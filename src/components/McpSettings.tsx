import { Select } from './Select';
import { ErrorNotice } from './ErrorNotice';
import { useEffect, useState } from 'react';
import { bridge } from '../infrastructure/bridge';
import { useAppearance } from '../application/AppearanceProvider';
import type { McpDefinition } from '../domain/extensions';
const empty = (): McpDefinition => ({
  name: '',
  enabled: true,
  command: '',
  args: [],
  url: null,
  bearerTokenEnvVar: null,
});
export function McpSettings() {
  const { t } = useAppearance();
  const [items, setItems] = useState<McpDefinition[]>([]);
  const [draft, setDraft] = useState(empty);
  const [argumentsText, setArgumentsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [authorizationUrl, setAuthorizationUrl] = useState('');
  useEffect(() => {
    let active = true;
    void bridge
      .listMcpDefinitions()
      .then((v) => {
        if (active) setItems(v);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  async function save(value: McpDefinition) {
    setBusy(true);
    setError('');
    try {
      await bridge.saveMcpDefinition(value);
      setItems(await bridge.listMcpDefinitions());
      setNotice(t('已保存，重新连接后生效。'));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mcp-settings">
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void bridge
            .rpc('config/mcpServer/reload', {})
            .then(() => setNotice(t('服务配置已重新加载。')))
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        {t('重新加载服务')}
      </button>
      {authorizationUrl && (
        <label className="form-field">
          {t('在浏览器中打开授权地址')}
          <input readOnly value={authorizationUrl} onFocus={(e) => e.target.select()} />
          <button
            onClick={() =>
              void navigator.clipboard.writeText(authorizationUrl).catch((e) => setError(String(e)))
            }
          >
            {t('复制授权地址')}
          </button>
        </label>
      )}
      {items.map((item) => (
        <div key={item.name}>
          <strong>{item.name}</strong>
          {item.url && (
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError('');
                void bridge
                  .rpc<{ authorizationUrl: string }>('mcpServer/oauth/login', { name: item.name })
                  .then((result) => {
                    const url = new URL(result.authorizationUrl);
                    if (!['http:', 'https:'].includes(url.protocol))
                      throw new Error('授权地址无效');
                    setAuthorizationUrl(url.href);
                  })
                  .catch((e) => setError(String(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {t('连接授权')}
            </button>
          )}
          <label>
            <input
              type="checkbox"
              checked={item.enabled}
              disabled={busy}
              onChange={() => void save({ ...item, enabled: !item.enabled })}
            />
            {t('已启用')}
          </label>
          <button
            onClick={() => {
              setDraft(item);
              setArgumentsText(item.args.join('\n'));
            }}
          >
            {t('编辑')}
          </button>
        </div>
      ))}
      <details>
        <summary>{t('添加或编辑 MCP 服务')}</summary>
        <label className="form-field">
          {t('服务名称')}
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            maxLength={100}
          />
        </label>
        <label className="form-field">
          {t('传输方式')}
          <Select
            value={draft.url === null ? 'stdio' : 'http'}
            onValueChange={(value) =>
              setDraft((d) => ({
                ...d,
                command: value === 'stdio' ? '' : null,
                url: value === 'http' ? '' : null,
              }))
            }
          >
            <option value="stdio">{t('标准输入输出')}</option>
            <option value="http">HTTP</option>
          </Select>
        </label>
        {draft.url === null ? (
          <>
            <label className="form-field">
              {t('可执行程序')}
              <input
                value={draft.command ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, command: e.target.value }))}
              />
            </label>
            <label className="form-field">
              {t('参数，每行一个')}
              <textarea value={argumentsText} onChange={(e) => setArgumentsText(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label className="form-field">
              URL
              <input
                value={draft.url}
                onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
              />
            </label>
            <label className="form-field">
              {t('令牌环境变量')}
              <input
                value={draft.bearerTokenEnvVar ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, bearerTokenEnvVar: e.target.value || null }))
                }
              />
            </label>
          </>
        )}
        <button
          disabled={busy || !draft.name || !(draft.command || draft.url)}
          onClick={() =>
            void save({ ...draft, args: argumentsText ? argumentsText.split('\n') : [] })
          }
        >
          {t('保存')}
        </button>
      </details>
      {error && (
        <p role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
