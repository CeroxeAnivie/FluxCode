import { ErrorNotice } from './ErrorNotice';
import { useEffect, useState } from 'react';
import { useAppearance } from '../application/AppearanceProvider';
import {
  listPlugins,
  installPlugin,
  uninstallPlugin,
  addMarketplace,
} from '../infrastructure/plugins';
import type { Plugin } from '../domain/plugins';
export function PluginSettings({ cwd }: { cwd?: string }) {
  const { t } = useAppearance();
  const [items, setItems] = useState<Plugin[]>([]);
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    void listPlugins(cwd)
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [cwd, generation]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      setGeneration((v) => v + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <label className="form-field">
        {t('插件市场来源')}
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder={t('本地市场路径或仓库地址')}
        />
      </label>
      <button
        disabled={busy || !source.trim()}
        onClick={() => void run(() => addMarketplace(source))}
      >
        {t('添加市场')}
      </button>
      {error && (
        <p role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
      {!items.length && !busy && <p>{t('没有可用插件，请先添加市场。')}</p>}
      {items.map((p) => (
        <article key={p.id}>
          <strong>{p.name}</strong>
          <small>{p.marketplace}</small>
          <button
            disabled={busy}
            onClick={() => void run(() => (p.installed ? uninstallPlugin(p.id) : installPlugin(p)))}
          >
            {t(p.installed ? '卸载' : '安装')}
          </button>
        </article>
      ))}
    </section>
  );
}
