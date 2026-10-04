import { useEffect, useMemo, useRef, useState } from 'react';
import { collectSubagents, conversationAgentStatus, isAgentActive } from '../domain/subagents';
import { reduceEvent } from '../domain/conversation';
import {
  emptyConversation,
  type AgentReference,
  type Conversation,
  type RpcEvent,
} from '../domain/types';
import { bridge } from '../infrastructure/bridge';
import { listSubagents, readSubagent, type AgentSnapshot } from '../infrastructure/subagents';

export interface SubagentView extends AgentReference {
  conversation?: Conversation;
  loading?: boolean;
  readError?: string;
  truncated?: boolean;
}
interface CachedAgent extends AgentSnapshot {
  sourceStatus: string;
  readError?: string;
  loading?: boolean;
}

export function useSubagents(parentId: string | null, parent: Conversation, connected: boolean) {
  const [discovery, setDiscovery] = useState<{
    parentId: string | null;
    agents: AgentReference[];
    error?: string;
  }>({ parentId, agents: [] });
  const direct = useMemo(() => collectSubagents(parent.items), [parent.items]);
  const references = useMemo(() => {
    const agents = new Map(
      (discovery.parentId === parentId ? discovery.agents : []).map((agent) => [
        agent.threadId,
        agent,
      ]),
    );
    for (const agent of direct)
      agents.set(agent.threadId, { ...agents.get(agent.threadId), ...agent });
    agents.delete(parentId ?? '');
    return [...agents.values()];
  }, [direct, discovery, parentId]);
  const signature = JSON.stringify(references);
  const [selection, setSelection] = useState<{ parentId: string; id: string } | null>(null);
  const selectedId = selection?.parentId === parentId ? selection.id : null;
  const [cache, setCache] = useState<{
    parentId: string | null;
    agents: Record<string, CachedAgent>;
  }>({ parentId, agents: {} });
  const [revision, setRevision] = useState(0);
  const currentCache = useRef(cache);
  currentCache.current = cache;
  const parentBusy = useRef(parent.busy);
  parentBusy.current = parent.busy;
  const agents = references.map((reference): SubagentView => {
    const cached = cache.parentId === parentId ? cache.agents[reference.threadId] : undefined;
    return {
      ...reference,
      ...cached,
      name: reference.name || cached?.name,
      prompt: reference.prompt || cached?.prompt,
      identity: cached?.identity || reference.identity,
      status: cached && cached.sourceStatus === reference.status ? cached.status : reference.status,
    };
  });
  const selected = agents.find((agent) => agent.threadId === selectedId);
  const activeAgents = useRef(false);
  activeAgents.current = agents.some((agent) => isAgentActive(agent.status));
  useEffect(() => {
    if (!parentId || !connected) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const refresh = async () => {
      if (disposed) return;
      if (document.visibilityState === 'visible') {
        try {
          let cursor: string | null = null;
          const cursors = new Set<string>();
          const agents: AgentReference[] = [];
          do {
            const page = await listSubagents(parentId, cursor);
            if (disposed) return;
            agents.push(...page.agents);
            cursor = page.nextCursor;
            if (cursor && cursors.has(cursor)) throw new Error('子智能体列表分页重复');
            if (cursor) cursors.add(cursor);
          } while (cursor && !disposed);
          failures = 0;
          setDiscovery({ parentId, agents });
        } catch (cause) {
          if (!disposed)
            setDiscovery((previous) => ({
              parentId,
              agents: previous.parentId === parentId ? previous.agents : [],
              error: String(cause),
            }));
          failures++;
        }
      }
      if (
        !disposed &&
        failures < 3 &&
        (parentBusy.current || activeAgents.current || document.visibilityState !== 'visible')
      )
        timer = setTimeout(() => void refresh(), 5000);
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [parentId, connected, parent.busy, revision]);

  useEffect(() => {
    if (!parentId || !connected || !references.length) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    const failures = new Map<string, number>();
    const buffers = new Map<string, RpcEvent[]>();
    const update = (id: string, updater: (old: CachedAgent | undefined) => CachedAgent) => {
      if (disposed) return;
      setCache((previous) => {
        if (disposed) return previous;
        const agents = previous.parentId === parentId ? previous.agents : {};
        return { parentId, agents: { ...agents, [id]: updater(agents[id]) } };
      });
    };
    const receive = (event: RpcEvent) => {
      const id = event.params?.threadId;
      if (typeof id !== 'string') return;
      const reference = references.find((agent) => agent.threadId === id);
      if (!reference) return;
      buffers.get(id)?.push(event);
      update(id, (old) => {
        const base = old ?? { status: reference.status, sourceStatus: reference.status };
        if (event.method === 'thread/status/changed') {
          const status = (event.params?.status as { type?: string } | undefined)?.type;
          return {
            ...base,
            status:
              status === 'active' ? 'running' : status === 'systemError' ? 'errored' : base.status,
          };
        }
        const conversation = reduceEvent(base.conversation ?? emptyConversation(), event);
        return {
          ...base,
          conversation,
          status: conversationAgentStatus(conversation, base.status),
        };
      });
    };
    const refresh = async (first: boolean) => {
      if (disposed) return;
      // No background work while the app is hidden. A visible window resumes on the next tick.
      if (document.visibilityState === 'visible') {
        let cursor = 0;
        async function worker() {
          while (!disposed && cursor < references.length) {
            const reference = references[cursor++];
            const id = reference.threadId;
            const cached =
              currentCache.current.parentId === parentId
                ? currentCache.current.agents[id]
                : undefined;
            const status =
              cached?.sourceStatus === reference.status ? cached.status : reference.status;
            if ((failures.get(id) ?? 0) >= 3) continue;
            if (!first && !parentBusy.current && !isAgentActive(status)) continue;
            const includeHistory = id === selectedId;
            if (includeHistory) buffers.set(id, []);
            update(id, (old) => ({
              ...old,
              status: old?.status ?? reference.status,
              sourceStatus: reference.status,
              loading: includeHistory && !old?.conversation,
            }));
            try {
              const snapshot = await readSubagent(id, includeHistory, () => disposed);
              if (
                !includeHistory &&
                (snapshot.status === 'idle' || snapshot.status === 'unknown') &&
                !isAgentActive(reference.status)
              )
                snapshot.status = reference.status;
              const buffered = buffers.get(id) ?? [];
              if (snapshot.conversation) {
                snapshot.conversation = buffered.reduce(reduceEvent, snapshot.conversation);
                snapshot.status = conversationAgentStatus(snapshot.conversation, snapshot.status);
              }
              failures.delete(id);
              update(id, (old) => ({
                ...old,
                ...snapshot,
                sourceStatus: reference.status,
                readError: undefined,
                loading: false,
              }));
            } catch (cause) {
              failures.set(id, (failures.get(id) ?? 0) + 1);
              update(id, (old) => ({
                ...old,
                status: old?.status ?? reference.status,
                sourceStatus: reference.status,
                readError: String(cause),
                loading: false,
              }));
            } finally {
              buffers.delete(id);
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(2, references.length) }, () => worker()));
      }
      if (!disposed) timer = setTimeout(() => void refresh(false), 2500);
    };
    void bridge
      .subscribe(receive)
      .then((stop) => {
        if (disposed) stop();
        else unsubscribe = stop;
      })
      .catch((cause) => {
        for (const reference of references)
          update(reference.threadId, (old) => ({
            ...old,
            sourceStatus: reference.status,
            status: old?.status ?? reference.status,
            readError: String(cause),
          }));
      });
    void refresh(true);
    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe?.();
    };
    // The signature only changes when the parent's agent metadata changes, not on token deltas.
  }, [parentId, connected, signature, selectedId, revision]);

  return {
    agents,
    discoveryError: discovery.parentId === parentId ? discovery.error : undefined,
    selected,
    connected,
    open: (id: string) => {
      if (parentId) setSelection({ parentId, id });
    },
    close: () => setSelection(null),
    refresh: () => setRevision((value) => value + 1),
  };
}
export type SubagentsController = ReturnType<typeof useSubagents>;
