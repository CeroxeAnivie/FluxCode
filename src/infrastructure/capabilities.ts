import { bridge } from './bridge';
import type { ModelListResponse } from '../generated/codex/v2/ModelListResponse';
import type { SkillsListResponse } from '../generated/codex/v2/SkillsListResponse';
import type { ListMcpServerStatusResponse } from '../generated/codex/v2/ListMcpServerStatusResponse';
import type { ModelCapability, SkillCapability, McpCapability } from '../domain/capabilities';
export async function listModels(): Promise<ModelCapability[]> {
  const result: ModelCapability[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const response: ModelListResponse = await bridge.rpc('model/list', { cursor, limit: 100 });
    if (!Array.isArray(response.data)) throw new Error('Invalid model catalog response');
    result.push(
      ...response.data.map((m) => ({
        id: m.model,
        name: m.displayName,
        description: m.description,
        efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort),
        modalities: m.inputModalities,
      })),
    );
    cursor = response.nextCursor;
    if (!cursor) return result;
  }
  throw new Error('Model catalog exceeds supported limit');
}
export async function listSkills(cwd: string): Promise<SkillCapability[]> {
  const result = await bridge.rpc<SkillsListResponse>('skills/list', {
    cwds: [cwd],
    forceReload: true,
  });
  const errors = result.data.flatMap((entry) => entry.errors);
  if (errors.length) throw new Error(errors.map((error) => error.message).join('\n'));
  return result.data.flatMap((entry) =>
    entry.skills.map((s) => ({
      name: s.name,
      description: s.description,
      path: s.path,
      enabled: s.enabled,
    })),
  );
}
export async function listMcp(threadId?: string): Promise<McpCapability[]> {
  const items: McpCapability[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const result: ListMcpServerStatusResponse = await bridge.rpc('mcpServerStatus/list', {
      cursor,
      limit: 100,
      threadId,
    });
    items.push(
      ...result.data.map((m) => ({
        name: m.name,
        status: m.runtimeStatus ?? 'unknown',
        tools: Object.keys(m.tools).length,
        error: m.toolsError,
      })),
    );
    cursor = result.nextCursor;
    if (!cursor) return items;
  }
  throw new Error('MCP catalog exceeds supported limit');
}
export const setSkillEnabled = (path: string, enabled: boolean) =>
  bridge.rpc('skills/config/write', { path, enabled });
