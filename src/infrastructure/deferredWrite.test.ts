import { afterEach, expect, it, vi } from 'vitest';
import { deferredWrite } from './deferredWrite';
afterEach(() => vi.useRealTimers());
it('coalesces typing and flushes the latest value before navigation', () => {
  vi.useFakeTimers();
  const save = vi.fn();
  const writer = deferredWrite(save, vi.fn());
  writer.schedule('a');
  writer.schedule('ab');
  expect(save).not.toHaveBeenCalled();
  expect(writer.flush()).toBe(true);
  expect(save).toHaveBeenCalledExactlyOnceWith('ab');
  vi.runAllTimers();
  expect(save).toHaveBeenCalledTimes(1);
});
it('bounds latency during continuous typing and cancels obsolete drafts', () => {
  vi.useFakeTimers();
  const save = vi.fn();
  const writer = deferredWrite(save, vi.fn());
  for (let i = 0; i < 10; i++) {
    writer.schedule(i);
    vi.advanceTimersByTime(100);
  }
  expect(save).toHaveBeenCalledExactlyOnceWith(9);
  writer.schedule('obsolete');
  writer.cancel();
  vi.runAllTimers();
  expect(save).toHaveBeenCalledTimes(1);
});
it('retains failed writes for explicit retry without an infinite retry loop', () => {
  vi.useFakeTimers();
  const save = vi.fn().mockImplementationOnce(() => {
    throw new Error('quota');
  });
  const status = vi.fn();
  const writer = deferredWrite(save, status);
  writer.schedule('draft');
  vi.runAllTimers();
  expect(status).toHaveBeenLastCalledWith('failed', expect.any(Error));
  expect(save).toHaveBeenCalledTimes(1);
  expect(writer.flush()).toBe(true);
  expect(save).toHaveBeenLastCalledWith('draft');
});
