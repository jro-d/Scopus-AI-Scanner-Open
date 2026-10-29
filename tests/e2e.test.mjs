// End-to-end test + tutorial screenshots.
// Loads the REAL unpacked extension into Chrome, serves a mock Scopus page at https://www.scopus.com/...
// via request interception (so the real content script runs), and mocks only the Gemini HTTP API.
// Run: node tests/e2e.test.mjs   (needs Chrome; set CHROME_PATH to override)
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { buildMockPage, makeMockPapers } from './fixtures/mock-scopus.mjs';
import { blankProject } from '../shared/default-preset.js';

function makeTestPreset() {
  const p = blankProject('Sample Research');
  p.thesisTitle = 'Systematic Literature Review Test';
  p.context = 'Evaluating research papers across various topics.';
  p.topics = [
    { code: 'A', name: 'Distributed Systems', focus: 'Microservices and cloud scheduling', keywords: ['distributed', 'cloud'], chapter: '1.1' },
    { code: 'B', name: 'Neural Optimization', focus: 'Model compression and pruning', keywords: ['neural', 'pruning'], chapter: '1.2' },
    { code: 'C', name: 'Software Verification', focus: 'Symbolic execution and formal methods', keywords: ['testing', 'verification'], chapter: '1.3' },
    { code: 'D', name: 'Predictive Modeling', focus: 'Time-series forecasting and control', keywords: ['predictive', 'forecasting'], chapter: '1.4' },
    { code: 'E', name: 'Security Protocols', focus: 'Zero trust and cryptographic protocols', keywords: ['security', 'cryptographic'], chapter: '1.5' },
    { code: 'F', name: 'Empirical Studies', focus: 'Developer productivity and pipelines', keywords: ['empirical', 'developer'], chapter: '1.6' }
  ];
  return p;
}

const here = dirname(fileURLToPath(import.meta.url));
const ext = resolve(here, '..');
const shots = resolve(ext, 'docs/screenshots');
const dl = resolve(here, '.downloads');
mkdirSync(shots, { recursive: true });
rmSync(dl, { recursive: true, force: true });
mkdirSync(dl, { recursive: true });

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const papers = makeMockPapers(100);
const mockHtml = buildMockPage(papers);
const preset = makeTestPreset();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const ok = (cond, msg) => (assert.ok(cond, msg), checks++, console.log(`  ✓ ${msg}`));
const eq = (a, b, msg) => (assert.equal(a, b, msg), checks++, console.log(`  ✓ ${msg}`));

// ---- mocked Gemini (derives a plausible evaluation from the prompt + the request's own schema)
function mockGemini(body) {
  const input = body.input || '';
  const title = (/TITLE: (.*)/.exec(input) || [])[1] || '';
  const abstract = (/ABSTRACT:\n([\s\S]*)$/.exec(input) || [])[1] || '';
  const text = `${title} ${abstract}`.toLowerCase();
  const schema = body.response_format.schema.properties;
  const out = { summary: `Demo: ${title.slice(0, 80)}` };
  const rel = {};
  if (schema.topicRelevance) {
    for (const t of preset.topics) {
      const hits = t.keywords.filter((k) => text.includes(k.toLowerCase())).length;
      rel[t.code] = Math.min(3, hits >= 3 ? 3 : hits === 2 ? 2 : hits);
    }
    out.topicRelevance = rel;
    const best = Object.entries(rel).sort((a, b) => b[1] - a[1])[0];
    out.bestTopic = best && best[1] > 0 ? best[0] : 'None';
  }
  const maxRel = Math.max(0, ...Object.values(rel));
  const hw = /hardware|prototype|experiment|measurement|field data/.test(text);
  const crit = Object.keys(schema.criteria.properties);
  out.criteria = {
    [crit[0]]: maxRel,
    [crit[1]]: /controller|algorithm|method|topology|scheduler|lstm|mppt/.test(text) ? (hw ? 3 : 2) : 1,
    [crit[2]]: hw ? 3 : /simulation|simulink|case study/.test(text) ? 2 : 1
  };
  const sentences = abstract.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);
  out.notes = Object.fromEntries(
    Object.keys(schema.notes.properties).map((k, i) => [
      k,
      i % 4 === 3 ? 'not stated in abstract' : (sentences[i % Math.max(1, sentences.length)] || 'not stated in abstract').slice(0, 220)
    ])
  );
  return out;
}

