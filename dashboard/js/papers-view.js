// Papers tab: metrics, AI queue controls, filters, table, detail dialog, exports.
import { state, emit, on, esc, $, $$, toast, topicOf, currentYear, debounce } from './state.js';
import { putPaper, putPapers, deletePaper, clearPapers } from './db.js';
import { computeGrade, bestTopicOf, keywordHits, normalizeTitle } from './scoring.js';
import { AiQueue } from './queue.js';
import { toCSV, toBibTeX, toBibTeXAll, buildWorkbook, download, safeName } from './exporter.js';

export const queue = new AiQueue({
  getPaper: async (key) => state.papers.find((p) => p.key === key),
  getConfig: () => state.project,
  getSettings: () => state.settings,
  onPaper: async (p) => {
    await putPaper(p);
    scheduleRender();
  },
  onState: (s) => {
    state.queue = s;
    renderQueue();
    if (s.state === 'idle' || s.remaining === 0) {
      renderMetrics();
      renderPapers();
    } else {
      scheduleRender();
    }
  }
});

const isExcluded = (p) => p.decision === 'Exclude';
const gradeOf = (p) => computeGrade(p, state.project, currentYear());

// ------------------------------------------------------------------ persistence helpers
export const savePaper = (p) => putPaper(p);

// ------------------------------------------------------------------ filtering
function visiblePapers() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  let list = state.papers.filter((p) => {
    if (q && !`${p.title} ${p.authors} ${p.abstract} ${p.venue} ${p.doi}`.toLowerCase().includes(q)) return false;
    if (f.topic !== 'all') {
      const best = p.eval ? bestTopicOf(p.eval, state.project.topics) : null;
      if (f.topic === 'none' ? best : best !== f.topic) return false;
    }
    if (f.tier !== 'all') {
      const g = gradeOf(p);
      if (f.tier === 'ungraded' ? g : !g || g.tier !== f.tier) return false;
    }
    if (f.decision !== 'all') {
      if (f.decision === 'none' ? p.decision : p.decision !== f.decision) return false;
    }
    return true;
  });
  const by = {
    order: (a, b) => (a.addedAt - b.addedAt) || (a.order - b.order),
    score: (a, b) => (gradeOf(b)?.pct ?? -1) - (gradeOf(a)?.pct ?? -1),
    year: (a, b) => (b.year || 0) - (a.year || 0),
    citations: (a, b) => (b.citations || 0) - (a.citations || 0),
    title: (a, b) => String(a.title).localeCompare(String(b.title))
  }[f.sort];
  list = list.sort(by);
  return list;
}

// ------------------------------------------------------------------ metrics + queue
function renderMetrics() {
  const ps = state.papers;
  const graded = ps.filter((p) => p.eval);
  const t = { 'Tier 1': 0, 'Tier 2': 0, 'Tier 3': 0 };
  for (const p of graded) if (!isExcluded(p)) t[gradeOf(p).tier]++;
  const errs = ps.filter((p) => p.status === 'error').length;
  const waiting = ps.filter((p) => !p.eval && !isExcluded(p)).length;
  $('#metrics').innerHTML = [
    ['m-total', ps.length, 'Papers scanned', 'TOTAL CORPUS', 'Full-page text stream'],
    ['m-graded', graded.length, 'AI-graded', 'EVALUATED', 'Completed scoring'],
    ['t1', t['Tier 1'], 'Tier 1 · read first', 'TIER 1 (MUST READ)', 'High topic alignment'],
    ['t2', t['Tier 2'], 'Tier 2 · maybe', 'TIER 2 (MAYBE)', 'Moderate relevance'],
    ['t3', t['Tier 3'], 'Tier 3 · low fit', 'TIER 3 (LOW FIT)', 'Contextual or marginal'],
    ['m-waiting', waiting, 'Waiting for grading', 'PENDING QUEUE', 'Ready for Gemini'],
    ['err', errs, 'Failed', 'ERRORS', 'Requires retry']
  ]
    .map(([c, n, l, eye, sub]) => `
      <div class="metric ${c}">
        <span class="metric-eyebrow">${eye}</span>
        <b>${n}</b>
        <span class="metric-label">${l}</span>
        <span class="metric-sub">${sub}</span>
      </div>
    `)
    .join('');
}

