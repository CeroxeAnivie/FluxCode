import { expect, it } from 'vitest';
import { gitChangeActions, gitChangeKind } from './git';

it('names porcelain states without requiring users to decode Git letters', () => {
  expect(gitChangeKind('??')).toBe('未跟踪');
  expect(gitChangeKind('A ')).toBe('新增');
  expect(gitChangeKind(' D')).toBe('删除');
  expect(gitChangeKind('R ')).toBe('重命名');
  expect(gitChangeKind('T ')).toBe('类型变更');
  expect(gitChangeKind('UU')).toBe('冲突');
});

it('offers only applicable whole-file stage actions for each index/worktree state', () => {
  expect(gitChangeActions('??')).toEqual({ stage: true, unstage: false });
  expect(gitChangeActions(' M')).toEqual({ stage: true, unstage: false });
  expect(gitChangeActions(' D')).toEqual({ stage: true, unstage: false });
  expect(gitChangeActions('A ')).toEqual({ stage: false, unstage: true });
  expect(gitChangeActions('R ')).toEqual({ stage: false, unstage: true });
  expect(gitChangeActions('MM')).toEqual({ stage: true, unstage: true });
  expect(gitChangeActions('')).toEqual({ stage: false, unstage: false });
});
