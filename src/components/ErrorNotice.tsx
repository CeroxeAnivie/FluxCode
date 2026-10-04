import { useEffect, useState, type ReactNode } from 'react';
import { useAppearance } from '../application/AppearanceProvider';
import { describeError, redactDiagnostic } from '../domain/errors';

export function ErrorNotice({ message, actions }: { message: string; actions?: ReactNode }) {
  const { t, language } = useAppearance();
  const [result, setResult] = useState('');
  const { summary, detail } = describeError(message, language);
  useEffect(() => setResult(''), [message]);
  return (
    <span className="error-notice">
      <span className="error-notice-content">
        <span>{summary}</span>
        {detail && (
          <span className="error-notice-detail" aria-label={t('错误详情')} dir="auto">
            {detail}
          </span>
        )}
      </span>
      <span className="error-notice-actions">
        <button
          type="button"
          className="diagnostic-copy"
          onClick={() =>
            void navigator.clipboard
              .writeText(redactDiagnostic(message))
              .then(() => setResult('已复制'))
              .catch(() => setResult('复制失败'))
          }
        >
          {t(result || '复制诊断信息')}
        </button>
        {actions}
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {result ? t(result) : ''}
      </span>
    </span>
  );
}
