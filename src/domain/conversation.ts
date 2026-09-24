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
  switch (event.method) {
    case 'turn/started':
      return { ...state, busy: true, turnId: text(record(p.turn).id), error: null };
    case 'turn/completed':
      return {
        ...state,
        busy: false,
        turnId: null,
        error: text(record(record(p.turn).error).message) || null,
      };
    case 'error':
      return { ...state, error: text(record(p.error).message) || 'Codex 执行失败' };
    case 'item/started':
    case 'item/completed': {
      const item = normalizeItem(p.item);
      if (!item) return state;
      return { ...state, items: upsert(state.items, item) };
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
