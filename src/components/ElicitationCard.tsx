import { Select } from './Select';
import { useState } from 'react';
import type { Elicitation } from '../domain/elicitation';
import { useAppearance } from '../application/AppearanceProvider';
import { ErrorNotice } from './ErrorNotice';
export function ElicitationCard({
  request,
  answers,
  onChange,
  onAnswer,
}: {
  request: Elicitation;
  answers: Record<string, unknown>;
  onChange: (answers: Record<string, unknown>) => void;
  onAnswer: (action: string, content: Record<string, unknown> | null) => Promise<void>;
}) {
  const { t } = useAppearance();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fields = Object.entries(request.requestedSchema?.properties ?? {});
  const supported =
    request.mode === 'url' ||
    (['form', 'openai/form', 'openaiForm'].includes(request.mode) &&
      fields.every(([, field]) => ['string', 'number', 'integer', 'boolean'].includes(field.type)));
  async function submit(action: string) {
    setBusy(true);
    setError('');
    try {
      const content = Object.fromEntries(
        fields.flatMap(([name, field]) => {
          const value = answers[name];
          if (field.type === 'boolean') return [[name, value === true]];
          if (value === undefined || (value === '' && field.type !== 'string')) return [];
          return [[name, value]];
        }),
      );
      await onAnswer(action, action === 'accept' && request.mode !== 'url' ? content : null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="agent-question"
      onSubmit={(e) => {
        e.preventDefault();
        void submit('accept');
      }}
    >
      <strong>{request.serverName}</strong>
      <p>{request.message}</p>
      {request.mode === 'url' ? (
        <input
          readOnly
          aria-label={t('授权地址')}
          value={request.url ?? ''}
          onFocus={(e) => e.target.select()}
        />
      ) : supported ? (
        fields.map(([name, field]) => (
          <label className="form-field" key={name}>
            {field.title ?? name}
            {field.enum ? (
              <Select
                required={request.requestedSchema?.required?.includes(name)}
                value={String(answers[name] ?? '')}
                disabled={busy}
                onValueChange={(value) => onChange({ ...answers, [name]: value })}
              >
                <option value="">{t('请选择')}</option>
                {field.enum.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </Select>
            ) : (
              <input
                disabled={busy}
                autoComplete="off"
                checked={field.type === 'boolean' ? answers[name] === true : undefined}
                value={field.type === 'boolean' ? undefined : String(answers[name] ?? '')}
                type={
                  field.type === 'boolean'
                    ? 'checkbox'
                    : field.type === 'number' || field.type === 'integer'
                      ? 'number'
                      : 'text'
                }
                required={
                  field.type !== 'boolean' && request.requestedSchema?.required?.includes(name)
                }
                min={field.minimum}
                max={field.maximum}
                minLength={field.minLength}
                maxLength={field.maxLength ?? 40000}
                step={field.type === 'integer' ? 1 : 'any'}
                onChange={(e) =>
                  onChange({
                    ...answers,
                    [name]:
                      field.type === 'boolean'
                        ? e.target.checked
                        : field.type === 'string'
                          ? e.target.value
                          : e.target.value === ''
                            ? ''
                            : e.target.valueAsNumber,
                  })
                }
              />
            )}
          </label>
        ))
      ) : (
        <p>{t('此服务要求额外验证，请在服务端完成后重试。')}</p>
      )}
      {error && (
        <p role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
      <button disabled={busy || !supported}>
        {t(request.mode === 'url' ? '已完成授权' : '提交回答')}
      </button>
      <button type="button" disabled={busy} onClick={() => void submit('decline')}>
        {t('拒绝')}
      </button>
      <button type="button" disabled={busy} onClick={() => void submit('cancel')}>
        {t('取消')}
      </button>
    </form>
  );
}
