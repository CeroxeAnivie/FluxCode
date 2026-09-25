import { useMemo, useState } from 'react';
import { useAppearance } from '../application/AppearanceProvider';
import type { Catalog, Conversation } from '../domain/types';
import type { QueuedMessage } from '../domain/queuedMessage';
import { taskActivity, type ActivityStatus } from '../domain/taskActivity';
import { useModalDialog } from './useModalDialog';
import { ErrorNotice } from './ErrorNotice';

const labels: Record<ActivityStatus, string> = {
  running: '运行中',
  input: '等待输入',
  queued: '排队中',
  paused: '队列已暂停',
  failed: '失败',
  completed: '已完成',
  idle: '未运行',
};
export function TaskActivityDialog({
  catalog,
  conversations,
  queue,
  waiting,
  onSelect,
  onStop,
  onClose,
}: {
  catalog: Catalog;
  conversations: Record<string, Conversation>;
  queue: QueuedMessage[];
  waiting: ReadonlySet<string>;
  onSelect: (id: string) => Promise<boolean>;
  onStop: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useAppearance();
  const dialog = useModalDialog();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string[]>([]);
  const [opening, setOpening] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const rows = useMemo(
    () => taskActivity(catalog, conversations, queue, waiting),
    [catalog, conversations, queue, waiting],
  );
  const visible = rows.filter((row) =>
    `${row.task.title} ${row.project}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  async function stop(id: string) {
    if (pending.includes(id)) return;
    setPending((current) => [...current, id]);
    setError('');
    try {
      await onStop(id);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending((current) => current.filter((key) => key !== id));
    }
  }
  async function open(id: string) {
    if (opening) return;
    setOpening(id);
    setError('');
    try {
      if (await onSelect(id)) onClose();
      else setError(t('无法打开任务，请检查连接后重试。'));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setOpening(null);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="model-dialog"
      aria-label={t('任务总览')}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2>{t('任务总览')}</h2>
      <p role="status" aria-live="polite">
        {t('运行中')} {rows.filter((row) => row.status === 'running').length} · {t('等待输入')}{' '}
        {rows.filter((row) => row.status === 'input').length} · {t('失败')}{' '}
        {rows.filter((row) => row.status === 'failed').length}
      </p>
      <label className="form-field">
        {t('搜索任务或项目')}
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(50);
          }}
        />
      </label>
      {error && (
        <p role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
      <ul className="task-activity-list">
        {visible.slice(0, limit).map((row) => (
          <li key={row.task.id}>
            <button
              className="task-activity-open"
              disabled={opening !== null}
              aria-busy={opening === row.task.id}
              onClick={() => void open(row.task.id)}
            >
              <strong>{row.task.title}</strong>
              <span>
                {row.project} · {t(labels[row.status])}
                {row.queuedCount > 0 ? ` · ${t('待发送')} ${row.queuedCount}` : ''}
              </span>
            </button>
            {row.canStop && (
              <button
                disabled={pending.includes(row.task.id)}
                onClick={() => void stop(row.task.id)}
              >
                {t('停止任务')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {!visible.length && (
        <p>
          {t('没有匹配的任务')}
          {query && <button onClick={() => setQuery('')}>{t('清除搜索')}</button>}
        </p>
      )}
      {visible.length > limit && (
        <button onClick={() => setLimit((count) => count + 50)}>{t('显示更多任务')}</button>
      )}
      <div className="model-dialog-actions">
        <button onClick={onClose}>{t('关闭')}</button>
      </div>
    </dialog>
  );
}
