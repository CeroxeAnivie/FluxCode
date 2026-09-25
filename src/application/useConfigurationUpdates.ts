import { useEffect, useRef, useState } from 'react';
import { configuration, type ConfigurationSnapshot } from '../infrastructure/configuration';
import type { Settings } from '../domain/types';
import { bridge } from '../infrastructure/bridge';

const fingerprint = (s: Settings) =>
  JSON.stringify([
    s.baseUrl,
    s.model,
    s.apiKeyEnv,
    s.proxyUrl,
    s.contextWindow ?? null,
    s.autoCompactTokens ?? null,
    s.pricing
      ? [s.pricing.model, s.pricing.currency, s.pricing.input, s.pricing.cached, s.pricing.output]
      : null,
  ]);
const equal = (left: Settings, right: Settings) => fingerprint(left) === fingerprint(right);

export function useConfigurationUpdates(
  applied: Settings,
  connected: boolean,
  busy: boolean,
  connect: (settings: Settings, revision: number) => Promise<boolean>,
  setFontSize: (size: number) => void,
) {
  const [snapshot, setSnapshot] = useState<ConfigurationSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);
  const latest = useRef({ connect, setFontSize, applied, connected, busy });
  latest.current = { connect, setFontSize, applied, connected, busy };
  useEffect(() => {
    if (!configuration.native) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let stopRuntime: (() => void) | undefined;
    let revision = 0;
    const accept = (next: ConfigurationSnapshot) => {
      if (disposed || next.revision < revision) return;
      revision = next.revision;
      setSnapshot(next);
      setFailed(false);
      latest.current.setFontSize(next.ui.font_size);
      document.documentElement.style.setProperty('--font-size', `${next.ui.font_size}px`);
      document.documentElement.style.setProperty('--sidebar-width', `${next.ui.sidebar_width}px`);
      document.documentElement.style.setProperty(
        '--inspector-width',
        `${next.ui.inspector_width}px`,
      );
    };
    void (async () => {
      unlisten = await configuration.subscribe(accept);
      stopRuntime = await bridge.subscribe((event) => {
        if (!disposed && event.method === 'engine/idle') setAttempt((value) => value + 1);
      });
      if (disposed) {
        unlisten();
        stopRuntime();
        return;
      }
      accept(await configuration.load());
    })().catch(() => {
      if (!disposed) setFailed(true);
    });
    return () => {
      disposed = true;
      unlisten?.();
      stopRuntime?.();
    };
  }, []);
  const pending = !!snapshot && !equal(snapshot.settings, applied);
  useEffect(() => {
    if (!pending || !snapshot || snapshot.error || busy || !connected || failed || inFlight.current)
      return;
    inFlight.current = true;
    void configuration
      .idle()
      .then(async (idle) => {
        if (!idle) return;
        // A UI save may finish while the idle query is in flight. Never reconnect
        // using the earlier watcher snapshot or race a foreground connection.
        const fresh = await configuration.load();
        if (fresh.revision !== snapshot.revision) {
          setSnapshot((current) =>
            !current || fresh.revision > current.revision ? fresh : current,
          );
          return;
        }
        const current = latest.current;
        if (
          !current.connected ||
          current.busy ||
          fresh.error ||
          equal(fresh.settings, current.applied)
        )
          return;
        if (!(await current.connect(fresh.settings, fresh.settingsRevision))) setFailed(true);
      })
      .catch(() => setFailed(true))
      .finally(() => {
        inFlight.current = false;
      });
  }, [snapshot, pending, busy, connected, failed, attempt]);
  return {
    snapshot,
    message:
      snapshot && !snapshot.watching
        ? '配置自动监测不可用，请重新启动应用。'
        : snapshot?.error
          ? '配置文件无效，继续使用上一份有效设置。修复文件后会自动恢复。'
          : failed
            ? '配置尚未应用。当前任务和终端保持不变，请检查设置后重试。'
            : pending
              ? '配置已更新，连接设置将在任务空闲时应用；已有终端保持原环境。'
              : null,
    retry: () => {
      setFailed(false);
      setAttempt((value) => value + 1);
    },
    failed,
  };
}
