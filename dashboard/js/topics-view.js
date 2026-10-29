// Topics & Rubric tab: edit the project config (auto-saved).
import { state, emit, on, esc, $, $$, toast, debounce } from './state.js';
import { saveProject } from './db.js';
import { PRESET_LIST, topicColor, buildScopusQuery } from '../../shared/default-preset.js';
import { suggestTopics } from './gemini.js';
import { maxTotal } from './scoring.js';

const save = debounce(async () => {
  await saveProject(state.project);
  emit('config-changed');
}, 350);

const touch = () => {
  renderHint();
  save();
};

function nextCode() {
  const used = new Set(state.project.topics.map((t) => t.code));
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(c)) return c;
  let i = 1;
  while (used.has(`T${i}`)) i++;
  return `T${i}`;
}

function topicHTML(t, i) {
  return `<div class="topic" data-i="${i}" style="--tc:${esc(t.color)}">
    <div class="topic-head">
      <label>Code<input data-f="code" value="${esc(t.code)}" maxlength="6" /></label>
      <label>Topic name<input data-f="name" value="${esc(t.name)}" placeholder="e.g. Hybrid energy storage" /></label>
      <label>Color<input type="color" data-f="color" value="${esc(t.color)}" /></label>
      <button class="xbtn" data-del-topic title="Delete topic">🗑</button>
    </div>
    <div class="topic-body">
      <label class="wide">What papers belong here?<textarea data-f="focus" rows="2" placeholder="One or two sentences the AI uses to decide if a paper fits this topic">${esc(t.focus)}</textarea></label>
      <label>Keywords <span class="muted">(one per line or comma-separated)</span><textarea data-f="keywords" rows="4">${esc((t.keywords || []).join('\n'))}</textarea></label>
      <label>Literature-review section<input data-f="chapter" value="${esc(t.chapter || '')}" placeholder="e.g. 2.3 Solar PV Power Conditioning" /></label>
      <label class="wide">Scopus advanced-search string
        <textarea data-f="scopusQuery" rows="2" placeholder='TITLE-ABS-KEY("keyword one" OR "keyword two") AND PUBYEAR > 2020'>${esc(t.scopusQuery || '')}</textarea></label>
      <div class="row wide">
        <button class="btn" data-build>⚙ Build from keywords</button>
        <button class="btn" data-copy-open>📋 Copy &amp; open Scopus advanced search</button>
      </div>
    </div>
  </div>`;
}

function renderTopics() {
  const list = $('#topicsList');
  list.innerHTML = state.project.topics.length
    ? state.project.topics.map(topicHTML).join('')
    : '<p class="muted">No topics yet. Add them manually, use “Suggest topics with AI”, or load a preset. Without topics the AI still grades relevance to your thesis title and context.</p>';
}

function renderCriteria() {
  $('#criteriaList').innerHTML = state.project.criteria
    .map(
      (c, i) => `<div class="crit" data-i="${i}">
      <input data-f="label" value="${esc(c.label)}" placeholder="Criterion" />
      <textarea data-f="description" rows="2" placeholder="How to score 0–3">${esc(c.description)}</textarea>
      <button class="xbtn" data-del-crit title="Remove">✕</button></div>`
    )
    .join('');
}

function renderNotes() {
  $('#notesList').innerHTML = state.project.noteFields
    .map(
      (f, i) => `<div class="note" data-i="${i}">
      <input data-f="label" value="${esc(f.label)}" placeholder="Field name" />
      <textarea data-f="instruction" rows="2" placeholder="What should the AI extract?">${esc(f.instruction)}</textarea>
      <button class="xbtn" data-del-note title="Remove">✕</button></div>`
    )
    .join('');
}

function renderHint() {
  const p = state.project;
  const max = maxTotal(p);
  $('#rubricHint').textContent = `Max score ${max} (${p.criteria.length} criteria${p.recencyEnabled === false ? '' : ' + Recency'}). Tier 1 ≥ ${Math.ceil((max * p.tier1Pct) / 100)} pts, Tier 2 ≥ ${Math.ceil((max * p.tier2Pct) / 100)} pts.`;
}

