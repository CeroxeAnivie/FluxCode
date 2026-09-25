import { ErrorNotice } from './ErrorNotice';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
const CodeEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })));
const ConflictEditor = lazy(() =>
  import('./ConflictEditor').then((m) => ({ default: m.ConflictEditor })),
);
import { bridge } from '../infrastructure/bridge';
import { loadEditorDraft, saveEditorDraft } from '../infrastructure/editorDrafts';
import { useAppearance } from '../application/AppearanceProvider';
import { deferredWrite } from '../infrastructure/deferredWrite';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { preserveLineEndings } from '../domain/lineEndings';
import { guardWorkspaceNavigation } from '../infrastructure/navigationGuard';

export function FileEditor({
  root,
  path,
  content,
  onSaved,
  onClose,
}: {
  root: string;
  path: string;
  content: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t } = useAppearance();
  const [initial] = useState(() => {
    try {
      return { draft: loadEditorDraft(root, path), error: '' };
    } catch (e) {
      return { draft: undefined, error: String(e) };
    }
  });
  const [base, setBase] = useState(initial.draft?.base ?? content);
  const [text, setText] = useState(initial.draft?.text ?? content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initial.error);
  const [disk, setDisk] = useState<string | null>(null);
  const saving = useRef(false);
  const [draftState, setDraftState] = useState<'pending' | 'saved' | 'failed'>('saved');
  const [writer] = useState(() =>
    deferredWrite<Parameters<typeof saveEditorDraft>[2]>(
      (draft) => saveEditorDraft(root, path, draft),
      (state, failure) => {
        setDraftState(state);
        if (failure) setError(String(failure));
      },
    ),
  );
  useEffect(() => {
    const removeGuard = guardWorkspaceNavigation(() => !saving.current && writer.flush());
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void getCurrentWindow()
        .onCloseRequested((event) => {
          if (!writer.flush()) event.preventDefault();
        })
        .then((stop) => {
          if (disposed) stop();
          else unlisten = stop;
        })
        .catch((failure) => setError(String(failure)));
    }
    const flush = () => {
      writer.flush();
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!writer.flush()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', flush);
    window.addEventListener('blur', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      removeGuard();
      disposed = true;
      unlisten?.();
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('blur', flush);
      document.removeEventListener('visibilitychange', hidden);
      writer.flush();
    };
  }, [writer]);
  const dirty = text !== base;
  function edit(next: string) {
    next = preserveLineEndings(next, base);
    setText(next);
    writer.schedule(next === base ? null : { base, text: next, updatedAt: Date.now() });
  }
  async function save() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await bridge.saveFile(root, path, disk ?? base, text);
      setBase(text);
      setDisk(null);
      writer.cancel();
      setDraftState('saved');
      onSaved();
      try {
        saveEditorDraft(root, path, null);
      } catch {
        setError('文件已保存，但旧草稿未能清理。重新打开时请核对文件内容。');
      }
    } catch (e) {
      setError(String(e));
      try {
        const current = await bridge.readFile(root, path);
        if (current !== base) setDisk(current);
      } catch (readError) {
        setError(`${String(e)}; ${String(readError)}`);
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="file-editor">
      <header>
        <span>
          {path}
          {dirty ? ' ●' : ''}
        </span>
        <button onClick={() => void save()} disabled={!dirty || busy}>
          {t('保存')}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            if (writer.flush()) onClose();
          }}
        >
          {t('关闭')}
        </button>
      </header>
      {error && (
        <p role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
      {disk !== null && (
        <p role="status">
          {t('文件在磁盘上已变化。左侧为最新文件，右侧保留你的编辑；调整右侧后保存合并结果。')}
        </p>
      )}
      <div className="editor-surface" inert={busy}>
        <Suspense fallback={<p role="status">{t('正在加载…')}</p>}>
          {disk !== null ? (
            <ConflictEditor disk={disk} draft={text} onChange={edit} onSave={() => void save()} />
          ) : (
            <CodeEditor
              path={path}
              value={text}
              onChange={edit}
              onSave={() => {
                void save();
              }}
              readOnly={busy}
            />
          )}
        </Suspense>
      </div>
      <small>
        {draftState === 'failed'
          ? t('草稿未能保存在本机，请保存文件或重试。')
          : draftState === 'pending'
            ? t('正在保存本机草稿…')
            : dirty
              ? t('未保存编辑已保存在本机，重新打开文件可继续。')
              : t('UTF-8 · Ctrl S 保存 · 外部修改冲突时保留你的编辑')}
      </small>
      {draftState === 'failed' && (
        <div>
          <button
            onClick={() => {
              if (writer.flush()) setError('');
            }}
          >
            {t('重试保存草稿')}
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void bridge
                .exportDocument(`${path.split(/[\\/]/).at(-1) ?? 'draft'}.txt`, text)
                .catch((cause) => setError(String(cause)))
            }
          >
            {t('另存当前编辑')}
          </button>
        </div>
      )}
    </section>
  );
}
