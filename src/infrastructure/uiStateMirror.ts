import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { confirm } from '@tauri-apps/plugin-dialog';
import { allowWorkspaceNavigation } from './navigationGuard';

export interface UiStateSnapshot {
  version: 1;
  generation: number;
  values: Record<string, string>;
}

const PREFIX = 'fluxcode.';
const GENERATION_KEY = '__fluxcode.ui-mirror-generation.v1';
const DIRTY_KEY = '__fluxcode.ui-mirror-dirty.v1';
const ERROR_EVENT = 'fluxcode:ui-storage-error';

export function captureUiState(storage: Storage = localStorage): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(PREFIX)) {
      const value = storage.getItem(key);
      if (value !== null) result[key] = value;
    }
  }
  return result;
}

export function applyUiState(values: Record<string, string>, storage: Storage = localStorage) {
  const previous = captureUiState(storage);
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(PREFIX) || typeof value !== 'string') {
      throw new Error('界面恢复数据包含无效键');
    }
  }
  try {
    for (const key of Object.keys(previous)) storage.removeItem(key);
    for (const [key, value] of Object.entries(values)) storage.setItem(key, value);
  } catch (cause) {
    for (const key of Object.keys(captureUiState(storage))) storage.removeItem(key);
    for (const [key, value] of Object.entries(previous)) storage.setItem(key, value);
    throw cause;
  }
  if (typeof localStorage !== 'undefined' && storage === localStorage) scheduleUiStateMirror();
}

type NativeStore = {
  load: () => Promise<UiStateSnapshot | null>;
  save: (generation: number | null, values: Record<string, string>) => Promise<UiStateSnapshot>;
  restore: (values: Record<string, string>) => Promise<UiStateSnapshot>;
};

function sameValues(left: Record<string, string>, right: Record<string, string>) {
  const leftKeys = Object.keys(left);
  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

export class UiStateMirror {
  private generation: number | null = null;
  private initialized = false;
  private pending = false;
  private running: Promise<void> | null = null;
  private failure: unknown = null;

  constructor(
    private readonly storage: Storage,
    private readonly native: NativeStore,
    private readonly report: (error: unknown) => void,
  ) {}

  async initialize(restored?: Record<string, string>) {
    if (this.initialized) return;
    if (restored) {
      const snapshot = await this.native.restore(restored);
      applyUiState(snapshot.values, this.storage);
      this.generation = snapshot.generation;
      this.storage.setItem(GENERATION_KEY, String(snapshot.generation));
      this.storage.removeItem(DIRTY_KEY);
      this.initialized = true;
      return;
    }
    const snapshot = await this.native.load();
    this.generation = snapshot?.generation ?? null;
    const local = captureUiState(this.storage);
    if (snapshot) {
      const unsaved = this.storage.getItem(DIRTY_KEY) === String(snapshot.generation);
      if (
        Object.keys(local).length === 0 ||
        !unsaved ||
        (snapshot.values['fluxcode.catalog.v1'] && !local['fluxcode.catalog.v1'])
      ) {
        applyUiState(snapshot.values, this.storage);
        this.storage.setItem(GENERATION_KEY, String(snapshot.generation));
        this.storage.removeItem(DIRTY_KEY);
      } else if (!sameValues(local, snapshot.values)) {
        await this.persist(local);
      } else {
        this.storage.removeItem(DIRTY_KEY);
      }
    } else if (Object.keys(local).length) {
      await this.persist(local);
    }
    this.initialized = true;
  }

  changed() {
    if (!this.initialized) return;
    this.storage.setItem(DIRTY_KEY, String(this.generation ?? 0));
    this.pending = true;
    queueMicrotask(() => this.startDrain());
  }

  async flush() {
    while (this.pending || this.running) {
      this.startDrain();
      await this.running;
    }
    if (this.failure) throw this.failure;
  }

  private startDrain() {
    if (this.running || !this.pending) return;
    this.running = this.drain().finally(() => {
      this.running = null;
      if (this.pending) this.startDrain();
    });
  }

  private async drain() {
    while (this.pending) {
      this.pending = false;
      try {
        await this.persist(captureUiState(this.storage));
        this.failure = null;
      } catch (error) {
        this.failure = error;
        this.report(error);
        return;
      }
    }
  }

  private async persist(values: Record<string, string>) {
    let snapshot: UiStateSnapshot;
    try {
      snapshot = await this.native.save(this.generation, values);
    } catch (error) {
      const latest = await this.native.load();
      if (!latest || !sameValues(latest.values, values)) throw error;
      snapshot = latest;
    }
    this.generation = snapshot.generation;
    this.storage.setItem(GENERATION_KEY, String(snapshot.generation));
    if (this.pending) this.storage.setItem(DIRTY_KEY, String(snapshot.generation));
    else this.storage.removeItem(DIRTY_KEY);
  }
}

let mirror: UiStateMirror | undefined;
function currentMirror() {
  mirror ??= new UiStateMirror(
    localStorage,
    {
      load: () => invoke<UiStateSnapshot | null>('load_ui_state'),
      save: (expectedGeneration, values) =>
        invoke<UiStateSnapshot>('save_ui_state', { expectedGeneration, values }),
      restore: (values) => invoke<UiStateSnapshot>('commit_restored_ui_state', { values }),
    },
    (error) => window.dispatchEvent(new CustomEvent(ERROR_EVENT, { detail: String(error) })),
  );
  return mirror;
}

export function scheduleUiStateMirror() {
  if (typeof window !== 'undefined' && isTauri()) currentMirror().changed();
}

export async function initializeUiStateMirror(restored?: Record<string, string>) {
  if (!isTauri()) return;
  await currentMirror().initialize(restored);
  let closing = false;
  await getCurrentWindow().onCloseRequested((event) => {
    event.preventDefault();
    if (closing || !allowWorkspaceNavigation()) return;
    closing = true;
    void currentMirror()
      .flush()
      .then(async () => {
        if (await invoke<boolean>('workspace_exit_needs_confirmation')) {
          const english = document.documentElement.lang.startsWith('en');
          const accepted = await confirm(
            english
              ? 'Exiting will stop running tasks and terminals. Your saved history and drafts will remain.'
              : '退出程序将停止正在运行的任务和终端，已保存的历史与草稿会保留。',
            {
              title: english ? 'Exit FluxCode?' : '退出 FluxCode？',
              kind: 'warning',
              okLabel: english ? 'Exit' : '退出',
              cancelLabel: english ? 'Keep working' : '继续工作',
            },
          );
          if (!accepted) return;
        }
        await invoke('close_workspace_window');
      })
      .then(() => {
        closing = false;
      })
      .catch((error) => {
        closing = false;
        window.dispatchEvent(new CustomEvent(ERROR_EVENT, { detail: String(error) }));
      });
  });
  window.addEventListener(
    'pagehide',
    () =>
      void currentMirror()
        .flush()
        .catch(() => {}),
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden')
      void currentMirror()
        .flush()
        .catch(() => {});
  });
}

export const flushUiStateMirror = () => mirror?.flush() ?? Promise.resolve();
export async function retryUiStateMirror() {
  if (!isTauri()) return;
  currentMirror().changed();
  await currentMirror().flush();
}
export const uiStorageErrorEvent = ERROR_EVENT;
export async function recoverPreviousUiState() {
  const snapshot = await invoke<UiStateSnapshot>('restore_previous_ui_state');
  applyUiState(snapshot.values);
  localStorage.setItem(GENERATION_KEY, String(snapshot.generation));
  localStorage.removeItem(DIRTY_KEY);
}
