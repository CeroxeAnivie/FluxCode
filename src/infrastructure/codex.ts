import type { ThreadStartParams } from '../generated/codex/v2/ThreadStartParams';
import type { ThreadStartResponse } from '../generated/codex/v2/ThreadStartResponse';
import type { TurnStartParams } from '../generated/codex/v2/TurnStartParams';
import { readTurnIdentities } from './modelIdentity';
import { bridge } from './bridge';
import { hydrateItems } from '../domain/conversation';
import { emptyConversation } from '../domain/types';
import type { Conversation, Settings } from '../domain/types';
import { turnModelSettings, isModelSelection } from '../domain/modelSelection';
import type { ModelSelection } from '../domain/modelSelection';
import { validateAttachments, type Attachment } from '../domain/attachments';

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
  attachments: Attachment[] = [],
): Promise<{ turn: { id: string } }> {
  validateAttachments(attachments);
  const params: TurnStartParams = {
    threadId,
    ...turnModelSettings(selection),
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'dangerFullAccess' },
    input: [
      { type: 'text', text: message, text_elements: [] },
      ...attachments.map((item) =>
        item.kind === 'image'
          ? { type: 'localImage' as const, path: item.path }
          : { type: 'mention' as const, name: item.name, path: item.path },
      ),
    ],
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
  const identities = readTurnIdentities(threadId);
  const attributed = (item: unknown, turnId: string) =>
    item && typeof item === 'object' ? { ...item, identity: identities[turnId] } : item;
  let items = turns.flatMap((turn) => (turn.items ?? []).map((item) => attributed(item, turn.id)));
  if (result.thread.historyMode === 'paginated') {
    items = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const response: { data: { item: unknown; turnId: string }[]; nextCursor: string | null } =
        await bridge.rpc('thread/items/list', {
          threadId,
          cursor,
          limit: 100,
          sortDirection: 'asc',
        });
      items.push(...response.data.map((row) => attributed(row.item, row.turnId)));
      cursor = response.nextCursor;
      if (!cursor) break;
      if (page === 99) throw new Error('任务历史超过当前加载上限（10000 条）。');
    }
  }
  const running = turns.find((t) => t.status === 'inProgress');
  return {
    ...emptyConversation(),
    activeIdentity:
      identities[running?.id ?? turns.at(-1)?.id ?? ''] ??
      (running && result.model ? { model: result.model } : undefined),
    selection: isModelSelection({ model: result.model, effort: result.reasoningEffort ?? 'off' })
      ? {
          model: result.model!,
          effort: (result.reasoningEffort ?? 'off') as ModelSelection['effort'],
        }
      : undefined,
    items: hydrateItems(items),
    turnId: running?.id ?? null,
    busy: !!running,
    lastTurnStatus: running?.status ?? turns.at(-1)?.status,
  };
}
