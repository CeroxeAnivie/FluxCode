import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Settings } from '../domain/types';
import { providerModels, sameProvider, type ProviderProfile } from '../domain/provider';
import { bridge } from '../infrastructure/bridge';
import { useAppearance } from '../application/AppearanceProvider';
import { ErrorNotice } from './ErrorNotice';

export function ChannelEditor({
  source,
  copied = false,
  initial,
  busy,
  onSave,
  onCancel,
  onActivity,
  names,
  locked,
}: {
  source?: ProviderProfile;
  copied?: boolean;
  initial: Settings;
  busy: boolean;
  locked: boolean;
  onActivity: (working: boolean) => void;
  names: string[];
  onSave: (profile: ProviderProfile, key: string, enable: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useAppearance();
  const [name, setName] = useState(source?.name ?? '');
  const [settings, setSettings] = useState<Settings>(
    () =>
      source?.settings ?? {
        ...initial,
        baseUrl: '',
        model: '',
        apiKeyEnv: `FLUXCODE_CHANNEL_${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`,
      },
  );
  const [key, setKey] = useState('');
  const [models, setModels] = useState(() => (source ? providerModels(source) : []));
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState('');
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const errorNotice = useRef<HTMLParagraphElement>(null);
  const [notice, setNotice] = useState('');
  const [confirmDeleteKey, setConfirmDeleteKey] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    onActivity(fetching);
  }, [fetching, onActivity]);
  useEffect(() => {
    if (error) errorNotice.current?.focus();
  }, [error]);
  useEffect(
    () => () => {
      epoch.current++;
      onActivity(false);
    },
    [onActivity],
  );
  const viewport = useRef<HTMLDivElement>(null);
  const filtered = models.filter((model) => model.toLowerCase().includes(query.toLowerCase()));
  const virtual = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 36,
    overscan: 6,
  });
  useEffect(() => {
    virtual.scrollToOffset(0);
  }, [query]);
  function address(value: string) {
    epoch.current++;
    setFetching(false);
    setSettings((s) => ({ ...s, baseUrl: value, model: '' }));
    setModels([]);
    setError('');
    setNotice('');
  }
  async function discover() {
    const generation = ++epoch.current;
    setFetching(true);
    setError('');
    try {
      const result = await bridge.discoverProvider(settings, key);
      if (generation === epoch.current) {
        setModels(result.models);
        setQuery('');
        if (result.duplicateModels) {
          setNotice(`${result.duplicateModels} ${t('个重复模型 ID 已合并')}`);
        }
      }
    } catch (e) {
      if (generation === epoch.current) setError(String(e));
    } finally {
      if (generation === epoch.current) setFetching(false);
    }
  }
  async function save(enable: boolean) {
    setError('');
    if (copied && !key.trim()) {
      setError(t('副本需要单独设置密钥。'));
      return;
    }
    if (source && !copied && !sameProvider(source.settings, settings) && !key.trim()) {
      setError(t('连接地址或凭据标识已改变，请输入新密钥。'));
      return;
    }
    const generation = ++epoch.current;
    setFetching(true);
    try {
      const enteredModels = [...new Set([...models, ...manual.split(/[,，\s]+/).filter(Boolean)])];
      const catalogue = enteredModels.length
        ? enteredModels
        : (await bridge.discoverProvider(settings, key)).models;
      if (generation !== epoch.current) return;
      setModels(catalogue);
      if (!catalogue.length) throw new Error('服务未返回模型，请展开手动添加模型后重试。');
      const model = catalogue.includes(settings.model) ? settings.model : catalogue[0];
      let channelName = name.trim() || new URL(settings.baseUrl).host;
      if (!name.trim()) {
        const base = channelName;
        let index = 2;
        while (names.includes(channelName)) channelName = `${base} (${index++})`;
      }
      await onSave(
        {
          name: channelName,
          settings: { ...settings, baseUrl: settings.baseUrl.trim().replace(/\/+$/, ''), model },
          models: catalogue,
        },
        key,
        enable,
      );
    } catch (e) {
      if (generation === epoch.current) setError(String(e));
    } finally {
      if (generation === epoch.current) setFetching(false);
    }
  }
  return (
    <form
      className="channel-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save(!locked);
      }}
    >
      <h3>{t(copied ? '复制渠道配置' : source ? '编辑渠道' : '添加渠道')}</h3>
      <p className="field-help">
        {t(
          copied
            ? '复制配置后填写新密钥，副本会独立保存。'
            : '粘贴地址和密钥，即可导入全部模型并开始使用。',
        )}
      </p>
      <label className="form-field">
        {t('服务地址')}
        <input
          autoFocus
          required
          value={settings.baseUrl}
          onChange={(e) => address(e.target.value)}
          placeholder="https://api.openai.com/v1"
          spellCheck={false}
          disabled={busy || fetching}
        />
      </label>
      <label className="form-field">
        {t('访问密钥')}
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => {
            epoch.current++;
            setFetching(false);
            setKey(e.target.value);
            if (!copied) setModels([]);
          }}
          placeholder={t(source && !copied ? '留空保留已保存的凭据' : '输入渠道密钥')}
          disabled={busy || fetching}
        />
      </label>
      {source && !copied && (
        <div>
          <button
            type="button"
            disabled={busy || fetching}
            onClick={() => setConfirmDeleteKey(true)}
          >
            {t('删除已保存密钥')}
          </button>
          {confirmDeleteKey && (
            <div role="alert" className="channel-delete">
              <span>{t('删除密钥后，下次连接此渠道需重新输入。')}</span>
              <button type="button" disabled={fetching} onClick={() => setConfirmDeleteKey(false)}>
                {t('取消')}
              </button>
              <button
                type="button"
                disabled={fetching}
                onClick={() => {
                  setFetching(true);
                  setError('');
                  void bridge
                    .forgetApiKey(source.settings)
                    .then(() => {
                      setConfirmDeleteKey(false);
                      setNotice(t('已删除保存的密钥；当前运行中的连接不受影响。'));
                    })
                    .catch((cause) => setError(String(cause)))
                    .finally(() => setFetching(false));
                }}
              >
                {t('确认删除')}
              </button>
            </div>
          )}
        </div>
      )}
      <label className="form-field">
        {t('渠道名称')} <span className="field-optional">{t('可选，默认使用服务地址')}</span>
        <input
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('例如：主力服务、备用服务')}
          disabled={busy || fetching}
        />
      </label>
      <details className="channel-optional" open={models.length > 0}>
        <summary>{t('模型与连接选项（可选）')}</summary>
        <div className="channel-model-heading">
          <strong>
            {t('模型列表')} <span>{models.length}</span>
          </strong>
          <button
            type="button"
            disabled={busy || fetching || !settings.baseUrl.trim()}
            onClick={() => void discover()}
          >
            {t(fetching ? '正在获取模型…' : '获取模型列表')}
          </button>
        </div>
        <p className="field-help">{t('获取到的模型会全部保存，在会话中选择要使用的模型。')}</p>
        {!!models.length && (
          <label className="form-field">
            {t('搜索模型')}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('按模型名称筛选')}
            />
          </label>
        )}
        <div
          ref={viewport}
          className="channel-model-list"
          hidden={!models.length}
          role="list"
          aria-label={t('服务模型')}
        >
          <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
            {virtual.getVirtualItems().map((row) => (
              <div
                role="listitem"
                className="channel-model-row"
                key={filtered[row.index]}
                style={{
                  position: 'absolute',
                  top: 0,
                  transform: `translateY(${row.start}px)`,
                  height: row.size,
                  width: '100%',
                }}
                title={filtered[row.index]}
              >
                {filtered[row.index]}
              </div>
            ))}
          </div>
          {!filtered.length && (
            <p>{t(models.length ? '没有匹配模型' : '获取模型列表，或手动添加模型。')}</p>
          )}
        </div>
        <details>
          <summary>{t('手动添加模型')}</summary>
          <label className="form-field">
            {t('模型 ID')}
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder={t('多个模型用逗号分隔')}
            />
          </label>
          <button
            type="button"
            disabled={busy || !manual.trim()}
            onClick={() => {
              setModels((current) => [
                ...new Set([...current, ...manual.split(/[,，\s]+/).filter(Boolean)]),
              ]);
              setManual('');
            }}
          >
            {t('添加到模型列表')}
          </button>
        </details>
        <details>
          <summary>{t('高级连接设置')}</summary>
          <label className="form-field">
            {t('网络代理')}
            <input
              value={settings.proxyUrl}
              onChange={(e) => {
                epoch.current++;
                setFetching(false);
                setSettings({ ...settings, proxyUrl: e.target.value });
              }}
            />
          </label>
          <label className="form-field">
            {t('API Key 环境变量')}
            <input
              value={settings.apiKeyEnv}
              onChange={(e) => {
                epoch.current++;
                setFetching(false);
                setSettings({ ...settings, apiKeyEnv: e.target.value });
              }}
            />
          </label>
        </details>
      </details>
      {locked && <p role="status">{t('任务运行时可保存渠道，结束后再启用。')}</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p ref={errorNotice} tabIndex={-1} role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
      <div className="channel-editor-actions">
        <button
          type="button"
          disabled={busy || fetching}
          onClick={() => {
            epoch.current++;
            onCancel();
          }}
        >
          {t('取消')}
        </button>
        {!locked && (
          <button
            type="button"
            onClick={() => void save(false)}
            disabled={busy || fetching || !settings.baseUrl.trim()}
          >
            {t('仅保存')}
          </button>
        )}
        <button
          className="primary-button"
          type="submit"
          disabled={busy || fetching || !settings.baseUrl.trim()}
        >
          {t(
            fetching || busy
              ? '正在导入…'
              : locked
                ? '保存渠道'
                : source
                  ? '保存并使用'
                  : '导入并使用',
          )}
        </button>
      </div>
    </form>
  );
}
