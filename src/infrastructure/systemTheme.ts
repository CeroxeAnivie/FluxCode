import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { subscribeToResume } from './resumeSignals';

/** WebView2's preferred color scheme can differ from the Windows app theme. */
export async function observeSystemTheme(
  changed: (dark: boolean) => void,
  failed: (error: unknown) => void,
): Promise<() => void> {
  if (!isTauri()) {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const update = () => changed(query.matches);
    query.addEventListener('change', update);
    update();
    return () => query.removeEventListener('change', update);
  }
  const window = getCurrentWindow();
  let disposed = false;
  let revision = 0;
  const refresh = async () => {
    const current = ++revision;
    try {
      const theme = await window.theme();
      if (!disposed && current === revision) {
        if (!theme) throw new Error('Native window theme is unavailable');
        changed(theme === 'dark');
      }
    } catch (error) {
      if (!disposed && current === revision) failed(error);
    }
  };
  const off = await window.onThemeChanged(({ payload }) => {
    revision++;
    if (!disposed) changed(payload === 'dark');
  });
  const resume = subscribeToResume(() => void refresh());
  await refresh();
  return () => {
    disposed = true;
    revision++;
    resume();
    off();
  };
}
