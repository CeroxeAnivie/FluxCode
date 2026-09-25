import { afterEach, expect, it, vi } from 'vitest';
import { eventBatch } from './eventBatch';
afterEach(() => vi.useRealTimers());
it('coalesces streaming updates and flushes in order before completion', () => {
  vi.useFakeTimers();
  const deliver = vi.fn();
  const batch = eventBatch(deliver);
  const delta = { method: 'item/agentMessage/delta', params: { delta: 'x' } };
  batch.push(delta);
  batch.push(delta);
  expect(deliver).not.toHaveBeenCalled();
  batch.push({ method: 'turn/completed' });
  expect(deliver.mock.calls[0][0]).toEqual([delta, delta, { method: 'turn/completed' }]);
  vi.advanceTimersByTime(100);
  expect(deliver).toHaveBeenCalledTimes(1);
});
it('flushes at the bounded capacity and cancels work on unmount', () => {
  vi.useFakeTimers();
  const deliver = vi.fn();
  const batch = eventBatch(deliver);
  for (let i = 0; i < 128; i++) batch.push({ method: 'item/agentMessage/delta' });
  expect(deliver).toHaveBeenCalledTimes(1);
  batch.push({ method: 'item/agentMessage/delta' });
  batch.dispose();
  vi.runAllTimers();
  expect(deliver).toHaveBeenCalledTimes(1);
});

it('batches actual command and reasoning deltas until the frame deadline', () => {
  vi.useFakeTimers();
  const deliver = vi.fn();
  const batch = eventBatch(deliver);
  const command = { method: 'item/commandExecution/outputDelta', params: { delta: 'build' } };
  const reasoning = { method: 'item/reasoning/summaryTextDelta', params: { delta: 'check' } };
  batch.push(command);
  batch.push(reasoning);
  vi.advanceTimersByTime(31);
  expect(deliver).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(deliver).toHaveBeenCalledExactlyOnceWith([command, reasoning]);
});

it('delivers completion after pending command output without waiting for the timer', () => {
  vi.useFakeTimers();
  const deliver = vi.fn();
  const batch = eventBatch(deliver);
  const output = { method: 'item/commandExecution/outputDelta', params: { delta: 'done' } };
  const completed = { method: 'item/completed' };
  batch.push(output);
  batch.push(completed);
  expect(deliver).toHaveBeenCalledExactlyOnceWith([output, completed]);
  vi.runAllTimers();
  expect(deliver).toHaveBeenCalledTimes(1);
});
