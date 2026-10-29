// Shared state + tiny helpers for the dashboard.
import { DEFAULT_MODEL } from './gemini.js';

export const state = {
  projects: [],
  project: null, // the active project config (also persisted in IndexedDB 'projects')
  papers: [], // papers of the active project
  settings: { apiKey: '', model: DEFAULT_MODEL, intervalSec: 4, theme: 'light', scihub: false, scihubUrl: 'https://sci-hub.se/', email: '' },
  filters: { q: '', topic: 'all', tier: 'all', decision: 'all', sort: 'order' },
  selected: new Set(),
  queue: { state: 'idle', remaining: 0, message: '' }
};

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));

export const currentYear = () => new Date().getFullYear();

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape untrusted (scraped / AI) text before putting it into innerHTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function toast(message, kind = '') {
  const host = $('#toastHost');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 7000 : 4200);
}

export function debounce(fn, ms = 400) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export const topicOf = (code) => state.project?.topics.find((t) => t.code === code) || null;

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  state.settings = { ...state.settings, ...(settings || {}) };
}
export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await chrome.storage.local.set({ settings: state.settings });
  emit('settings-changed');
}
