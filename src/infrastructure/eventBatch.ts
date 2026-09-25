import type { RpcEvent } from '../domain/types';

const STREAMING_METHODS = new Set([
  'item/agentMessage/delta',
  'item/commandExecution/outputDelta',
  'item/reasoning/summaryTextDelta',
]);

/** Bound the renderer update rate without delaying lifecycle transitions. */
export function eventBatch(deliver: (events: RpcEvent[]) => void, delay = 32) {
  let pending: RpcEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  function flush() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!pending.length) return;
    const events = pending;
    pending = [];
    deliver(events);
  }
  return {
    push(event: RpcEvent) {
      pending.push(event);
      if (!STREAMING_METHODS.has(event.method) || pending.length >= 128) flush();
      else timer ??= setTimeout(flush, delay);
    },
    flush,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      pending = [];
      timer = undefined;
    },
  };
}
