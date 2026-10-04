import { useEffect, useState } from 'react';
import { useAppearance } from '../application/AppearanceProvider';

/** Reduced motion retains a subtle pulse to distinguish activity from a frozen UI. */
export function WorkingIndicator({ name }: { name?: string }) {
  const { t } = useAppearance();
  const [startedAt] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const label = `${name || t('模型未记录')} ${t('正在处理')}`;
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="working-indicator" role="status" aria-label={label}>
      <span className="working-dot" aria-hidden="true" />
      <span className="working-dot" aria-hidden="true" />
      <span className="working-dot" aria-hidden="true" />
      <span className="working-text">{label}</span>
      <time
        className="working-elapsed"
        aria-live="off"
        title={t('本次等待时间')}
        dateTime={`PT${seconds}S`}
      >
        {elapsed}
      </time>
    </div>
  );
}
