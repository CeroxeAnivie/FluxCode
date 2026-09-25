import { parseQueue, type QueuedMessage } from '../domain/queuedMessage';
import { scheduleUiStateMirror } from './uiStateMirror';
const KEY = 'fluxcode.queue.v1';
export const loadQueue = () => parseQueue(localStorage.getItem(KEY));
export function saveQueue(items: QueuedMessage[]) {
  const value = JSON.stringify(items);
  if (value.length > 2_000_000) throw new Error('Queue storage limit exceeded');
  localStorage.setItem(KEY, value);
  scheduleUiStateMirror();
}
