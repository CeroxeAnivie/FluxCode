import { useEffect, useState } from 'react';
import { bridge } from '../infrastructure/bridge';
import type { ConflictVersions } from '../domain/git';
import { useAppearance } from '../application/AppearanceProvider';
import { ErrorNotice } from './ErrorNotice';
import { useModalDialog } from './useModalDialog';

const combine = (first: string, second: string) =>
  first + (first && second && !first.endsWith('\n') ? '\n' : '') + second;

export function GitConflictEditor({
  root,
  path,
  onResolved,
  onClose,
}: {
  root: string;
  path: string;
  onResolved: () => void;
  onClose: () => void;
}) {
  const { t } = useAppearance();
  const dialog = useModalDialog();
  const [versions, setVersions] = useState<ConflictVersions | null>(null);
  const [expected, setExpected] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setVersions(null);
    setError('');
    void bridge
      .gitConflictVersions(root, path)
      .then((sources) => {
        if (!active) return;
        setVersions(sources);
        setExpected(sources.working);
        setResult(sources.working ?? sources.current ?? sources.incoming ?? '');
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [root, path]);

  function requestClose() {
    if (saving) return;
    if (result !== expected) setDiscard(true);
    else onClose();
  }

  async function save() {
    if (saving || !versions) return;
    setSaving(true);
    setError('');
    try {
      await bridge.gitAction(root, { type: 'resolveEdited', path, expected, content: result });
      onResolved();
      onClose();
    } catch (cause) {
      const disk = await bridge.readFile(root, path).catch(() => null);
      if (disk === result) setExpected(disk);
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="git-conflict-dialog"
      aria-label={t('解决 Git 冲突')}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
    >
      <header className="dialog-header">
        <div>
          <h2>{t('解决 Git 冲突')}</h2>
          <p title={path}>{path}</p>
        </div>
        <button type="button" onClick={requestClose} disabled={saving} aria-label={t('关闭')}>
          ×
        </button>
      </header>
      {loading && <p role="status">{t('正在加载…')}</p>}
      {versions && (
        <>
          <div className="git-conflict-sources">
            {(
              [
                ['共同祖先', versions.base],
                ['当前版本', versions.current],
                ['传入版本', versions.incoming],
              ] as const
            ).map(([label, content]) => (
              <section key={label}>
                <h3>{t(label)}</h3>
                <pre>{content ?? t('此版本不存在')}</pre>
              </section>
            ))}
          </div>
          <div className="git-conflict-result">
            <div className="git-conflict-result-header">
              <label htmlFor="git-conflict-result">{t('合并结果')}</label>
              <div>
                <button
                  type="button"
                  disabled={saving || versions.current === null}
                  onClick={() => setResult(versions.current ?? '')}
                >
                  {t('使用当前')}
                </button>
                <button
                  type="button"
                  disabled={saving || versions.incoming === null}
                  onClick={() => setResult(versions.incoming ?? '')}
                >
                  {t('使用传入')}
                </button>
                <button
                  type="button"
                  disabled={saving || versions.current === null || versions.incoming === null}
                  onClick={() =>
                    setResult(combine(versions.current ?? '', versions.incoming ?? ''))
                  }
                >
                  {t('保留两者')}
                </button>
              </div>
            </div>
            <textarea
              id="git-conflict-result"
              aria-label={t('合并结果')}
              value={result}
              disabled={saving}
              onChange={(event) => setResult(event.target.value)}
              spellCheck={false}
            />
          </div>
          <footer className="git-conflict-footer">
            {discard && <span role="alert">{t('未保存的合并结果将丢失。')}</span>}
            <button type="button" disabled={saving} onClick={discard ? onClose : requestClose}>
              {t(discard ? '确认放弃' : '取消')}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={saving}
              onClick={() => void save()}
            >
              {t('保存并标记已解决')}
            </button>
          </footer>
        </>
      )}
      {error && (
        <p role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
    </dialog>
  );
}
