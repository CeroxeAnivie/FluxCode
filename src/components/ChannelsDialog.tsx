import { useState } from 'react';
import { Plus, X, Server, Check } from 'lucide-react';
import { useAppearance } from '../application/AppearanceProvider';
import { bridge } from '../infrastructure/bridge';
import {
  providerModels,
  sameConnection,
  sameProvider,
  type ProviderProfile,
} from '../domain/provider';
import type { Settings } from '../domain/types';
import { ChannelEditor } from './ChannelEditor';
import { ErrorNotice } from './ErrorNotice';
import { ChannelTransfer } from './ChannelTransfer';
import { ChannelTools } from './ChannelTools';
import { useModalDialog } from './useModalDialog';

export function ChannelsDialog({
  settings,
  profiles,
  onProfiles,
  onConnect,
  onClose,
  connected,
  locked,
  open,
  returnFocus,
  connectionError,
}: {
  settings: Settings;
  profiles: ProviderProfile[];
  onProfiles: (rows: ProviderProfile[]) => void;
  onConnect: (settings: Settings) => Promise<boolean>;
  onClose: () => void;
  connected: boolean;
  locked: boolean;
  open: boolean;
  returnFocus?: HTMLElement | null;
  connectionError?: string | null;
}) {
  const { t } = useAppearance();
  const dialog = useModalDialog(open, undefined, returnFocus);
  const [editing, setEditing] = useState<ProviderProfile | 'new' | null>(null);
  const [copying, setCopying] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [pendingEditor, setPendingEditor] = useState<{
    target: ProviderProfile | 'new' | null;
  } | null>(null);
  function switchEditor(target: ProviderProfile | 'new' | null) {
    if (busy || editorWorking) return;
    if (editing && editorDirty) {
      setPendingEditor({ target });
      return;
    }
    setEditing(target);
    setCopying(false);
    setEditorDirty(false);
    setError('');
    setNotice('');
  }
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [editorWorking, setEditorWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [needsReconnect, setNeedsReconnect] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const current = profiles.find((p) => sameProvider(p.settings, settings));
  const visibleProfiles = profiles.filter((p) =>
    `${p.name} ${p.settings.baseUrl}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  async function enable(profile: ProviderProfile) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = {
        ...settings,
        baseUrl: profile.settings.baseUrl,
        apiKeyEnv: profile.settings.apiKeyEnv,
        proxyUrl: profile.settings.proxyUrl,
        model: profile.settings.model,
      };
      if (await onConnect(next)) {
        setNeedsReconnect((names) => names.filter((name) => name !== profile.name));
        setNotice(`${t('已启用渠道')} · ${profile.name}`);
        onClose();
      } else setError(t('渠道未切换，原连接保持不变。请查看连接错误后重试。'));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="channels-dialog"
      aria-label={t('渠道管理')}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy && !editorWorking) {
          onClose();
        }
      }}
    >
      <header className="dialog-header">
        <div>
          <h2>{t('渠道管理')}</h2>
        </div>
        <button
          className="icon-button"
          aria-label={t('关闭渠道管理')}
          disabled={busy || editorWorking}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </header>
      <div className="channels-layout">
        <nav className="channel-directory" aria-label={t('渠道列表')}>
          <button
            className="primary-button"
            disabled={busy || editorWorking}
            onClick={() => switchEditor('new')}
          >
            <Plus size={16} />
            {t('添加渠道')}
          </button>
          <label className="channel-search">
            <span className="sr-only">{t('搜索渠道')}</span>
            <input
              aria-label={t('搜索渠道')}
              placeholder={t('搜索渠道名称或地址')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            className="channel-directory-item"
            aria-current={editing === null ? 'page' : undefined}
            onClick={() => switchEditor(null)}
            disabled={busy || editorWorking}
          >
            <Server size={16} />
            <span>{t('全部渠道')}</span>
            <small>{profiles.length}</small>
          </button>
          <div className="channel-directory-list">
            {visibleProfiles.map((profile) => (
              <button
                key={profile.name}
                className="channel-directory-item"
                aria-label={`${t('编辑渠道')} · ${profile.name}`}
                aria-current={
                  editing !== 'new' && editing?.name === profile.name ? 'page' : undefined
                }
                disabled={busy || editorWorking}
                onClick={() => switchEditor(profile)}
              >
                <span
                  className="channel-directory-dot"
                  data-active={sameConnection(profile.settings, settings) && connected}
                />
                <span title={profile.name}>{profile.name}</span>
                <small>{providerModels(profile).length}</small>
              </button>
            ))}
          </div>
        </nav>
        <div className={`channels-body${editing ? ' channels-body-editing' : ''}`}>
          {pendingEditor && (
            <div className="settings-unsaved" role="alert">
              <p>{t('还有未保存的内容。继续编辑，或放弃本次修改？')}</p>
              <button type="button" onClick={() => setPendingEditor(null)}>
                {t('继续编辑')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(pendingEditor.target);
                  setCopying(false);
                  setEditorDirty(false);
                  setPendingEditor(null);
                }}
              >
                {t('放弃修改')}
              </button>
            </div>
          )}
          {editing ? (
            <ChannelEditor
              key={editing === 'new' ? 'new' : editing.name}
              source={editing === 'new' ? undefined : editing}
              copied={copying}
              initial={settings}
              busy={busy}
              locked={locked}
              names={profiles.map((p) => p.name)}
              onActivity={setEditorWorking}
              onDirtyChange={setEditorDirty}
              onCancel={() => {
                setEditing(null);
                setCopying(false);
                setEditorDirty(false);
              }}
              onSave={async (profile, key, activate) => {
                setBusy(true);
                setError('');
                try {
                  const rows = await bridge.saveProviderProfile(
                    profile,
                    editing === 'new' || !profiles.some((row) => row.name === editing.name)
                      ? null
                      : editing.name,
                    profiles,
                    key,
                  );
                  onProfiles(rows);
                  setEditing(null);
                  setCopying(false);
                  const pendingCredential =
                    !activate && !!key.trim() && sameProvider(profile.settings, settings);
                  if (pendingCredential)
                    setNeedsReconnect((names) => [...new Set([...names, profile.name])]);
                  setNotice(
                    t(pendingCredential ? '渠道已保存，重新连接后使用新密钥。' : '渠道已保存'),
                  );
                  setEditorDirty(false);
                  if (activate) await enable(profile);
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : (
            <>
              <p className="field-help">
                {t('渠道保存连接信息和全部模型；启用后，在会话中切换模型。')}
              </p>
              <ChannelTransfer profiles={profiles} onProfiles={onProfiles} />
              {locked && <p role="status">{t('任务运行时可管理渠道，结束后再切换。')}</p>}
              {!current && settings.model && (
                <div className="channel-import">
                  <span>{t('当前连接尚未保存为渠道')}</span>
                  <button
                    disabled={busy}
                    onClick={() =>
                      setEditing({
                        name: t('当前服务'),
                        settings,
                        models: [settings.model],
                        model_labels: {},
                        excluded_models: [],
                      })
                    }
                  >
                    {t('保存当前连接')}
                  </button>
                </div>
              )}
              <div className="channel-cards">
                {visibleProfiles.map((profile) => {
                  const active =
                    connected &&
                    sameConnection(profile.settings, settings) &&
                    !needsReconnect.includes(profile.name);
                  return (
                    <article
                      className={`channel-card${active ? ' active' : ''}`}
                      key={profile.name}
                    >
                      <div className="channel-card-icon">
                        <Server size={21} />
                      </div>
                      <div className="channel-card-content">
                        <h3>
                          {profile.name}
                          {active && (
                            <span className="channel-active">
                              <Check size={12} />
                              {t('当前启用')}
                            </span>
                          )}
                        </h3>
                        <p title={profile.settings.baseUrl}>{profile.settings.baseUrl}</p>
                        <span>
                          {providerModels(profile).length} {t('个模型')} · Responses API
                        </span>
                      </div>
                      <div className="channel-card-actions">
                        <button disabled={busy || locked} onClick={() => void enable(profile)}>
                          {t(active || needsReconnect.includes(profile.name) ? '重新连接' : '启用')}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            setEditing(profile);
                            setCopying(false);
                            setError('');
                          }}
                        >
                          {t('编辑')}
                        </button>
                        <button
                          disabled={busy || sameProvider(profile.settings, settings)}
                          onClick={() => setRemoving(profile.name)}
                        >
                          {t('删除')}
                        </button>
                      </div>
                      {removing === profile.name && (
                        <div className="channel-delete" role="alert">
                          <span>{t('删除此渠道配置？任务记录会保留。')}</span>
                          <button onClick={() => setRemoving(null)}>{t('取消')}</button>
                          <button
                            disabled={busy}
                            onClick={() => {
                              setBusy(true);
                              const rows = profiles.filter((p) => p.name !== profile.name);
                              void bridge
                                .saveProviderProfiles(rows, profiles)
                                .then(() => {
                                  onProfiles(rows);
                                  setRemoving(null);
                                })
                                .catch((e) => setError(String(e)))
                                .finally(() => setBusy(false));
                            }}
                          >
                            {t('确认删除')}
                          </button>
                        </div>
                      )}
                      <ChannelTools
                        profile={profile}
                        profiles={profiles}
                        onProfiles={onProfiles}
                        disabled={busy}
                        onCopy={() => {
                          const base = `${profile.name} (${t('副本')})`;
                          let name = base;
                          let suffix = 2;
                          while (profiles.some((row) => row.name === name))
                            name = `${base} (${suffix++})`;
                          setEditing({
                            ...profile,
                            name,
                            settings: {
                              ...profile.settings,
                              apiKeyEnv: `FLUXCODE_CHANNEL_${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`,
                            },
                          });
                          setCopying(true);
                        }}
                      />
                    </article>
                  );
                })}
              </div>
              {!profiles.length && (
                <div className="channel-empty">
                  <Server size={36} />
                  <h3>{t('添加你的第一个渠道')}</h3>
                  <p>{t('填写服务地址和密钥，获取全部模型后保存。')}</p>
                </div>
              )}
              {!!profiles.length && !visibleProfiles.length && (
                <div className="channel-empty" role="status">
                  <p>{t('没有匹配的渠道')}</p>
                  <button onClick={() => setQuery('')}>{t('清除搜索')}</button>
                </div>
              )}
              <button
                className="channel-reload"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void bridge
                    .listProviderProfiles()
                    .then(onProfiles)
                    .catch((e) => setError(String(e)))
                    .finally(() => setBusy(false));
                }}
              >
                {t('重新载入渠道')}
              </button>
            </>
          )}
          {notice && (
            <p className="channel-notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert">
              <ErrorNotice message={error || connectionError || ''} />
            </p>
          )}
        </div>
      </div>
    </dialog>
  );
}
