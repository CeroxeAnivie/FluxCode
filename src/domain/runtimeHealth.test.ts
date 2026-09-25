import { expect, it } from 'vitest';
import { parseRuntimeHealth, parseResourceUsage } from './runtimeHealth';

it('reports bounded resource counters and rejects malformed native values', () => {
  const data = {
    engineResources: { activeTurns: 2, pendingRequests: 3 },
    windowResources: { terminalSessions: 4, openWorkspaceWindows: 2 },
  };
  expect(parseResourceUsage(data)).toEqual({ tasks: 2, requests: 3, terminals: 4, windows: 2 });
  expect(parseResourceUsage({})).toBeNull();
  expect(
    parseResourceUsage({ ...data, engineResources: { activeTurns: -1, pendingRequests: 3 } }),
  ).toBeNull();
});

it('accepts known runtime statuses and ignores unrelated diagnostic fields', () => {
  expect(
    parseRuntimeHealth({
      schemaVersion: 1,
      runtimeHealth: {
        git: 'missing',
        webview2: 'ready',
        engine: 'corrupt',
        codeModeHost: 'unreadable',
        legal: 'timeout',
        secret: 'must-not-be-rendered',
      },
    }),
  ).toEqual({
    git: 'missing',
    webview2: 'ready',
    engine: 'corrupt',
    codeModeHost: 'unreadable',
    legal: 'timeout',
  });
});

it('rejects incomplete and unknown native diagnostic contracts', () => {
  expect(parseRuntimeHealth({ schemaVersion: 1 })).toBeNull();
  expect(parseRuntimeHealth({ runtimeHealth: { git: 'ready' } })).toBeNull();
  expect(
    parseRuntimeHealth({
      runtimeHealth: {
        git: 'ready',
        webview2: 'ready',
        engine: 'ready',
        codeModeHost: 'ready',
        legal: 'unsafe',
      },
    }),
  ).toBeNull();
});
