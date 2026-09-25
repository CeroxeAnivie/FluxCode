import { useEffect, useState } from 'react';
import { useAppearance } from '../application/AppearanceProvider';
import { errorMessage, redactDiagnostic } from '../domain/errors';
export function ErrorNotice({ message }: { message: string }) {
  const { t, language } = useAppearance();
  const [result, setResult] = useState('');
  useEffect(() => setResult(''), [message]);
  return (
    <span className="error-notice">
      <span>{errorMessage(message, language)}</span>
      <button
        type="button"
        onClick={() =>
          void navigator.clipboard
            .writeText(redactDiagnostic(message))
            .then(() => setResult('已复制'))
            .catch(() => setResult('复制失败'))
        }
      >
        {t(result || '复制诊断信息')}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {result ? t(result) : ''}
      </span>
    </span>
  );
}