export function renderConfig() {
  const p = state.project;
  if (!p) return;
  $('#pName').value = p.name || '';
  $('#pTitle').value = p.thesisTitle || '';
  $('#pContext').value = p.context || '';
  $('#recencyOn').checked = p.recencyEnabled !== false;
  $('#tier1Pct').value = p.tier1Pct ?? 75;
  $('#tier2Pct').value = p.tier2Pct ?? 50;
  renderTopics();
  renderCriteria();
  renderNotes();
  renderHint();
}

const parseKeywords = (s) => Array.from(new Set(String(s).split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean)));
const cleanCode = (s) => String(s).replace(/[^A-Za-z0-9_]/g, '').slice(0, 6);

function onTopicInput(e) {
  const card = e.target.closest('.topic');
  const f = e.target.dataset.f;
  if (!card || !f) return;
  const t = state.project.topics[+card.dataset.i];
  if (f === 'keywords') t.keywords = parseKeywords(e.target.value);
  else if (f === 'code') {
    const c = cleanCode(e.target.value);
    t.code = c || t.code;
  } else t[f] = e.target.value;
  if (f === 'color') card.style.setProperty('--tc', e.target.value);
  touch();
}

async function onTopicClick(e) {
  const card = e.target.closest('.topic');
  if (!card) return;
  const t = state.project.topics[+card.dataset.i];
  if (e.target.closest('[data-del-topic]')) {
    if (!confirm(`Delete topic ${t.code} — ${t.name}?`)) return;
    state.project.topics.splice(+card.dataset.i, 1);
    renderTopics();
    touch();
  } else if (e.target.closest('[data-build]')) {
    t.scopusQuery = buildScopusQuery(t.keywords, new Date().getFullYear() - 5);
    card.querySelector('[data-f="scopusQuery"]').value = t.scopusQuery;
    touch();
  } else if (e.target.closest('[data-copy-open]')) {
    if (!t.scopusQuery) t.scopusQuery = buildScopusQuery(t.keywords, new Date().getFullYear() - 5);
    card.querySelector('[data-f="scopusQuery"]').value = t.scopusQuery;
    await navigator.clipboard.writeText(t.scopusQuery);
    toast('Search string copied — paste it into Scopus advanced search.', 'ok');
    window.open('https://www.scopus.com/search/form.uri?display=advanced', '_blank', 'noopener');
    touch();
  }
}

function listEditor(rootSel, arrKey, delAttr, render) {
  const root = $(rootSel);
  root.addEventListener('input', (e) => {
    const row = e.target.closest('[data-i]');
    if (!row || !e.target.dataset.f) return;
    state.project[arrKey][+row.dataset.i][e.target.dataset.f] = e.target.value;
    touch();
  });
  root.addEventListener('click', (e) => {
    const btn = e.target.closest(`[${delAttr}]`);
    if (!btn) return;
    const arr = state.project[arrKey];
    if (arr.length <= 1 && arrKey === 'criteria') return toast('Keep at least one criterion.');
    arr.splice(+btn.closest('[data-i]').dataset.i, 1);
    render();
    touch();
  });
}

