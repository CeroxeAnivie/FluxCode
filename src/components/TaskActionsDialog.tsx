import { ErrorNotice } from './ErrorNotice';
import { useEffect, useRef, useState } from 'react';
import type { FluxController } from '../application/useFluxCode';
import type { Task } from '../domain/types';
import { useAppearance } from '../application/AppearanceProvider';
import { useModalDialog } from './useModalDialog';
export function TaskActionsDialog({
  task,
  app,
  onClose,
}: {
  task: Task;
  app: FluxController;
  onClose: () => void;
}) {
  const { t } = useAppearance();
  const dialog = useModalDialog();
  const [title, setTitle] = useState(task.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errorNotice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorNotice.current?.focus();
  }, [error]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      const result = await action();
      if (result !== false) onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="model-dialog"
      aria-label={t('整理任务')}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => app.renameTask(task.id, title));
        }}
      >
        <h2>{t('整理任务')}</h2>
        <label className="form-field">
          {t('任务名称')}
          <input
            value={title}
            maxLength={200}
            required
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={
            busy ||
            !!task.imported ||
            !!app.conversations[task.id]?.busy ||
            app.connection !== 'ready'
          }
          onClick={() => void run(() => app.forkTask(task.id))}
        >
          {t('从此任务创建分支')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => app.exportTask(task.id, 'markdown'))}
        >
          {t('导出文档')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => app.exportTask(task.id, 'json'))}
        >
          {t('导出结构化记录')}
        </button>
        {error && (
          <p ref={errorNotice} tabIndex={-1} role="alert">
            <ErrorNotice message={error} />
          </p>
        )}
        <div className="model-dialog-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              app.pinTask(task.id);
              onClose();
            }}
          >
            {t(task.pinned ? '取消置顶' : '置顶')}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            {t('取消')}
          </button>
          <button className="primary-button" disabled={busy || !title.trim()}>
            {t('保存')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
