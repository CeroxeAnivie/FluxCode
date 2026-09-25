import { Select } from './Select';
import { ErrorNotice } from './ErrorNotice';
import { useAppearance } from '../application/AppearanceProvider';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import type { Settings } from '../domain/types';
import { validateSettings } from '../domain/types';
import { bridge } from '../infrastructure/bridge';
import { errorText } from '../application/useFluxCode';
import { PricingSettings } from './PricingSettings';
import { ContextSettings } from './ContextSettings';
import { AppearanceSettings } from './AppearanceSettings';
import { UpdateSettings } from './UpdateSettings';
import { BackupSettings } from './BackupSettings';
import { RuntimeHealthSettings } from './RuntimeHealthSettings';
import { useModalDialog } from './useModalDialog';

export function SettingsDialog({
  initial,
  onChannels,
  connecting,
  onClose,
  onConnect,
  fontSize,
  onFontSize,
  settingsRevision,
  busyWork,
  hasUnsentDraft,
  connectionError,
}: {
  initial: Settings;
  onChannels: () => void;
  connecting: boolean;
  onClose: () => void;
  onConnect: (
    settings: Settings,
    apiKey?: string,
    rememberKey?: boolean,
    expectedRevision?: number,
  ) => Promise<boolean>;
  settingsRevision?: number;
  busyWork: boolean;
  hasUnsentDraft: boolean;
  connectionError?: string | null;
  fontSize: number;
  onFontSize: (size: number) => Promise<void>;
}) {
  const { t } = useAppearance();
  const [settings, setSettings] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [savingFont, setSavingFont] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const savingSettingsRef = useRef(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<'close' | 'channels' | null>(null);
  const errorNotice = useRef<HTMLParagraphElement>(null);
  function navigate(destination: 'close' | 'channels') {
    if (backupBusy || savingSettingsRef.current) return;
    if (JSON.stringify(settings) !== JSON.stringify(baseline.current)) {
      setPendingNavigation(destination);
      return;
    }
    if (destination === 'channels') onChannels();
    else onClose();
  }
  const baseline = useRef(initial);
  const baselineRevision = useRef(settingsRevision);
  const configurationChanged = JSON.stringify(baseline.current) !== JSON.stringify(initial);
  const dialog = useModalDialog();
  useEffect(() => {
    if (error) errorNotice.current?.focus();
  }, [error]);
  useEffect(() => {
    if (submitFailed && connectionError) setError(connectionError);
  }, [submitFailed, connectionError]);
  return (
    <dialog
      className="settings-dialog"
      aria-label={t('工作空间设置')}
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (!connecting && !backupBusy && !savingSettings) navigate('close');
      }}
    >
      <form
        noValidate
        aria-busy={connecting || savingSettings || savingFont || backupBusy}
        onSubmit={(e) => {
          e.preventDefault();
          if (connecting || backupBusy || savingSettingsRef.current) return;
          setSubmitFailed(false);
          if (configurationChanged) {
            setError(t('配置已在其他位置更新，请先载入最新设置。当前输入仍保留。'));
            return;
          }
          if (!settings.model) {
            onClose();
            return;
          }
          const invalid = validateSettings(settings);
          setError(invalid);
          if (!invalid) {
            savingSettingsRef.current = true;
            setSavingSettings(true);
            void onConnect(settings, undefined, false, baselineRevision.current)
              .then((ok) => {
                if (ok) onClose();
                else {
                  setSubmitFailed(true);
                  setError(t('设置未保存，请检查配置并重试。'));
                }
              })
              .catch((cause) => setError(errorText(cause)))
              .finally(() => {
                savingSettingsRef.current = false;
                setSavingSettings(false);
              });
          }
        }}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">{t('工作空间设置')}</span>
            <h2>{t('工作空间设置')}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t('关闭设置')}
            onClick={() => navigate('close')}
            disabled={connecting || savingSettings || backupBusy}
          >
            <X size={19} />
          </button>
        </header>
        <div className="settings-body">
          {configurationChanged && (
            <div className="configuration-notice" role="status">
              <span>{t('配置已在其他位置更新，请先载入最新设置。当前输入仍保留。')}</span>
              <button
                type="button"
                onClick={() => {
                  baseline.current = initial;
                  baselineRevision.current = settingsRevision;
                  setSettings(initial);
                  setError(null);
                }}
              >
                {t('载入最新设置')}
              </button>
            </div>
          )}
          <section className="settings-channel-link">
            <div>
              <h3>{t('模型渠道')}</h3>
              <p>{t('添加或切换模型服务，请前往渠道管理。')}</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('channels')}
              disabled={backupBusy || savingSettings}
            >
              {t('管理渠道')}
            </button>
          </section>
          {!settings.model && (
            <p role="status">{t('先添加渠道，即可设置模型价格和上下文；外观现在就可以调整。')}</p>
          )}
          <fieldset
            disabled={connecting || savingSettings || !settings.model}
            className="settings-model-options"
          >
            <PricingSettings settings={settings} onChange={setSettings} />
            <ContextSettings
              settings={settings}
              onChange={setSettings}
              disabled={connecting || savingSettings || !settings.model}
            />
            <p className="field-help">{t('模型价格和上下文在点击“保存设置”后生效。')}</p>
          </fieldset>
          <AppearanceSettings />
          <label className="form-field font-preference">
            {t('界面字号')}
            <Select
              aria-label={t('界面字号')}
              value={fontSize}
              disabled={savingFont}
              onValueChange={(value) => {
                setSavingFont(true);
                void onFontSize(Number(value))
                  .catch((e) => setError(errorText(e)))
                  .finally(() => setSavingFont(false));
              }}
            >
              {[11, 12, 13, 14, 15, 16, 17, 18].map((size) => (
                <option key={size} value={size}>
                  {size} px{size === 14 ? t(' · 默认') : ''}
                </option>
              ))}
            </Select>
            <small>{t('立即生效并记忆，正文和控件字号一起调整。')}</small>
          </label>
          <div className="access-setting">
            <ShieldCheck size={19} />
            <div>
              <strong>{t('终端与工具完全访问')}</strong>
              <p>{t('可执行命令、访问文件和网络，无需逐次审批。')}</p>
            </div>
            <span className="enabled-tag">{t('已启用')}</span>
          </div>
          <details className="advanced-settings">
            <summary>{t('高级配置与个人指令')}</summary>
            <p>{t('TOML 修改会自动校验并载入；外观立即更新，连接变更等待任务与终端空闲。')}</p>
            <div>
              {(
                [
                  ['config', t('编辑 TOML')],
                  ['agent', t('我的 AGENTS.md')],
                  ['environment', t('环境说明')],
                ] as const
              ).map(([kind, label]) => (
                <button
                  type="button"
                  key={kind}
                  onClick={() =>
                    void bridge.openUserFile(kind).catch((e) => setError(errorText(e)))
                  }
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </details>
          {error && (
            <p ref={errorNotice} tabIndex={-1} className="inline-error" role="alert">
              <ErrorNotice message={error} />
            </p>
          )}
          <UpdateSettings />
          <BackupSettings
            busyWork={busyWork}
            unsavedSettings={JSON.stringify(settings) !== JSON.stringify(baseline.current)}
            hasUnsentDraft={hasUnsentDraft}
            onActivity={setBackupBusy}
          />
          <RuntimeHealthSettings />
        </div>
        <footer className="dialog-footer">
          {pendingNavigation && (
            <div role="alert" className="settings-unsaved">
              <p>{t('还有未保存的设置。继续编辑，或放弃本次修改？')}</p>
              <button
                type="button"
                disabled={backupBusy}
                onClick={() => setPendingNavigation(null)}
              >
                {t('继续编辑')}
              </button>
              <button
                type="button"
                disabled={backupBusy}
                onClick={() => (pendingNavigation === 'channels' ? onChannels() : onClose())}
              >
                {t('放弃修改')}
              </button>
            </div>
          )}
          <span>
            <ExternalLink size={12} />
            FluxCode 0.1.0 · Apache-2.0
          </span>
          <button
            type="submit"
            className="primary-button"
            disabled={connecting || savingSettings || backupBusy}
          >
            {connecting ? (
              <>
                <LoaderCircle size={15} className="spin" />
                {t('正在连接')}
              </>
            ) : (
              t('保存设置')
            )}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