function selectedUngradedKeys() {
  return state.papers.filter((p) => state.selected.has(p.key) && !isExcluded(p)).map((p) => p.key);
}
function ungradedKeys() {
  return state.papers.filter((p) => !p.eval && !isExcluded(p) && p.status !== 'queued' && p.status !== 'running').map((p) => p.key);
}

export function renderQueue() {
  const q = state.queue;
  const startBtn = $('#startBtn');
  const sel = selectedUngradedKeys();
  const pending = sel.length ? sel : ungradedKeys();
  const running = q.state === 'running';
  const paused = q.state === 'paused';
  startBtn.hidden = running || paused;
  startBtn.disabled = !pending.length && !state.papers.some((p) => p.status === 'queued');
  const playIcon = '<svg class="icon-svg" viewBox="0 0 24 24" style="fill:currentColor;stroke:none;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
  startBtn.innerHTML = `${playIcon} ${sel.length ? `Grade ${sel.length} selected` : `Start AI evaluation (${pending.length})`}`;
  $('#pauseBtn').hidden = !running;
  $('#resumeBtn').hidden = !paused;
  $('#clearQueueBtn').hidden = !(running || paused);
  const prog = $('#progress');
  prog.hidden = !(running || paused);
  const text = $('#queueText');
  const interval = state.settings.intervalSec;
  if (running || paused) {
    const total = Math.max(q.remaining, state.papers.filter((p) => p.status === 'queued' || p.status === 'running' || p.status === 'done').length);
    const done = total - q.remaining;
    $('#progressBar').style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    const mins = Math.max(1, Math.round((q.remaining * interval) / 60));
    text.innerHTML = running
      ? `<b>Grading…</b> ${q.remaining} left · about ${mins} min. You can switch tabs or work on other things — this tab keeps going.${q.message ? `<div class="banner">${esc(q.message)}</div>` : ''}`
      : `<b>Paused.</b> ${q.remaining} papers waiting.${q.message ? `<div class="banner">${esc(q.message)}</div>` : ''}`;
  } else if (!state.papers.length) {
    text.textContent = 'Scan papers on Scopus, review them below, then start grading.';
  } else if (pending.length) {
    const mins = Math.max(1, Math.round((pending.length * interval) / 60));
    text.textContent = `${pending.length} paper${pending.length === 1 ? '' : 's'} ready to grade (about ${mins} min at ${interval}s per paper). Review the list first — untick/exclude duplicates you don't need.`;
  } else {
    text.textContent = 'All papers are graded. Scan another Scopus page to add more.';
  }
}

// ------------------------------------------------------------------ table
const linksOf = (p) => {
  const out = [];
  if (p.url) out.push(`<a href="${esc(p.url)}" target="_blank" rel="noreferrer">Scopus</a>`);
  if (p.doi) {
    out.push(`<a href="https://doi.org/${esc(p.doi)}" target="_blank" rel="noreferrer">DOI</a>`);
    if (state.settings.scihub) out.push(`<a href="${esc(state.settings.scihubUrl.replace(/\/?$/, '/'))}${esc(p.doi)}" target="_blank" rel="noreferrer">Sci-Hub</a>`);
  } else out.push('<span class="muted small">no DOI</span>');
  return out.join('');
};

function topicChips(p) {
  const topics = state.project.topics;
  if (p.eval) {
    const best = bestTopicOf(p.eval, topics);
    const chips = [];
    if (best) {
      const t = topicOf(best);
      chips.push(`<span class="tchip" title="${esc(t.name)}"><i style="background:${esc(t.color)}"></i>${esc(best)} · ${esc(t.name.slice(0, 22))}</span>`);
    } else chips.push('<span class="tchip">No clear match</span>');
    for (const t of topics) {
      if (t.code !== best && (p.eval.topicRelevance?.[t.code] || 0) >= 2) chips.push(`<span class="tchip hit" title="${esc(t.name)}"><i style="background:${esc(t.color)}"></i>${esc(t.code)}</span>`);
    }
    return chips.join('');
  }
  const hits = keywordHits(p, topics);
  const chips = topics
    .filter((t) => hits[t.code] > 0)
    .sort((a, b) => hits[b.code] - hits[a.code])
    .map((t) => `<span class="tchip hit" title="${hits[t.code]} keyword hit(s) — ${esc(t.name)}"><i style="background:${esc(t.color)}"></i>${esc(t.code)} · ${hits[t.code]}</span>`);
  return chips.length ? chips.join('') : '<span class="muted small">—</span>';
}

