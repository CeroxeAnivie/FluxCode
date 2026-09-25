import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { subscribeToResume } from './resumeSignals';

let documentEvents: EventTarget & { visibilityState: string };
let windowEvents: EventTarget;
beforeEach(() => {
  vi.useFakeTimers();
  documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  windowEvents = new EventTarget();
  vi.stubGlobal('document', documentEvents);
  vi.stubGlobal('window', windowEvents);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('notifies visible foreground signals and removes every subscription on disposal', () => {
  const notify = vi.fn();
  const dispose = subscribeToResume(notify);
  for (const name of ['focus', 'online']) windowEvents.dispatchEvent(new Event(name));
  documentEvents.dispatchEvent(new Event('visibilitychange'));
  expect(notify).toHaveBeenCalledTimes(3);
  dispose();
  windowEvents.dispatchEvent(new Event('focus'));
  windowEvents.dispatchEvent(new Event('online'));
  documentEvents.dispatchEvent(new Event('visibilitychange'));
  expect(notify).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not poll the engine during normal clock progression or while hidden', () => {
  const notify = vi.fn();
  const dispose = subscribeToResume(notify);
  vi.advanceTimersByTime(120_000);
  expect(notify).not.toHaveBeenCalled();
  documentEvents.visibilityState = 'hidden';
  windowEvents.dispatchEvent(new Event('focus'));
  windowEvents.dispatchEvent(new Event('online'));
  vi.setSystemTime(Date.now() + 120_000);
  vi.advanceTimersByTime(15_000);
  expect(notify).not.toHaveBeenCalled();
  documentEvents.visibilityState = 'visible';
  documentEvents.dispatchEvent(new Event('visibilitychange'));
  expect(notify).toHaveBeenCalledTimes(1);
  dispose();
});

it('detects a delayed timer after suspension without replaying the gap repeatedly', () => {
  const notify = vi.fn();
  const dispose = subscribeToResume(notify);
  vi.setSystemTime(Date.now() + 120_000);
  vi.advanceTimersByTime(15_000);
  expect(notify).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(60_000);
  expect(notify).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() - 120_000);
  vi.advanceTimersByTime(15_000);
  expect(notify).toHaveBeenCalledTimes(2);
  dispose();
});
