import { useEffect, useMemo, useState } from 'react';
import { Diff, Hunk, Decoration, getChangeKey, parseDiff, type ChangeData } from 'react-diff-view';
import { Fragment } from 'react';
import { bridge } from '../infrastructure/bridge';
import { ErrorNotice } from './ErrorNotice';
import 'react-diff-view/style/index.css';
import { useAppearance } from '../application/AppearanceProvider';
export function DiffReview({
  content,
  staged,
  root,
  path,
  status,
  onChanged,
}: {
  content: string;
  staged?: string;
  root?: string;
  path?: string;
  status?: string;
  onChanged?: () => Promise<void>;
}) {
  const { t, language } = useAppearance();
  const [split, setSplit] = useState(false);
  const [showStaged, setShowStaged] = useState(!content && !!staged);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedLines, setSelectedLines] = useState<{ hunk: number; keys: string[] }>({
    hunk: -1,
    keys: [],
  });
  async function applyHunk(index: number) {
    if (!root || !path || busy) return;
    setBusy(true);
    setError('');
    try {
      await bridge.gitAction(root, {
        type: 'hunk',
        path,
        expected: selectedContent,
        index,
        staged: showStaged,
      });
      await onChanged?.();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  }
  const selectedContent = showStaged ? (staged ?? '') : content;
  useEffect(() => setSelectedLines({ hunk: -1, keys: [] }), [selectedContent]);
  const files = useMemo(() => {
    try {
      return parseDiff(selectedContent);
    } catch {
      return [];
    }
  }, [selectedContent]);
  const visibleFiles = files.filter((item) => item.hunks.length > 0);
  const ordinaryModification = !status || /^(?: M|M |MM)$/.test(status);
  const file =
    files.length === 1 &&
    files[0].hunks.length > 0 &&
    files[0].type === 'modify' &&
    ordinaryModification &&
    files[0].oldPath === files[0].newPath &&
    !/^(?:old mode|new mode|new file mode|deleted file mode|rename from|rename to|copy from|copy to|Binary files|GIT binary patch) /m.test(
      selectedContent,
    )
      ? files[0]
      : null;
  const wholeFileOnly = !ordinaryModification || (!!selectedContent && !file);
  function selectLine(change: ChangeData) {
    if (!file || change.type === 'normal') return;
    const hunk = file.hunks.findIndex((item) => item.changes.some((row) => row === change));
    if (hunk < 0) return;
    const key = getChangeKey(change);
    setSelectedLines((current) => ({
      hunk,
      keys:
        current.hunk !== hunk
          ? [key]
          : current.keys.includes(key)
            ? current.keys.filter((item) => item !== key)
            : [...current.keys, key],
    }));
  }
  async function applySelectedLines() {
    if (!root || !path || !file || busy || selectedLines.hunk < 0) return;
    const hunk = file.hunks[selectedLines.hunk];
    const selected = hunk.changes
      .filter((change) => change.type !== 'normal')
      .flatMap((change, index) =>
        selectedLines.keys.includes(getChangeKey(change)) ? [index] : [],
      );
    if (!selected.length) return;
    setBusy(true);
    setError('');
    try {
      await bridge.gitAction(root, {
        type: 'lines',
        path,
        expected: selectedContent,
        index: selectedLines.hunk,
        selected,
        staged: showStaged,
      });
      setSelectedLines({ hunk: -1, keys: [] });
      await onChanged?.();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="diff-review">
      {error && (
        <p role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
      <div className="diff-toolbar">
        {onChanged && (
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onChanged()
                .catch((failure) => setError(String(failure)))
                .finally(() => setBusy(false));
            }}
          >
            {t('刷新差异')}
          </button>
        )}
        {staged !== undefined && (
          <>
            <button aria-pressed={!showStaged} onClick={() => setShowStaged(false)}>
              {t('未暂存')}
            </button>
            <button aria-pressed={showStaged} onClick={() => setShowStaged(true)}>
              {t('已暂存')}
            </button>
          </>
        )}
        <button aria-pressed={!split} onClick={() => setSplit(false)}>
          {t('统一对比')}
        </button>
        <button aria-pressed={split} onClick={() => setSplit(true)}>
          {t('并排对比')}
        </button>
        {root && path && file && (
          <button
            disabled={busy || !selectedLines.keys.length}
            onClick={() => void applySelectedLines()}
          >
            {t(showStaged ? '取消暂存所选行' : '暂存所选行')}
            {selectedLines.keys.length > 0 &&
              ` · ${language === 'en' ? `${selectedLines.keys.length} selected` : `已选 ${selectedLines.keys.length} 行`}`}
          </button>
        )}
      </div>
      {wholeFileOnly && (
        <p className="panel-note">{t('新增、删除、重命名、二进制或权限变更请使用文件级暂存。')}</p>
      )}
      <div className="diff-scroll">
        {visibleFiles.length ? (
          visibleFiles.map((file, index) => (
            <Diff
              key={index}
              viewType={split ? 'split' : 'unified'}
              diffType={file.type}
              hunks={file.hunks}
              selectedChanges={selectedLines.keys}
              renderGutter={({ change, side, renderDefault }) =>
                root &&
                path &&
                files.length === 1 &&
                file === files[0] &&
                !wholeFileOnly &&
                ((change.type === 'insert' && side === 'new') ||
                  (change.type === 'delete' && side === 'old')) ? (
                  <button
                    type="button"
                    className="diff-line-select"
                    aria-pressed={selectedLines.keys.includes(getChangeKey(change))}
                    aria-label={`${t(showStaged ? '选择要取消暂存的差异行' : '选择要暂存的差异行')} ${change.lineNumber}`}
                    title={t(showStaged ? '选择要取消暂存的差异行' : '选择要暂存的差异行')}
                    onClick={() => selectLine(change)}
                  >
                    {renderDefault()}
                  </button>
                ) : (
                  renderDefault()
                )
              }
            >
              {(hunks) =>
                hunks.map((hunk, hunkIndex) => (
                  <Fragment key={hunk.content}>
                    {root && path && file === files[0] && !wholeFileOnly && (
                      <Decoration>
                        <button
                          className="diff-hunk-action"
                          disabled={busy}
                          onClick={() => void applyHunk(hunkIndex)}
                        >
                          {t(showStaged ? '取消暂存此差异块' : '暂存此差异块')}
                        </button>
                      </Decoration>
                    )}
                    <Hunk hunk={hunk} />
                  </Fragment>
                ))
              }
            </Diff>
          ))
        ) : (
          <pre>{selectedContent || t('没有文本差异（文件可能为二进制或仅权限发生变化）。')}</pre>
        )}
      </div>
    </div>
  );
}
