import { estimateCost, type Pricing } from '../domain/pricing';
import type { Conversation } from '../domain/types';
import { useAppearance } from '../application/AppearanceProvider';

export function UsageIndicator({
  usage,
  pricing,
  canCompact,
  onCompact,
}: {
  usage: Conversation['usage'];
  pricing?: Pricing | null;
  canCompact: boolean;
  onCompact: () => void;
}) {
  const { t, language } = useAppearance();
  const format = (value: number) => new Intl.NumberFormat(language).format(value);
  const cost = estimateCost(
    pricing,
    usage?.model ?? '',
    usage
      ? { input: usage.lastInput, cached: usage.lastCached, output: usage.lastOutput }
      : undefined,
  );
  const capacity = usage?.context && usage.context > 0 ? usage.context : null;
  const percentage =
    usage && capacity ? Math.min(100, Math.round((100 * usage.lastTotal) / capacity)) : null;
  return (
    <details className="usage-indicator">
      <summary>
        {t('上下文')}
        {percentage !== null ? ` ${percentage}%` : ''}
      </summary>
      <div className="usage-popover">
        <dl>
          {usage ? (
            <>
              <div>
                <dt>{t('当前占用')}</dt>
                <dd>
                  {format(usage.lastTotal)} / {capacity ? format(capacity) : t('未知')}
                </dd>
              </div>
              {(
                [
                  [t('累计用量'), usage.total],
                  [t('输入'), usage.input],
                  [t('输出'), usage.output],
                  [t('缓存命中'), usage.cached],
                  [t('推理'), usage.reasoning],
                ] as const
              ).map(([label, count]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{format(count)}</dd>
                </div>
              ))}
            </>
          ) : (
            <div>{t('尚无用量数据')}</div>
          )}
        </dl>
        {cost !== null && (
          <p>
            {t('最近一轮估算费用')} · {pricing!.currency} {cost.toFixed(6)}
          </p>
        )}
        <small>{t('词元统计来自引擎最近一次报告，并非实时估算。')}</small>
        <button type="button" disabled={!canCompact} onClick={onCompact}>
          {t('压缩上下文')}
        </button>
        <small>{t('压缩会概括较早内容，保留当前任务并继续对话。')}</small>
      </div>
    </details>
  );
}
