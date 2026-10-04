import { useEffect, useRef, useState } from 'react';
import { useAppearance } from '../application/AppearanceProvider';
import { compareProviderModels, providerModels, type ProviderProfile } from '../domain/provider';
import { bridge } from '../infrastructure/bridge';
import { ErrorNotice } from './ErrorNotice';

interface ModelPreview {
  models: string[];
  available: string[];
  source: string;
}

export function ChannelTools({
  profile,
  profiles,
  onProfiles,
  disabled,
  onCopy,
}: {
  profile: ProviderProfile;
  profiles: ProviderProfile[];
  onProfiles: (rows: ProviderProfile[]) => void;
  disabled: boolean;
  onCopy: () => void;
}) {
  const { t } = useAppearance();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeSource, setNoticeSource] = useState('');
  const [preview, setPreview] = useState<ModelPreview | null>(null);
  const [keepMissing, setKeepMissing] = useState(false);
  const source = JSON.stringify(profile);
  const request = useRef(0);
  const currentSource = useRef(source);
  currentSource.current = source;
  useEffect(() => {
    request.current++;
    setPreview(null);
    setError('');
    setBusy(false);
    return () => {
      request.current++;
    };
  }, [source]);
  const changes =
    preview?.source === source
      ? compareProviderModels(providerModels(profile), preview.models)
      : null;

  async function discover(refresh: boolean) {
    const generation = ++request.current;
    setBusy(true);
    setPreview(null);
    setKeepMissing(false);
    setError('');
    setNotice('');
    try {
      const result = await bridge.discoverProvider(profile.settings);
      if (generation !== request.current || source !== currentSource.current) return;
      setNoticeSource(source);
      setNotice(
        `${t('模型目录可用')} · ${result.latencyMs} ms · ${result.models.length} ${t('个模型')}${result.duplicateModels ? ` · ${result.duplicateModels} ${t('个重复模型 ID 已合并')}` : ''}`,
      );
      if (refresh)
        setPreview({
          available: result.models,
          models: result.models.filter((id) => !profile.excluded_models?.includes(id)),
          source,
        });
    } catch (cause) {
      if (generation === request.current && source === currentSource.current)
        setError(String(cause));
    } finally {
      if (generation === request.current && source === currentSource.current) setBusy(false);
    }
  }

  async function apply() {
    if (!preview || preview.source !== source || !preview.models.length) return;
    setBusy(true);
    setError('');
    try {
      const models = keepMissing
        ? [...new Set([...providerModels(profile), ...preview.models])]
        : preview.models;
      const rows = profiles.map((row) =>
        row.name === profile.name
          ? {
              ...row,
              models,
              excluded_models: (row.excluded_models ?? []).filter(
                (id) => keepMissing || preview.available.includes(id),
              ),
              model_labels: Object.fromEntries(
                Object.entries(row.model_labels ?? {}).filter(
                  ([id]) =>
                    models.includes(id) ||
                    (row.excluded_models?.includes(id) &&
                      (keepMissing || preview.available.includes(id))),
                ),
              ),
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
      setNoticeSource(JSON.stringify(rows.find((row) => row.name === profile.name)));
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
      {notice && noticeSource === source && (
        <p role="status">
          {notice}
          <small>{t('仅检测目录访问，模型推理能力以实际请求为准。')}</small>
        </p>
      )}
      {preview && changes && (
        <div className="model-refresh-preview">
          <p>
            {t('新增模型')} {changes.added.length} · {t('保留模型')} {changes.retained.length} ·{' '}
            {t('本次未返回')} {changes.removed.length}
          </p>
          {!!changes.removed.length && (
            <label>
              <input
                type="checkbox"
                checked={keepMissing}
                disabled={busy}
                onChange={(event) => setKeepMissing(event.target.checked)}
              />
              {t('保留本次未返回的模型及其配置')}
            </label>
          )}
          {!keepMissing &&
            !preview.models.includes(profile.settings.model) &&
            !!preview.models.length && (
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
            disabled={busy || disabled || !preview.models.length}
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