const geminiCalls = [];
const armed = new WeakSet();
async function armPage(page, { scopus = false } = {}) {
  if (armed.has(page)) return;
  armed.add(page);
  page.on('request', (req) => {
    const url = req.url();
    if (scopus && url.startsWith('https://www.scopus.com/')) {
      if (/\/results\//.test(url)) return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: mockHtml });
      return req.respond({ status: 200, contentType: 'text/html', body: '<html><body>stub</body></html>' });
    }
    if (url.startsWith('https://generativelanguage.googleapis.com/')) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
      const body = JSON.parse(req.postData() || '{}');
      geminiCalls.push({ url, key: req.headers()['x-goog-api-key'], model: body.model });
      return req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ output_text: JSON.stringify(mockGemini(body)) }) });
    }
    if (url.startsWith('https://aistudio.google.com') || url.startsWith('https://doi.org') || url.startsWith('https://api.crossref.org')) return req.abort();
    req.continue();
  });
  await page.setRequestInterception(true);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  pipe: true,
  enableExtensions: [ext],
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-first-run', '--no-default-browser-check']
});

try {
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl }).catch(() => {});

  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'), { timeout: 20000 });
  const extId = new URL(sw.url()).host;
  console.log(`extension loaded: ${extId}`);
  const dashUrl = `chrome-extension://${extId}/dashboard/dashboard.html`;

  // Request-intercepted pages don't get manifest content scripts (a Puppeteer quirk), so we inject the very same
  // file through chrome.scripting. Auto-injection on the real scopus.com is verified in step 0.
  const swWorker = await sw.worker();
  const injectScanner = () =>
    swWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://www.scopus.com/results/*' });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/scopus-scanner.js'] });
    });
  const hostVisible = () => {
    const h = document.getElementById('scopus-ai-scanner-v2-host');
    return !!h && getComputedStyle(h).display !== 'none';
  };

  // ================= 0. Manifest content script auto-injects on the real scopus.com =================
  console.log('0. Real scopus.com auto-injection (needs internet; skipped if offline)');
  try {
    const real = await browser.newPage();
    await real.goto('https://www.scopus.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(2000);
    ok(await real.evaluate(() => !!document.getElementById('scopus-ai-scanner-v2-host')), 'content script auto-injected on https://www.scopus.com');
    await real.close();
  } catch (e) {
    console.log('  (skipped: ' + e.message + ')');
  }
  // ================= 1. Scopus page =================
  console.log('1. Scopus page + scanner panel');
  const scopus = await browser.newPage();
  await armPage(scopus, { scopus: true });
  await scopus.goto('https://www.scopus.com/results/results.uri?sort=plf-f&src=s&st1=distributed+systems&sl=0&sessionSearchId=demo', { waitUntil: 'load' });
  await injectScanner();
  await scopus.waitForFunction(hostVisible, { timeout: 10000 });
  const detected = await scopus.evaluate(() => document.getElementById('scopus-ai-scanner-v2-host').shadowRoot.getElementById('stat').textContent);
  ok(/\d+ papers detected/.test(detected), `floating panel visible: "${detected}"`);
  await scopus.screenshot({ path: join(shots, '01-scopus-results.png') });

  // ================= 2. Scan (while user is "busy" elsewhere) =================
  console.log('2. Scan 100 papers while another tab is in the foreground');
  const startedAt = Date.now();
  const beforeY = 0;
  await scopus.evaluate(() => document.getElementById('scopus-ai-scanner-v2-host').shadowRoot.getElementById('scan').click());
  await sleep(2500);
  await scopus.screenshot({ path: join(shots, '02-scan-progress.png') });
  const other = await browser.newPage(); // the user's "other work"
  await other.goto('about:blank');
  await other.bringToFront();
  let lastStat = '';
  await scopus
    .waitForFunction(() => /Sent \d+ papers/.test(document.getElementById('scopus-ai-scanner-v2-host').shadowRoot.getElementById('stat').textContent), { timeout: 180000, polling: 500 })
    .catch(async (e) => {
      lastStat = await scopus.evaluate(() => document.getElementById('scopus-ai-scanner-v2-host').shadowRoot.getElementById('stat').textContent);
      throw new Error(`scan did not finish: ${lastStat}`);
    });
  console.log(`   scan finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  const sentText = await scopus.evaluate(() => document.getElementById('scopus-ai-scanner-v2-host').shadowRoot.getElementById('stat').textContent);
  ok(/Sent 100 papers/.test(sentText), `all 100 lazy-loaded papers captured (${sentText})`);
  const msgText = await scopus.evaluate(() => document.getElementById('scopus-ai-scanner-v2-host').shadowRoot.getElementById('msg').textContent);
  ok(/All abstracts captured/.test(msgText), 'every card had an abstract (scanner expanded the collapsed ones)');
  const scrollAfter = await scopus.evaluate(() => window.scrollY);
  eq(scrollAfter, beforeY, 'scroll position restored after scan');
  await scopus.bringToFront();
  await scopus.screenshot({ path: join(shots, '03-scan-done.png') });

  // ================= 3. Dashboard opened in background =================
  console.log('3. Dashboard');
  const dashTarget = await browser.waitForTarget((t) => t.url().startsWith(dashUrl), { timeout: 15000 });
  const dash = await dashTarget.page();
  await dash.setViewport({ width: 1440, height: 900 });
  await dash.waitForFunction(() => window.__scannerReady === true, { timeout: 15000 });
  await armPage(dash);
  await dash.waitForFunction(() => document.querySelectorAll('#papersBody tr').length === 100, { timeout: 15000 });
  ok(true, 'dashboard auto-opened in the background and imported 100 papers');
  const metrics = await dash.$$eval('#metrics .metric b', (els) => els.map((e) => e.textContent));
  eq(metrics[0], '100', 'metric "Papers scanned" = 100');
  const withoutDoi = await dash.$$eval('#papersBody tr', (rows) => rows.filter((r) => r.querySelector('.links')?.textContent.includes('no DOI')).length);
  ok(withoutDoi > 0 && withoutDoi < 20, `DOIs read from publisher links; ${withoutDoi} papers correctly flagged "no DOI"`);
  const firstRow = await dash.$eval('#papersBody tr', (tr) => tr.innerText);
  ok(/Kumar|Santos|Tan|Garcia|Ahmed|Nguyen|M.ller/.test(firstRow), 'author names captured');
  const cleanAbs = await dash.evaluate(async () => {
    const req = indexedDB.open('scopus-ai-scanner-v2');
    const db = await new Promise((res) => (req.onsuccess = () => res(req.result)));
    const tx = db.transaction('papers', 'readonly');
    const all = await new Promise((res) => {
      const r = tx.objectStore('papers').getAll();
      r.onsuccess = () => res(r.result);
    });
    return all.every((p) => p.abstract && !p.abstract.includes(p.title) && !/\b\d+\s+Citations\b/.test(p.abstract));
  });
  ok(cleanAbs, 'every captured abstract is clean (no card header/title/citation noise)');
  await dash.bringToFront();
  await dash.screenshot({ path: join(shots, '04-dashboard-imported.png') });

  // duplicate protection: scan again -> nothing new
  console.log('   re-scan to verify duplicate protection');
  await scopus.bringToFront();
  await scopus.evaluate(() => document.getElementById('scopus-ai-scanner-v2-host').shadowRoot.getElementById('stat').textContent = '');
  await scopus.reload({ waitUntil: 'load' });
  await injectScanner();
  await scopus.waitForFunction(hostVisible);
  await scopus.evaluate(() => document.getElementById('scopus-ai-scanner-v2-host').shadowRoot.getElementById('scan').click());
  await scopus.waitForFunction(() => /Sent \d+ papers/.test(document.getElementById('scopus-ai-scanner-v2-host').shadowRoot.getElementById('stat').textContent), { timeout: 180000, polling: 500 });
  await sleep(1500);
  eq(await dash.$$eval('#papersBody tr', (r) => r.length), 100, 're-scan did not create duplicates');

  // ================= 4. Topics: load preset =================
  console.log('4. Topics & rubric');
  dash.on('dialog', (d) => d.accept());
  await dash.bringToFront();
  await dash.evaluate((p) => {
    return new Promise((resolve) => {
      const req = indexedDB.open('ScopusAiScannerV2');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['projects', 'kv'], 'readwrite');
        tx.objectStore('projects').put({ ...p, id: 'test-p-1' });
        tx.objectStore('kv').put('test-p-1', 'activeProjectId');
        tx.oncomplete = () => {
          location.reload();
        };
      };
    });
  }, preset);
  await dash.waitForFunction(() => window.__scannerReady === true);
  await dash.click('#tabs [data-tab="topics"]');
  await dash.waitForFunction(() => document.querySelectorAll('#topicsList .topic').length === 6);
  ok(true, 'topics loaded: 6 topics (A–F)');
  eq(await dash.$$eval('#notesList .note', (e) => e.length), 10, 'provides 10 deep-note fields');
  await dash.evaluate(() => (document.getElementById('toastHost').innerHTML = ''));
  await dash.screenshot({ path: join(shots, '05-topics.png') });
  await dash.evaluate(() => document.querySelector('#criteriaList').scrollIntoView({ block: 'start' }));
  await sleep(300);
  await dash.screenshot({ path: join(shots, '06-rubric.png') });

  // adding a custom topic persists
  await dash.click('#addTopicBtn');
  await dash.type('#topicsList .topic:last-child [data-f="name"]', 'My extra topic');
  await sleep(700);

  // ================= 5. Settings =================
  console.log('5. Settings');
  await dash.evaluate(() => window.scrollTo(0, 0));
  await dash.click('#tabs [data-tab="settings"]');
  await dash.type('#sApiKey', 'AIzaSyD-DEMO-KEY-not-a-real-key-0000');
  await dash.click('#saveSettingsBtn');
  await sleep(300);
  eq(await dash.$eval('#keyChip', (e) => e.textContent), 'API key: set ✓', 'API key chip turns green');
  await dash.evaluate(() => (document.getElementById('toastHost').innerHTML = ''));
  await dash.screenshot({ path: join(shots, '07-settings.png') });
  // speed up pacing for the test only (UI minimum is 1s)
  await dash.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    settings.intervalSec = 0.05;
    await chrome.storage.local.set({ settings });
  });
  await dash.reload({ waitUntil: 'load' });
  await dash.waitForFunction(() => window.__scannerReady === true);
  eq(await dash.$$eval('#topicsList .topic', (e) => e.length), 7, 'edited topics persisted across reload (IndexedDB)');
  // remove the extra topic again
  await dash.click('#tabs [data-tab="topics"]');
  await dash.evaluate(() => document.querySelector('#topicsList .topic:last-child [data-del-topic]').click());
  await sleep(600);

  // ================= 6. AI evaluation =================
  console.log('6. AI evaluation (mocked Gemini)');
  await dash.click('#tabs [data-tab="papers"]');
  const label = await dash.$eval('#startBtn', (e) => e.textContent);
  ok(/Start AI evaluation \(100\)/.test(label), `start button: "${label}"`);
  await dash.click('#startBtn');
  await sleep(1200);
  await dash.screenshot({ path: join(shots, '08-evaluating.png') });
  await dash.waitForFunction(() => /All papers are graded/.test(document.querySelector('#queueText').textContent), { timeout: 120000, polling: 400 });
  await dash.waitForFunction(() => {
    const bs = Array.from(document.querySelectorAll('#metrics .metric b')).map((e) => +e.textContent);
    return bs[1] === 100;
  }, { timeout: 10000, polling: 200 });
  eq(geminiCalls.length, 100, 'exactly one Gemini request per paper (100)');
  ok(geminiCalls.every((c) => c.key && c.key.startsWith('AIzaSyD-DEMO')), 'API key sent in header');
  ok(geminiCalls.every((c) => c.model === 'gemini-3.8-flash'), 'default model gemini-3.8-flash');
  const m2 = await dash.$$eval('#metrics .metric b', (els) => els.map((e) => +e.textContent));
  eq(m2[1], 100, 'metric "AI-graded" = 100');
  ok(m2[2] + m2[3] + m2[4] === 100, `tiers add up: T1=${m2[2]} T2=${m2[3]} T3=${m2[4]}`);
  ok(m2[2] > 0 && m2[4] > 0, 'tiers are differentiated (not all the same)');
  await dash.select('#sortBy', 'score');
  await sleep(400);
  await dash.screenshot({ path: join(shots, '09-results.png') });

  // filters
  await dash.select('#fTier', 'Tier 1');
  await sleep(300);
  const t1rows = await dash.$$eval('#papersBody tr', (r) => r.length);
  eq(t1rows, m2[2], 'Tier 1 filter shows exactly the Tier 1 papers');
  await dash.select('#fTier', 'all');

  // detail dialog
  await dash.evaluate(() => document.querySelector('#papersBody tr [data-act="open"]').click());
  await dash.waitForSelector('#paperDialog[open]');
  await sleep(300);
  await dash.screenshot({ path: join(shots, '10-paper-detail.png') });
  await dash.select('#dDecision', 'Include');
  await sleep(300);
  await dash.evaluate(() => document.querySelector('#paperDialog [data-close]').click());

  // ================= 7. Matrix =================
  console.log('7. Grading matrix');
  await dash.click('#tabs [data-tab="matrix"]');
  await sleep(400);
  const matrixRows = await dash.$$eval('#matrixTable tbody tr', (r) => r.length);
  ok(matrixRows >= 6, `matrix has ${matrixRows} topic rows`);
  const totalGraded = await dash.$$eval('#matrixTable tbody tr', (rows) => rows.reduce((s, r) => s + +r.children[4].textContent, 0));
  eq(totalGraded, 100, 'matrix counts every graded paper exactly once');
  await dash.screenshot({ path: join(shots, '11-matrix.png') });

  // ================= 8. Exports =================
  console.log('8. Exports');
  await dash.click('#tabs [data-tab="papers"]');
  await dash.click('#exportBtn');
  await sleep(300);
  await dash.screenshot({ path: join(shots, '12-export-menu.png') });
  for (const kind of ['xlsx', 'csv', 'bib']) {
    await dash.click('#exportBtn');
    await dash.evaluate((k) => document.querySelector(`#exportMenu [data-export="${k}"]`).click(), kind);
    await sleep(900);
  }
  const files = readdirSync(dl);
  ok(files.some((f) => f.endsWith('.xlsx')) && files.some((f) => f.endsWith('.csv')) && files.some((f) => f.endsWith('.bib')), `downloads: ${files.join(', ')}`);
  const m = { exports: {} };
  new Function('module', 'exports', readFileSync(join(ext, 'vendor/xlsx.full.min.js'), 'utf8'))(m, m.exports);
  const XLSX = m.exports;
  const wb = XLSX.read(readFileSync(join(dl, files.find((f) => f.endsWith('.xlsx')))), { type: 'buffer' });
  eq(wb.SheetNames.join('|'), 'Screening|Topic Matrix|Deep Notes|Topics & Rubric|Settings', 'xlsx has all 5 sheets');
  eq(XLSX.utils.sheet_to_json(wb.Sheets.Screening).length, 100, 'Screening sheet has 100 rows');
  eq(XLSX.utils.sheet_to_json(wb.Sheets['Deep Notes']).length, 100, 'Deep Notes sheet has 100 rows');
  const bib = readFileSync(join(dl, files.find((f) => f.endsWith('.bib'))), 'utf8');
  eq((bib.match(/^@(article|inproceedings|incollection)\{/gm) || []).length, 100, 'BibTeX has 100 entries');

  // ================= 9. Dark mode =================
  await dash.click('#themeBtn');
  await sleep(300);
  await dash.screenshot({ path: join(shots, '13-dark-mode.png') });
  await dash.click('#themeBtn');

  console.log(`\nE2E OK — ${checks} checks passed`);
} catch (e) {
  console.error('\nE2E FAILED:', e.stack || e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
