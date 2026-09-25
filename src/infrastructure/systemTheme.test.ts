import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  theme: vi.fn(),
  onThemeChanged: vi.fn(),
  resume: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => state }));
vi.mock('./resumeSignals', () => ({ subscribeToResume: state.resume }));
import { observeSystemTheme } from './systemTheme';
afterEach(() => vi.resetAllMocks());
it('uses native dark theme even when the embedded browser does not expose it and cleans up', async () => {
  const stopEvents = vi.fn(),
    stopResume = vi.fn(),
    changed = vi.fn(),
    failed = vi.fn();
  state.theme.mockResolvedValue('dark');
  state.onThemeChanged.mockResolvedValue(stopEvents);
  state.resume.mockReturnValue(stopResume);
  const stop = await observeSystemTheme(changed, failed);
  expect(changed).toHaveBeenLastCalledWith(true);
  state.onThemeChanged.mock.calls[0][0]({ payload: 'light' });
  expect(changed).toHaveBeenLastCalledWith(false);
  stop();
  expect(stopEvents).toHaveBeenCalledOnce();
  expect(stopResume).toHaveBeenCalledOnce();
  expect(failed).not.toHaveBeenCalled();
});
it('does not overwrite a newer system event with an older initial read', async () => {
  let resolve!: (theme: string) => void;
  state.theme.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  state.onThemeChanged.mockResolvedValue(vi.fn());
  state.resume.mockReturnValue(vi.fn());
  const changed = vi.fn();
  const pending = observeSystemTheme(changed, vi.fn());
  await vi.waitFor(() => expect(state.theme).toHaveBeenCalled());
  state.onThemeChanged.mock.calls[0][0]({ payload: 'dark' });
  resolve('light');
  const stop = await pending;
  expect(changed.mock.calls).toEqual([[true]]);
  stop();
});
it('reports a failed native read instead of silently claiming the system is light', async () => {
  state.theme.mockRejectedValue(new Error('read failed'));
  state.onThemeChanged.mockResolvedValue(vi.fn());
  state.resume.mockReturnValue(vi.fn());
  const failed = vi.fn(),
    changed = vi.fn();
  const stop = await observeSystemTheme(changed, failed);
  expect(failed).toHaveBeenCalledOnce();
  expect(changed).not.toHaveBeenCalled();
  stop();
});
