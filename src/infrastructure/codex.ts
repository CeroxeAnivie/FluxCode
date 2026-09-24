import type { ThreadStartParams } from '../generated/codex/v2/ThreadStartParams';
import type { ThreadStartResponse } from '../generated/codex/v2/ThreadStartResponse';
import type { TurnStartParams } from '../generated/codex/v2/TurnStartParams';
import { bridge } from './bridge';
import { hydrateItems } from '../domain/conversation';
import { emptyConversation } from '../domain/types';
import type { Conversation, Settings } from '../domain/types';
import { turnModelSettings, isModelSelection } from '../domain/modelSelection';
import type { ModelSelection } from '../domain/modelSelection';

export async function startThread(cwd: string, settings: Settings): Promise<string> {
  const params: ThreadStartParams = {
    cwd,
    model: settings.model,
    modelProvider: 'fluxcode',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
  };
  const result = await bridge.rpc<ThreadStartResponse>('thread/start', params);
  return result.thread.id;
}

export async function startTurn(
  threadId: string,
  message: string,
  selection: ModelSelection,
): Promise<{ turn: { id: string } }> {
  const params: TurnStartParams = {
    threadId,
    ...turnModelSettings(selection),
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'dangerFullAccess' },
    input: [{ type: 'text', text: message, text_elements: [] }],
  };
  return bridge.rpc('turn/start', params);
}

export async function resumeThread(
  threadId: string,
): Promise<Conversation & { selection?: ModelSelection }> {
  const result = await bridge.rpc<{
    model?: string;
    reasoningEffort?: string | null;
    thread: { historyMode: string; turns: { id: string; status: string; items: unknown[] }[] };
  }>('thread/resume', {
    threadId,
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    excludeTurns: false,
  });
  const turns = result.thread.turns ?? [];
  let items = turns.flatMap((t) => t.items ?? []);
  if (result.thread.historyMode === 'paginated') {
    items = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const response: { data: { item: unknown }[]; nextCursor: string | null } = await bridge.rpc(
        'thread/items/list',
        { threadId, cursor, limit: 100, sortDirection: 'asc' },
      );
      items.push(...response.data.map((row) => row.item));
      cursor = response.nextCursor;
      if (!cursor) break;
      if (page === 99) throw new Error('任务历史超过当前加载上限（10000 条）。');
    }
  }
  const running = turns.find((t) => t.status === 'inProgress');
  return {
    ...emptyConversation(),
    selection: isModelSelection({ model: result.model, effort: result.reasoningEffort ?? 'off' })
      ? {
          model: result.model!,
          effort: (result.reasoningEffort ?? 'off') as ModelSelection['effort'],
        }
      : undefined,
    items: hydrateItems(items),
    turnId: running?.id ?? null,
    busy: !!running,
  };
}
