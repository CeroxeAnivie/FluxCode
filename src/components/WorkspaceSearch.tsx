import { useEffect, useRef, useState } from 'react';
import { bridge } from '../infrastructure/bridge';
import { useAppearance } from '../application/AppearanceProvider';
import { ErrorNotice } from './ErrorNotice';
export function WorkspaceSearch({
  root,
  onOpen,
}: {
  root: string;
  onOpen: (path: string) => void;
}) {
  const { t } = useAppearance();
  const [query, setQuery] = useState('');
  const [contents, setContents] = useState(false);
  const [results, setResults] = useState<Awaited<ReturnType<typeof bridge.searchWorkspace>> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const queryInput = useRef<HTMLInputElement>(null);
  const errorNotice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorNotice.current?.focus();
  }, [error]);
  const epoch = useRef(0);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [root],
  );
  async function search() {
    const revision = ++epoch.current;
    setBusy(true);
    setError('');
    try {
      const result = await bridge.searchWorkspace(root, query, contents);
      if (revision === epoch.current) setResults(result);
    } catch (e) {
      if (revision === epoch.current) setError(String(e));
    } finally {
      if (revision === epoch.current) setBusy(false);
    }
  }
  return (
    <details className="workspace-search">
      <summary>{t('搜索工作区')}</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          ref={queryInput}
          aria-label={t('搜索内容')}
          value={query}
          maxLength={200}
          onChange={(e) => {
            epoch.current++;
            setQuery(e.target.value);
            setResults(null);
            setError('');
            setBusy(false);
          }}
        />
        <label>
          <input
            type="checkbox"
            checked={contents}
            onChange={(e) => {
              epoch.current++;
              setContents(e.target.checked);
              setResults(null);
              setError('');
              setBusy(false);
            }}
          />
          {t('搜索文件内容')}
        </label>
        <button disabled={busy || !query.trim()}>{t(busy ? '正在搜索…' : '搜索')}</button>
      </form>
      {error && (
        <p ref={errorNotice} tabIndex={-1} role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
      {results?.truncated && <p>{t('结果达到上限，请缩小搜索范围。')}</p>}
      {results && !results.hits.length && (
        <div className="search-empty" role="status">
          <p>{t('没有匹配结果')}</p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setResults(null);
              queryInput.current?.focus();
            }}
          >
            {t('清除搜索')}
          </button>
        </div>
      )}
      {results?.hits.map((hit, index) => (
        <button className="search-result" key={index} onClick={() => onOpen(hit.path)}>
          <strong>
            {hit.path}
            {hit.line ? `:${hit.line}` : ''}
          </strong>
          <span>{hit.preview}</span>
        </button>
      ))}
    </details>
  );
}
