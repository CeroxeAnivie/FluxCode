import { useAppearance } from '../application/AppearanceProvider';
export function UpdateSettings() {
  const { t } = useAppearance();
  return (
    <details className="update-settings">
      <summary>{t('应用更新')}</summary>
      <p>{t('当前为本地离线工具，应用不会检查或下载更新。')}</p>
      <button type="button" disabled>
        {t('检查更新（暂未开放）')}
      </button>
    </details>
  );
}
