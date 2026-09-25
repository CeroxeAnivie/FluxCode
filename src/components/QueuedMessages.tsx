import { ErrorNotice } from './ErrorNotice';
import { useState } from 'react';
import type { QueuedMessage } from '../domain/queuedMessage';
import { useAppearance } from '../application/AppearanceProvider';
export function QueuedMessages({
  items,
  busy,
  onRemove,
  onRetry,
}: {
  items: QueuedMessage[];
  busy: boolean;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const { t } = useAppearance();
  const [removing, setRemoving] = useState<string | null>(null);
  if (!items.length) return null;
  return (
    <div className="queued-messages" aria-label={t('待发送消息')}>
      {items.map((item) => (
        <div key={item.id}>
          <span>{item.text}</span>
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
          {item.error && (
            <span role="alert">
              <ErrorNotice message={item.error} />
            </span>
          )}
          {(item.status === 'failed' || item.status === 'paused') && (
            <button
              disabled={busy}
              title={busy ? t('任务结束后再确认发送') : undefined}
              onClick={() => onRetry(item.id)}
            >
              {t(item.status === 'paused' ? '继续发送' : '重试')}
            </button>
          )}
          <button disabled={item.status === 'sending'} onClick={() => setRemoving(item.id)}>
            {t('移除')}
          </button>
          {removing === item.id && (
            <div role="alert" className="queued-remove-confirm">
              <span>{t('确认移除此待发送消息？')}</span>
              <button onClick={() => setRemoving(null)}>{t('取消')}</button>
              <button
                onClick={() => {
                  onRemove(item.id);
                  setRemoving(null);
                }}
              >
                {t('确认删除')}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
