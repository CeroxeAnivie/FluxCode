import type { ChatItem, Conversation, RpcEvent } from './types';
import { isModelIdentity } from './modelIdentity';
import { normalizeAgentReferences } from './subagents';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const cap = (s: string) => (s.length > 240_000 ? '[较早的输出已截断]\n' + s.slice(-220_000) : s);

function imageContent(content: unknown): { source: string; name: string }[] {
  if (!Array.isArray(content)) return [];
  return content
    .flatMap((value) => {
      const item = record(value);
      let source = '';
      if (item.type === 'localImage') source = text(item.path);
      if (item.type === 'image' || item.type === 'input_image' || item.type === 'inputImage') {
        source = text(item.url) || text(item.image_url) || text(item.imageUrl);
        if (
          !source &&
          typeof item.data === 'string' &&
          /^image\/(png|jpeg|gif|webp)$/.test(text(item.mimeType))
        )
          source = 'data:' + item.mimeType + ';base64,' + item.data;
      }
      if (!source || source.length > 28 * 1024 * 1024) return [];
      return [
        {
          source,
          name: source.startsWith('data:')
            ? '图片'
            : source.split(/[\\/]/).at(-1)?.split('?')[0] || '图片',
        },
      ];
    })
    .slice(0, 20);
}
export function normalizeItem(value: unknown): ChatItem | null {
  const i = record(value);
  const id = text(i.id);
  if (!id) return null;
  switch (i.type) {
    case 'userMessage':
      return {
        id,
        kind: 'user',
        images: imageContent(i.content),
        text: (Array.isArray(i.content) ? i.content : [])
          .map((v) => text(record(v).text))
          .join('\n'),
      };
    case 'agentMessage':
      return {
        id,
        kind: 'assistant',
        text: text(i.text),
        images: imageContent(i.content),
        ...(isModelIdentity(i.identity) ? { identity: i.identity } : {}),
      };
    case 'imageGeneration': {
      const saved = text(i.savedPath);
      const result = text(i.result);
      return {
        id,
        kind: 'assistant',
        text: '',
        images: imageContent(
          saved
            ? [{ type: 'localImage', path: saved }]
            : result
              ? [
                  {
                    type: 'image',
                    url: result.startsWith('data:') ? result : 'data:image/png;base64,' + result,
                  },
                ]
              : [],
        ),
      };
    }
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
        agentOperation: text(i.tool),
        agents: normalizeAgentReferences(i),
      };
    case 'subAgentActivity':
      return {
        id,
        kind: 'agent',
        text: '',
        status: text(i.kind),
        agents: text(i.agentThreadId)
          ? [
              {
                threadId: text(i.agentThreadId),
                name: text(i.agentPath),
                status:
                  (
                    {
                      started: 'running',
                      interacted: 'unknown',
                      interrupted: 'interrupted',
                      completed: 'completed',
                    } as Record<string, string>
                  )[text(i.kind)] ?? 'unknown',
              },
            ]
          : [],
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
        images: imageContent(record(i.result).content ?? i.contentItems),
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
      const normalized = normalizeItem(p.item);
      if (!normalized) return state;
      const previous = state.items.find((item) => item.id === normalized.id);
      const item = {
        ...normalized,
        identity: previous?.identity ?? normalized.identity ?? state.activeIdentity,
      };
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
      const current = state.items.find((i) => i.id === id) ?? {
        id,
        kind,
        text: '',
        identity: state.activeIdentity,
      };
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
