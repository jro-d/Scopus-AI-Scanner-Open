// Unit tests for the pure logic. Run: node tests/unit.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { recencyScore, computeGrade, bestTopicOf, keywordHits, paperSignature, buildTopicMatrix, maxTotal } from '../dashboard/js/scoring.js';
import { buildEvalSchema, buildSystemPrompt, normalizeEval, callGemini, callGeminiWithRetry, GeminiError, evaluatePaper, parseJsonLoose } from '../dashboard/js/gemini.js';
import { splitAuthors, toBibTeX, toBibTeXAll, toCSV, buildWorkbook, bibKey } from '../dashboard/js/exporter.js';
import { blankProject, buildScopusQuery } from '../shared/default-preset.js';
import { AiQueue } from '../dashboard/js/queue.js';

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.stack}`);
    process.exitCode = 1;
  }
};

function makeSampleTestConfig() {
  const p = blankProject('Sample Research');
  p.thesisTitle = 'Systematic Literature Review and Research Synthesis';
  p.context = 'Automated evaluation and grading of literature review papers.';
  p.topics = [
    { code: 'A', name: 'Information Retrieval', focus: 'Search engines and crawlers', keywords: ['search', 'retrieval'], chapter: '1.1 Information Retrieval' },
    { code: 'B', name: 'Data Processing', focus: 'Data pipelines and cleaning', keywords: ['pipeline', 'processing'], chapter: '1.2 Data Processing' },
    { code: 'C', name: 'MPPT', focus: 'Algorithms under test', keywords: ['MPPT', 'partial shading'], chapter: '1.3 MPPT Evaluation' },
    { code: 'D', name: 'Deep Learning', focus: 'Neural network architectures', keywords: ['deep learning', 'neural network'], chapter: '1.4 Deep Learning' },
    { code: 'E', name: 'Natural Language Processing', focus: 'Text analysis and summarization', keywords: ['nlp', 'language model'], chapter: '1.5 NLP' },
    { code: 'F', name: 'Benchmarking', focus: 'Quantitative metrics and results', keywords: ['benchmark', 'metrics'], chapter: '1.6 Benchmarking' }
  ];
  return p;
}

const cfg = makeSampleTestConfig();
const mkPaper = (over = {}) => ({
  key: 'p|1', signature: 'doi:10.1/x', title: 'Benchmarking distributed microservices and container orchestration', authors: 'Kumar, K., Kwon, S.-H., Bae, S.',
  year: 2025, venue: 'IEEE Access', docType: 'Article', citations: 4, doi: '10.1109/access.2025.1', abstract: 'We study MPPT...',
  status: 'done',
  eval: {
    summary: 's', bestTopic: 'B',
    topicRelevance: { A: 0, B: 3, C: 2, D: 1, E: 0, F: 0 },
    criteria: { c1: 3, c2: 2, c3: 2 },
    notes: Object.fromEntries(cfg.noteFields.map((f) => [f.id, 'x']))
  },
  ...over
});

console.log('scoring');
await test('recency thresholds', () => {
  assert.equal(recencyScore(2026, 2026), 3);
  assert.equal(recencyScore(2024, 2026), 3);
  assert.equal(recencyScore(2022, 2026), 2);
  assert.equal(recencyScore(2020, 2026), 1);
  assert.equal(recencyScore(2010, 2026), 0);
  assert.equal(recencyScore(null, 2026), 0);
});
await test('grade + tier math', () => {
  const g = computeGrade(mkPaper(), cfg, 2026); // 3+2+2 + recency 3 = 10 / 12
  assert.equal(g.total, 10);
  assert.equal(g.max, 12);
  assert.equal(g.tier, 'Tier 1');
  const low = computeGrade(mkPaper({ year: 2005, eval: { ...mkPaper().eval, criteria: { c1: 1, c2: 0, c3: 0 } } }), cfg, 2026);
  assert.equal(low.tier, 'Tier 3');
  assert.equal(computeGrade({ title: 'x' }, cfg), null);
});
await test('custom rubric changes max score', () => {
  const c = blankProject();
  c.criteria.push({ id: 'c4', label: 'Novelty', description: '' });
  assert.equal(maxTotal(c), 15);
  c.recencyEnabled = false;
  assert.equal(maxTotal(c), 12);
});
await test('best topic + keyword hits', () => {
  assert.equal(bestTopicOf(mkPaper().eval, cfg.topics), 'B');
  const hits = keywordHits({ title: 'MPPT with partial shading', abstract: '' }, cfg.topics);
  assert.ok(hits.C >= 2);
  assert.equal(hits.F, 0);
});
await test('signature prefers DOI, then eid, then title', () => {
  assert.equal(paperSignature({ doi: '10.1/ABC' }), 'doi:10.1/abc');
  assert.equal(paperSignature({ eid: '2-s2.0-1' }), 'eid:2-s2.0-1');
  assert.match(paperSignature({ title: 'Hello, World!', year: 2020 }), /^t:helloworld:2020$/);
});
await test('topic matrix counts tiers per best topic and skips excluded', () => {
  const rows = buildTopicMatrix([mkPaper(), mkPaper({ key: 'x', decision: 'Exclude' })], cfg, 2026);
  const b = rows.find((r) => r.code === 'B');
  assert.equal(b.total, 1);
  assert.equal(b.tier1, 1);
});

console.log('gemini');
await test('schema is built from topics, rubric and note fields', () => {
  const s = buildEvalSchema(cfg);
  assert.deepEqual(Object.keys(s.properties.topicRelevance.properties), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.deepEqual(s.properties.bestTopic.enum.slice(-1), ['None']);
  assert.equal(Object.keys(s.properties.criteria.properties).length, 3);
  assert.equal(Object.keys(s.properties.notes.properties).length, cfg.noteFields.length);
  assert.ok(cfg.noteFields.length >= 10, 'default project should have 10+ note fields');
  const blank = buildEvalSchema(blankProject());
  assert.equal(blank.properties.topicRelevance, undefined);
});
await test('system prompt includes user topics', () => {
  const p = buildSystemPrompt(cfg);
  assert.match(p, /Topic C — MPPT/);
  assert.match(p, /never invent|Never invent/i);
});
await test('normalizeEval clamps and fills defaults', () => {
  const n = normalizeEval({ criteria: { c1: 9, c2: -2 }, topicRelevance: { A: 2.6 }, bestTopic: 'None', notes: {} }, cfg);
  assert.equal(n.criteria.c1, 3);
  assert.equal(n.criteria.c2, 0);
  assert.equal(n.criteria.c3, 0);
  assert.equal(n.topicRelevance.A, 3);
  assert.equal(n.bestTopic, null);
  assert.equal(n.notes.n1, 'not stated in abstract');
});
await test('parseJsonLoose handles code fences and chatter', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Here: {"a":2} thanks'), { a: 2 });
});
const okFetch = (body) => async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(body) }), text: async () => '' });
await test('callGemini sends key as header (not in URL) and structured schema', async () => {
  let seen;
  const f = async (url, init) => ((seen = { url, init }), okFetch({ ok: true })());
  await callGemini({ apiKey: 'KEY', model: 'm', system: 's', input: 'i', schema: { type: 'object' }, fetchImpl: f });
  assert.ok(!seen.url.includes('KEY'));
  assert.equal(seen.init.headers['x-goog-api-key'], 'KEY');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.response_format.mime_type, 'application/json');
  assert.equal(body.store, false);
});
await test('callGemini parses steps[] responses', async () => {
  const f = async () => ({ ok: true, json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"x":1}' }] }] }) });
  assert.deepEqual(await callGemini({ apiKey: 'k', schema: {}, fetchImpl: f }), { x: 1 });
});
await test('retry honours 429 retryDelay then succeeds', async () => {
  let n = 0;
  const f = async () => {
    n++;
    if (n < 3) return { ok: false, status: 429, text: async () => '{"error":{"details":[{"retryDelay":"0s"}]}}' };
    return okFetch({ v: 1 })();
  };
  const orig = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => orig(fn, 1); // fast-forward backoff
  try {
    const r = await callGeminiWithRetry({ apiKey: 'k', schema: {}, fetchImpl: f }, { maxAttempts: 4 });
    assert.deepEqual(r, { v: 1 });
    assert.equal(n, 3);
  } finally {
    globalThis.setTimeout = orig;
  }
});
await test('401 is not retried', async () => {
  let n = 0;
  const f = async () => (n++, { ok: false, status: 401, text: async () => 'bad key' });
  await assert.rejects(callGeminiWithRetry({ apiKey: 'k', schema: {}, fetchImpl: f }), (e) => e instanceof GeminiError && e.status === 401);
  assert.equal(n, 1);
});
await test('evaluatePaper end-to-end with mocked API', async () => {
  const raw = { summary: 'ok', bestTopic: 'C', topicRelevance: { A: 0, B: 0, C: 3, D: 0, E: 0, F: 0 }, criteria: { c1: 3, c2: 3, c3: 1 }, notes: { n1: 'a' } };
  const r = await evaluatePaper(mkPaper(), cfg, { apiKey: 'k', model: 'm', fetchImpl: okFetch(raw) });
  assert.equal(r.bestTopic, 'C');
  assert.equal(r.criteria.c3, 1);
});

console.log('exporters');
await test('splitAuthors handles Scopus formats', () => {
  assert.deepEqual(splitAuthors('Kumar, K., Kwon, S.-H., Bae, S.'), ['Kumar, K.', 'Kwon, S.-H.', 'Bae, S.']);
  assert.deepEqual(splitAuthors('Kumar, K.,Kwon, S.,Bae, S.'), ['Kumar, K.', 'Kwon, S.', 'Bae, S.']);
  assert.deepEqual(splitAuthors('Kumar, K.; Kwon, S.'), ['Kumar, K.', 'Kwon, S.']);
  assert.deepEqual(splitAuthors(''), []);
});
await test('BibTeX entry types and keys', () => {
  const b = toBibTeX(mkPaper());
  assert.match(b, /^@article\{Kumar2025benchmarking,/);
  assert.match(b, /author = \{Kumar, K\. and Kwon, S\.-H\. and Bae, S\.\}/);
  assert.match(b, /doi = \{10\.1109\/access\.2025\.1\}/);
  assert.match(toBibTeX(mkPaper({ docType: 'Conference paper' })), /^@inproceedings\{[^,]+,[\s\S]*booktitle = \{IEEE Access\}/);
  const all = toBibTeXAll([mkPaper(), mkPaper({ key: 'q' })]);
  assert.ok(all.includes('Kumar2025benchmarking,') && all.includes('Kumar2025benchmarkingb,'), 'duplicate keys get a b/c suffix');
  assert.equal(bibKey(mkPaper()), 'Kumar2025benchmarking');
});
await test('CSV escapes quotes/commas and has BOM', () => {
  const csv = toCSV([mkPaper({ title: 'He said "hi", ok' })], cfg, 2026);
  assert.ok(csv.startsWith('\uFEFF#'));
  assert.ok(csv.includes('"He said ""hi"", ok"'));
  assert.ok(csv.split('\r\n').length === 2);
});
await test('Excel workbook: sheets, live formulas, matrix counts', () => {
  const m = { exports: {} };
  new Function('module', 'exports', readFileSync(join(here, '../vendor/xlsx.full.min.js'), 'utf8'))(m, m.exports);
  const XLSX = m.exports;
  const papers = [mkPaper(), mkPaper({ key: 'b', signature: 's2', title: 'Other', eval: null, status: 'scanned' })];
  const wb = buildWorkbook(XLSX, papers, cfg, 2026);
  assert.deepEqual(wb.SheetNames, ['Screening', 'Topic Matrix', 'Deep Notes', 'Topics & Rubric', 'Settings']);
  const s = wb.Sheets.Screening;
  const header = XLSX.utils.sheet_to_json(s, { header: 1 })[0];
  const col = (name) => XLSX.utils.encode_col(header.indexOf(name));
  assert.match(s[`${col('Recency (auto)')}2`].f, /Settings!\$B\$1/);
  assert.match(s[`${col('Total')}2`].f, /^SUM\(/);
  assert.equal(s[`${col('Tier')}2`].v, 'Tier 1');
  assert.match(s[`${col('Tier')}2`].f, /Settings!\$B\$2/);
  const mx = XLSX.utils.sheet_to_json(wb.Sheets['Topic Matrix'], { header: 1 });
  const rowB = mx.find((r) => r[0] === 'B');
  assert.equal(rowB[2], 1);
  assert.match(wb.Sheets['Topic Matrix'].C3.f, /COUNTIFS\(Screening!/);
  // round-trips through a real xlsx file
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  const back = XLSX.read(buf, { type: 'buffer' });
  assert.equal(back.SheetNames.length, 5);
  assert.match(back.Sheets.Screening[`${col('Total')}2`].f, /SUM/);
});
await test('Scopus query builder quotes phrases', () => {
  assert.equal(buildScopusQuery(['MPPT', 'maximum power point'], 2021), 'TITLE-ABS-KEY(MPPT OR "maximum power point") AND PUBYEAR > 2020');
  assert.equal(buildScopusQuery([]), '');
});

console.log('text-scanner');
await test('full-page text scanner extracts numbered cards, authors, metadata, and abstracts', () => {
  // Read scanner code into an isolated scope to extract scanPageFromText
  const scannerSrc = readFileSync(join(here, '../content/scopus-scanner.js'), 'utf8');
  const m = {};
  const fnBody = scannerSrc
    .slice(scannerSrc.indexOf('function stripAbstractUi'), scannerSrc.indexOf('function correlateWithDom'));
  new Function('exports', 'const clean = (s) => String(s || "").replace(/\\s+/g, " ").trim();\n' + fnBody + '\nexports.scanPageFromText = scanPageFromText;')(m);

  const sample = `
