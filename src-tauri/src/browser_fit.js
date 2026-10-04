// Remote content stays untrusted: this script exposes no application bridge.
(() => {
  if (window.top !== window) {
    const forward = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.type === 'keydown' && !['+', '-', '=', '0'].includes(event.key)) return;
      window.top.postMessage({ fluxcodeZoomIntent: event.type === 'keydown' && event.key === '0' ? 'reset' : 'manual' }, '*');
    };
    window.addEventListener('wheel', forward, { capture: true, passive: true });
    window.addEventListener('keydown', forward, true);
    return;
  }
  let frame = 0;
  let timer = 0;
  let running = false;
  let manualZoom = false;
  const zoomIntent = (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.type === 'keydown' && !['+', '-', '=', '0'].includes(event.key)) return;
    manualZoom = !(event.type === 'keydown' && event.key === '0');
    if (!manualZoom) schedule();
  };
  // Native WebView2 performs zoom. Freeze the fit scale so resize events do not
  // compensate for (and visually cancel) the user's chosen magnification.
  window.addEventListener('wheel', zoomIntent, { capture: true, passive: true });
  window.addEventListener('keydown', zoomIntent, true);
  // A cross-origin frame can only pause/reset fitting; this exposes no native capability.
  window.addEventListener('message', (event) => {
    const intent = event.data?.fluxcodeZoomIntent;
    if (intent !== 'manual' && intent !== 'reset') return;
    manualZoom = intent === 'manual';
    if (!manualZoom) schedule();
  });
  const fit = () => {
    if (!document.body || running || manualZoom) return;
    running = true;
    const root = document.documentElement;
    root.style.zoom = '1';
    const width = window.innerWidth;
    const content = Math.max(root.scrollWidth, document.body.scrollWidth);
    // Responsive sites stay at 100%; fixed-width desktop pages shrink to the panel.
    const scale = content > width + 2 ? Math.max(0.35, width / content) : 1;
    root.style.zoom = String(scale);
    running = false;
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    }, 100);
  };
  const start = () => {
    fit();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('load', schedule, true);
    document.fonts?.ready.then(schedule);
    window.addEventListener('pagehide', () => {
      observer.disconnect();
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    });
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      schedule();
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
