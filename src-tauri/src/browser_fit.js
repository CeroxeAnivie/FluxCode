// Remote content stays untrusted: this script exposes no application bridge.
(() => {
  if (window.top !== window) return;
  let frame = 0;
  let timer = 0;
  let running = false;
  const fit = () => {
    if (!document.body || running) return;
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
    }, { once: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
