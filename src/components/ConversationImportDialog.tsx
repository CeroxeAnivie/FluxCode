import { useEffect, useRef, useState } from 'react';
import { FileUp, X } from 'lucide-react';
import { useAppearance } from '../application/AppearanceProvider';
import { planTaskImport, type ImportPlan } from '../domain/taskImport';
import type { Catalog } from '../domain/types';
import { bridge } from '../infrastructure/bridge';
import { ErrorNotice } from './ErrorNotice';
import { useModalDialog } from './useModalDialog';

export function ConversationImportDialog({
  catalog,
  onImport,
  onClose,
}: {
  catalog: Catalog;
  onImport: (
    text: string,
    includeDuplicates: boolean,
  ) => Promise<{ imported: number; skipped: number }>;
  onClose: () => void;
}) {
  const { t } = useAppearance();
  const dialog = useModalDialog();
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errorNotice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorNotice.current?.focus();
  }, [error]);
  async function choose() {
    setBusy(true);
    setError('');
    try {
      const content = await bridge.readDocument(['json']);
      if (content === null) return;
      const preview = await planTaskImport(content, catalog);
      setText(content);
      setPlan(preview);
      setIncludeDuplicates(false);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    setBusy(true);
    setError('');
    try {
      const result = await onImport(text, includeDuplicates);
      if (result.imported) onClose();
      else setError(t('这些对话已导入；如需再次保存，请选择包含重复项。'));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="conversation-search-dialog"
      aria-label={t('导入对话')}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="dialog-header">
        <div>
          <span className="eyebrow">{t('任务历史')}</span>
          <h2>{t('导入对话')}</h2>
        </div>
        <button className="icon-button" aria-label={t('关闭')} disabled={busy} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="conversation-search-results">
        <p>{t('支持 FluxCode 导出的 JSON 对话文件。导入后可阅读和搜索，不能继续原引擎会话。')}</p>
        <button type="button" disabled={busy} onClick={() => void choose()}>
          <FileUp size={16} /> {t('选择 JSON 文件')}
        </button>
        {plan && (
          <>
            <p role="status">
              {t('项目')} {plan.projectCount} · {t('任务')} {plan.entries.length} ·{' '}
              {t('已导入重复项')} {plan.duplicateCount} · {t('源 ID 冲突')} {plan.idConflictCount}
            </p>
            <div className="import-preview">
              {plan.entries.map((entry, index) => (
                <div key={`${entry.fingerprint}:${index}`}>
                  <strong>
                    {t(entry.projectName)} / {entry.title}
                  </strong>
                  <span>
                    {' '}
                    · {entry.messages.length} {t('条消息')}
                  </span>
                  {entry.duplicate && <small> · {t('已导入，将跳过')}</small>}
                  {entry.idConflict && <small> · {t('源 ID 已存在，将分配新 ID')}</small>}
                </div>
              ))}
            </div>
            {plan.duplicateCount > 0 && (
              <label>
                <input
                  type="checkbox"
                  checked={includeDuplicates}
                  onChange={(event) => setIncludeDuplicates(event.target.checked)}
                />
                {t('包含重复项（另存副本）')}
              </label>
            )}
          </>
        )}
        {error && (
          <p ref={errorNotice} tabIndex={-1} role="alert">
            <ErrorNotice message={error} />
          </p>
        )}
      </div>
      <div className="model-dialog-actions">
        <button disabled={busy} onClick={onClose}>
          {t('取消')}
        </button>
        <button
          className="primary-button"
          disabled={
            busy || !plan || (!includeDuplicates && plan.entries.every((entry) => entry.duplicate))
          }
          onClick={() => void commit()}
        >
          {t(busy ? '正在导入…' : '导入对话')}
        </button>
      </div>
    </dialog>
  );
}
