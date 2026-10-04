import { useRef, useState } from 'react';
import { useModalDialog } from './useModalDialog';
import { useAppearance } from '../application/AppearanceProvider';
import { ErrorNotice } from './ErrorNotice';
export function NewTextFileDialog({
  directory,
  onCreate,
  onClose,
}: {
  directory: string;
  onCreate: (path: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useAppearance();
  const input = useRef<HTMLInputElement>(null);
  const dialog = useModalDialog(true, input);
  const [name, setName] = useState(directory ? directory + '/untitled.txt' : 'untitled.txt');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create() {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onCreate(name.trim());
      onClose();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="new-text-dialog"
      aria-label={t('新建文本文件')}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <h2>{t('新建文本文件')}</h2>
        <label>
          {t('项目内文件路径')}
          <input
            ref={input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={4096}
            disabled={busy}
          />
        </label>
        <p className="field-help">{t('创建后直接编辑，Ctrl + S 保存。已有文件不会被覆盖。')}</p>
        {error && (
          <p role="alert">
            <ErrorNotice message={error} />
          </p>
        )}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            {t('取消')}
          </button>
          <button type="submit" className="primary-button" disabled={busy || !name.trim()}>
            {t('创建并编辑')}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
