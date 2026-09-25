import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { parseQueue } from '../domain/queuedMessage';
import { hasEditorDrafts } from './editorDrafts';
import { allowWorkspaceNavigation } from './navigationGuard';
import { captureUiState, flushUiStateMirror } from './uiStateMirror';
export { applyUiState, captureUiState } from './uiStateMirror';

export interface BackupSummary {
  id: string;
  createdAt: number;
  sizeBytes: number;
  fileCount: number;
  automatic: boolean;
  error: string | null;
}

export interface BackupFile {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface BackupDetail {
  summary: BackupSummary;
  files: BackupFile[];
  totalFiles: number;
}

export interface BackupProgress {
  jobId: string;
  stage: 'preparing' | 'copying' | 'publishing';
  files: number;
  bytes: number;
}

export function restoreBlockers(storage: Storage = localStorage): string[] {
  const blockers: string[] = [];
  try {
    if (parseQueue(storage.getItem('fluxcode.queue.v1')).length) {
      blockers.push('仍有待发送消息，请先处理或移除队列后再恢复。');
    }
  } catch {
    blockers.push('待发送队列无法读取，请先修复本地队列数据。');
  }
  try {
    if (hasEditorDrafts(storage)) {
      blockers.push('仍有未保存的文件编辑，请先保存或放弃草稿后再恢复。');
    }
  } catch {
    blockers.push('文件编辑草稿无法读取，请先修复本地草稿数据。');
  }
  return blockers;
}

export const backups = {
  list: () => invoke<BackupSummary[]>('list_backups'),
  openLocation: () => invoke<void>('open_backup_location'),
  create: (automatic = false, progressId?: string) => {
    if (!allowWorkspaceNavigation()) {
      return Promise.reject(new Error('文件编辑草稿未能保存，请保留当前窗口并重试。'));
    }
    return flushUiStateMirror().then(() =>
      invoke<BackupSummary>('create_backup', {
        uiState: captureUiState(),
        automatic,
        progressId: progressId ?? null,
      }),
    );
  },
  createManual: (onProgress: (progress: BackupProgress) => void) => {
    const id = crypto.randomUUID();
    const promise = (async () => {
      const stop = await listen<BackupProgress>('backup-progress', (event) => {
        if (event.payload.jobId === id) onProgress(event.payload);
      });
      try {
        return await backups.create(false, id);
      } finally {
        void Promise.resolve(stop()).catch((cause) =>
          console.warn('backup_progress_unsubscribe_failed', cause),
        );
      }
    })();
    return { id, promise };
  },
  cancel: (progressId: string) => invoke<boolean>('cancel_backup', { progressId }),
  detail: (id: string, offset = 0, limit = 50) =>
    invoke<BackupDetail>('backup_detail', { id, offset, limit }),
  verify: (id: string) => invoke<BackupSummary>('verify_backup', { id }),
  remove: (id: string) => invoke<void>('remove_backup', { id }),
  restore: (id: string) => {
    if (!allowWorkspaceNavigation()) {
      return Promise.reject(new Error('文件编辑草稿未能保存，请保留当前窗口并重试。'));
    }
    const blockers = restoreBlockers();
    if (blockers.length) return Promise.reject(new Error(blockers[0]));
    return invoke<BackupSummary>('request_backup_restore', { id, uiState: captureUiState() });
  },
  restart: () => invoke<void>('restart_for_restore'),
  restartUnconfirmed: () => invoke<void>('restart_unconfirmed_restore'),
  restoredUi: () => invoke<Record<string, string> | null>('restored_ui_state'),
  finishUiRestore: () => invoke<void>('finish_ui_restore'),
};
