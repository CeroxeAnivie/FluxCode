import { expect, it } from 'vitest';
import { sharedWorkspaceTasks } from './sharedWorkspace';
import { emptyConversation, type Catalog } from './types';

const catalog: Catalog = {
  version: 1,
  projects: [
    { id: 'main', name: 'Main', path: 'D:/Project' },
    { id: 'nested', name: 'Nested', path: 'd:\\project\\src' },
    { id: 'isolated', name: 'Worktree', path: 'D:/Project-other' },
  ],
  tasks: ['main', 'nested', 'isolated'].map((id) => ({
    id,
    projectId: id,
    title: id,
    archived: false,
    updatedAt: 0,
  })),
};
const conversations = Object.fromEntries(
  catalog.tasks.map(({ id }) => [
    id,
    {
      ...emptyConversation(),
      busy: true,
    },
  ]),
);

it('warns for overlapping Windows directories, excluding self and separate worktrees', () => {
  expect(
    sharedWorkspaceTasks(catalog, conversations, 'main', 'main').map((task) => task.id),
  ).toEqual(['nested']);
});
it('does not warn for finished tasks or missing projects', () => {
  expect(sharedWorkspaceTasks(catalog, {}, 'main', null)).toEqual([]);
  expect(sharedWorkspaceTasks(catalog, conversations, null, null)).toEqual([]);
});