14
Review · Article in Press
Enabling Self-Sustainable IoT Nodes: Low-Power Design, Energy Harvesting, Wireless Power Transfer and Edge Intelligence
Yue X., Kiely J., Drakakis E.M., Mirza M.
IEEE Internet of Things Journal
2026
0
Hide abstract ^ View at Publisher ↗ Related documents
Self-sustainable Internet of Things (IoT) nodes are increasingly important for large-scale, long-lifetime sensing systems in which battery replacement is economically, environmentally, or operationally impractical. Sustained autonomous operation requires the coordinated reduction of energy demand and the reliable provision, storage, and management of energy under weak, intermittent, and uncertain conditions.

15
Book Chapter
Enhancing energy harvesting in wireless sensor networks: Title Strategies, challenges, and future trends
Bakare M.S., Abdulkarim A., Abdulkarim A., Guntreddi V., Ibrahim O.
Handbook of Sustainable Wireless Communication Systems Innovations and Applications
2026
0
Hide abstract ^ View at Publisher ↗ Related documents
The rapid growth of mobile devices and emerging 5G/6G technologies has significantly increased energy demands in wireless networks, emphasizing the need for sustainable solutions.
`;

  const parsed = m.scanPageFromText(sample);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].order, 14);
  assert.equal(parsed[0].docType, 'Review · Article in Press');
  assert.equal(parsed[0].title, 'Enabling Self-Sustainable IoT Nodes: Low-Power Design, Energy Harvesting, Wireless Power Transfer and Edge Intelligence');
  assert.equal(parsed[0].authors, 'Yue X., Kiely J., Drakakis E.M., Mirza M.');
  assert.equal(parsed[0].year, 2026);
  assert.ok(parsed[0].abstract.startsWith('Self-sustainable Internet of Things'));
  assert.equal(parsed[1].order, 15);
  assert.equal(parsed[1].docType, 'Book Chapter');
  assert.ok(parsed[1].abstract.startsWith('The rapid growth of mobile devices'));
});

console.log('queue');
await test('queue grades sequentially, paces, pauses on quota, resumes', async () => {
  const papers = [1, 2, 3].map((i) => mkPaper({ key: `k${i}`, eval: null, status: 'queued', title: `P${i}` }));
  const store = new Map(papers.map((p) => [p.key, p]));
  const starts = [];
  let calls = 0;
  const states = [];
  const q = new AiQueue({
    getPaper: async (k) => store.get(k),
    getConfig: () => cfg,
    getSettings: () => ({ apiKey: 'k', model: 'm', intervalSec: 0.05 }),
    onPaper: async () => {},
    onState: (s) => states.push(s.state),
    evaluate: async (p) => {
      starts.push(Date.now());
      calls++;
      if (calls === 2) throw new GeminiError('quota', { status: 429, quota: true });
      return { ok: true, criteria: {}, topicRelevance: {}, notes: {}, summary: p.title };
    }
  });
  q.enqueue([...store.keys()]);
  q.start();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(q.state, 'paused');
  assert.equal(store.get('k1').status, 'done');
  assert.equal(store.get('k2').status, 'queued', 'quota-hit paper goes back to queue');
  assert.equal(q.remaining, 2);
  q.start();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(q.state, 'idle');
  assert.ok([...store.values()].every((p) => p.status === 'done'));
  assert.ok(starts[1] - starts[0] >= 40, 'requests are paced');
});

console.log(`\n${passed} checks passed${process.exitCode ? ' — WITH FAILURES' : ''}`);
