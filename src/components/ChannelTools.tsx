import { useState } from 'react';
import { useAppearance } from '../application/AppearanceProvider';
import { compareProviderModels, providerModels, type ProviderProfile } from '../domain/provider';
import { bridge } from '../infrastructure/bridge';
import { ErrorNotice } from './ErrorNotice';

interface ModelPreview {
  models: string[];
  source: string;
}

export function ChannelTools({
  profile,
  profiles,
  onProfiles,
  disabled,
  activeModel,
  onCopy,
}: {
  profile: ProviderProfile;
  profiles: ProviderProfile[];
  onProfiles: (rows: ProviderProfile[]) => void;
  disabled: boolean;
  activeModel: string | null;
  onCopy: () => void;
}) {
  const { t } = useAppearance();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<ModelPreview | null>(null);
  const source = JSON.stringify(profile);
  const changes =
    preview?.source === source
      ? compareProviderModels(providerModels(profile), preview.models)
      : null;

  async function discover(refresh: boolean) {
    setBusy(true);
    setPreview(null);
    setError('');
    setNotice('');
    try {
      const result = await bridge.discoverProvider(profile.settings);
      setNotice(
        `${t('模型目录可用')} · ${result.latencyMs} ms · ${result.models.length} ${t('个模型')}${result.duplicateModels ? ` · ${result.duplicateModels} ${t('个重复模型 ID 已合并')}` : ''}`,
      );
      if (refresh) setPreview({ models: result.models, source });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (
      !preview ||
      preview.source !== source ||
      !preview.models.length ||
      (activeModel !== null && !preview.models.includes(activeModel))
    )
      return;
    setBusy(true);
    setError('');
    try {
      const models = preview.models;
      const rows = profiles.map((row) =>
        row.name === profile.name
          ? {
              ...row,
              models,
              settings: {
                ...row.settings,
                model: models.includes(row.settings.model) ? row.settings.model : models[0],
              },
            }
          : row,
      );
      await bridge.saveProviderProfiles(rows, profiles);
      onProfiles(rows);
      setPreview(null);
      setNotice(t('模型目录已更新'));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="channel-tools">
      <div className="channel-transfer-actions">
        <button disabled={busy || disabled} onClick={onCopy}>
          {t('复制渠道配置')}
        </button>
        <button disabled={busy || disabled} onClick={() => void discover(false)}>
          {t('检测连接')}
        </button>
        <button disabled={busy || disabled} onClick={() => void discover(true)}>
          {t('刷新模型')}
        </button>
      </div>
      {notice && (
        <p role="status">
          {notice}
          <small>{t('仅检测目录访问，模型推理能力以实际请求为准。')}</small>
        </p>
      )}
      {preview && changes && (
        <div className="model-refresh-preview">
          <p>
            {t('新增模型')} {changes.added.length} · {t('保留模型')} {changes.retained.length} ·{' '}
            {t('移除模型')} {changes.removed.length}
          </p>
          {activeModel !== null && !preview.models.includes(activeModel) && (
            <p role="alert">{t('当前会话使用的模型已移除，请先切换到其他渠道，再应用此目录。')}</p>
          )}
          {!preview.models.includes(profile.settings.model) && !!preview.models.length && (
            <p role="status">
              {t('当前默认模型已移除，应用后将改为')} {preview.models[0]}
            </p>
          )}
          {!!changes.added.length && (
            <details>
              <summary>{t('查看新增模型')}</summary>
              <p>{changes.added.join(', ')}</p>
            </details>
          )}
          {!!changes.removed.length && (
            <details>
              <summary>{t('查看移除模型')}</summary>
              <p>{changes.removed.join(', ')}</p>
            </details>
          )}
          {!!changes.retained.length && (
            <details>
              <summary>{t('查看保留模型')}</summary>
              <p>{changes.retained.join(', ')}</p>
            </details>
          )}
          <button disabled={busy} onClick={() => setPreview(null)}>
            {t('取消')}
          </button>
          <button
            disabled={
              busy ||
              disabled ||
              !preview.models.length ||
              (activeModel !== null && !preview.models.includes(activeModel))
            }
            onClick={() => void apply()}
          >
            {t('应用模型变更')}
          </button>
        </div>
      )}
      {error && (
        <p role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
    </div>
  );
}
