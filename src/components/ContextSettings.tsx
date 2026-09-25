import type { Settings } from '../domain/types';
import { useAppearance } from '../application/AppearanceProvider';

export function ContextSettings({
  settings,
  onChange,
  disabled,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
  disabled: boolean;
}) {
  const { t } = useAppearance();
  return (
    <fieldset className="context-settings" disabled={disabled}>
      <legend>{t('上下文与压缩')}</legend>
      <div className="form-columns">
        {(
          [
            ['contextWindow', '上下文窗口上限'],
            ['autoCompactTokens', '自动压缩阈值'],
          ] as const
        ).map(([key, label]) => (
          <label className="form-field" key={key}>
            {t(label)}
            <input
              type="number"
              min={1024}
              max={100_000_000}
              step={1}
              placeholder={t('模型默认')}
              value={settings[key] ?? ''}
              onChange={(event) =>
                onChange({
                  ...settings,
                  [key]: event.target.value === '' ? null : event.target.valueAsNumber,
                })
              }
            />
          </label>
        ))}
      </div>
      <small>
        {t('单位为词元，留空沿用模型默认值。保存并重新连接后生效，不会扩大服务商的模型容量。')}
      </small>
      <small>
        {t(
          '达到阈值时由引擎自动压缩；也可在状态栏手动压缩。压缩会概括较早内容，可能丢失部分细节。',
        )}
      </small>
    </fieldset>
  );
}
