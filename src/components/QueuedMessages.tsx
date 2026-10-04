import { ErrorNotice } from './ErrorNotice';
import { useEffect, useRef, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import type { QueuedMessage } from '../domain/queuedMessage';
import { useAppearance } from '../application/AppearanceProvider';

type Lease = { token: string; text: string };
interface Actions {
  busy: boolean;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onBeginEdit: (id: string) => Lease | false | Promise<Lease | false>;
  onFinishEdit: (id: string, token: string, text: string | null) => boolean | Promise<boolean>;
}
export function QueuedMessages({ items, ...actions }: Actions & { items: QueuedMessage[] }) {
  const { t } = useAppearance();
  if (!items.length) return null;
  return (
    <section className="queued-messages" aria-label={t('待发送消息')}>
      <header>
        <span>{t('待发送消息')}</span>
        <span className="queue-count">{items.length}</span>
      </header>
      <ol>
        {items.map((item) => (
          <QueuedRow key={item.id} item={item} {...actions} />
        ))}
      </ol>
    </section>
  );
}
function QueuedRow({
  item,
  busy,
  onRemove,
  onRetry,
  onBeginEdit,
  onFinishEdit,
}: Actions & { item: QueuedMessage }) {
  const { t } = useAppearance();
  const [edit, setEdit] = useState<Lease | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const lease = useRef<Lease | null>(null);
  const mounted = useRef(true);
  const finish = useRef(onFinishEdit);
  finish.current = onFinishEdit;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (lease.current) {
        void Promise.resolve(finish.current(item.id, lease.current.token, null)).catch(() =>
          console.warn('queue_edit_release_failed'),
        );
        lease.current = null;
      }
    };
  }, [item.id]);
  async function begin() {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      const result = await onBeginEdit(item.id);
      if (!mounted.current) {
        if (result) await finish.current(item.id, result.token, null);
        return;
      }
      if (result) {
        lease.current = result;
        setEdit(result);
      } else setError('消息已开始发送或正在另一个窗口编辑。');
    } catch (cause) {
      if (mounted.current) setError(String(cause));
    } finally {
      if (mounted.current) setWorking(false);
    }
  }
  async function save(text: string | null) {
    if (!edit || working) return;
    setWorking(true);
    setError('');
    try {
      if (await onFinishEdit(item.id, edit.token, text)) {
        lease.current = null;
        if (mounted.current) setEdit(null);
      } else if (mounted.current) setError('消息状态已改变，修改尚未保存，请保留编辑内容后重试。');
    } catch (cause) {
      if (mounted.current) setError(String(cause));
    } finally {
      if (mounted.current) setWorking(false);
    }
  }
  return (
    <li className="queued-row">
      {edit ? (
        <div className="queue-editor">
          <textarea
            autoFocus
            aria-label={t('编辑待发送消息')}
            value={edit.text}
            rows={3}
            maxLength={100_000}
            onChange={(event) => setEdit({ ...edit, text: event.target.value })}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                void save(null);
              }
              if (event.key === 'Enter' && event.ctrlKey && !event.repeat) {
                event.preventDefault();
                event.stopPropagation();
                void save(edit.text);
              }
            }}
          />
          <div className="queue-editor-footer">
            <small>{t('编辑期间暂停发送')}</small>
            <button disabled={working} onClick={() => void save(null)}>
              {t('取消编辑')}
            </button>
            <button
              className="queue-save"
              disabled={working || (!edit.text.trim() && !item.attachments.length)}
              onClick={() => void save(edit.text)}
            >
              {t('保存修改')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="queued-content">
            <span className="queued-text" title={item.text}>
              {item.text}
            </span>
            <small>
              {t(
                item.status === 'failed'
                  ? '发送失败'
                  : item.status === 'paused'
                    ? '已暂停'
                    : item.status === 'sending'
                      ? '发送中'
                      : '等待上一轮完成',
              )}
            </small>
            {item.attachments.length > 0 && (
              <span className="queued-attachments">
                {item.attachments.map((attachment) => attachment.name).join(' · ')}
              </span>
            )}
          </div>
          <div className="queued-actions">
            {(item.status === 'failed' || item.status === 'paused') && (
              <button disabled={busy || working} onClick={() => onRetry(item.id)}>
                {t(item.status === 'paused' ? '继续发送' : '重试')}
              </button>
            )}
            <button
              className="icon-button"
              disabled={item.status === 'sending' || working}
              title={t('编辑待发送消息')}
              aria-label={t('编辑待发送消息')}
              onClick={() => void begin()}
            >
              <Pencil size={14} />
            </button>
            <button
              className="icon-button"
              disabled={item.status === 'sending' || working}
              title={t('取消排队')}
              aria-label={t('取消排队')}
              onClick={() => onRemove(item.id)}
            >
              <X size={15} />
            </button>
          </div>
        </>
      )}
      {(error || (!edit && item.error)) && (
        <div className="queued-error" role="alert">
          <ErrorNotice message={error || item.error!} />
        </div>
      )}
    </li>
  );
}
