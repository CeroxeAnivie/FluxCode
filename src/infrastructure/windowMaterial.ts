import { invoke, isTauri } from '@tauri-apps/api/core';
let pending: Promise<unknown> = Promise.resolve();
export function observeWindowMaterial(dark: boolean): () => void {
  if (!isTauri()) return () => {};
  let disposed = false;
  let revision = 0;
  const reduced = matchMedia('(prefers-reduced-transparency: reduce)');
  const forced = matchMedia('(forced-colors: active)');
  const apply = () => {
    const epoch = ++revision;
    // Serialize native changes so late replies cannot restore an obsolete theme.
    pending = pending
      .catch(() => {})
      .then(async () => {
        if (disposed || epoch !== revision) return;
        try {
          const result = await invoke<{ applied: boolean }>('configure_window_material', {
            dark,
            enabled: !reduced.matches && !forced.matches,
          });
          if (!disposed && epoch === revision)
            document.documentElement.dataset.material = result.applied ? 'acrylic' : 'solid';
        } catch {
          if (!disposed) document.documentElement.dataset.material = 'solid';
          console.warn('window_material_unavailable');
        }
      });
  };
  const foreground = () => {
    if (!document.hidden) apply();
  };
  reduced.addEventListener('change', apply);
  forced.addEventListener('change', apply);
  window.addEventListener('focus', apply);
  document.addEventListener('visibilitychange', foreground);
  apply();
  return () => {
    disposed = true;
    revision++;
    reduced.removeEventListener('change', apply);
    forced.removeEventListener('change', apply);
    window.removeEventListener('focus', apply);
    document.removeEventListener('visibilitychange', foreground);
  };
}
