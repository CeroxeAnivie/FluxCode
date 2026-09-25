export interface Checkpoint {
  revision: string;
  label: string;
}

export function gitChangeKind(status: string): string {
  if (status === '??') return '未跟踪';
  const flags = status.slice(0, 2);
  if (flags.includes('U') || flags === 'AA' || flags === 'DD') return '冲突';
  if (flags.includes('R')) return '重命名';
  if (flags.includes('C')) return '复制';
  if (flags.includes('D')) return '删除';
  if (flags.includes('A')) return '新增';
  if (flags.includes('T')) return '类型变更';
  if (flags.includes('M')) return '修改';
  return '变更';
}

export function gitChangeActions(status: string): { stage: boolean; unstage: boolean } {
  if (status.length !== 2) return { stage: false, unstage: false };
  if (status === '??') return { stage: true, unstage: false };
  return {
    stage: status[1] !== ' ',
    unstage: status[0] !== ' ' && status[0] !== '?',
  };
}

export type GitAction =
  | { type: 'checkpoint'; label: string }
  | { type: 'restoreCheckpoint'; revision: string; path: string }
  | { type: 'stage' | 'unstage'; path: string }
  | { type: 'hunk'; path: string; expected: string; index: number; staged: boolean }
  | {
      type: 'lines';
      path: string;
      expected: string;
      index: number;
      selected: number[];
      staged: boolean;
    }
  | { type: 'commit'; message: string }
  | { type: 'createBranch' | 'switchBranch'; name: string }
  | { type: 'createWorktree'; path: string; branch: string }
  | { type: 'merge' | 'rebase'; branch: string }
  | { type: 'continueOperation' | 'abortOperation' }
  | { type: 'resolveConflict'; path: string; version: 'ours' | 'theirs' }
  | { type: 'resolveEdited'; path: string; expected: string | null; content: string };
export interface GitBranches {
  current: string;
  branches: string[];
}
export interface GitOperation {
  kind: 'merge' | 'rebase' | null;
  conflicts: string[];
  dirty: boolean;
}
export interface ConflictVersions {
  base: string | null;
  current: string | null;
  incoming: string | null;
  working: string | null;
}