function gradeCell(p) {
  if (p.status === 'running') return '<span class="badge run">Grading…</span>';
  if (p.status === 'queued') return '<span class="badge run">Queued</span>';
  if (p.status === 'error') return `<span class="badge err" title="${esc(p.error)}">Error</span>`;
  const g = gradeOf(p);
  if (!g) return '<span class="muted small">Not graded</span>';
  const cls = g.tier === 'Tier 1' ? 't1' : g.tier === 'Tier 2' ? 't2' : 't3';
  return `<span class="badge ${cls}">${g.tier}</span><div class="score">${g.total}/${g.max} · ${Math.round(g.pct)}%</div>`;
}

let renderTimer = null;
export function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderPapers();
  }, 120);
}

export function renderPapers() {
  if (!state.project) return;
  renderMetrics();
  renderQueue();
  renderTopicFilter();
  const list = visiblePapers();
  $('#emptyState').hidden = state.papers.length > 0;
  $('#papersTable').hidden = state.papers.length === 0;
  const body = $('#papersBody');
  body.innerHTML = list
    .map((p, i) => {
      const meta = [p.authors && esc(p.authors.length > 90 ? p.authors.slice(0, 90) + '…' : p.authors), p.year, esc(p.venue), esc(p.docType), p.citations ? `${p.citations} cites` : '']
        .filter(Boolean)
        .join(' · ');
      return `<tr data-key="${esc(p.key)}" class="${isExcluded(p) ? 'excluded' : ''}">
        <td><input type="checkbox" class="sel" ${state.selected.has(p.key) ? 'checked' : ''} /></td>
        <td class="w-num">${i + 1}</td>
        <td>${gradeCell(p)}</td>
        <td>${topicChips(p)}</td>
        <td><a class="ptitle" data-act="open">${esc(p.title)}</a>${p.decision ? `<span class="pill-dec ${esc(p.decision)}">${esc(p.decision)}</span>` : ''}
          <div class="pmeta">${meta}</div>
          ${p.eval?.summary ? `<div class="psum">${esc(p.eval.summary)}</div>` : !p.abstract ? '<div class="pmeta" style="color:var(--warn);font-weight:500">No abstract captured</div>' : ''}
          ${p.status === 'error' ? `<div class="pmeta" style="color:var(--bad)">${esc(p.error)}</div>` : ''}</td>
        <td class="links">${linksOf(p)}</td>
        <td><button class="xbtn" data-act="open" title="Details" aria-label="Details"><svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1.5"></circle><circle cx="19" cy="12" r="1.5"></circle><circle cx="5" cy="12" r="1.5"></circle></svg></button></td></tr>`;
    })
    .join('');
  $('#selectionInfo').textContent = `${list.length} of ${state.papers.length} papers shown${state.selected.size ? ` · ${state.selected.size} selected` : ''}`;
}

function renderTopicFilter() {
  const sel = $('#fTopic');
  const sig = state.project.topics.map((t) => t.code + t.name).join('|');
  if (sel.dataset.sig === sig) return;
  sel.dataset.sig = sig;
  sel.innerHTML =
    '<option value="all">All topics</option>' +
    state.project.topics.map((t) => `<option value="${esc(t.code)}">${esc(t.code)} · ${esc(t.name)}</option>`).join('') +
    '<option value="none">No clear topic</option>';
  sel.value = state.filters.topic;
}

