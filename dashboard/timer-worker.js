// Worker-based timer: timers inside a dedicated Worker are not subject to the aggressive
// background-tab throttling that would otherwise stretch our pacing delays to a minute.
self.onmessage = (e) => {
  const { id, ms } = e.data;
  setTimeout(() => self.postMessage({ id }), ms);
};
