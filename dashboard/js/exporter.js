// Export helpers: CSV, BibTeX, and a multi-sheet Excel workbook with live formulas.
import { computeGrade, bestTopicOf, recencyScore, maxTotal } from './scoring.js';

// ---------------------------------------------------------------- authors / bibtex
/** Scopus lists authors like "Kumar, K., Kwon, S.-H., Bae, S." — split into individual authors. */
export function splitAuthors(str) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const re = /[^,;]+?,\s*(?:[A-Z][a-z]?\.?[-\s]*)+/g;
  const m = s.match(re);
  if (m && m.length) return m.map((a) => a.replace(/[,\s;]+$/, '').trim());
  return s.split(/;|\band\b/).map((a) => a.trim()).filter(Boolean);
}

const bibEscape = (s) => String(s ?? '').replace(/([&%$#_])/g, '\\$1');

export function bibKey(paper) {
  const first = splitAuthors(paper.authors)[0] || 'anon';
  const surname = first.split(',')[0].replace(/[^A-Za-z]/g, '') || 'anon';
  const word = (String(paper.title || '').toLowerCase().match(/[a-z]{4,}/g) || ['paper'])[0];
  return `${surname}${paper.year || 'nd'}${word}`;
}

export function toBibTeX(paper) {
  const type = /conference/i.test(paper.docType || '') ? 'inproceedings' : /chapter/i.test(paper.docType || '') ? 'incollection' : 'article';
  const venueField = type === 'article' ? 'journal' : 'booktitle';
  const fields = [];
  const authors = splitAuthors(paper.authors);
  if (authors.length) fields.push(['author', authors.join(' and ')]);
  fields.push(['title', `{${paper.title || ''}}`]);
  if (paper.venue) fields.push([venueField, paper.venue]);
  if (paper.year) fields.push(['year', String(paper.year)]);
  if (paper.doi) fields.push(['doi', paper.doi]);
  const body = fields
    .map(([k, v]) => `  ${k} = {${k === 'doi' ? v : bibEscape(v)}}`)
    .join(',\n');
  return `@${type}{${bibKey(paper)},\n${body}\n}`;
}

export function toBibTeXAll(papers) {
  const seen = new Map();
  return papers
    .map((p) => {
      let entry = toBibTeX(p);
      const key = bibKey(p);
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      if (n > 1) entry = entry.replace(`{${key},`, `{${key}${String.fromCharCode(96 + n)},`);
      return entry;
    })
    .join('\n\n');
}

// ---------------------------------------------------------------- csv
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildTable(papers, config, currentYear) {
  const header = [
    '#', 'Best topic', 'Title', 'Authors', 'Year', 'Venue', 'Type', 'Citations', 'DOI',
    ...config.criteria.map((c) => c.label),
    ...(config.recencyEnabled === false ? [] : ['Recency']),
    'Total', 'Max', 'Percent', 'Tier', 'Decision', 'Summary',
    ...config.noteFields.map((f) => f.label),
    'My notes', 'Scopus link', 'Abstract'
  ];
  const rows = papers.map((p, i) => {
    const g = computeGrade(p, config, currentYear);
    return [
      i + 1,
      bestTopicOf(p.eval, config.topics) || '',
      p.title, p.authors, p.year, p.venue, p.docType, p.citations, p.doi,
      ...config.criteria.map((c) => (p.eval ? p.eval.criteria?.[c.id] ?? '' : '')),
      ...(config.recencyEnabled === false ? [] : [g ? g.recency : '']),
      g ? g.total : '', g ? g.max : '', g ? Math.round(g.pct) : '', g ? g.tier : '',
      p.decision || '', p.eval?.summary || '',
      ...config.noteFields.map((f) => p.eval?.notes?.[f.id] || ''),
      p.userNote || '', p.url || '', p.abstract || ''
    ];
  });
  return { header, rows };
}

export function toCSV(papers, config, currentYear) {
  const { header, rows } = buildTable(papers, config, currentYear);
  return '\uFEFF' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// ---------------------------------------------------------------- xlsx
const colName = (i) => {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

export function buildWorkbook(XLSX, papers, config, currentYear) {
  const wb = XLSX.utils.book_new();
  const withEval = (p) => !!p.eval;
  const sorted = [...papers].sort((a, b) => {
    const ga = computeGrade(a, config, currentYear)?.pct ?? -1;
    const gb = computeGrade(b, config, currentYear)?.pct ?? -1;
    return gb - ga;
  });
  const recencyOn = config.recencyEnabled !== false;
  const max = maxTotal(config);

  // ---- Settings (referenced by formulas)
  const ws0 = XLSX.utils.aoa_to_sheet([
    ['Current year', currentYear],
    ['Tier 1 cutoff (%)', config.tier1Pct ?? 75],
    ['Tier 2 cutoff (%)', config.tier2Pct ?? 50],
    ['Max score', max],
    [],
    ['Edit the blue-labelled values above and the Screening / Topic Matrix sheets recalculate.']
  ]);
  ws0['!cols'] = [{ wch: 22 }, { wch: 12 }];

  // ---- Screening
  const fixed = ['#', 'Best topic', 'Title', 'Authors', 'Year', 'Venue', 'Type', 'Citations', 'DOI'];
  const critStart = fixed.length; // index of first criterion col
  const critEnd = critStart + config.criteria.length - 1;
  const recencyCol = recencyOn ? critEnd + 1 : -1;
  const totalCol = (recencyOn ? recencyCol : critEnd) + 1;
  const maxCol = totalCol + 1;
  const pctCol = totalCol + 2;
  const tierCol = totalCol + 3;
  const decisionCol = totalCol + 4;
  const summaryCol = totalCol + 5;
  const header = [
    ...fixed,
    ...config.criteria.map((c) => c.label),
    ...(recencyOn ? ['Recency (auto)'] : []),
    'Total', 'Max', 'Percent', 'Tier', 'Decision', 'Summary', 'My notes', 'Scopus link'
  ];
  const aoa = [header];
  sorted.forEach((p, i) => {
    const g = computeGrade(p, config, currentYear);
    const row = [
      i + 1, bestTopicOf(p.eval, config.topics) || '', p.title, p.authors, p.year || '', p.venue, p.docType, p.citations ?? '', p.doi,
      ...config.criteria.map((c) => (withEval(p) ? p.eval.criteria?.[c.id] ?? '' : '')),
      ...(recencyOn ? [g ? g.recency : ''] : []),
      g ? g.total : '', g ? g.max : '', g ? Math.round(g.pct) : '', g ? g.tier : '',
      p.decision || '', p.eval?.summary || '', p.userNote || '', p.url || ''
    ];
    aoa.push(row);
  });
  const ws1 = XLSX.utils.aoa_to_sheet(aoa);
  // live formulas
  sorted.forEach((p, i) => {
    if (!withEval(p)) return;
    const r = i + 2;
    const g = computeGrade(p, config, currentYear);
    const set = (c, f, v, t = 'n') => (ws1[`${colName(c)}${r}`] = { t, f, v });
    const cs = `${colName(critStart)}${r}`;
    const ce = `${colName(critEnd)}${r}`;
    if (recencyOn) {
      const y = `E${r}`;
      set(recencyCol, `IF(${y}="",0,IF(${y}>=Settings!$B$1-2,3,IF(${y}>=Settings!$B$1-4,2,IF(${y}>=Settings!$B$1-6,1,0))))`, recencyScore(p.year, currentYear));
    }
    const totalF = recencyOn ? `SUM(${cs}:${ce})+${colName(recencyCol)}${r}` : `SUM(${cs}:${ce})`;
    set(totalCol, totalF, g.total);
    set(maxCol, 'Settings!$B$4', g.max);
    set(pctCol, `ROUND(${colName(totalCol)}${r}/${colName(maxCol)}${r}*100,0)`, Math.round(g.pct));
    set(tierCol, `IF(${colName(pctCol)}${r}>=Settings!$B$2,"Tier 1",IF(${colName(pctCol)}${r}>=Settings!$B$3,"Tier 2","Tier 3"))`, g.tier, 's');
  });
  ws1['!cols'] = header.map((h, i) => ({ wch: i === 2 ? 60 : i === 3 ? 30 : i === summaryCol ? 60 : Math.max(8, Math.min(24, String(h).length + 4)) }));
  ws1['!freeze'] = { xSplit: 3, ySplit: 1 };
  ws1['!autofilter'] = { ref: `A1:${colName(header.length - 1)}${Math.max(2, aoa.length)}` };

  // ---- Topic Matrix
  const last = Math.max(2, aoa.length);
  const topicRange = `Screening!$B$2:$B$${last}`;
  const tierRange = `Screening!$${colName(tierCol)}$2:$${colName(tierCol)}$${last}`;
  const pctRange = `Screening!$${colName(pctCol)}$2:$${colName(pctCol)}$${last}`;
  const mAoa = [['Topic', 'Name', 'Tier 1', 'Tier 2', 'Tier 3', 'Scored papers', 'Avg score (%)']];
  const gradedByTopic = {};
  for (const p of sorted) {
    const g = computeGrade(p, config, currentYear);
    if (!g || p.decision === 'Exclude') continue;
    const code = bestTopicOf(p.eval, config.topics) || '';
    (gradedByTopic[code] ||= []).push(g);
  }
  const rowsOf = config.topics.map((t) => ({ code: t.code, name: t.name }));
  rowsOf.push({ code: '', name: 'No clear topic match' });
  for (const t of rowsOf) mAoa.push([t.code || '—', t.name, '', '', '', '', '']);
  const ws2 = XLSX.utils.aoa_to_sheet(mAoa);
  rowsOf.forEach((t, i) => {
    const r = i + 2;
    const gs = gradedByTopic[t.code] || [];
    const crit = t.code ? `$A${r}` : '""';
    const f = (tier) => `COUNTIFS(${topicRange},${crit},${tierRange},"${tier}")`;
    ws2[`C${r}`] = { t: 'n', f: f('Tier 1'), v: gs.filter((g) => g.tier === 'Tier 1').length };
    ws2[`D${r}`] = { t: 'n', f: f('Tier 2'), v: gs.filter((g) => g.tier === 'Tier 2').length };
    ws2[`E${r}`] = { t: 'n', f: f('Tier 3'), v: gs.filter((g) => g.tier === 'Tier 3').length };
    ws2[`F${r}`] = { t: 'n', f: `SUM(C${r}:E${r})`, v: gs.length };
    ws2[`G${r}`] = {
      t: 'n',
      f: `IFERROR(ROUND(AVERAGEIFS(${pctRange},${topicRange},${crit}),0),"")`,
      v: gs.length ? Math.round(gs.reduce((s, g) => s + g.pct, 0) / gs.length) : ''
    };
  });
  ws2['!cols'] = [{ wch: 8 }, { wch: 46 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 14 }, { wch: 14 }];

  // ---- Deep Notes
  const nHeader = ['#', 'Title', 'Year', 'DOI', 'Best topic', 'Summary', ...config.noteFields.map((f) => f.label), 'Abstract'];
  const nAoa = [nHeader];
  sorted.filter(withEval).forEach((p, i) => {
    nAoa.push([
      i + 1, p.title, p.year || '', p.doi, bestTopicOf(p.eval, config.topics) || '', p.eval.summary,
      ...config.noteFields.map((f) => p.eval.notes?.[f.id] || ''), p.abstract
    ]);
  });
  const ws3 = XLSX.utils.aoa_to_sheet(nAoa);
  ws3['!cols'] = nHeader.map((h, i) => ({ wch: i === 1 ? 50 : i === 5 || i === nHeader.length - 1 ? 70 : i >= 6 ? 40 : 12 }));
  ws3['!freeze'] = { xSplit: 2, ySplit: 1 };

  // ---- Topics & Rubric (reproducibility)
  const tAoa = [['Thesis title', config.thesisTitle], ['Context', config.context], [], ['Code', 'Topic', 'Focus', 'Keywords', 'Scopus query', 'Lit-review section']];
  for (const t of config.topics) tAoa.push([t.code, t.name, t.focus, (t.keywords || []).join('; '), t.scopusQuery || '', t.chapter || '']);
  tAoa.push([], ['Rubric criterion', 'Description']);
  for (const c of config.criteria) tAoa.push([c.label, c.description]);
  const ws4 = XLSX.utils.aoa_to_sheet(tAoa);
  ws4['!cols'] = [{ wch: 18 }, { wch: 36 }, { wch: 70 }, { wch: 50 }, { wch: 70 }, { wch: 40 }];

  XLSX.utils.book_append_sheet(wb, ws1, 'Screening');
  XLSX.utils.book_append_sheet(wb, ws2, 'Topic Matrix');
  XLSX.utils.book_append_sheet(wb, ws3, 'Deep Notes');
  XLSX.utils.book_append_sheet(wb, ws4, 'Topics & Rubric');
  XLSX.utils.book_append_sheet(wb, ws0, 'Settings');
  return wb;
}

export function download(filename, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const safeName = (s) => String(s || 'export').replace(/[^\w.-]+/g, '_').slice(0, 60);
