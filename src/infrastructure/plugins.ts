import { bridge } from './bridge';
import type { Plugin } from '../domain/plugins';
import type { PluginListResponse } from '../generated/codex/v2/PluginListResponse';
export async function listPlugins(cwd?: string): Promise<Plugin[]> {
  const result = await bridge.rpc<PluginListResponse>('plugin/list', {
    cwds: cwd ? [cwd] : [],
    marketplaceKinds: ['local'],
  });
  if (result.marketplaceLoadErrors.length)
    throw new Error(result.marketplaceLoadErrors.map((e) => JSON.stringify(e)).join('\n'));
  return result.marketplaces.flatMap((m) =>
    m.plugins.map((p) => ({
      id: p.id,
      name: p.name,
      marketplace: m.name,
      marketplacePath: m.path,
      installed: p.installed,
      enabled: p.enabled,
    })),
  );
}
export async function installPlugin(plugin: Plugin) {
  await bridge.rpc('plugin/install', {
    pluginName: plugin.name,
    marketplacePath: plugin.marketplacePath,
    remoteMarketplaceName: plugin.marketplacePath ? null : plugin.marketplace,
    installAttemptId: crypto.randomUUID(),
  });
}
export const uninstallPlugin = (id: string) => bridge.rpc('plugin/uninstall', { pluginId: id });
export const addMarketplace = (source: string) => bridge.rpc('marketplace/add', { source });
