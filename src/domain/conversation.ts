import type { ChatItem, Conversation, RpcEvent } from './types';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const cap = (s: string) => (s.length > 240_000 ? '[较早的输出已截断]\n' + s.slice(-220_000) : s);

export function normalizeItem(value: unknown): ChatItem | null {
  const i = record(value);
  const id = text(i.id);
  if (!id) return null;
  switch (i.type) {
    case 'userMessage':
      return {
        id,
        kind: 'user',
        text: (Array.isArray(i.content) ? i.content : [])
          .map((v) => text(record(v).text))
          .join('\n'),
      };
    case 'agentMessage':
      return { id, kind: 'assistant', text: text(i.text) };
    case 'commandExecution':
      return {
        id,
        kind: 'command',
        text: text(i.command),
        detail: cap(text(i.aggregatedOutput)),
        status: text(i.status),
        cwd: text(i.cwd),
        exitCode: typeof i.exitCode === 'number' ? i.exitCode : null,
        durationMs: typeof i.durationMs === 'number' ? i.durationMs : null,
      };
    case 'fileChange':
      return {
        id,
        kind: 'file',
        text: (Array.isArray(i.changes) ? i.changes : [])
          .map((v) => text(record(v).path))
          .join('\n'),
        detail: cap(
          (Array.isArray(i.changes) ? i.changes : []).map((v) => text(record(v).diff)).join('\n'),
        ),
        status: text(i.status),
      };
    case 'reasoning':
      return {
        id,
        kind: 'reasoning',
        text: Array.isArray(i.summary) ? i.summary.map(text).join('\n') : '',
      };
    case 'collabAgentToolCall':
      return {
        id,
        kind: 'agent',
        text: text(i.prompt),
        status: text(i.status),
        detail: (Array.isArray(i.receiverThreadIds) ? i.receiverThreadIds.map(text) : []).join(
          '\n',
        ),
        steps: Object.entries(record(i.agentsStates)).map(([id, value]) => ({
          text: id,
          status: text(record(value).status),
        })),
      };
    case 'subAgentActivity':
      return {
        id,
        kind: 'agent',
        text: text(i.agentPath),
        detail: text(i.agentThreadId),
        status: text(i.kind),
      };
    case 'contextCompaction':
      return { id, kind: 'compaction', text: '' };
    case 'plan':
      return { id, kind: 'plan', text: text(i.text) };
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return {
        id,
        kind: 'tool',
        text: [text(i.server), text(i.tool)].filter(Boolean).join(' / '),
        status: text(i.status),
      };
    default:
      return null;
  }
}

export function upsert(items: ChatItem[], item: ChatItem): ChatItem[] {
  const index = items.findIndex((i) => i.id === item.id);
  if (index < 0) return [...items, item];
  return items.map((i, n) => (n === index ? item : i));
}

export function reduceEvent(state: Conversation, event: RpcEvent): Conversation {
  const p = event.params ?? {};
  // A delayed completion or delta from an older turn must not stop or alter the active turn.
  const eventTurnId = event.method === 'turn/completed' ? text(record(p.turn).id) : text(p.turnId);
  if (
    state.turnId &&
    eventTurnId &&
    state.turnId !== eventTurnId &&
    event.method !== 'turn/started'
  )
    return state;
  switch (event.method) {
    case 'thread/tokenUsage/updated': {
      const usage = record(p.tokenUsage);
      const total = record(usage.total);
      const last = record(usage.last);
      const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
      return {
        ...state,
        usage: {
          input: count(total.inputTokens),
          output: count(total.outputTokens),
          cached: count(total.cachedInputTokens),
          reasoning: count(total.reasoningOutputTokens),
          total: count(total.totalTokens),
          context: typeof usage.modelContextWindow === 'number' ? usage.modelContextWindow : null,
          lastInput: count(last.inputTokens),
          lastTotal: count(last.totalTokens),
          lastCached: count(last.cachedInputTokens),
          lastOutput: count(last.outputTokens),
          model: state.activeModel,
        },
      };
    }
    case 'turn/started':
      return {
        ...state,
        recoveredTurn: undefined,
        busy: true,
        lastTurnStatus: 'inProgress',
        turnId: text(record(p.turn).id),
        error: null,
      };
    case 'turn/completed':
      return {
        ...state,
        busy: false,
        lastTurnStatus: text(record(p.turn).status),
        items: state.items.map((item) =>
          item.kind === 'compaction' && item.status === 'inProgress'
            ? { ...item, status: 'interrupted' }
            : item,
        ),
        turnId: null,
        error: text(record(record(p.turn).error).message) || null,
      };
    case 'error':
      return { ...state, error: text(record(p.error).message) || 'Codex 执行失败' };
    case 'item/started':
    case 'item/completed': {
      const item = normalizeItem(p.item);
      if (!item) return state;
      return {
        ...state,
        items: upsert(
          state.items,
          item.kind === 'compaction'
            ? { ...item, status: event.method === 'item/started' ? 'inProgress' : 'completed' }
            : item,
        ),
      };
    }
    case 'item/agentMessage/delta':
    case 'item/commandExecution/outputDelta':
    case 'item/reasoning/summaryTextDelta': {
      const id = text(p.itemId);
      if (!id) return state;
      const kind = event.method.includes('commandExecution')
        ? 'command'
        : event.method.includes('reasoning')
          ? 'reasoning'
          : 'assistant';
      const current = state.items.find((i) => i.id === id) ?? { id, kind, text: '' };
      const item =
        kind === 'command'
          ? { ...current, detail: cap((current.detail ?? '') + text(p.delta)) }
          : { ...current, text: cap(current.text + text(p.delta)) };
      return { ...state, items: upsert(state.items, item) };
    }
    case 'turn/plan/updated': {
      const steps = (Array.isArray(p.plan) ? p.plan : []).map((value) => ({
        text: text(record(value).step),
        status: text(record(value).status),
      }));
      return {
        ...state,
        items: upsert(state.items, {
          id: `plan:${text(p.turnId)}`,
          kind: 'plan',
          text: text(p.explanation),
          steps,
        }),
      };
    }
    case 'turn/diff/updated':
      return { ...state, diff: text(p.diff) };
    default:
      return state;
  }
}

export function hydrateItems(values: unknown[]): ChatItem[] {
  return values.reduce<ChatItem[]>((items, value) => {
    const item = normalizeItem(value);
    return item ? upsert(items, item) : items;
  }, []);
}