// ------------------------------------------------------------------ detail dialog
export function openPaper(key) {
  const p = state.papers.find((x) => x.key === key);
  if (!p) return;
  const cfg = state.project;
  const g = gradeOf(p);
  const best = p.eval ? bestTopicOf(p.eval, cfg.topics) : null;
  const dlg = $('#paperDialog');
  const bars = p.eval
    ? [
        ...cfg.criteria.map((c) => [c.label, p.eval.criteria?.[c.id] ?? 0]),
        ...(cfg.recencyEnabled === false ? [] : [['Recency (auto)', g.recency]])
      ]
        .map(([l, v]) => `<div class="sbar">${esc(l)}<b>${v}/3</b><div class="track"><i style="width:${(v / 3) * 100}%"></i></div></div>`)
        .join('')
    : '';
  const relRow = p.eval
    ? cfg.topics.map((t) => `<span class="tchip"><i style="background:${esc(t.color)}"></i>${esc(t.code)}: ${p.eval.topicRelevance?.[t.code] ?? 0}/3</span>`).join('')
    : '';
  const notes = p.eval
    ? `<dl class="kv">${cfg.noteFields.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(p.eval.notes?.[f.id] || '—')}</dd>`).join('')}</dl>`
    : '<p class="muted">Not graded yet.</p>';
  $('#paperDialogBody').innerHTML = `
    <div class="dialog-head">
      <div><h3>${esc(p.title)}</h3>
        <div class="pmeta">${esc(p.authors)} · ${p.year || '?'} · ${esc(p.venue)} · ${esc(p.docType)}${p.citations ? ` · ${p.citations} citations` : ''}</div>
        <div class="links" style="margin-top:6px">${linksOf(p)}</div></div>
      <button class="btn ghost" data-close>✕</button>
    </div>
    <div class="dialog-body">
      ${g ? `<div class="row"><span class="badge ${g.tier === 'Tier 1' ? 't1' : g.tier === 'Tier 2' ? 't2' : 't3'}">${g.tier}</span><b>${g.total}/${g.max}</b><span class="muted">${Math.round(g.pct)}%</span>${best ? `<span class="tchip"><i style="background:${esc(topicOf(best).color)}"></i>Best: ${esc(best)} · ${esc(topicOf(best).name)}</span>` : ''}</div>` : ''}
      ${p.eval?.summary ? `<p><b>Summary:</b> ${esc(p.eval.summary)}</p>` : ''}
      ${bars ? `<div class="scorebars">${bars}</div>` : ''}
      ${relRow ? `<div>${relRow}</div>` : ''}
      <div><h3>Deep notes</h3>${notes}</div>
      <div><h3>Abstract</h3><div class="abstract">${esc(p.abstract) || '<span class="muted">No abstract captured.</span>'}</div></div>
      <div class="grid2">
        <label>My decision
          <select id="dDecision"><option value="">Undecided</option><option>Include</option><option>Maybe</option><option>Exclude</option></select></label>
        <label>My notes<textarea id="dNote" rows="2" placeholder="Your own notes…"></textarea></label>
      </div>
      <div class="row">
        <button class="btn primary" data-act="regrade">↻ Re-grade with AI</button>
        <button class="btn" data-act="bib">Copy BibTeX</button>
        <button class="btn" data-act="pdf" ${p.doi ? '' : 'disabled'}>Find free PDF</button>
        <span class="spacer"></span>
        <button class="btn danger" data-act="delete">Delete paper</button>
      </div>
      <p class="muted small" id="dMsg"></p>
    </div>`;
  $('#dDecision').value = p.decision || '';
  $('#dNote').value = p.userNote || '';
  dlg.dataset.key = key;
  if (!dlg.open) dlg.showModal();
}

async function onDialogClick(e) {
  const dlg = $('#paperDialog');
  const p = state.papers.find((x) => x.key === dlg.dataset.key);
  if (!p) return;
  if (e.target.closest('[data-close]')) return dlg.close();
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const msg = $('#dMsg');
  if (act === 'bib') {
    await navigator.clipboard.writeText(toBibTeX(p));
    msg.textContent = 'BibTeX copied.';
  } else if (act === 'regrade') {
    if (!state.settings.apiKey) return toast('Add your Gemini API key in Settings first.', 'bad');
    p.status = 'queued';
    await putPaper(p);
    queue.enqueue([p.key]);
    queue.start();
    dlg.close();
    scheduleRender();
  } else if (act === 'delete') {
    if (!confirm('Delete this paper from the project?')) return;
    await deletePaper(p.key);
    state.papers = state.papers.filter((x) => x.key !== p.key);
    dlg.close();
    scheduleRender();
  } else if (act === 'pdf') {
    if (!state.settings.email) {
      msg.textContent = 'Add an e-mail in Settings (Unpaywall requires one) to look up free PDFs.';
      return;
    }
    msg.textContent = 'Looking up Unpaywall…';
    try {
      const r = await fetch(`https://api.unpaywall.org/v2/${encodeURIComponent(p.doi)}?email=${encodeURIComponent(state.settings.email)}`);
      const j = await r.json();
      const url = j?.best_oa_location?.url_for_pdf || j?.best_oa_location?.url;
      if (url) {
        msg.innerHTML = `Free version found: <a href="${esc(url)}" target="_blank" rel="noreferrer">open PDF</a>`;
      } else msg.textContent = 'No free legal version found. Try your library/proxy link on the Scopus page.';
    } catch (err) {
      msg.textContent = `Lookup failed: ${err.message}`;
    }
  }
}

