import type { Settings } from '../domain/types';
import { useAppearance } from '../application/AppearanceProvider';
export function PricingSettings({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const { t } = useAppearance();
  const price = settings.pricing;
  return (
    <details className="pricing-settings">
      <summary>{t('用量费用估算')}</summary>
      <label>
        <input
          type="checkbox"
          checked={!!price}
          onChange={(e) =>
            onChange({
              ...settings,
              pricing: e.target.checked
                ? { model: settings.model, currency: 'USD', input: 0, cached: 0, output: 0 }
                : null,
            })
          }
        />
        {t('使用自定义价格')}
      </label>
      <p>{t('价格由你提供，按每百万词元计算；估算不是账单，仅适用于所填模型。')}</p>
      {price && (
        <>
          {(['model', 'currency', 'input', 'cached', 'output'] as const).map((key) => (
            <label className="form-field" key={key}>
              {t(
                {
                  model: '计价模型',
                  currency: '货币代码',
                  input: '输入单价',
                  cached: '缓存输入单价',
                  output: '输出单价',
                }[key],
              )}
              <input
                type={key === 'model' || key === 'currency' ? 'text' : 'number'}
                min={0}
                max={1000000}
                step="any"
                value={price[key]}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    pricing: {
                      ...price,
                      [key]:
                        key === 'model' || key === 'currency'
                          ? e.target.value
                          : e.target.valueAsNumber,
                    },
                  })
                }
              />
            </label>
          ))}
        </>
      )}
    </details>
  );
}
