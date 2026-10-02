import { ErrorNotice } from './ErrorNotice';
import { useEffect, useRef, useState } from 'react';
import type { FluxController } from '../application/useFluxCode';
import type { Task } from '../domain/types';
import { useAppearance } from '../application/AppearanceProvider';
import { useModalDialog } from './useModalDialog';
import { GitFork, Download, FileJson, Pin, X } from 'lucide-react';
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
      className="model-dialog task-actions-dialog"
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
        <header className="dialog-header">
          <div>
            <span className="eyebrow">{t('任务')}</span>
            <h2>{t('整理任务')}</h2>
          </div>
          <button type="button" className="icon-button" aria-label={t('关闭')} onClick={onClose} disabled={busy}>
            <X size={18} />
          </button>
        </header>
        <p className="dialog-description">{t('修改名称、创建分支或导出当前任务。')}</p>
        <label className="form-field">
          {t('任务名称')}
          <input
            autoFocus
            onFocus={(event) => event.target.select()}
            value={title}
            maxLength={200}
            required
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="task-action-list">
          <button
            type="button"
            className="task-action-button"
          disabled={
            busy ||
            !!task.imported ||
            !!app.conversations[task.id]?.busy ||
            app.connection !== 'ready'
          }
          onClick={() => void run(() => app.forkTask(task.id))}
          >
            <GitFork size={16} />
            <span>{t('从此任务创建分支')}</span>
          </button>
          <button
            type="button"
            className="task-action-button"
          disabled={busy}
          onClick={() => void run(() => app.exportTask(task.id, 'markdown'))}
          >
            <Download size={16} />
            <span>{t('导出文档')}</span>
          </button>
          <button
            type="button"
            className="task-action-button"
          disabled={busy}
          onClick={() => void run(() => app.exportTask(task.id, 'json'))}
          >
            <FileJson size={16} />
            <span>{t('导出结构化记录')}</span>
          </button>
        </div>
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
            <Pin size={15} />
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
