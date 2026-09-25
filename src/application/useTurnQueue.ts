import { useEffect, useRef, useState } from 'react';
import { bridge } from '../infrastructure/bridge';

import type { Conversation } from '../domain/types';
import type { ModelSelection } from '../domain/modelSelection';
import type { Attachment } from '../domain/attachments';
import { settleQueuedMessage, type QueuedMessage } from '../domain/queuedMessage';
import { loadQueue, saveQueue } from '../infrastructure/turnQueue';

/** A bounded queue advances only after confirmed completion, never after ambiguous failure. */
export function useTurnQueue(
  conversations: Record<string, Conversation>,
  ready: boolean,
  report: (text: string) => void,
  send: (item: QueuedMessage) => Promise<{ turnId: string }>,
) {
  const [initial] = useState(() => {
    try {
      return { items: loadQueue(), error: '' };
    } catch (e) {
      return { items: [], error: String(e) };
    }
  });
  const [items, setItems] = useState<QueuedMessage[]>(initial.items);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const locks = useRef(new Set<string>());
  const dispatching = useRef<string | null>(null);
  const completed = useRef(new Map<string, { turnId: string; status: string; error?: string }>());
  const previouslyReady = useRef(ready);
  const reconciled = useRef(new Map<string, string>());
  function commit(change: (rows: QueuedMessage[]) => QueuedMessage[]): boolean {
    if (initial.error) {
      report('待发送队列数据损坏，已停止写入以保护原始数据；请从备份恢复。');
      return false;
    }
    const next = change(itemsRef.current);
    try {
      saveQueue(next);
    } catch (error) {
      report(String(error));
      return false;
    }
    itemsRef.current = next;
    setItems(next);
    return true;
  }
  useEffect(() => {
    if (initial.error) report('待发送队列数据损坏，已停止写入以保护原始数据；请从备份恢复。');
  }, []);
  useEffect(() => {
    if (!initial.error) commit((rows) => rows);
  }, []);
  useEffect(() => {
    const lostConnection = previouslyReady.current && !ready;
    previouslyReady.current = ready;
    if (!lostConnection) return;
    locks.current.clear();
    dispatching.current = null;
    completed.current.clear();
    // Health probes can detect a lost connection before an engine event arrives.
    // Require explicit review before dispatching anything after reconnect.
    commit((rows) =>
      rows.map((row) =>
        row.status === 'waiting' || row.status === 'sending'
          ? { ...row, status: 'failed', error: '连接已断开，请确认执行状态后重试。' }
          : row,
      ),
    );
  }, [ready]);
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    void bridge
      .subscribe((event) => {
        if (event.method === 'turn/started' && typeof event.params?.threadId === 'string') {
          const threadId = event.params.threadId;
          const turn = event.params.turn as { id?: string } | undefined;
          if (turn?.id) {
            commit((rows) =>
              rows.map((row) =>
                row.threadId === threadId && row.status === 'sending' && !row.turnId
                  ? { ...row, turnId: turn.id }
                  : row,
              ),
            );
          }
        }
        if (event.method === 'turn/completed' && typeof event.params?.threadId === 'string') {
          const threadId = event.params.threadId;
          const turn = event.params.turn as
            { id?: string; status?: string; error?: { message?: string } } | undefined;
          const sending = turn?.id
            ? itemsRef.current.find(
                (row) =>
                  row.threadId === threadId && row.status === 'sending' && row.turnId === turn.id,
              )
            : undefined;
          if (sending) {
            locks.current.delete(threadId);
            if (dispatching.current === sending.id) dispatching.current = null;
            commit((rows) =>
              settleQueuedMessage(rows, sending.id, {
                status: turn?.status ?? 'unknown',
                turnId: turn?.id,
                error: turn?.error?.message,
              }),
            );
          } else if (turn?.id) {
            const pending = itemsRef.current.find(
              (row) => row.threadId === threadId && row.status === 'sending' && !row.turnId,
            );
            if (pending) {
              if (completed.current.size >= 256) completed.current.clear();
              completed.current.set(pending.id, {
                turnId: turn.id,
                status: turn.status ?? 'unknown',
                error: turn.error?.message,
              });
            }
          } else {
            const pending = itemsRef.current.find(
              (row) => row.threadId === threadId && row.status === 'sending',
            );
            if (pending) {
              locks.current.delete(threadId);
              if (dispatching.current === pending.id) dispatching.current = null;
              commit((rows) =>
                settleQueuedMessage(rows, pending.id, {
                  status: 'unknown',
                  error: '完成事件缺少任务标识，请检查历史后重试。',
                }),
              );
            }
          }
          if (turn?.status !== 'completed')
            commit((rows) =>
              rows.map((row) =>
                row.threadId === threadId && row.status === 'waiting'
                  ? { ...row, status: 'paused', error: '任务已停止，请确认后继续发送。' }
                  : row,
              ),
            );
        }
        if (event.method === 'engine/disconnected') {
          locks.current.clear();
          dispatching.current = null;
          completed.current.clear();
          commit((rows) =>
            rows.map((row) =>
              row.status === 'paused'
                ? row
                : {
                    ...row,
                    status: 'failed',
                    error: '连接已断开，请确认执行状态后重试。',
                  },
            ),
          );
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else off = fn;
      })
      .catch((e) => report(String(e)));
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  function enqueue(
    threadId: string,
    text: string,
    selection: ModelSelection,
    attachments: Attachment[] = [],
  ) {
    if (!text.trim()) return false;
    if (itemsRef.current.length >= 50) {
      report('待发送消息已达 50 条，请先处理现有消息。');
      return false;
    }
    const next: QueuedMessage[] = [
      ...itemsRef.current,
      { id: crypto.randomUUID(), threadId, text, selection, attachments, status: 'waiting' },
    ];
    if (JSON.stringify(next).length > 2_000_000) {
      report('待发送内容过大，请减少附件或消息。');
      return false;
    }
    return commit(() => next);
  }
  useEffect(() => {
    if (!ready) return;
    const stopped = new Set(
      Object.entries(conversations)
        .filter(([id, conversation]) => {
          const turn = conversation.recoveredTurn;
          return turn && turn.status !== 'completed' && reconciled.current.get(id) !== turn.id;
        })
        .map(([id]) => id),
    );
    const recovered = itemsRef.current.filter((row) => {
      const turn = conversations[row.threadId]?.recoveredTurn;
      return row.status === 'sending' && turn && row.turnId === turn.id;
    });
    if (!recovered.length && !stopped.size) return;
    for (const row of recovered) {
      locks.current.delete(row.threadId);
      if (dispatching.current === row.id) dispatching.current = null;
    }
    const saved = commit((rows) =>
      recovered.reduce(
        (next, row) => {
          const turn = conversations[row.threadId].recoveredTurn!;
          return settleQueuedMessage(next, row.id, {
            turnId: turn.id,
            status: turn.status,
            error: turn.error,
          });
        },
        rows.map((row) =>
          stopped.has(row.threadId) && row.status === 'waiting'
            ? { ...row, status: 'paused' as const, error: '任务已停止，请确认后继续发送。' }
            : row,
        ),
      ),
    );
    if (saved) {
      for (const id of stopped) reconciled.current.set(id, conversations[id].recoveredTurn!.id);
      for (const id of reconciled.current.keys()) {
        if (!conversations[id]?.recoveredTurn) reconciled.current.delete(id);
      }
    }
  }, [conversations, ready, items]);
  useEffect(() => {
    if (!ready || dispatching.current !== null) return;
    const threads = new Set(items.map((row) => row.threadId));
    for (const threadId of threads) {
      const item = itemsRef.current.find((row) => row.threadId === threadId);
      if (
        !item ||
        item.status !== 'waiting' ||
        conversations[threadId]?.busy ||
        locks.current.has(threadId)
      )
        continue;
      locks.current.add(threadId);
      const sending = itemsRef.current.map((row) =>
        row.id === item.id ? { ...row, status: 'sending' as const } : row,
      );
      if (!commit(() => sending)) {
        locks.current.delete(threadId);
        return;
      }
      dispatching.current = item.id;
      void send(item)
        .then(({ turnId }) => {
          if (dispatching.current === item.id) dispatching.current = null;
          const active = itemsRef.current.find((row) => row.id === item.id);
          if (active?.status !== 'sending') return;
          const finished = completed.current.get(item.id);
          if (finished && finished.turnId === turnId) {
            completed.current.delete(item.id);
            locks.current.delete(threadId);
            commit((rows) =>
              settleQueuedMessage(rows, item.id, {
                status: finished.status,
                turnId,
                error: finished.error,
              }),
            );
          } else {
            commit((rows) => rows.map((row) => (row.id === item.id ? { ...row, turnId } : row)));
          }
        })
        .catch((e) => {
          if (dispatching.current === item.id) dispatching.current = null;
          const active = itemsRef.current.find((row) => row.id === item.id);
          const finished = completed.current.get(item.id);
          if (active?.status !== 'sending') return;
          if (finished) {
            completed.current.delete(item.id);
            locks.current.delete(threadId);
            commit((rows) => settleQueuedMessage(rows, item.id, finished));
            return;
          }
          if (active.turnId) return;
          locks.current.delete(threadId);
          commit((rows) =>
            settleQueuedMessage(rows, item.id, { status: 'unknown', error: String(e) }),
          );
        });
      break;
    }
  }, [items, conversations, ready]);
  async function steer(
    threadId: string,
    turnId: string,
    text: string,
    attachments: Attachment[] = [],
  ) {
    await bridge.rpc('turn/steer', {
      threadId,
      expectedTurnId: turnId,
      input: [
        { type: 'text', text, text_elements: [] },
        ...attachments.map((a) =>
          a.kind === 'image'
            ? { type: 'localImage', path: a.path }
            : { type: 'mention', path: a.path, name: a.name },
        ),
      ],
    });
  }
  return {
    items,
    enqueue,
    steer,
    pause: (threadId: string) =>
      commit((rows) =>
        rows.map((row) =>
          row.threadId === threadId && row.status === 'waiting'
            ? { ...row, status: 'paused', error: undefined }
            : row,
        ),
      ),
    remove: (id: string) =>
      commit((rows) => rows.filter((row) => row.id !== id || row.status === 'sending')),
    retry: (id: string) => {
      const item = itemsRef.current.find((row) => row.id === id);
      if (!item || item.status === 'sending') return false;
      if (conversations[item.threadId]?.busy || locks.current.has(item.threadId)) {
        report('任务仍在运行，请确认完成后再重试待发送消息。');
        return false;
      }
      return commit((rows) =>
        rows.map((row) =>
          row.id === id && row.status !== 'sending'
            ? { ...row, status: 'waiting', error: undefined }
            : row,
        ),
      );
    },
  };
}
