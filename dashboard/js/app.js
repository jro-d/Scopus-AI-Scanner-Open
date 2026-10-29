// Dashboard bootstrap: projects, tabs, scan inbox.
import { state, emit, on, esc, $, $$, toast, loadSettings } from './state.js';
import { listProjects, saveProject, listPapers, putPapers, getKV, setKV, uid } from './db.js';
import { PRESET_LIST, blankProject } from '../../shared/default-preset.js';
import { paperSignature } from './scoring.js';
import { initPapersView, scheduleRender, queue, renderPapers } from './papers-view.js';
import { initTopicsView, renderConfig } from './topics-view.js';
import { initMatrixView } from './matrix-view.js';
import { initSettingsView, renderSettings, applyTheme } from './settings-view.js';

// ------------------------------------------------------------------ tabs
function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  emit('tab-shown', name);
  location.hash = name;
}

// ------------------------------------------------------------------ projects
function renderProjectSelect() {
  const sel = $('#projectSelect');
  sel.innerHTML = state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name || 'Untitled')}</option>`).join('');
  sel.value = state.project?.id || '';
}

async function setProject(id) {
  queue.clear();
  const project = state.projects.find((p) => p.id === id) || state.projects[0];
  state.project = project;
  state.papers = await listPapers(project.id);
  // recover from an interrupted run
  const changed = [];
  for (const p of state.papers) {
    if (p.status === 'running') {
      p.status = 'queued';
      changed.push(p);
    }
  }
  if (changed.length) await putPapers(changed);
  await setKV('activeProjectId', project.id);
  renderProjectSelect();
  emit('project-changed');
  const waiting = state.papers.filter((p) => p.status === 'queued');
  if (waiting.length) {
    queue.enqueue(waiting.map((p) => p.key));
    queue.state = 'paused';
    queue.message = 'A previous grading run was interrupted. Press Resume to continue.';
    queue.emit();
  }
  scheduleRender();
}

async function createProject(name, presetId) {
  const preset = PRESET_LIST.find((p) => p.id === presetId) || PRESET_LIST[0];
  const project = { ...preset.make(), id: uid(), name: name || preset.make().name, createdAt: Date.now() };
  await saveProject(project);
  state.projects.push(project);
  await setProject(project.id);
  return project;
}

// ------------------------------------------------------------------ scan inbox
let consuming = false;
async function consumeInbox() {
  if (consuming || !state.project) return;
  consuming = true;
  try {
    const { inbox = [] } = await chrome.storage.local.get('inbox');
    if (!inbox.length) return;
    let added = 0;
    let dupes = 0;
    let noAbs = 0;
    const toSave = [];
    const byKey = new Map(state.papers.map((p) => [p.key, p]));
    for (const batch of inbox) {
      for (const raw of batch.papers || []) {
        const signature = paperSignature(raw);
        const key = `${state.project.id}|${signature}`;
        const existing = byKey.get(key);
        if (existing) {
          dupes++;
          if (!existing.abstract && raw.abstract) {
            existing.abstract = raw.abstract;
            toSave.push(existing);
          }
          continue;
        }
        const paper = {
          key,
          projectId: state.project.id,
          signature,
          title: raw.title,
          authors: raw.authors || '',
          year: raw.year || null,
          venue: raw.venue || '',
          docType: raw.docType || '',
          citations: raw.citations || 0,
          doi: raw.doi || '',
          eid: raw.eid || '',
          url: raw.url || '',
          abstract: raw.abstract || '',
          scanId: batch.scanId,
          query: batch.query || '',
          addedAt: batch.scannedAt + (raw.order || 0),
          order: raw.order || 0,
          status: 'scanned',
          eval: null,
          decision: '',
          userNote: ''
        };
        if (!paper.abstract) noAbs++;
        byKey.set(key, paper);
        state.papers.push(paper);
        toSave.push(paper);
        added++;
      }
    }
    await putPapers(toSave);
    const done = new Set(inbox.map((b) => b.scanId));
    const cur = (await chrome.storage.local.get('inbox')).inbox || [];
    await chrome.storage.local.set({ inbox: cur.filter((b) => !done.has(b.scanId)) });
    chrome.runtime.sendMessage({ type: 'INBOX_CONSUMED' }).catch(() => {});
    renderPapers();
    emit('papers-changed');
    showTab('papers');
    toast(
      `Imported ${added} new paper${added === 1 ? '' : 's'} into “${state.project.name}”${dupes ? ` · ${dupes} already there` : ''}${noAbs ? ` · ${noAbs} without abstract` : ''}.`,
      'ok'
    );
  } finally {
    consuming = false;
  }
}

// ------------------------------------------------------------------ boot
async function boot() {
  await loadSettings();
  applyTheme();
  initPapersView();
  initTopicsView();
  initMatrixView();
  initSettingsView();

  state.projects = await listProjects();
  let firstRun = false;
  if (!state.projects.length) {
    const p = { ...blankProject('My Research'), id: uid(), createdAt: Date.now() };
    await saveProject(p);
    state.projects = [p];
    firstRun = true;
  }
  const activeId = await getKV('activeProjectId');
  await setProject(activeId);
  renderSettings();
  renderConfig();

  // tabs
  $('#tabs').addEventListener('click', (e) => e.target.dataset.tab && showTab(e.target.dataset.tab));
  on('goto-tab', showTab);

  // project switching
  $('#projectSelect').addEventListener('change', (e) => setProject(e.target.value));
  on('project-renamed', () => {
    renderProjectSelect();
  });
  on('config-changed', () => {
    state.projects = state.projects.map((p) => (p.id === state.project.id ? state.project : p));
  });
  const npDlg = $('#newProjectDialog');
  $('#npPreset').innerHTML = PRESET_LIST.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
  $('#newProjectBtn').addEventListener('click', () => npDlg.showModal());
  npDlg.addEventListener('close', async () => {
    if (npDlg.returnValue === 'ok') await createProject($('#npName').value.trim(), $('#npPreset').value);
    npDlg.returnValue = '';
  });
  on('project-imported', async (id) => {
    state.projects = await listProjects();
    await setProject(id);
  });
  on('project-deleted', async () => {
    state.projects = await listProjects();
    if (!state.projects.length) await createProject('My Thesis', 'blank');
    else await setProject(state.projects[0].id);
  });

  // scan inbox: on load and whenever the background worker adds a scan
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.inbox?.newValue?.length) consumeInbox();
  });
  await consumeInbox();

  const hash = location.hash.replace('#', '');
  if (['papers', 'topics', 'matrix', 'settings'].includes(hash)) showTab(hash);
  else if (firstRun) showTab('topics');
  renderPapers();
  window.__scannerReady = true;
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('afterbegin', `<pre style="color:#b91c1c;padding:20px">Dashboard failed to start: ${esc(e.stack || e.message)}</pre>`);
});
