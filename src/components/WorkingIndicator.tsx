import { useEffect, useState } from 'react';
import { useAppearance } from '../application/AppearanceProvider';

/** Elapsed time remains visible when the operating system reduces animation. */
export function WorkingIndicator() {
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
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="working-indicator" role="status" aria-label={t('FluxCode 正在处理')}>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span className="working-text">{t('FluxCode 正在处理')}</span>
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
