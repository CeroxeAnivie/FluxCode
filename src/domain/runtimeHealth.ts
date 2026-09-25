export const runtimeChecks = ['git', 'webview2', 'engine', 'codeModeHost', 'legal'] as const;
export type RuntimeCheck = (typeof runtimeChecks)[number];
export type RuntimeStatus = 'ready' | 'missing' | 'corrupt' | 'unreadable' | 'timeout' | 'failed';
export type RuntimeHealth = Record<RuntimeCheck, RuntimeStatus>;

export function parseResourceUsage(
  data: Record<string, unknown>,
): { tasks: number; terminals: number; windows: number; requests: number } | null {
  const engine = data.engineResources as Record<string, unknown> | null;
  const windows = data.windowResources as Record<string, unknown> | null;
  if (!engine || !windows) return null;
  const values = [
    engine.activeTurns,
    windows.terminalSessions,
    windows.openWorkspaceWindows,
    engine.pendingRequests,
  ];
  if (
    !values.every((value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  )
    return null;
  return {
    tasks: values[0] as number,
    terminals: values[1] as number,
    windows: values[2] as number,
    requests: values[3] as number,
  };
}

const statuses: RuntimeStatus[] = [
  'ready',
  'missing',
  'corrupt',
  'unreadable',
  'timeout',
  'failed',
];

export function parseRuntimeHealth(diagnostics: Record<string, unknown>): RuntimeHealth | null {
  const value = diagnostics.runtimeHealth;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (
    runtimeChecks.some(
      (name) => !statuses.includes((value as Record<string, unknown>)[name] as RuntimeStatus),
    )
  )
    return null;
  return Object.fromEntries(
    runtimeChecks.map((name) => [name, (value as Record<string, RuntimeStatus>)[name]]),
  ) as RuntimeHealth;
}
