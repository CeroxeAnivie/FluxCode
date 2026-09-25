const SAMPLE_INTERVAL_MS = 15_000;
const SUSPEND_GAP_MS = 45_000;

/** Browsers have no portable suspend event. Focus/visibility/network signals
 * cover foreground returns; a delayed timer also detects a long suspension
 * while the window remained visible. Normal ticks never trigger network work. */
export function subscribeToResume(onResume: () => void): () => void {
  let lastSample = Date.now();
  const notify = () => {
    if (document.visibilityState === 'visible') onResume();
  };
  const timer = setInterval(() => {
    const now = Date.now();
    const gap = now - lastSample;
    lastSample = now;
    if (gap > SUSPEND_GAP_MS || gap < 0) notify();
  }, SAMPLE_INTERVAL_MS);
  document.addEventListener('visibilitychange', notify);
  window.addEventListener('focus', notify);
  window.addEventListener('online', notify);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', notify);
    window.removeEventListener('focus', notify);
    window.removeEventListener('online', notify);
  };
}
