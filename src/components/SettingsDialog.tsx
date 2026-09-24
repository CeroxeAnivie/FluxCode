import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, LoaderCircle, LockKeyhole, ShieldCheck, X } from 'lucide-react';
import type { Settings } from '../domain/types';
import { validateSettings } from '../domain/types';
import { bridge } from '../infrastructure/bridge';
import { errorText } from '../application/useFluxCode';

export function SettingsDialog({
  initial,
  connecting,
  onClose,
  onConnect,
  fontSize,
  onFontSize,
}: {
  initial: Settings;
  connecting: boolean;
  onClose: () => void;
  onConnect: (settings: Settings, apiKey?: string, rememberKey?: boolean) => Promise<boolean>;
  fontSize: number;
  onFontSize: (size: number) => Promise<void>;
}) {
  const [settings, setSettings] = useState(initial);
  const [apiKey, setApiKey] = useState('');
  const [rememberKey, setRememberKey] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savingFont, setSavingFont] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const field = (key: keyof Settings, value: string) =>
    setSettings((s) => ({ ...s, [key]: value }));
  return (
    <dialog
      className="settings-dialog"
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (!connecting) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const invalid = validateSettings(settings);
          setError(invalid);
          if (!invalid)
            void onConnect(settings, apiKey, rememberKey).then((ok) => {
              if (ok) {
                setApiKey('');
                onClose();
              }
            });
        }}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">WORKSPACE SETTINGS</span>
            <h2>连接你的模型服务</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭设置"
            onClick={onClose}
            disabled={connecting}
          >
            <X size={19} />
          </button>
        </header>
        <p className="dialog-intro">使用支持 Responses API 的服务，开始在本地项目中工作。</p>
        <label className="form-field font-preference">
          界面字号
          <select
            aria-label="界面字号"
            value={fontSize}
            disabled={savingFont}
            onChange={(e) => {
              setSavingFont(true);
              void onFontSize(Number(e.target.value))
                .catch((e) => setError(errorText(e)))
                .finally(() => setSavingFont(false));
            }}
          >
            {[11, 12, 13, 14, 15, 16, 17, 18].map((size) => (
              <option key={size} value={size}>
                {size} px{size === 14 ? ' · 默认' : ''}
              </option>
            ))}
          </select>
          <small>立即生效并记忆，正文和控件字号一起调整。</small>
        </label>
        <div className="protocol-badge">
          <Check size={14} />
          Responses API<span>当前支持的协议</span>
        </div>
        <label className="form-field">
          服务地址
          <input
            value={settings.baseUrl}
            onChange={(e) => field('baseUrl', e.target.value)}
            placeholder="https://api.openai.com/v1"
            required
            spellCheck={false}
          />
        </label>
        <label className="form-field">
          模型 ID
          <input
            value={settings.model}
            onChange={(e) => field('model', e.target.value)}
            placeholder="填写服务商提供的模型 ID"
            required
            spellCheck={false}
          />
        </label>
        <div className="form-columns">
          <label className="form-field">
            API Key 环境变量
            <input
              value={settings.apiKeyEnv}
              onChange={(e) => field('apiKeyEnv', e.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="form-field">
            网络代理
            <input
              value={settings.proxyUrl}
              onChange={(e) => field('proxyUrl', e.target.value)}
              spellCheck={false}
            />
          </label>
        </div>
        <label className="form-field">
          API Key <span className="field-optional">留空保留已保存的凭据</span>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="从系统凭据库或环境变量读取"
          />
        </label>
        <div className="credential-options">
          <label>
            <input
              type="checkbox"
              checked={rememberKey}
              onChange={(e) => setRememberKey(e.target.checked)}
            />
            保存到系统凭据库
          </label>
          <button
            type="button"
            onClick={() =>
              void bridge
                .forgetApiKey(settings)
                .then(() => setNotice('已删除保存的密钥；当前运行中的连接不受影响。'))
                .catch((e) => setError(errorText(e)))
            }
          >
            删除已保存密钥
          </button>
        </div>
        <p className="field-help">
          <LockKeyhole size={12} />
          密钥不写入 TOML、日志或任务索引。
        </p>
        {notice && <p className="field-help">{notice}</p>}
        <div className="access-setting">
          <ShieldCheck size={19} />
          <div>
            <strong>终端与工具完全访问</strong>
            <p>可执行命令、访问文件和网络，无需逐次审批。</p>
          </div>
          <span className="enabled-tag">已启用</span>
        </div>
        <details className="advanced-settings">
          <summary>高级配置与个人指令</summary>
          <p>在本地编辑 TOML 与个人指令。保存后重新连接生效；界面尺寸修改需重启。</p>
          <div>
            {(
              [
                ['config', '编辑 TOML'],
                ['agent', '我的 AGENTS.md'],
                ['environment', '环境说明'],
              ] as const
            ).map(([kind, label]) => (
              <button
                type="button"
                key={kind}
                onClick={() => void bridge.openUserFile(kind).catch((e) => setError(errorText(e)))}
              >
                {label}
              </button>
            ))}
          </div>
        </details>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-footer">
          <span>
            <ExternalLink size={12} />
            FluxCode 0.1.0 · Apache-2.0
          </span>
          <button type="submit" className="primary-button" disabled={connecting}>
            {connecting ? (
              <>
                <LoaderCircle size={15} className="spin" />
                正在连接
              </>
            ) : (
              '保存并连接'
            )}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
