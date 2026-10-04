import { bridge } from './bridge';
import { failureReason, hydrateItems } from '../domain/conversation';
import {
  emptyConversation,
  type Conversation,
  type ModelIdentity,
  type AgentReference,
} from '../domain/types';
import type { ThreadTurnsListResponse } from '../generated/codex/v2/ThreadTurnsListResponse';
import type { Thread } from '../generated/codex/v2/Thread';
import { conversationAgentStatus } from '../domain/subagents';

export interface AgentSnapshot {
  name?: string;
  prompt?: string;
  identity?: ModelIdentity;
  status: string;
  conversation?: Conversation;
  truncated?: boolean;
  failure?: string;
}

// Reading must never resume, fork or change a child agent's configuration.
export async function readSubagent(
  threadId: string,
  includeHistory: boolean,
  cancelled: () => boolean,
): Promise<AgentSnapshot> {
  const { thread } = await bridge.rpc<{ thread: Thread }>('thread/read', {
    threadId,
    includeTurns: includeHistory,
  });
  if (thread.id !== threadId) throw new Error('子智能体会话标识不匹配');
  let turns = thread.turns ?? [];
  if (!turns.length && ['idle', 'notLoaded'].includes(thread.status?.type) && !cancelled()) {
    const latest = await bridge.rpc<ThreadTurnsListResponse>('thread/turns/list', {
      threadId,
      limit: 1,
      sortDirection: 'desc',
      itemsView: 'summary',
    });
    turns = latest.data;
  }
  const running = turns.find((turn) => turn.status === 'inProgress');
  const last = running ?? turns.at(-1);
  const status = thread.status?.type;
  const waiting = thread.status?.type === 'active' ? (thread.status.activeFlags ?? []) : [];
  const waitingStatus = waiting.includes('waitingOnUserInput')
    ? 'waitingInput'
    : waiting.includes('waitingOnApproval')
      ? 'waitingApproval'
      : null;
  const conversation: Conversation = {
    ...emptyConversation(),
    activeIdentity: thread.model ? { model: thread.model } : undefined,
    busy: status === 'active' || !!running,
    turnId: running?.id ?? null,
    lastTurnStatus: last?.status,
    error:
      failureReason(last?.error) ||
      (last?.status === 'failed' || status === 'systemError'
        ? '子智能体执行失败，但服务未提供具体错误。请查看运行记录。'
        : null),
  };
  let truncated = false;
  if (includeHistory && !cancelled()) {
    let items: unknown[] = turns.flatMap((turn) => turn.items ?? []);
    if (thread.historyMode === 'paginated') {
      items = [];
      const cursors = new Set<string>();
      let cursor: string | null = null;
      // Show the most recent 2,000 items, not the oldest pages of a long session.
      for (let page = 0; page < 20 && !cancelled(); page++) {
        const response: { data: { item: unknown }[]; nextCursor: string | null } = await bridge.rpc(
          'thread/items/list',
          { threadId, cursor, limit: 100, sortDirection: 'desc' },
        );
        items.push(...response.data.slice(0, 100).map((row) => row.item));
        cursor = response.nextCursor;
        if (!cursor) break;
        if (cursors.has(cursor) || !response.data.length || page === 19) {
          truncated = true;
          break;
        }
        cursors.add(cursor);
      }
      items.reverse();
    } else if (items.length > 2000) {
      items = items.slice(-2000);
      truncated = true;
    }
    conversation.items = hydrateItems(items);
  }
  return {
    failure:
      failureReason(last?.error) ||
      (last?.status === 'failed' || status === 'systemError'
        ? '子智能体执行失败，但服务未提供具体错误。请查看运行记录。'
        : undefined),
    name: thread.agentNickname || thread.name || undefined,
    prompt: thread.preview || undefined,
    identity: thread.model ? { model: thread.model } : undefined,
    status:
      status === 'systemError'
        ? 'errored'
        : (waitingStatus ??
          conversationAgentStatus(conversation, status === 'idle' ? 'idle' : 'unknown')),
    ...(includeHistory ? { conversation, truncated } : {}),
  };
}

export async function listSubagents(
  parentId: string,
  cursor: string | null,
): Promise<{ agents: AgentReference[]; nextCursor: string | null }> {
  const result = await bridge.rpc<{ data: Thread[]; nextCursor: string | null }>('thread/list', {
    ancestorThreadId: parentId,
    sourceKinds: ['subAgentThreadSpawn'],
    cursor,
    limit: 100,
    sortDirection: 'asc',
    useStateDbOnly: true,
  });
  return {
    agents: result.data.map((thread) => {
      const source =
        typeof thread.source === 'object' && 'subAgent' in thread.source
          ? thread.source.subAgent
          : null;
      const path =
        source && typeof source === 'object' && 'thread_spawn' in source
          ? source.thread_spawn.agent_path
          : null;
      return {
        threadId: thread.id,
        name: path || thread.agentNickname || thread.name || undefined,
        prompt: thread.preview || undefined,
        identity: thread.model ? { model: thread.model } : undefined,
        status:
          thread.status?.type === 'active'
            ? 'running'
            : thread.status?.type === 'systemError'
              ? 'errored'
              : 'unknown',
      };
    }),
    nextCursor: result.nextCursor,
  };
}
