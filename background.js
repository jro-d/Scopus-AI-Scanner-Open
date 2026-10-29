// Service worker: receives scan results from the Scopus tab, parks them in a local inbox, and makes sure
// the dashboard tab exists — WITHOUT stealing focus from whatever the user is doing.
const DASHBOARD_URL = chrome.runtime.getURL('dashboard/dashboard.html');

async function findDashboardTab() {
  const tabs = await chrome.tabs.query({ url: DASHBOARD_URL + '*' });
  return tabs[0] || null;
}

async function ensureDashboard({ focus = false, windowId } = {}) {
  const existing = await findDashboardTab();
  if (existing) {
    if (focus) {
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
    }
    return existing;
  }
  return chrome.tabs.create({ url: DASHBOARD_URL, active: focus, ...(windowId ? { windowId } : {}) });
}

async function updateBadge() {
  const { inbox = [] } = await chrome.storage.local.get('inbox');
  const n = inbox.reduce((s, b) => s + (b.papers?.length || 0), 0);
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'SCOPUS_SCAN_RESULT') {
      const { inbox = [] } = await chrome.storage.local.get('inbox');
      inbox.push(msg.payload);
      await chrome.storage.local.set({ inbox });
      await updateBadge();
      await ensureDashboard({ focus: false, windowId: sender.tab?.windowId });
      sendResponse({ ok: true, queued: msg.payload.papers.length });
    } else if (msg?.type === 'OPEN_DASHBOARD') {
      await ensureDashboard({ focus: msg.focus !== false });
      sendResponse({ ok: true });
    } else if (msg?.type === 'INBOX_CONSUMED') {
      await updateBadge();
      sendResponse({ ok: true });
    }
  })().catch((e) => sendResponse({ ok: false, error: e.message }));
  return true; // async response
});

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'open_dashboard') ensureDashboard({ focus: true });
});

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
