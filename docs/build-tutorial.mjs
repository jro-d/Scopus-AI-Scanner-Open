// Builds docs/Scopus-AI-Scanner-V2-Tutorial.pdf from docs/screenshots/*.png using headless Chrome.
import puppeteer from 'puppeteer-core';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'screenshots');
const outPdf = join(here, 'Scopus-AI-Scanner-V2-Tutorial.pdf');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function img(name, caption) {
  const p = join(shots, name);
  if (!existsSync(p)) throw new Error(`Missing screenshot: ${p}`);
  const b64 = readFileSync(p).toString('base64');
  return `<figure><img src="data:image/png;base64,${b64}" alt="${caption}" /><figcaption>${caption}</figcaption></figure>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Scopus AI Scanner V2 — User Tutorial</title>
<style>
  @page { size: A4; margin: 16mm 16mm 18mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10.5pt/1.5 "Segoe UI", system-ui, -apple-system, Roboto, sans-serif; color: #0f172a; }
  h1 { font-size: 24pt; margin: 0 0 6pt; color: #1e1b4b; line-height: 1.15; }
  h2 { font-size: 14pt; margin: 16pt 0 6pt; color: #312e81; border-bottom: 2px solid #e0e7ff; padding-bottom: 3pt; break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 10pt 0 4pt; color: #1e293b; break-after: avoid; }
  p, li { margin: 0 0 5pt; }
  ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
  code, pre { font-family: Consolas, "SFMono-Regular", monospace; font-size: 9.5pt; background: #f1f5f9; border-radius: 4pt; padding: 1pt 4pt; }
  .cover { padding: 18pt 20pt; border-radius: 12pt; background: linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%); border: 1px solid #c7d2fe; margin-bottom: 14pt; }
  .badge { display: inline-block; background: #4f46e5; color: #fff; font-weight: 700; font-size: 8.5pt; padding: 2pt 8pt; border-radius: 99pt; letter-spacing: .04em; text-transform: uppercase; margin-bottom: 6pt; }
  .lead { font-size: 11.5pt; color: #334155; margin: 4pt 0 10pt; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10pt; margin: 8pt 0; }
  .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8pt; padding: 8pt 10pt; break-inside: avoid; }
  .box b { color: #1e1b4b; }
  .callout { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 7pt 10pt; border-radius: 4pt; margin: 8pt 0; break-inside: avoid; }
  .warn { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 7pt 10pt; border-radius: 4pt; margin: 8pt 0; break-inside: avoid; }
  figure { margin: 8pt 0 12pt; text-align: center; break-inside: avoid; page-break-inside: avoid; }
  figure img { max-width: 100%; max-height: 112mm; border: 1px solid #cbd5e1; border-radius: 6pt; box-shadow: 0 2px 8px rgba(15,23,42,.08); }
  figcaption { font-size: 9pt; color: #475569; margin-top: 4pt; font-style: italic; }
  .page-break { page-break-before: always; break-before: page; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin: 6pt 0 10pt; break-inside: avoid; }
  th, td { border: 1px solid #cbd5e1; padding: 5pt 7pt; text-align: left; vertical-align: top; }
  th { background: #eef2ff; color: #1e1b4b; font-weight: 700; }
</style>
</head>
<body>

<div class="cover">
  <span class="badge">Open-Source Chrome Extension · V2.0</span>
  <h1>Scopus AI Scanner V2 — Complete Step-by-Step Tutorial</h1>
  <p class="lead">Bulk-scan 100 Scopus abstracts per page without touching your mouse, then grade every paper against your own thesis topics and rubric using the free Google Gemini API.</p>
  <div class="grid2">
    <div class="box"><b>Non-Intrusive Background Scanning</b><br/>All scrolling and abstract expanding happens inside the Scopus tab DOM. Your mouse, keyboard, and other tabs/apps stay 100% under your control.</div>
    <div class="box"><b>Flexible for Any Thesis Topic</b><br/>Define your own topics (e.g., Topics A–F), keywords, 0–3 rubric criteria, and 15+ deep-note fields—or let AI suggest topics from your thesis title.</div>
  </div>
</div>

<h2>Quick Overview of the Workflow</h2>
<table>
  <thead>
    <tr><th>Step</th><th>Where</th><th>What Happens</th></tr>
  </thead>
  <tbody>
    <tr><td><b>1. Install</b></td><td><code>chrome://extensions</code></td><td>Load the unpacked folder in Chrome or Edge (takes 30 seconds).</td></tr>
    <tr><td><b>2. Free API Key</b></td><td>Dashboard → Settings</td><td>Paste a free Google AI Studio key (no credit card or billing required).</td></tr>
    <tr><td><b>3. Topics &amp; Rubric</b></td><td>Dashboard → Topics &amp; Rubric</td><td>Enter your thesis title, topics (or load a preset), keywords, and grading criteria.</td></tr>
    <tr><td><b>4. Scan Scopus</b></td><td>Scopus search page (100/page)</td><td>Click <b>Scan this page → Dashboard</b> on the bottom-right floating pill.</td></tr>
    <tr><td><b>5. AI Grading</b></td><td>Dashboard → Papers</td><td>Preview the 100 scanned papers, then click <b>Start AI evaluation</b>.</td></tr>
    <tr><td><b>6. Matrix &amp; Export</b></td><td>Dashboard → Grading Matrix / Export</td><td>Inspect Tier 1/2/3 counts per topic and export to Excel (<code>.xlsx</code>), CSV, or BibTeX.</td></tr>
  </tbody>
</table>

<h2>Step 1 — Install the Extension in Chrome (or Edge)</h2>
<ol>
  <li>Download or clone the <code>Scopus-AI-Scanner-Open</code> repository to your computer.</li>
  <li>Open Google Chrome and navigate to <code>chrome://extensions</code> in the address bar.</li>
  <li>Turn ON the <b>Developer mode</b> toggle in the top-right corner.</li>
  <li>Click <b>Load unpacked</b> (top-left button) and select the cloned folder.</li>
  <li>Click the puzzle-piece Extensions icon in your Chrome toolbar and <b>pin</b> <i>Scopus AI Scanner V2</i> for quick access.</li>
</ol>

<h2>Step 2 — Get a Free Gemini API Key (No Credit Card Needed)</h2>
<ol>
  <li>Visit <code>https://aistudio.google.com/apikey</code> and sign in with any regular Google account.</li>
  <li>Click <b>Create API key</b> and copy the generated key (starts with <code>AIza...</code>).</li>
  <li>Click the <b>⚡ Scopus AI Scanner V2</b> icon in Chrome → <b>Open dashboard</b> → open the <b>Settings</b> tab.</li>
  <li>Paste your key into <b>API key</b>, keep the interval at <b>4 seconds</b> (safe for the 15 requests/minute free tier), click <b>Save settings</b>, and click <b>Test key</b> to confirm it works.</li>
</ol>
${img('07-settings.png', 'Figure 1 — Dashboard Settings tab: paste your free Google AI Studio key and click Test key.')}

<div class="page-break"></div>

<h2>Step 3 — Set Up Your Thesis Topics, Keywords &amp; Grading Rubric</h2>
<p>Open the <b>Topics &amp; Rubric</b> tab in the dashboard. Unlike fixed scanners, V2 lets you create separate projects for different courses or theses using the project selector in the top bar.</p>
<ul>
  <li><b>Start from scratch:</b> Enter your <i>Project name</i>, <i>Thesis title</i>, and a short <i>Study context</i>, and click <b>+ Add topic</b> to add literature-review sections.</li>
  <li><b>AI Topic Generator:</b> Have only a thesis title? Click <b>✨ Suggest topics &amp; keywords with AI</b> and Gemini will propose literature-review sections and Scopus search keywords for you.</li>
  <li><b>One-Click Scopus Search String:</b> Inside each topic card, click <b>⚙ Build from keywords</b> or <b>📋 Copy &amp; open Scopus advanced search</b> to launch Scopus with a ready-made <code>TITLE-ABS-KEY(...)</code> query.</li>
</ul>
${img('05-topics.png', 'Figure 2 — Topics & Rubric tab: configure your thesis context and custom Topics (A–F or your own).')}

<h3>Customizing the 0–3 Rubric and Deep-Note Extraction Fields</h3>
<p>Scroll down on the <b>Topics &amp; Rubric</b> tab to tailor how each paper is graded and what notes are extracted:</p>
<ul>
  <li><b>Grading rubric:</b> By default, the AI grades <i>Topic Match (0–3)</i>, <i>Method Usefulness (0–3)</i>, and <i>Evidence Quality (0–3)</i>, plus an automatic <i>Recency (0–3)</i> score based on publication year (max 12 points; Tier 1 ≥ 75%, Tier 2 ≥ 50%). You can add, edit, or remove criteria at any time.</li>
  <li><b>Deep-note fields:</b> Customize the 10–15 structured fields the AI extracts from every abstract (e.g., objective, methodology, system/dataset scale, validation type, quantitative metrics, equations/parameters, limitations, research gap, and suggested RRL section).</li>
</ul>
${img('06-rubric.png', 'Figure 3 — Customizing the 0–3 rubric criteria, Tier cutoffs, and 15 deep-note extraction fields.')}

<div class="page-break"></div>

<h2>Step 4 — Bulk-Scan 100 Papers on Scopus (Zero Mouse Interference)</h2>
<ol>
  <li>Log in to <b>Scopus</b> through your university or organization account and run your topic search.</li>
  <li>Change the page size dropdown from 20 to <b>100 results per page</b> so you can scan a full batch at once.</li>
  <li>Look at the bottom-right corner of the Scopus page: the <b>⚡ Scopus AI Scanner V2</b> pill automatically detects how many papers are currently rendered.</li>
</ol>
${img('01-scopus-results.png', 'Figure 4 — Scopus search results page with the non-intrusive floating scanner pill in the bottom-right corner.')}

<ol start="4">
  <li>Click <b>Scan this page → Dashboard</b>. The extension automatically expands collapsed <i>“Show abstract”</i> sections, scrolls through the page to trigger lazy-loaded results, and extracts the Title, Authors, Year, Journal/Conference, Citations, DOI, and Abstract.</li>
  <li><b>Keep using your computer:</b> The scan runs strictly inside the Scopus tab’s DOM—you can switch to another tab, write in Word, or use your mouse normally while it finishes.</li>
</ol>
${img('02-scan-progress.png', 'Figure 5 — Live progress bar while scanning and expanding abstracts across the page.')}
${img('03-scan-done.png', 'Figure 6 — Scan complete: all 100 papers and their abstracts have been sent to your local dashboard.')}

<div class="page-break"></div>

<h2>Step 5 — Preview Imported Papers &amp; Run the AI Evaluation Queue</h2>
<p>Switch to the <b>Scopus AI Scanner V2 — Dashboard</b> tab (it opens automatically in the background when you scan):</p>
<ul>
  <li><b>Instant keyword preview:</b> Even before calling the AI, each paper shows colored topic chips indicating how many of your topic keywords appear in its title and abstract.</li>
  <li><b>De-duplication built in:</b> If you scan the same Scopus page twice, existing papers are skipped automatically.</li>
  <li><b>Start grading when ready:</b> Review the list (or select specific rows with the checkboxes) and click <b>▶ Start AI evaluation</b>.</li>
</ul>
${img('04-dashboard-imported.png', 'Figure 7 — All 100 scanned papers previewed in the dashboard before starting the AI queue.')}

<div class="callout">
  <b>How Pacing Works on the Free Tier:</b> Google AI Studio’s free tier allows 15 requests per minute. The queue spaces requests by 4 seconds (~6.5 minutes for 100 papers), saves every paper to IndexedDB immediately after it is graded, and lets you <b>Pause</b> or <b>Resume</b> at any time.
</div>
${img('08-evaluating.png', 'Figure 8 — The AI evaluation queue grading papers in the background with a live progress bar.')}
${img('09-results.png', 'Figure 9 — Graded results sorted by highest score, showing Tier badges, percentage scores, best topics, and one-sentence summaries.')}

<div class="page-break"></div>

<h2>Step 6 — Inspect Deep Notes &amp; Record Your Screening Decision</h2>
<p>Click any paper’s title (or the <b>⋯</b> button on the right) to open the full inspection modal:</p>
<ul>
  <li>View the 0–3 score bars for each rubric criterion and the 0–3 relevance score for each of your topics.</li>
  <li>Read all <b>15+ extracted deep-note fields</b>. Whenever a detail is not mentioned in the abstract, the AI writes <code>not stated in abstract</code> instead of guessing.</li>
  <li>Set your manual screening decision (<b>Include</b>, <b>Maybe</b>, or <b>Exclude</b>), type your own notes, copy the paper’s <b>BibTeX</b> citation, or look up a free Open-Access PDF via Unpaywall.</li>
</ul>
${img('10-paper-detail.png', 'Figure 10 — Paper detail dialog showing rubric breakdown, per-topic relevance, and 15 extracted deep-note fields.')}

<h2>Step 7 — Analyze the Per-Topic Grading Matrix</h2>
<p>Open the <b>Grading Matrix</b> tab to see how your literature coverage is distributed across your thesis topics:</p>
<ul>
  <li><b>Summary table:</b> Shows how many <i>Tier 1</i>, <i>Tier 2</i>, and <i>Tier 3</i> papers belong to each topic, along with the average percentage score and a visual distribution bar.</li>
  <li><b>Paper × Topic Relevance Heat-Map:</b> Every graded paper is listed with its 0–3 relevance across all topics so you can immediately spot cross-cutting papers that bridge two or more chapters of your RRL.</li>
</ul>
${img('11-matrix.png', 'Figure 11 — Per-topic Grading Matrix and Paper × Topic relevance heat-map.')}

<div class="page-break"></div>

<h2>Step 8 — Export to Excel (.xlsx), CSV &amp; BibTeX + Dark Mode</h2>
<p>On the <b>Papers</b> tab, click <b>⬇ Export ▾</b> to download your screened literature in one click:</p>
<ul>
  <li><b>Excel workbook (<code>.xlsx</code>):</b> Contains 5 sheets—<code>Screening</code> (with live Excel formulas for Recency, Total, Percent, and Tier), <code>Topic Matrix</code> (with live <code>COUNTIFS</code> and <code>AVERAGEIFS</code> formulas), <code>Deep Notes</code> (all 15+ extracted fields), <code>Topics &amp; Rubric</code>, and <code>Settings</code>.</li>
  <li><b>CSV (<code>.csv</code>):</b> UTF-8 CSV ready for Google Sheets, R, or Python pandas.</li>
  <li><b>BibTeX (<code>.bib</code> or clipboard):</b> Clean <code>@article</code> / <code>@inproceedings</code> entries ready to import into Zotero, Mendeley, or Overleaf/LaTeX.</li>
</ul>
${img('12-export-menu.png', 'Figure 12 — One-click export menu for multi-sheet Excel (.xlsx), CSV, and BibTeX.')}
${img('13-dark-mode.png', 'Figure 13 — Toggle between Light and Dark academic themes at any time using the 🌓 button in the top bar.')}

<div class="warn">
  <b>Troubleshooting Tips:</b>
  <ul>
    <li><b>Accessing Scopus via a university proxy URL?</b> If your university rewrites the domain (e.g., <code>scopus.com.ezproxy.univ.edu</code>), click the extension icon in the toolbar and click <b>Show scanner on this tab</b>.</li>
    <li><b>Missing DOIs on some cards?</b> On the Dashboard Papers tab, click <b>⋯ → Find missing DOIs (CrossRef)</b> to resolve them automatically from the title and year.</li>
  </ul>
</div>

</body>
</html>`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  pipe: true,
  args: ['--no-first-run', '--no-default-browser-check']
});
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({
    path: outPdf,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:8pt;color:#64748b;width:100%;padding:0 16mm;font-family:Segoe UI,sans-serif;">Scopus AI Scanner V2 — User Tutorial</div>`,
    footerTemplate: `<div style="font-size:8pt;color:#64748b;width:100%;padding:0 16mm;display:flex;justify-content:space-between;font-family:Segoe UI,sans-serif;"><span>Open-Source Chrome Extension for Academic Literature Screening</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`
  });
  console.log('Generated tutorial PDF:', outPdf);
} finally {
  await browser.close();
}
