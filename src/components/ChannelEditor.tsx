import { useEffect, useRef, useState } from 'react';
import { ChannelModelList } from './ChannelModelList';
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
  onDirtyChange,
  names,
  locked,
}: {
  source?: ProviderProfile;
  copied?: boolean;
  initial: Settings;
  busy: boolean;
  locked: boolean;
  onActivity: (working: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
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
  const [labels, setLabels] = useState<Record<string, string>>(() => source?.model_labels ?? {});
  const [hiddenModels, setHiddenModels] = useState<string[]>(() => source?.excluded_models ?? []);
  const [catalogueRevision, setCatalogueRevision] = useState(0);
  const [manual, setManual] = useState('');
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const errorNotice = useRef<HTMLParagraphElement>(null);
  const [notice, setNotice] = useState('');
  const [networkStatus, setNetworkStatus] = useState('');
  const [checkingNetwork, setCheckingNetwork] = useState(false);
  const networkRevision = useRef(0);
  useEffect(() => {
    networkRevision.current++;
    setNetworkStatus('');
  }, [settings.proxyUrl, settings.baseUrl]);
  async function checkNetwork() {
    const revision = networkRevision.current;
    setCheckingNetwork(true);
    setError('');
    try {
      const result = await bridge.networkStatus(settings.proxyUrl, settings.baseUrl);
      if (revision !== networkRevision.current) return;
      const source = {
        manual: '手动代理',
        environment: '环境变量代理',
        system: 'Windows 系统代理',
      }[result.source];
      setNetworkStatus(
        `${t(source)} · ${result.bypassed || !result.address ? t('此地址直接连接') : `${t('代理端口可连接')} · ${result.address}`}`,
      );
    } catch (cause) {
      if (revision === networkRevision.current) setError(String(cause));
    } finally {
      setCheckingNetwork(false);
    }
  }
  const [confirmDeleteKey, setConfirmDeleteKey] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const draft = JSON.stringify({ name, settings, models, labels, hiddenModels, key, manual });
  const baseline = useRef(draft);
  const epoch = useRef(0);
  useEffect(() => {
    onDirtyChange(draft !== baseline.current);
  }, [draft, onDirtyChange]);
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
  const visibleModels = models.filter((model) => !hiddenModels.includes(model));
  function invalidateCatalogue() {
    epoch.current++;
    setFetching(false);
    setSettings((s) => ({ ...s, model: '' }));
    setCatalogueRevision((value) => value + 1);
    setManual('');
    setModels([]);
    setHiddenModels([]);
    setLabels({});
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
        const incoming = [...new Set(result.models)];
        const added = incoming.filter((model) => !models.includes(model));
        const missing = models.filter((model) => !incoming.includes(model));
        setModels(incoming);
        setHiddenModels((current) => current.filter((id) => incoming.includes(id)));
        setLabels((current) =>
          Object.fromEntries(Object.entries(current).filter(([id]) => incoming.includes(id))),
        );
        setSettings((current) => ({
          ...current,
          model: incoming.includes(current.model) ? current.model : '',
        }));
        setCatalogueRevision((value) => value + 1);
        setNotice(
          `${incoming.length} ${t('个模型')} · ${added.length} ${t('个新增模型')} · ${missing.length} ${t('个过期模型已移除')}`,
        );
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
      const enteredModels = [
        ...new Set([...visibleModels, ...manual.split(/[,，\s]+/).filter(Boolean)]),
      ];
      const catalogue = enteredModels.length
        ? enteredModels
        : hiddenModels.length
          ? []
          : (await bridge.discoverProvider(settings, key)).models;
      if (generation !== epoch.current) return;
      setModels(catalogue);
      setHiddenModels((current) => current.filter((id) => !catalogue.includes(id)));
      if (!catalogue.length) throw new Error('请至少保留一个模型，或手动添加模型。');
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
          excluded_models: hiddenModels.filter((id) => !catalogue.includes(id)),
          model_labels: Object.fromEntries(
            Object.entries(labels)
              .map(([id, label]) => [id, label.trim()])
              .filter(
                ([id, label]) =>
                  (catalogue.includes(id) || hiddenModels.includes(id)) && !!label && id !== label,
              ),
          ),
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
      <div className="channel-editor-body">
        <h3>{t(copied ? '复制渠道配置' : source ? '编辑渠道' : '添加渠道')}</h3>
        {copied && <p className="field-help">{t('复制配置后填写新密钥，副本会独立保存。')}</p>}
        <label className="form-field">
          {t('服务地址')}
          <input
            autoFocus
            required
            value={settings.baseUrl}
            onChange={(e) => {
              invalidateCatalogue();
              setSettings((s) => ({ ...s, baseUrl: e.target.value }));
            }}
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
              invalidateCatalogue();
              setKey(e.target.value);
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
                <button
                  type="button"
                  disabled={fetching}
                  onClick={() => setConfirmDeleteKey(false)}
                >
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
                        invalidateCatalogue();
                        setKey('');
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
          {t('渠道名称')}{' '}
          <span className="field-optional" title={t('可选，默认使用服务地址')}>
            {t('可选')}
          </span>
          <input
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('例如：主力服务、备用服务')}
            disabled={busy || fetching}
          />
        </label>
        <section className="channel-model-settings" aria-label={t('模型列表与连接设置')}>
          <div className="channel-model-heading">
            <strong>
              {t('模型列表')} <span>{visibleModels.length}</span>
            </strong>
            <button
              type="button"
              disabled={busy || fetching || !settings.baseUrl.trim()}
              onClick={() => void discover()}
            >
              {t(fetching ? '正在获取模型…' : '获取模型列表')}
            </button>
          </div>

          <ChannelModelList
            key={catalogueRevision}
            models={models}
            labels={labels}
            hiddenModels={hiddenModels}
            setModels={setModels}
            setLabels={setLabels}
            setHiddenModels={setHiddenModels}
            busy={busy || fetching}
          />
          <details>
            <summary>{t('手动添加模型')}</summary>
            <label className="form-field">
              {t('模型 ID')}
              <input
                value={manual}
                disabled={busy || fetching}
                onChange={(e) => setManual(e.target.value)}
                placeholder={t('多个模型用逗号分隔')}
              />
            </label>
            <button
              type="button"
              disabled={busy || fetching || !manual.trim()}
              onClick={() => {
                const added = manual.split(/[,，\s]+/).filter(Boolean);
                setModels((current) => [...new Set([...current, ...added])]);
                setHiddenModels((current) => current.filter((id) => !added.includes(id)));
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
                placeholder={t('留空自动使用系统代理')}
                value={settings.proxyUrl}
                disabled={busy || fetching}
                onChange={(e) => {
                  invalidateCatalogue();
                  setSettings((s) => ({ ...s, proxyUrl: e.target.value }));
                }}
              />
            </label>
            <p className="muted">
              {t('留空优先使用进程代理，其次跟随 Windows 系统代理；代理不可用时会显示原因。')}
            </p>
            <button
              type="button"
              disabled={checkingNetwork || !settings.baseUrl.trim()}
              onClick={() => void checkNetwork()}
            >
              {t(checkingNetwork ? '正在检查连接…' : '检查网络代理')}
            </button>
            {networkStatus && <p role="status">{networkStatus}</p>}
            <label className="form-field">
              <span>{t('API Key 环境变量')}</span>
              <input
                value={settings.apiKeyEnv}
                disabled={busy || fetching}
                onChange={(e) => {
                  invalidateCatalogue();
                  setSettings((s) => ({ ...s, apiKeyEnv: e.target.value }));
                }}
              />
            </label>
          </details>
        </section>
        {locked && <p role="status">{t('任务运行时可保存渠道，结束后再启用。')}</p>}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p ref={errorNotice} tabIndex={-1} role="alert">
            <ErrorNotice message={error} />
          </p>
        )}
      </div>
      <footer className="channel-editor-actions">
        {confirmCancel && (
          <div role="alert" className="settings-unsaved">
            <p>{t('还有未保存的内容。继续编辑，或放弃本次修改？')}</p>
            <button type="button" onClick={() => setConfirmCancel(false)}>
              {t('继续编辑')}
            </button>
            <button type="button" onClick={onCancel}>
              {t('放弃修改')}
            </button>
          </div>
        )}
        <button
          type="button"
          disabled={busy || fetching}
          onClick={() => {
            if (draft !== baseline.current) setConfirmCancel(true);
            else onCancel();
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
      </footer>
    </form>
  );
}
