import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useAppearance } from '../application/AppearanceProvider';
import type { Catalog } from '../domain/types';
import type { SearchHit } from '../domain/conversationSearch';
import { searchConversations } from '../infrastructure/conversationSearch';
import { ErrorNotice } from './ErrorNotice';
import { useModalDialog } from './useModalDialog';

export function ConversationSearchDialog({
  catalog,
  onHit,
  onClose,
}: {
  catalog: Catalog;
  onHit: (hit: SearchHit) => Promise<void>;
  onClose: () => void;
}) {
  const { t, language } = useAppearance();
  const queryInput = useRef<HTMLInputElement>(null);
  const dialog = useModalDialog(true, queryInput);
  const generation = useRef(0);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [running, setRunning] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const errorNotice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorNotice.current?.focus();
  }, [error]);
  useEffect(() => {
    return () => {
      generation.current++;
    };
  }, []);
  async function search() {
    const current = ++generation.current;
    setHits([]);
    setCompleted(0);
    setTruncated(false);
    setError('');
    setCancelled(false);
    setRunning(true);
    try {
      await searchConversations(
        catalog.tasks,
        query,
        () => generation.current !== current,
        (progress) => {
          if (generation.current !== current) return;
          setHits(progress.hits);
          setCompleted(progress.completed);
          setTruncated(progress.truncated);
        },
      );
    } catch (cause) {
      if (generation.current === current) {
        generation.current++;
        setError(String(cause));
        setRunning(false);
      }
    } finally {
      if (generation.current === current) setRunning(false);
    }
  }
  return (
    <dialog
      className="conversation-search-dialog"
      ref={dialog}
      aria-label={t('搜索对话正文')}
      onCancel={(event) => {
        event.preventDefault();
        generation.current++;
        onClose();
      }}
    >
      <header className="dialog-header">
        <div>
          <span className="eyebrow">{t('任务历史')}</span>
          <h2>{t('搜索对话正文')}</h2>
        </div>
        <button
          className="icon-button"
          aria-label={t('关闭')}
          onClick={() => {
            generation.current++;
            onClose();
          }}
        >
          <X size={18} />
        </button>
      </header>
      <form
        className="conversation-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim().length >= 2) void search();
        }}
      >
        <label className="form-field">
          {t('搜索词')}
          <input
            ref={queryInput}
            value={query}
            onChange={(event) => {
              generation.current++;
              setQuery(event.target.value);
              setHits([]);
              setCompleted(0);
              setTruncated(false);
              setError('');
              setCancelled(false);
              setRunning(false);
            }}
            placeholder={t('输入至少两个字符')}
          />
        </label>
        <button className="primary-button" disabled={running || query.trim().length < 2}>
          <Search size={16} />
          {t('搜索')}
        </button>
        {running && (
          <button
            type="button"
            onClick={() => {
              generation.current++;
              setRunning(false);
              setCancelled(true);
            }}
          >
            {t('取消搜索')}
          </button>
        )}
      </form>
      <div className="conversation-search-results">
        {cancelled && <p role="status">{t('搜索已取消')}</p>}
        {(running || completed > 0) && (
          <p role="status">
            {t('已搜索任务')} {completed} / {catalog.tasks.length} · {t('匹配消息')} {hits.length}
          </p>
        )}
        {truncated && <p role="status">{t('结果达到上限；缩小搜索词或在任务内继续查找。')}</p>}
        {!running &&
          !cancelled &&
          !error &&
          !hits.length &&
          (completed > 0 || !catalog.tasks.length) && (
            <div className="search-empty" role="status">
              <p>{t('没有匹配的消息')}</p>
              {!!query && (
                <button
                  type="button"
                  onClick={() => {
                    generation.current++;
                    setQuery('');
                    setHits([]);
                    setCompleted(0);
                    setTruncated(false);
                    queryInput.current?.focus();
                  }}
                >
                  {t('清除搜索')}
                </button>
              )}
            </div>
          )}
        {hits.map((hit, index) => {
          const task = catalog.tasks.find((item) => item.id === hit.taskId);
          const project = catalog.projects.find((item) => item.id === task?.projectId);
          return (
            <button
              type="button"
              className="conversation-search-hit"
              key={`${hit.taskId}:${hit.itemId}:${index}`}
              onClick={() => void onHit(hit).catch((cause) => setError(String(cause)))}
            >
              <strong>
                {project?.imported ? t('导入的对话') : (project?.name ?? t('未知项目'))} /{' '}
                {task?.title ?? t('未知任务')}
              </strong>
              <span>
                {task
                  ? new Date(task.updatedAt).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN')
                  : ''}
              </span>
              <p>{hit.snippet}</p>
            </button>
          );
        })}
        {error && (
          <p ref={errorNotice} tabIndex={-1} role="alert">
            <ErrorNotice message={error} />
          </p>
        )}
      </div>
    </dialog>
  );
}
