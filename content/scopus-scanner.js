/*
 * Scopus AI Scanner V2.1.1 — in-page scanner (content script).
 *
 * Design goals
 *  - Zero interference with the user's computer: everything happens INSIDE this tab through the DOM.
 *    We never move the real mouse or steal focus; "clicks" are element.click() calls and scrolling is
 *    window.scrollTo() on this tab only. The user can keep working in other tabs/windows.
 *  - Dual Scanning Architecture (DOM + Full-Page Text Stream):
 *    Combines live DOM tree correlation with direct full-page text stream parsing to guarantee
 *    100% extraction of titles, authors, citations, DOIs, and abstracts without fragility against
 *    Elsevier markup changes.
 */
(() => {
  'use strict';
  if (window.__scopusAiScannerV2) {
    window.__scopusAiScannerV2.show();
    return;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i;
  const RECORD_HREF = /record\/display\.uri|\/pages\/publications\/\d|[?&]eid=2-s2\.0-\d+/i;

  // ------------------------------------------------------------------ card discovery
  function recordIdOf(a) {
    const href = a.getAttribute('href') || '';
    const eid = /[?&]eid=(2-s2\.0-\d+)/i.exec(href);
    if (eid) return eid[1];
    const pub = /\/pages\/publications\/(\d+)/i.exec(href);
    if (pub) return pub[1];
    return null;
  }

  function findCards() {
    const bySelector = Array.from(
      document.querySelectorAll('tr.searchArea, [data-testid="results-list-item"], li.search-results-list-item, article[data-testid*="result" i]')
    );
    if (bySelector.length) return bySelector.map((el) => ({ el, id: null }));

    const anchors = Array.from(document.querySelectorAll('a[href]')).filter((a) => RECORD_HREF.test(a.getAttribute('href') || '') && recordIdOf(a));
    const ids = new Map(); // id -> anchors
    for (const a of anchors) {
      const id = recordIdOf(a);
      if (!ids.has(id)) ids.set(id, []);
      ids.get(id).push(a);
    }
    if (!ids.size) return [];

    const out = [];
    for (const [id, list] of ids) {
      const titleA = list.reduce((best, a) => (clean(a.textContent).length > clean(best.textContent).length ? a : best), list[0]);
      let el = titleA;
      for (let i = 0; i < 12 && el.parentElement && el.parentElement !== document.body; i++) {
        const p = el.parentElement;
        const foreign = Array.from(p.querySelectorAll('a[href]')).some((a) => {
          if (!RECORD_HREF.test(a.getAttribute('href') || '')) return false;
          const other = recordIdOf(a);
          return other && other !== id;
        });
        if (foreign) break;
        el = p;
      }
      out.push({ el, id });
    }
    // de-dup nested elements, keep DOM order
    return out.filter((c, i) => out.findIndex((o) => o.el === c.el) === i);
  }

  // ------------------------------------------------------------------ abstract expanding (programmatic only)
  function isShowAbstract(label) {
    if (!label) return false;
    return /\b(show|view|read)\s+(the\s+)?(full\s+)?abstract\b/i.test(label) && !/\b(hide|all)\b/i.test(label);
  }

  function expandAllAbstractsGlobal() {
    const allEls = document.querySelectorAll('button, a, [role="button"], span');
    for (const el of allEls) {
      const label = clean(el.textContent) || el.getAttribute('aria-label') || '';
      if (/\bshow\s+all\s+abstracts\b/i.test(label) && !/\bhide\b/i.test(label)) {
        try {
          el.click();
          return true;
        } catch (_) {}
      }
    }
    return false;
  }

  function expandAbstractsIn(root) {
    let clicked = 0;
    const els = root.querySelectorAll('button, a, [role="button"], summary, span[tabindex]');
    for (const el of els) {
      const label = clean(el.textContent) || el.getAttribute('aria-label') || '';
      if (!isShowAbstract(label)) continue;
      if (el.getAttribute('aria-expanded') === 'true') continue;
      if (el.tagName === 'A' && /^https?:/i.test(el.getAttribute('href') || '') && !el.getAttribute('href').includes('#')) continue; // real navigation
      try {
        el.click();
        clicked++;
      } catch (_) {
        /* ignore */
      }
    }
    return clicked;
  }

  function expandVisibleAbstracts() {
    let clicked = 0;
    const els = document.querySelectorAll('button, a, [role="button"], summary, span[tabindex]');
    for (const el of els) {
      const label = clean(el.textContent) || el.getAttribute('aria-label') || '';
      if (!isShowAbstract(label)) continue;
      if (el.getAttribute('aria-expanded') === 'true') continue;
      if (el.tagName === 'A' && /^https?:/i.test(el.getAttribute('href') || '') && !el.getAttribute('href').includes('#')) continue;
      try {
        el.click();
        clicked++;
      } catch (_) {}
    }
    return clicked;
  }

  // ------------------------------------------------------------------ extraction
  function stripUi(text) {
    return clean(text)
      .replace(/\b(Hide|Show|View|Read)\s+(the\s+)?(full\s+)?abstract\s*[▾▼▲^v\u25BC\u25B2\u25BE\u25B4]?/gi, ' ')
      .replace(/\bView at Publisher\s*[↗\u2197]?/gi, ' ')
      .replace(/\bRelated documents\b/gi, ' ')
      .replace(/^Abstract\s*[:\-–]?\s*/i, '')
      .replace(/^[\s\-_—–:;•·|]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isTitle(text, title) {
    if (!title) return false;
    const cleanTitle = clean(title).toLowerCase();
    const cleanText = clean(text).toLowerCase();
    if (cleanText === cleanTitle) return true;
    if (cleanText.length < cleanTitle.length * 1.35 && cleanText.includes(cleanTitle)) return true;
    return false;
  }

  function isNoiseText(text) {
    if (!text) return true;
    if (/^([A-Z][a-zA-Z'’-]+,\s*[A-Z]\.?,?\s*){3,}$/.test(text)) return true;
    if (/^(\d+\s+)?citations?\b/i.test(text) && text.length < 120) return true;
    if (/^(hide|show|view|read)\s+(the\s+)?(full\s+)?abstract$/i.test(text)) return true;
    if (/^(view at publisher|related documents|open access|article|conference paper)$/i.test(text)) return true;
    return false;
  }

  function extractAbstract(card, title) {
    // 1. Proximity to "Hide abstract" / "Show abstract" toggle button
    const toggleEl = Array.from(card.querySelectorAll('button, a, [role="button"], summary, span')).find((el) => {
      const txt = clean(el.textContent);
      return /\b(hide|show)\s+(the\s+)?(full\s+)?abstract\b/i.test(txt);
    });

    if (toggleEl) {
      const controlsId = toggleEl.getAttribute('aria-controls') || toggleEl.getAttribute('aria-describedby');
      if (controlsId) {
        const target = card.querySelector('#' + CSS.escape(controlsId)) || document.getElementById(controlsId);
        if (target && card.contains(target)) {
          const t = stripUi(target.textContent);
          if (t.length >= 80 && !isTitle(t, title) && !isNoiseText(t)) return t;
        }
      }

      const rootsToCheck = [toggleEl, toggleEl.parentElement, toggleEl.parentElement?.parentElement].filter(Boolean);
      for (const r of rootsToCheck) {
        let sib = r.nextElementSibling;
        while (sib && card.contains(sib)) {
          const t = stripUi(sib.textContent);
          if (t.length >= 80 && !isTitle(t, title) && !isNoiseText(t)) {
            return t;
          }
          sib = sib.nextElementSibling;
        }
      }
    }

    // 2. Dedicated Scopus & publisher abstract selectors
    const dedicatedSelectors = [
      '.abstractText',
      '.ddmDocAbstract',
      '.abs',
      '[data-testid*="abstract" i]:not(button):not(a)',
      '[class*="abstractText" i]',
      '[class*="abstract-text" i]',
      '[class*="results-list-item-abstract" i]',
      '[data-testid="result-item-abstract"]',
      '[class*="abstract" i]:not(button):not(a):not([class*="toggle" i])',
      '[id*="abstract" i]:not(button):not(a):not([id*="toggle" i])'
    ];
    const dedicatedMatches = [];
    for (const el of card.querySelectorAll(dedicatedSelectors.join(', '))) {
      const t = stripUi(el.textContent);
      if (t.length >= 80 && !isTitle(t, title) && !isNoiseText(t)) {
        dedicatedMatches.push(t);
      }
    }
    if (dedicatedMatches.length) {
      dedicatedMatches.sort((a, b) => b.length - a.length);
      return dedicatedMatches[0];
    }

    // 3. Fallback: Innermost leaf text block detector
    // Allows ANY number of keyword highlights (spans), marks, math tags (sub/sup), or links
    const blocks = [];
    for (const el of card.querySelectorAll('p, div, section, article, dd, blockquote')) {
      if (el.closest('button, a, nav, header, ul, ol, .authors, [data-testid*="author" i]')) continue;
      const raw = el.textContent || '';
      if (raw.length < 90) continue;

      const t = stripUi(raw);
      if (t.length < 80 || isTitle(t, title) || isNoiseText(t)) continue;

      const hasLargeChild = Array.from(el.children).some((child) => {
        const childText = clean(child.textContent);
        return childText.length >= 90 && !isTitle(childText, title);
      });
      if (hasLargeChild) continue;

      blocks.push(t);
    }
    if (blocks.length) {
      blocks.sort((a, b) => b.length - a.length);
      return blocks[0];
    }

    return '';
  }

  function extractAuthors(card, title, fullLines) {
    const links = Array.from(card.querySelectorAll('a[href*="authorId" i], a[href*="authid" i], a[href*="/authid/"], a[href*="/authors/"]'))
      .map((a) => clean(a.textContent))
      .filter((t) => t && t.length < 60);
    if (links.length) return Array.from(new Set(links)).join('; ');
    const box = card.querySelector('.ddmAuthorList, [data-testid*="author" i], [class*="author" i]');
    if (box) {
      const t = clean(box.textContent);
      if (t && t.length < 400) return t;
    }
    const line = fullLines.find((l) => l !== title && /([A-Z][a-zA-Z'’-]+,\s*[A-Z]\.)/.test(l) && l.length < 220 && !/abstract/i.test(l));
    return line || '';
  }

  function extractCard({ el: card, id }, order) {
    const text = card.innerText || '';
    const lines = text.split('\n').map(clean).filter(Boolean);

    const titleA =
      (id && Array.from(card.querySelectorAll('a[href]')).filter((a) => recordIdOf(a) === id).sort((a, b) => clean(b.textContent).length - clean(a.textContent).length)[0]) ||
      card.querySelector('h2 a, h3 a, h4 a, a.ddmDocTitle, [data-testid*="title" i] a, a[href*="record/display"]');
    const titleEl = titleA || card.querySelector('h2, h3, h4, [class*="title" i]');
    const title = clean(titleEl?.textContent);
    if (!title) return null;
    const url = titleA?.href || '';
    const eid =
      id ||
      (/[?&]eid=(2-s2\.0-\d+)/i.exec(url) || [])[1] ||
      (/\/pages\/publications\/(\d+)/i.exec(url) || [])[1] ||
      '';

    const abstract = extractAbstract(card, title);
    const authors = extractAuthors(card, title, lines);

    let docType = '';
    const dt = /(?:^|\n)\s*(?:\d+\s+)?(Conference paper|Article|Review|Book chapter|Data paper|Short survey|Letter|Editorial|Note|Book)\b/i.exec(text);
    if (dt) docType = dt[1];

    // venue + year (year is searched outside the abstract so years inside the abstract are ignored)
    let venue = '';
    const venueEl = card.querySelector('a[href*="/sourceid/"], a[href*="sourceId" i], .ddmPubTitle, [data-testid*="source" i]');
    if (venueEl) venue = clean(venueEl.textContent);
    const nonAbstract = abstract ? text.replace(abstract.slice(0, 60), '\u0000').split('\u0000')[0] : text;
    const scope = (venueEl?.parentElement?.textContent || '') + '\n' + nonAbstract;
    const ym = /\b(19[5-9]\d|20[0-4]\d)\b/.exec(scope.replace(title, ''));
    const year = ym ? parseInt(ym[1], 10) : null;
    if (!venue) {
      const vl = lines.find((l) => l !== title && l !== authors && /\b(19[5-9]\d|20[0-4]\d)\b/.test(l) && l.length < 200 && !/^(this|in this|abstract)/i.test(l));
      if (vl) venue = clean(vl.split(/\b(19[5-9]\d|20[0-4]\d)\b/)[0]).replace(/[,;.\s]+$/, '');
    }

    let citations = 0;
    const cm = /(\d[\d,]*)\s*\n?\s*Citations?\b/i.exec(text) || /Cited by\s*(\d[\d,]*)/i.exec(text);
    if (cm) citations = parseInt(cm[1].replace(/,/g, ''), 10);

    let doi = '';
    const dm = DOI_RE.exec(text);
    if (dm) doi = dm[0];
    if (!doi) {
      for (const el of card.querySelectorAll('a[href], button[data-doi], [data-doi], [data-url], [data-target], [data-link]')) {
        for (const attr of ['href', 'data-doi', 'data-url', 'data-target', 'data-link']) {
          const val = el.getAttribute(attr);
          if (!val) continue;
          try {
            const decoded = decodeURIComponent(val);
            const m = DOI_RE.exec(decoded);
            if (m) {
              doi = m[0];
              break;
            }
          } catch (_) {}
        }
        if (doi) break;
      }
    }
    doi = doi.replace(/[.,;)\]]+$/, '');

    return { order, eid, title, authors, year, venue, docType, citations, doi, abstract, url };
  }

  // ------------------------------------------------------------------ full-page text stream scanner
  function stripAbstractUi(text) {
    return clean(text)
      .replace(/^(?:Hide|Show|View|Read)\s+(?:the\s+)?(?:full\s+)?abstract\s*[▾▼▲^v\u25BC\u25B2\u25BE\u25B4]?\s*/i, '')
      .replace(/^(?:View at Publisher\s*[↗\u2197]?\s*)+/i, '')
      .replace(/^(?:Related documents\s*)+/i, '')
      .replace(/^Abstract\s*[:\-–]?\s*/i, '')
      .replace(/^[\s\-_—–:;•·|]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function scanPageFromText(fullText) {
    const text = (fullText || '').replace(/\r\n/g, '\n');
    if (!text.trim()) return [];

    // Step 1: Detect all numbered paper headings (e.g. "\n1\n", "\n2\n", "\n14\n")
    const rowRegex = /(?:^|\n)\s*(\d{1,4})\s*\n/g;
    let match;
    const numberedIndices = [];

    while ((match = rowRegex.exec(text)) !== null) {
      const num = parseInt(match[1], 10);
      if (num >= 1 && num <= 500) {
        const nextSlice = text.slice(match.index + match[0].length, match.index + match[0].length + 140);
        const firstLine = clean(nextSlice.split('\n')[0]);
        const isDocType = /^(Article|Review|Conference paper|Book chapter|Book|Data paper|Short survey|Editorial|Letter|Note)\b/i.test(firstLine);
        const isTitleLike = firstLine.length >= 15 && !/^(Hide|Show|Citations|Sort by|Download|Export)/i.test(firstLine);
        if (isDocType || isTitleLike) {
          numberedIndices.push({ index: match.index, num });
        }
      }
    }

    if (numberedIndices.length >= 2) {
      const papers = [];
      for (let i = 0; i < numberedIndices.length; i++) {
        const cur = numberedIndices[i];
        const nextIndex = i + 1 < numberedIndices.length ? numberedIndices[i + 1].index : text.length;
        const block = text.slice(cur.index, nextIndex).trim();

        const toggleMatch = /(?:Hide|Show|View|Read)\s+(?:the\s+)?(?:full\s+)?abstract\b[^\n]*/i.exec(block);
        let abstract = '';
        let headerText = block;

        if (toggleMatch) {
          headerText = block.slice(0, toggleMatch.index).trim();
          const afterToggle = block.slice(toggleMatch.index + toggleMatch[0].length);
          abstract = stripAbstractUi(afterToggle);
        }

        const lines = headerText.split('\n').map(clean).filter(Boolean);
        if (lines[0] === String(cur.num)) lines.shift();

        let docType = '';
        if (lines[0] && /^(Article|Review|Conference paper|Book chapter|Book|Data paper|Short survey|Editorial|Letter|Note)\b/i.test(lines[0])) {
          docType = lines.shift();
        }

        const title = lines[0] || '';
        let authors = '';
        let venue = '';
        let year = null;
        let citations = 0;

        const remaining = lines.slice(1);
        for (let k = 0; k < remaining.length; k++) {
          const line = remaining[k];
          if (!authors && /([A-Z][a-zA-Z'’\-]+,?\s+[A-Z]\.[A-Z\.]*|[A-Z][a-zA-Z'’\-]+,\s*[A-Z])/.test(line) && line.length < 300) {
            authors = line;
            continue;
          }
          const ym = /\b(19[5-9]\d|20[0-4]\d)\b/.exec(line);
          if (ym) {
            year = parseInt(ym[1], 10);
            if (!venue && k > 0 && remaining[k - 1] !== authors) {
              venue = remaining[k - 1];
            }
          }
          const cm = /(\d+)\s+Citations?\b/i.exec(line) || /Cited by\s*(\d+)/i.exec(line);
          if (cm) citations = parseInt(cm[1], 10);
          else if (/^\d+$/.test(line) && parseInt(line, 10) < 50000 && k === remaining.length - 1) {
            citations = parseInt(line, 10);
          }
        }

        if (title) {
          papers.push({ order: cur.num, docType, title, authors, venue, year, citations, abstract });
        }
      }
      return papers;
    }

    // Fallback: Segment by Abstract Toggle markers
    const markerRegex = /\b(?:Hide|Show|View|Read)\s+(?:the\s+)?(?:full\s+)?abstract\b[^\n]*/gi;
    const toggleIndices = [];
    let tm;
    while ((tm = markerRegex.exec(text)) !== null) {
      if (/\ball\s+abstracts\b/i.test(tm[0])) continue;
      toggleIndices.push({ index: tm.index, match: tm[0] });
    }

    const papers = [];
    for (let i = 0; i < toggleIndices.length; i++) {
      const cur = toggleIndices[i];
      const prevEnd = i === 0 ? 0 : toggleIndices[i - 1].index;
      const nextStart = i + 1 < toggleIndices.length ? toggleIndices[i + 1].index : text.length;

      const rawHeader = text.slice(prevEnd, cur.index);
      const rawAfter = text.slice(cur.index + cur.match.length, nextStart);

      const nextPaperMatch = /\n\s*(?:(?:\d{1,4}\s*\n\s*(?:Article|Review|Conference|Book|Data|Letter|Note)\b)|(?:Article|Review|Conference paper|Book chapter)\b)/i.exec(rawAfter);
      const abstractText = nextPaperMatch ? rawAfter.slice(0, nextPaperMatch.index) : rawAfter;
      const abstract = stripAbstractUi(abstractText);

      const lines = rawHeader.split('\n').map(clean).filter(Boolean);
      const titleCandidates = lines.filter(
        (l) =>
          l.length >= 20 &&
          !/^(Scopus|Search|Sources|SciVal|\d+ documents found|Hide all abstracts|Show all abstracts|Sort by|All Export)/i.test(l) &&
          !/^(Article|Review|Conference paper|Book chapter)\b/i.test(l) &&
          !/^([A-Z][a-zA-Z'’\-]+,?\s+[A-Z]\.)/.test(l)
      );
      const title = titleCandidates[titleCandidates.length - 1] || '';

      if (title) {
        papers.push({ order: i + 1, docType: '', title, authors: '', venue: '', year: null, citations: 0, abstract });
      }
    }
    return papers;
  }

  function correlateWithDom(papers) {
    const anchors = Array.from(document.querySelectorAll('a[href]'))
      .filter((a) => RECORD_HREF.test(a.getAttribute('href') || '') && recordIdOf(a));

    const seenIds = new Set();
    const uniqueAnchors = [];
    for (const a of anchors) {
      const id = recordIdOf(a);
      if (!seenIds.has(id)) {
        seenIds.add(id);
        uniqueAnchors.push({ id, a, title: clean(a.textContent) });
      }
    }

    const doiMap = new Map();
    for (const el of document.querySelectorAll('a[href], button[data-doi], [data-doi], [data-url], [data-target], [data-link]')) {
      for (const attr of ['href', 'data-doi', 'data-url', 'data-target', 'data-link']) {
        const val = el.getAttribute(attr);
        if (!val) continue;
        try {
          const m = DOI_RE.exec(decodeURIComponent(val));
          if (m) {
            const cardEl = el.closest('tr, li, article, [data-testid*="result" i], div');
            if (cardEl) {
              const cardTitle = clean(cardEl.querySelector('h2, h3, h4, a[href*="record/display"]')?.textContent);
              if (cardTitle) doiMap.set(cardTitle.toLowerCase().slice(0, 45), m[0]);
            }
          }
        } catch (_) {}
      }
    }

    for (let i = 0; i < papers.length; i++) {
      const p = papers[i];
      if (!p.title) continue;
      const normTitle = p.title.toLowerCase();

      const matched =
        uniqueAnchors.find((u) => {
          const ut = u.title.toLowerCase();
          return ut === normTitle || ut.includes(normTitle.slice(0, 40)) || normTitle.includes(ut.slice(0, 40));
        }) || uniqueAnchors[i];

      if (matched) {
        if (!p.eid) p.eid = matched.id;
        if (!p.url) p.url = matched.a.href;
      }

      if (!p.doi) {
        const key = normTitle.slice(0, 45);
        if (doiMap.has(key)) p.doi = doiMap.get(key);
      }
    }
    return papers;
  }

  // ------------------------------------------------------------------ query / meta
  function detectQuery() {
    const box = document.querySelector('textarea[name*="query" i], input[name*="query" i], textarea, input[type="search"]');
    const v = clean(box?.value || box?.textContent || '');
    if (v) return v;
    try {
      const p = new URL(location.href).searchParams;
      return clean(p.get('s') || p.get('st1') || p.get('query') || '');
    } catch (_) {
      return '';
    }
  }

  function reportedTotal() {
    const m = /([\d,]+)\s+(?:document\s+)?results?\b/i.exec(document.body?.innerText?.slice(0, 6000) || '');
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }

  // ------------------------------------------------------------------ scan
  let cancelRequested = false;
  let scanning = false;

  async function scan(onProgress) {
    scanning = true;
    cancelRequested = false;
    const startY = window.scrollY;
    const found = new Map(); // key -> paper
    const keyOf = (p) => p.eid || p.doi || p.title;

    const harvest = () => {
      expandAllAbstractsGlobal();
      expandVisibleAbstracts();
      for (const c of findCards()) {
        expandAbstractsIn(c.el);
      }
    };
    const collect = () => {
      // 1. Text stream engine (Scans the full page text directly!)
      const textPapers = correlateWithDom(scanPageFromText(document.body.innerText));
      for (const tp of textPapers) {
        const k = keyOf(tp);
        const prev = found.get(k);
        if (!prev) found.set(k, tp);
        else {
          for (const f of Object.keys(tp)) {
            if (!prev[f] || (typeof tp[f] === 'string' && tp[f].length > String(prev[f]).length)) {
              prev[f] = tp[f];
            }
          }
        }
      }

      // 2. DOM cards engine
      for (const c of findCards()) {
        const p = extractCard(c, found.size + 1);
        if (!p) continue;
        const k = keyOf(p);
        const prev = found.get(k);
        if (!prev) found.set(k, p);
        else {
          for (const f of Object.keys(p)) {
            if (!prev[f] || (typeof p[f] === 'string' && p[f].length > String(prev[f]).length)) {
              prev[f] = p[f];
            }
          }
        }
      }
      onProgress({ found: found.size, withAbstract: [...found.values()].filter((p) => p.abstract).length });
    };

    try {
      window.scrollTo({ top: 0, behavior: 'instant' });
      await sleep(300);
      expandAllAbstractsGlobal();
      expandVisibleAbstracts();
      await sleep(350);
      let stable = 0;
      let lastCount = -1;
      let lastY = -1;
      for (let step = 0; step < 220 && !cancelRequested; step++) {
        harvest();
        await sleep(350); // let React render expanded abstracts
        collect();
        const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
        if (atBottom) {
          stable = found.size === lastCount && window.scrollY === lastY ? stable + 1 : 0;
          if (stable >= 2) break;
        } else stable = 0;
        lastCount = found.size;
        lastY = window.scrollY;
        window.scrollBy({ top: Math.max(300, Math.round(window.innerHeight * 0.8)), behavior: 'instant' });
        // Chrome pauses rendering in background tabs, so real "scroll" events would never fire there and
        // lazy-loaded lists would stop growing. Fire the signal ourselves so scanning works while you
        // work in other tabs.
        window.dispatchEvent(new Event('scroll'));
        document.dispatchEvent(new Event('scroll'));
        await sleep(250);
      }
      // gap-fill: second chance for cards still without an abstract
      if (!cancelRequested) {
        window.scrollTo({ top: 0, behavior: 'instant' });
        await sleep(200);
        harvest();
        await sleep(900);
        collect();
      }
    } finally {
      window.scrollTo({ top: startY, behavior: 'instant' });
      scanning = false;
    }
    const papers = [...found.values()].map((p, i) => ({ ...p, order: i + 1 }));
    return { papers, cancelled: cancelRequested };
  }

  // ------------------------------------------------------------------ UI (shadow DOM, bottom-right dock)
  const host = document.createElement('div');
  host.id = 'scopus-ai-scanner-v2-host';
  host.style.cssText = 'all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host{all:initial}
      .pill{font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1c1917;background:#ffffff;border:1px solid #ece7de;
        border-radius:10px;box-shadow:0 12px 28px -4px rgba(35,30,25,.14),0 4px 10px -2px rgba(35,30,25,.06);padding:13px 15px;min-width:260px;max-width:320px}
      .row{display:flex;align-items:center;gap:8px}
      .brand{font-family:"Newsreader","Playfair Display","Merriweather","Georgia",serif;font-weight:700;color:#1c1917;font-size:14px;letter-spacing:-.01em;flex:1;display:flex;align-items:center;gap:6px}
      .tag{font-size:10.5px;font-family:ui-monospace,monospace;padding:1px 6px;border-radius:4px;background:#f8f6f2;border:1px solid #ece7de;color:#78716c;font-weight:600}
      .x{border:0;background:none;cursor:pointer;color:#78716c;font-size:16px;line-height:1;padding:2px 4px;border-radius:4px}
      .x:hover{color:#1c1917;background:#f8f6f2}
      .stat{margin:8px 0 10px;color:#44403c;font-size:12.5px}
      .stat b{color:#b91c1c;font-variant-numeric:tabular-nums;font-weight:700}
      .bar{height:5px;background:#f8f6f2;border-radius:9999px;overflow:hidden;margin:2px 0 10px;border:1px solid #ece7de}
      .bar>i{display:block;height:100%;width:0;background:#b91c1c;transition:width .2s}
      button.btn{width:100%;border:1px solid #b91c1c;border-radius:8px;padding:8px 10px;font:600 12.5px -apple-system,sans-serif;cursor:pointer;background:#b91c1c;color:#fff;transition:all .12s ease;box-shadow:0 1px 3px rgba(35,30,25,.04)}
      button.btn:hover{background:#991b1b;border-color:#991b1b}
      button.btn:active{transform:translateY(1px)}
      button.btn.alt{background:#ffffff;border-color:#ece7de;color:#1c1917;margin-top:6px}
      button.btn.alt:hover{background:#f8f6f2;border-color:#ded7c9}
      button.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
      .msg{font-size:11.5px;color:#78716c;margin-top:8px;line-height:1.35}
      .ok{color:#059669;font-weight:600}.warn{color:#c2410c;font-weight:600}
      .mini{display:none;cursor:pointer;background:#1c1917;color:#fff;border-radius:8px;padding:7px 12px;font:600 12px sans-serif;box-shadow:0 4px 14px rgba(35,30,25,.25);border:1px solid #332d26}
      .collapsed .pill{display:none}.collapsed .mini{display:block}
    </style>
    <div id="wrap">
      <div class="pill">
        <div class="row">
          <span class="brand">Scopus AI Scanner <span class="tag">v2.1.1</span></span>
          <button class="x" id="min" title="Minimise">–</button>
        </div>
        <div class="stat" id="stat">Looking for results…</div>
        <div class="bar" id="barwrap" hidden><i id="bar"></i></div>
        <button class="btn" id="scan">Scan this page → Dashboard</button>
        <button class="btn alt" id="open">Open dashboard</button>
        <div class="msg" id="msg">Tip: set results to 100 per page first. Abstracts are expanded automatically.</div>
      </div>
      <div class="mini" id="mini">Scanner</div>
    </div>`;
  const $ = (id) => root.getElementById(id);
  const statEl = $('stat');
  const msgEl = $('msg');
  const scanBtn = $('scan');
  let hidden = false;

  function refreshStat() {
    if (scanning) return;
    const cards = findCards().length;
    const textPapers = scanPageFromText(document.body.innerText).length;
    const n = Math.max(cards, textPapers);
    statEl.innerHTML = n ? `<b>${n}</b> papers detected on this page` : 'No result cards detected yet…';
    scanBtn.disabled = !n;
    host.style.display = hidden ? 'none' : '';
  }

  async function runScan() {
    if (scanning) {
      cancelRequested = true;
      scanBtn.textContent = 'Cancelling…';
      return;
    }
    scanBtn.textContent = 'Cancel scan';
    $('barwrap').hidden = false;
    msgEl.className = 'msg';
    msgEl.textContent = 'Scanning inside this tab — you can keep working in other windows.';
    const { papers, cancelled } = await scan(({ found, withAbstract }) => {
      statEl.innerHTML = `Scanning… <b>${found}</b> found · <b>${withAbstract}</b> with abstract`;
      const span = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      $('bar').style.width = `${Math.min(100, Math.round((window.scrollY / span) * 100))}%`;
    });
    scanBtn.textContent = 'Scan this page → Dashboard';
    $('barwrap').hidden = true;
    if (!papers.length) {
      statEl.textContent = 'No papers found.';
      msgEl.className = 'msg warn';
      msgEl.textContent = 'Make sure the results list is visible, then try again.';
      return;
    }
    const missing = papers.filter((p) => !p.abstract).length;
    const payload = {
      scanId: `${Date.now()}`,
      scannedAt: Date.now(),
      pageUrl: location.href,
      query: detectQuery(),
      reportedTotal: reportedTotal(),
      papers
    };
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SCOPUS_SCAN_RESULT', payload });
      statEl.innerHTML = `<span class="ok">✓ Sent ${papers.length} papers</span>${cancelled ? ' (cancelled early)' : ''}`;
      const total = payload.reportedTotal;
      const incomplete = total && total <= 200 && papers.length < Math.floor(total * 0.95);
      msgEl.className = 'msg' + (missing || incomplete ? ' warn' : ' ok');
      msgEl.textContent = incomplete
        ? `Page says ${total} results but only ${papers.length} were captured. Keep this tab visible (or in its own window) and scan again — duplicates are skipped.`
        : missing
          ? `${missing} paper(s) had no abstract text — click "Show abstract" on them and scan again (duplicates are skipped).`
          : 'All abstracts captured. Open the dashboard to start AI grading.';
      if (!res?.ok) throw new Error(res?.error || 'No response from extension');
    } catch (e) {
      statEl.innerHTML = '<span class="warn">Could not reach the extension</span>';
      msgEl.className = 'msg warn';
      msgEl.textContent = `Reload the page and try again (${e.message}).`;
    }
  }

  scanBtn.addEventListener('click', runScan);
  $('open').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD', focus: true }));
  $('min').addEventListener('click', () => $('wrap').classList.add('collapsed'));
  $('mini').addEventListener('click', () => $('wrap').classList.remove('collapsed'));

  document.documentElement.appendChild(host);
  host.style.display = 'none';

  let t = null;
  const mo = new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => {
      const hasCards = findCards().length > 0;
      if (hasCards && !hidden) host.style.display = '';
      refreshStat();
    }, 500);
  });
  mo.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => {
    if (findCards().length) host.style.display = '';
    refreshStat();
  }, 800);

  window.__scopusAiScannerV2 = {
    show() {
      hidden = false;
      host.style.display = '';
      $('wrap').classList.remove('collapsed');
      refreshStat();
    }
  };
})();
