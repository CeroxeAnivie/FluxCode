import { ErrorNotice } from './ErrorNotice';
import { useState } from 'react';
import type { AgentRequest } from '../domain/interaction';
import { useAppearance } from '../application/AppearanceProvider';

export function AgentQuestionCard({
  request,
  answers,
  onChange,
  onAnswer,
}: {
  request: AgentRequest;
  answers: Record<string, string>;
  onChange: (answers: Record<string, string>) => void;
  onAnswer: (answers: Record<string, string>) => Promise<void>;
}) {
  const { t } = useAppearance();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="agent-question"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        void onAnswer(answers)
          .catch((e) => setError(String(e)))
          .finally(() => setBusy(false));
      }}
    >
      <h3>{t('需要你的输入')}</h3>
      {request.questions.map((q) => (
        <fieldset key={q.id} disabled={busy}>
          <legend>{q.question}</legend>
          {q.options?.map((o) => (
            <label className="question-option" key={o.label}>
              <input
                type="radio"
                name={q.id}
                checked={answers[q.id] === o.label}
                onChange={() => onChange({ ...answers, [q.id]: o.label })}
              />
              <span>
                {o.label}
                <small>{o.description}</small>
              </span>
            </label>
          ))}
          <input
            aria-label={q.header}
            type={q.isSecret ? 'password' : 'text'}
            autoComplete="off"
            value={answers[q.id] ?? ''}
            onChange={(e) => onChange({ ...answers, [q.id]: e.target.value })}
            placeholder={t('填写你的回答')}
            required
            maxLength={10000}
          />
        </fieldset>
      ))}
      {error && (
        <p role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
      <button className="primary-button" disabled={busy}>
        {t('提交回答')}
      </button>
    </form>
  );
}
