document.getElementById('dash').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD', focus: true });
  window.close();
});

document.getElementById('show').addEventListener('click', async () => {
  const status = document.getElementById('status');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/scopus-scanner.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__scopusAiScannerV2?.show() });
    window.close();
  } catch (e) {
    status.textContent = `Cannot run on this page (${e.message}). Open a Scopus results page first.`;
  }
});