async function onDialogChange(e) {
  const dlg = $('#paperDialog');
  const p = state.papers.find((x) => x.key === dlg.dataset.key);
  if (!p) return;
  if (e.target.id === 'dDecision') p.decision = e.target.value;
  if (e.target.id === 'dNote') p.userNote = e.target.value;
  await putPaper(p);
  scheduleRender();
}

// ------------------------------------------------------------------ actions
async function startQueue() {
  if (!state.settings.apiKey) {
    toast('Add your free Gemini API key first (Settings tab).', 'bad');
    emit('goto-tab', 'settings');
    return;
  }
  const hasWaiting = state.papers.some((p) => p.status === 'queued');
  const sel = selectedUngradedKeys();
  const keys = sel.length ? sel : ungradedKeys();
  const changed = [];
  for (const k of keys) {
    const p = state.papers.find((x) => x.key === k);
    if (p && p.status !== 'queued') {
      p.status = 'queued';
      changed.push(p);
    }
  }
  if (changed.length) await putPapers(changed);
  queue.enqueue(state.papers.filter((p) => p.status === 'queued').map((p) => p.key));
  if (!queue.remaining && !hasWaiting) return toast('Nothing to grade.');
  queue.start();
  scheduleRender();
}

async function moreAction(act) {
  if (act === 'delete-all') {
    if (!confirm(`Delete ALL ${state.papers.length} papers in "${state.project.name}"? This cannot be undone.`)) return;
    queue.clear();
    await clearPapers(state.project.id);
    state.papers = [];
    state.selected.clear();
  } else if (act === 'delete-ungraded') {
    const del = state.papers.filter((p) => !p.eval);
    if (!del.length || !confirm(`Delete ${del.length} ungraded papers?`)) return;
    for (const p of del) await deletePaper(p.key);
    state.papers = state.papers.filter((p) => p.eval);
  } else if (act === 'requeue-errors') {
    const errs = state.papers.filter((p) => p.status === 'error');
    if (!errs.length) return toast('No failed papers.');
    for (const p of errs) p.status = 'queued';
    await putPapers(errs);
    queue.enqueue(errs.map((p) => p.key));
    queue.start();
  } else if (act === 'regrade-all') {
    if (!state.settings.apiKey) return toast('Add your Gemini API key in Settings first.', 'bad');
    const all = state.papers.filter((p) => !isExcluded(p));
    if (!confirm(`Re-grade all ${all.length} papers? This uses ${all.length} API requests.`)) return;
    for (const p of all) p.status = 'queued';
    await putPapers(all);
    queue.enqueue(all.map((p) => p.key));
    queue.start();
  } else if (act === 'resolve-doi') {
    const todo = state.papers.filter((p) => !p.doi && p.title);
    if (!todo.length) return toast('Every paper already has a DOI.');
    toast(`Looking up ${todo.length} DOIs on CrossRef…`);
    let found = 0;
    for (const p of todo) {
      try {
        const r = await fetch(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(`${p.title} ${p.year || ''}`)}&rows=2&select=DOI,title`);
        const j = await r.json();
        const target = normalizeTitle(p.title);
        const hit = (j?.message?.items || []).find((it) => {
          const c = normalizeTitle(it.title?.[0]);
          return c && (c === target || c.startsWith(target.slice(0, 40)) || target.startsWith(c.slice(0, 40)));
        });
        if (hit?.DOI) {
          p.doi = hit.DOI;
          found++;
          await putPaper(p);
        }
      } catch {
        /* skip */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    toast(`Found ${found} of ${todo.length} DOIs.`, found ? 'ok' : '');
  }
  scheduleRender();
}

function doExport(kind) {
  const cfg = state.project;
  const papers = visiblePapers();
  const base = safeName(`${cfg.name}_${new Date().toISOString().slice(0, 10)}`);
  if (!papers.length) return toast('Nothing to export yet.');
  if (kind === 'csv') download(`${base}.csv`, toCSV(papers, cfg, currentYear()), 'text/csv;charset=utf-8');
  else if (kind === 'bib') download(`${base}.bib`, toBibTeXAll(papers), 'text/plain;charset=utf-8');
  else if (kind === 'bib-copy') navigator.clipboard.writeText(toBibTeXAll(papers)).then(() => toast('BibTeX for all shown papers copied.', 'ok'));
  else if (kind === 'xlsx') {
    const wb = buildWorkbook(window.XLSX, papers, cfg, currentYear());
    const out = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(`${base}.xlsx`, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }
  toast(`Exported ${papers.length} papers (current filter).`, 'ok');
}

// ------------------------------------------------------------------ init
export function initPapersView() {
  const rerender = () => scheduleRender();
  $('#searchInput').addEventListener('input', debounce((e) => ((state.filters.q = e.target.value), rerender()), 200));
  for (const [id, key] of [['fTopic', 'topic'], ['fTier', 'tier'], ['fDecision', 'decision'], ['sortBy', 'sort']]) {
    $('#' + id).addEventListener('change', (e) => ((state.filters[key] = e.target.value), rerender()));
  }
  $('#papersBody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    if (e.target.classList.contains('sel')) {
      e.target.checked ? state.selected.add(tr.dataset.key) : state.selected.delete(tr.dataset.key);
      renderQueue();
      $('#selectionInfo').textContent = `${state.selected.size} selected`;
      return;
    }
    if (e.target.closest('[data-act="open"]')) openPaper(tr.dataset.key);
  });
  $('#checkAll').addEventListener('change', (e) => {
    for (const p of visiblePapers()) e.target.checked ? state.selected.add(p.key) : state.selected.delete(p.key);
    rerender();
  });
  $('#startBtn').addEventListener('click', startQueue);
  $('#pauseBtn').addEventListener('click', () => queue.pause('Paused by you.'));
  $('#resumeBtn').addEventListener('click', () => {
    if (!state.settings.apiKey) return toast('Add your Gemini API key in Settings first.', 'bad');
    queue.start();
  });
  $('#clearQueueBtn').addEventListener('click', async () => {
    const waiting = state.papers.filter((p) => p.status === 'queued' || p.status === 'running');
    queue.clear();
    for (const p of waiting) p.status = p.eval ? 'done' : 'scanned';
    await putPapers(waiting);
    scheduleRender();
  });
  // menus
  const closeMenus = () => $$('.menu-pop').forEach((m) => (m.hidden = true));
  $('#exportBtn').addEventListener('click', (e) => (e.stopPropagation(), closeMenus(), ($('#exportMenu').hidden = false)));
  $('#moreBtn').addEventListener('click', (e) => (e.stopPropagation(), closeMenus(), ($('#moreMenu').hidden = false)));
  document.addEventListener('click', closeMenus);
  $('#exportMenu').addEventListener('click', (e) => e.target.dataset.export && doExport(e.target.dataset.export));
  $('#moreMenu').addEventListener('click', (e) => e.target.dataset.more && moreAction(e.target.dataset.more));
  // dialog
  const dlg = $('#paperDialog');
  dlg.addEventListener('click', (e) => (e.target === dlg ? dlg.close() : onDialogClick(e)));
  dlg.addEventListener('change', onDialogChange);
  on('papers-changed', rerender);
  on('settings-changed', rerender);
  on('project-changed', () => {
    state.selected.clear();
    $('#fTopic').dataset.sig = '';
    state.filters = { q: '', topic: 'all', tier: 'all', decision: 'all', sort: 'order' };
    $('#searchInput').value = '';
    for (const [id, v] of [['fTier', 'all'], ['fDecision', 'all'], ['sortBy', 'order']]) $('#' + id).value = v;
    rerender();
  });
  on('config-changed', rerender);
}
