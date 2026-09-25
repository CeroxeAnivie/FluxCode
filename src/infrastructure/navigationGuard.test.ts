import { afterEach, expect, it, vi } from 'vitest';
import { allowWorkspaceNavigation, guardWorkspaceNavigation } from './navigationGuard';

afterEach(() => vi.unstubAllGlobals());

it('cancels a snapshot when a registered writer cannot persist its draft', () => {
  vi.stubGlobal('window', new EventTarget());
  const release = guardWorkspaceNavigation(() => false);
  expect(allowWorkspaceNavigation()).toBe(false);
  release();
  expect(allowWorkspaceNavigation()).toBe(true);
});