async function runSuggest() {
  const p = state.project;
  if (!state.settings.apiKey) {
    toast('Add your free Gemini API key first (Settings tab).', 'bad');
    return emit('goto-tab', 'settings');
  }
  if (!p.thesisTitle.trim()) return toast('Type your thesis / research title first.', 'bad');
  const btn = $('#suggestBtn');
  btn.disabled = true;
  btn.textContent = '✨ Thinking…';
  try {
    const topics = await suggestTopics({ title: p.thesisTitle, context: p.context, apiKey: state.settings.apiKey, model: state.settings.model });
    const body = $('#suggestBody');
    body.innerHTML = `<h3>Suggested topics</h3><p class="muted">Tick the ones you want to add. You can edit them afterwards.</p>
      ${topics.map((t, i) => `<label class="check" style="align-items:flex-start"><input type="checkbox" checked data-s="${i}" /><span><b>${esc(t.name)}</b><br><span class="muted">${esc(t.focus)}</span><br><span class="small">${esc((t.keywords || []).join(', '))}</span></span></label>`).join('')}
      <div class="row end"><button class="btn ghost" id="sgCancel">Cancel</button><button class="btn primary" id="sgAdd">Add selected</button></div>`;
    const dlg = $('#suggestDialog');
    $('#sgCancel').onclick = () => dlg.close();
    $('#sgAdd').onclick = () => {
      $$('#suggestBody [data-s]:checked').forEach((cb) => {
        const t = topics[+cb.dataset.s];
        const code = nextCode();
        state.project.topics.push({
          code,
          name: t.name,
          color: topicColor(state.project.topics.length),
          focus: t.focus,
          keywords: t.keywords || [],
          chapter: t.chapter || '',
          scopusQuery: buildScopusQuery(t.keywords, new Date().getFullYear() - 5)
        });
      });
      dlg.close();
      renderTopics();
      touch();
    };
    dlg.showModal();
  } catch (e) {
    toast(`Suggestion failed: ${e.message}`, 'bad');
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Suggest topics & keywords with AI';
  }
}

export function initTopicsView() {
  $('#presetSelect').innerHTML = PRESET_LIST.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
  $('#loadPresetBtn').addEventListener('click', async () => {
    const preset = PRESET_LIST.find((p) => p.id === $('#presetSelect').value).make();
    if (!confirm('Replace this project’s topics, rubric and note fields with the preset? (Your papers are kept.)')) return;
    const { id, name } = state.project;
    Object.assign(state.project, preset, { id, name });
    await saveProject(state.project);
    renderConfig();
    emit('config-changed');
    toast('Preset loaded.', 'ok');
  });
  const bind = (id, key, conv = (v) => v) =>
    $(id).addEventListener('input', (e) => {
      state.project[key] = conv(e.target.value);
      if (key === 'name') emit('project-renamed');
      touch();
    });
  bind('#pName', 'name');
  bind('#pTitle', 'thesisTitle');
  bind('#pContext', 'context');
  bind('#tier1Pct', 'tier1Pct', (v) => Math.max(1, Math.min(100, +v || 75)));
  bind('#tier2Pct', 'tier2Pct', (v) => Math.max(1, Math.min(100, +v || 50)));
  $('#recencyOn').addEventListener('change', (e) => ((state.project.recencyEnabled = e.target.checked), touch()));
  $('#addTopicBtn').addEventListener('click', () => {
    state.project.topics.push({ code: nextCode(), name: '', color: topicColor(state.project.topics.length), focus: '', keywords: [], chapter: '', scopusQuery: '' });
    renderTopics();
    touch();
    $('#topicsList').lastElementChild?.querySelector('[data-f="name"]')?.focus();
  });
  $('#addCriterionBtn').addEventListener('click', () => {
    state.project.criteria.push({ id: `c${Date.now()}`, label: '', description: '' });
    renderCriteria();
    touch();
  });
  $('#addNoteBtn').addEventListener('click', () => {
    state.project.noteFields.push({ id: `n${Date.now()}`, label: '', instruction: '' });
    renderNotes();
    touch();
  });
  const list = $('#topicsList');
  list.addEventListener('input', onTopicInput);
  list.addEventListener('click', onTopicClick);
  listEditor('#criteriaList', 'criteria', 'data-del-crit', renderCriteria);
  listEditor('#notesList', 'noteFields', 'data-del-note', renderNotes);
  $('#suggestBtn').addEventListener('click', runSuggest);
  on('project-changed', renderConfig);
}
