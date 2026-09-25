import { useEffect, useState } from 'react';
import { ErrorNotice } from './ErrorNotice';
import { useAppearance } from '../application/AppearanceProvider';
import { listModels, listSkills, listMcp, setSkillEnabled } from '../infrastructure/capabilities';
import type { ModelCapability, SkillCapability, McpCapability } from '../domain/capabilities';
import { PluginSettings } from './PluginSettings';
import { bridge } from '../infrastructure/bridge';
import { McpSettings } from './McpSettings';
import { useModalDialog } from './useModalDialog';
export function CapabilitiesDialog({
  cwd,
  threadId,
  onClose,
  onModel,
}: {
  cwd?: string;
  threadId?: string;
  onClose: () => void;
  onModel: (model: string) => void;
}) {
  const { t } = useAppearance();
  const dialog = useModalDialog();
  const [models, setModels] = useState<ModelCapability[]>([]);
  const [skills, setSkills] = useState<SkillCapability[]>([]);
  const [servers, setServers] = useState<McpCapability[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('models');
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let disposed = false;
    setBusy(true);
    setErrors([]);
    void Promise.allSettled([
      listModels(),
      cwd ? listSkills(cwd) : Promise.resolve([]),
      listMcp(threadId),
    ]).then(([m, s, c]) => {
      if (disposed) return;
      if (m.status === 'fulfilled') setModels(m.value);
      if (s.status === 'fulfilled') setSkills(s.value);
      if (c.status === 'fulfilled') setServers(c.value);
      setErrors(
        [m, s, c]
          .filter((r) => r.status === 'rejected')
          .map((r) => String((r as PromiseRejectedResult).reason)),
      );
      setBusy(false);
    });
    return () => {
      disposed = true;
    };
  }, [cwd, threadId, generation]);
  async function toggle(skill: SkillCapability) {
    setBusy(true);
    try {
      await setSkillEnabled(skill.path, !skill.enabled);
      setSkills((rows) =>
        rows.map((s) => (s.path === skill.path ? { ...s, enabled: !s.enabled } : s)),
      );
    } catch (e) {
      setErrors([String(e)]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="capabilities-dialog"
      aria-label={t('模型与扩展')}
      onCancel={onClose}
    >
      <header>
        <h2>{t('模型与扩展')}</h2>
        <button onClick={onClose} aria-label={t('关闭')}>
          ×
        </button>
      </header>
      <nav>
        {[
          ['models', '模型'],
          ['skills', '技能'],
          ['mcp', 'MCP'],
          ['plugins', '插件'],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {t(label)}
          </button>
        ))}
        <button disabled={busy} onClick={() => setGeneration((v) => v + 1)}>
          {t('刷新')}
        </button>
      </nav>
      {busy && <p role="status">{t('正在加载…')}</p>}
      {errors.map((e, i) => (
        <p role="alert" key={i}>
          <ErrorNotice message={e} />
        </p>
      ))}
      {tab === 'models' && (
        <>
          <p>{t('以下为内置引擎的能力目录，不代表当前服务已授权所有模型。')}</p>
          {models.map((m) => (
            <article key={m.id}>
              <strong>{m.name}</strong>
              <code>{m.id}</code>
              <p>{m.description}</p>
              <small>
                {m.efforts.join(' · ')} / {m.modalities.join(', ')}
              </small>
              <button
                onClick={() => {
                  onModel(m.id);
                  onClose();
                }}
              >
                {t('使用模型')}
              </button>
            </article>
          ))}
        </>
      )}
      {tab === 'plugins' && <PluginSettings cwd={cwd} />}
      {tab === 'skills' && (
        <>
          <button
            disabled={busy}
            onClick={() => {
              void bridge
                .chooseDirectory()
                .then((path) => (path ? bridge.installSkill(path) : null))
                .then(() => setGeneration((v) => v + 1))
                .catch((e) => setErrors([String(e)]));
            }}
          >
            {t('从文件夹安装技能')}
          </button>
          {!skills.length && !busy && <p>{t('当前项目没有可用 Skills。')}</p>}
          {skills.map((s) => (
            <article key={s.path}>
              <strong>{s.name}</strong>
              <p>{s.description}</p>
              <small>{s.path}</small>
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={s.enabled}
                  onChange={() => void toggle(s)}
                />
                {t('已启用')}
              </label>
            </article>
          ))}
        </>
      )}
      {tab === 'mcp' && (
        <>
          <McpSettings />
          {!servers.length && !busy && <p>{t('尚未配置 MCP 服务。')}</p>}
          {servers.map((s) => (
            <article key={s.name}>
              <strong>{s.name}</strong>
              <span>
                {t(
                  (
                    {
                      connected: '已连接',
                      connecting: '连接中',
                      failed: '失败',
                      disabled: '已禁用',
                      needsAuth: '等待授权',
                    } as Record<string, string>
                  )[s.status] ?? '状态未知',
                )}{' '}
                · {s.tools} {t('个工具')}
              </span>
              {s.error && <p role="alert">{s.error}</p>}
            </article>
          ))}
        </>
      )}
    </dialog>
  );
}
