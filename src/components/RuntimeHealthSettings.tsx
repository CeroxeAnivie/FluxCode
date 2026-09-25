import { useState } from 'react';
import { CheckCircle2, CircleAlert, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { useAppearance } from '../application/AppearanceProvider';
import { bridge } from '../infrastructure/bridge';
import {
  parseRuntimeHealth,
  parseResourceUsage,
  runtimeChecks,
  type RuntimeCheck,
  type RuntimeHealth,
  type RuntimeStatus,
} from '../domain/runtimeHealth';
import { openWebLink } from '../infrastructure/externalLinks';

const labels: Record<RuntimeCheck, string> = {
  git: '版本控制工具',
  webview2: '系统网页组件',
  engine: '内置执行引擎',
  codeModeHost: '代码执行组件',
  legal: '许可证与声明文件',
};
const statusLabels: Record<RuntimeStatus, string> = {
  ready: '正常',
  missing: '未找到',
  corrupt: '文件损坏',
  unreadable: '无法读取',
  timeout: '检查超时',
  failed: '检查失败',
};
const repairLinks: Partial<Record<RuntimeCheck, string>> = {
  git: 'https://git-scm.com/download/win',
  webview2: 'https://developer.microsoft.com/en-us/microsoft-edge/webview2/',
};

export function RuntimeHealthSettings() {
  const { t } = useAppearance();
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [usage, setUsage] = useState<ReturnType<typeof parseResourceUsage>>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function inspect(exportResult: boolean) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await bridge.diagnostics();
      setHealth(parseRuntimeHealth(data));
      setUsage(parseResourceUsage(data));
      setChecked(true);
      if (exportResult)
        await bridge.exportDocument('FluxCode-diagnostics.json', JSON.stringify(data, null, 2));
    } catch {
      setError(t('本机环境检查失败，请重试。'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      className="runtime-health-settings"
      onToggle={(event) => {
        if (event.currentTarget.open && !checked && !busy) void inspect(false);
      }}
    >
      <summary>{t('本机运行环境')}</summary>
      <p>
        {t('运行容量')}：{t('任务 8 · 终端 16 · 工作区窗口 8')}
      </p>
      {usage && (
        <p role="status">
          {t('运行中')} {usage.tasks}/8 · {t('终端')} {usage.terminals}/16 · {t('工作区窗口')}{' '}
          {usage.windows}/8 · {t('请求')} {usage.requests}/128
        </p>
      )}
      <div className="runtime-health-actions">
        <button type="button" disabled={busy} onClick={() => void inspect(false)}>
          <RefreshCw size={14} />
          {t('重新检查')}
        </button>
        <button type="button" disabled={busy} onClick={() => void inspect(true)}>
          <Download size={14} />
          {t('导出脱敏诊断')}
        </button>
      </div>
      {busy && <p role="status">{t('正在检查本机环境…')}</p>}
      {error && <p role="alert">{error}</p>}
      {checked && !health && !busy && <p role="status">{t('当前版本未提供环境诊断。')}</p>}
      {health && (
        <ul className="runtime-health-list" aria-label={t('本机运行环境')}>
          {runtimeChecks.map((name) => {
            const status = health[name];
            const link = repairLinks[name];
            return (
              <li key={name}>
                <div className="runtime-health-result">
                  <span>{t(labels[name])}</span>
                  <span className={status === 'ready' ? 'is-ready' : 'needs-repair'}>
                    {status === 'ready' ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
                    {t(statusLabels[status])}
                  </span>
                </div>
                {status !== 'ready' && (
                  <div className="runtime-health-repair">
                    <span>
                      {t(
                        name === 'git'
                          ? '安装或修复版本控制工具，然后重新启动程序。'
                          : name === 'webview2'
                            ? '安装或修复系统网页组件，然后重新启动程序。'
                            : '使用当前版本的安装包修复程序，并保留本地数据目录。',
                      )}
                    </span>
                    {link && (
                      <button
                        type="button"
                        onClick={() =>
                          void openWebLink(link).catch(() => setError(t('无法打开系统默认浏览器')))
                        }
                      >
                        <ExternalLink size={13} />
                        {t('打开官方下载页')}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
