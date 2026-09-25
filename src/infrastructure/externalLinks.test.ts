import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { openWebLink } from './externalLinks';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
beforeEach(() => vi.mocked(invoke).mockClear());
it('dispatches web navigation once through the native browser command', async () => {
  await openWebLink('https://example.com/docs?q=flux#start');
  expect(invoke).toHaveBeenCalledExactlyOnceWith('open_external_link', {
    url: 'https://example.com/docs?q=flux#start',
  });
});
it('rejects unsafe navigation before invoking the host', async () => {
  await expect(openWebLink('javascript:alert(1)')).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
