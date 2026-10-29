// Settings tab: API key, pacing, optional links, project import/export.
import { state, emit, on, $, toast, saveSettings } from './state.js';
import { MODEL_CHOICES, callGemini } from './gemini.js';
import { saveProject, putPapers, deleteProject, listPapers, uid } from './db.js';
import { download, safeName } from './exporter.js';

export function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme === 'dark' ? 'dark' : 'light';
}

export function renderSettings() {
  const s = state.settings;
  $('#sApiKey').value = s.apiKey || '';
  $('#sModel').innerHTML = MODEL_CHOICES.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
  $('#sModel').value = s.model;
  $('#sInterval').value = s.intervalSec;
  $('#sEmail').value = s.email || '';
  $('#sSciHub').checked = !!s.scihub;
  $('#sSciHubUrl').value = s.scihubUrl || '';
  const chip = $('#keyChip');
  chip.textContent = s.apiKey ? 'API key: set ✓' : 'API key: not set';
  chip.className = `chip ${s.apiKey ? 'ok' : 'bad'}`;
}

export function initSettingsView() {
  $('#saveSettingsBtn').addEventListener('click', async () => {
    await saveSettings({
      apiKey: $('#sApiKey').value.trim(),
      model: $('#sModel').value,
      intervalSec: Math.max(1, Math.min(60, parseFloat($('#sInterval').value) || 4)),
      email: $('#sEmail').value.trim(),
      scihub: $('#sSciHub').checked,
      scihubUrl: $('#sSciHubUrl').value.trim() || 'https://sci-hub.se/'
    });
    renderSettings();
    toast('Settings saved.', 'ok');
  });

  $('#testKeyBtn').addEventListener('click', async () => {
    const out = $('#testResult');
    const key = $('#sApiKey').value.trim();
    if (!key) return (out.textContent = 'Paste a key first.');
    out.textContent = 'Testing…';
    try {
      const r = await callGemini({
        apiKey: key,
        model: $('#sModel').value,
        system: 'Reply with the JSON {"ok": true}.',
        input: 'ping',
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }
      });
      out.textContent = r?.ok ? '✓ Key works.' : '✓ Reached Gemini.';
      out.style.color = 'var(--ok)';
    } catch (e) {
      out.textContent = `✗ ${e.message}`;
      out.style.color = 'var(--bad)';
    }
  });

  $('#themeBtn').addEventListener('click', async () => {
    await saveSettings({ theme: state.settings.theme === 'dark' ? 'light' : 'dark' });
    applyTheme();
  });

  $('#exportProjectBtn').addEventListener('click', () => {
    const data = { format: 'scopus-ai-scanner-v2', version: 1, project: state.project, papers: state.papers };
    download(`${safeName(state.project.name)}.project.json`, JSON.stringify(data, null, 2), 'application/json');
  });

  $('#importProjectBtn').addEventListener('click', () => $('#importProjectFile').click());
  $('#importProjectFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== 'scopus-ai-scanner-v2') throw new Error('Not a Scopus AI Scanner V2 project file.');
      const id = uid();
      const project = { ...data.project, id, name: `${data.project.name} (imported)` };
      await saveProject(project);
      await putPapers((data.papers || []).map((p) => ({ ...p, projectId: id, key: `${id}|${p.signature}` })));
      emit('project-imported', id);
      toast('Project imported.', 'ok');
    } catch (err) {
      toast(`Import failed: ${err.message}`, 'bad');
    }
  });

  $('#deleteProjectBtn').addEventListener('click', async () => {
    if (!confirm(`Delete project "${state.project.name}" and all its papers? This cannot be undone.`)) return;
    const id = state.project.id;
    await deleteProject(id);
    emit('project-deleted', id);
  });

  on('settings-changed', renderSettings);
}
