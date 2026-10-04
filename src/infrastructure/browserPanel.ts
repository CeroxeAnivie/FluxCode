import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { webLink } from '../domain/links';
import { redactDiagnostic } from '../domain/errors';
export const browserFailureEvent = 'fluxcode:browser-failure';
export function reportBrowserFailure(cause: unknown) {
  window.dispatchEvent(
    new CustomEvent(browserFailureEvent, { detail: redactDiagnostic(String(cause)) }),
  );
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type BrowserAction =
  | { kind: 'navigate'; url: string; bounds: BrowserBounds }
  | { kind: 'layout'; bounds: BrowserBounds; visible: boolean }
  | { kind: 'back' | 'forward' | 'reload' | 'close' };
export interface BrowserPageState {
  url?: string;
  loading: boolean;
  notice?: string;
}
export interface AgentBrowserRequest {
  id: string;
  action:
    | 'open'
    | 'read_page'
    | 'snapshot'
    | 'screenshot'
    | 'click'
    | 'fill'
    | 'press'
    | 'select_option'
    | 'set_checked'
    | 'hover'
    | 'scroll'
    | 'handle_dialog'
    | 'back'
    | 'forward'
    | 'reload'
    | 'close';
  url?: string;
}
export interface AgentBrowserState {
  active: boolean;
  paused: boolean;
  action?: AgentBrowserRequest['action'];
}
export interface BrowserTransport {
  controlAgent?(paused: boolean): Promise<void>;
  subscribeAgentState?(handler: (state: AgentBrowserState) => void): Promise<() => void>;
  command(action: BrowserAction): Promise<void>;
  subscribeAgent?(handler: (event: AgentBrowserRequest) => void): Promise<() => void>;
  completeAgent?(id: string, error: string | null): Promise<void>;
  subscribe(handler: (event: BrowserPageState) => void): Promise<() => void>;
}
declare global {
  interface Window {
    __FLUX_TEST_BROWSER__?: BrowserTransport;
  }
}

const native: BrowserTransport = {
  controlAgent: (paused) => invoke('browser_agent_control', { paused }),
  subscribeAgentState: (handler) =>
    listen<AgentBrowserState>('browser-agent-state', (event) => handler(event.payload)),
  subscribeAgent: (handler) =>
    listen<AgentBrowserRequest>('browser-agent-request', (event) => handler(event.payload)),
  completeAgent: (id, error) => invoke('complete_browser_agent_request', { id, error }),
  command: (action) => invoke('browser_command', { action }),
  subscribe: (handler) =>
    listen<BrowserPageState>('browser-state', (event) => handler(event.payload)),
};
function transport(): BrowserTransport {
  if (import.meta.env.MODE === 'test' && window.__FLUX_TEST_BROWSER__)
    return window.__FLUX_TEST_BROWSER__;
  return native;
}
export const browserAvailable = () =>
  isTauri() || (import.meta.env.MODE === 'test' && !!window.__FLUX_TEST_BROWSER__);

// Serialize native creation, layout and teardown, including React StrictMode remounts.
let commands: Promise<void> = Promise.resolve();
export function browserCommand(action: BrowserAction): Promise<void> {
  const pending = commands.then(() => transport().command(action));
  commands = pending.catch(() => {});
  return pending;
}
export const subscribeBrowser = (handler: (state: BrowserPageState) => void) =>
  transport().subscribe(handler);

const agentRequests = new Map<string, ReturnType<typeof setTimeout>>();
export const subscribeAgentBrowser = (handler: (event: AgentBrowserRequest) => void) =>
  transport().subscribeAgent?.((event) => {
    if (agentRequests.has(event.id)) return;
    if (agentRequests.size >= 16) {
      void transport()
        .completeAgent?.(event.id, 'Browser request limit exceeded')
        .catch(reportBrowserFailure);
      return;
    }
    agentRequests.set(
      event.id,
      setTimeout(() => completeAgentBrowser(event.id, 'Browser request expired'), 12000),
    );
    handler(event);
  }) ?? Promise.resolve(() => {});
export function completeAgentBrowser(id: string, error: string | null = null): void {
  const timer = agentRequests.get(id);
  if (timer === undefined) return;
  clearTimeout(timer);
  agentRequests.delete(id);
  void transport().completeAgent?.(id, error).catch(reportBrowserFailure);
}

// One browser surface per workspace window, shared by Markdown and the toolbar.
export interface BrowserRequest {
  agentRequestId?: string;
  agentControlled?: boolean;
  url: string;
  revision: number;
  origin: HTMLElement | null;
}
let request: BrowserRequest | null = null;
let revision = 0;
const listeners = new Set<() => void>();
export function requestBrowser(value = '', agentRequestId?: string) {
  const url = value ? webLink(value) : '';
  if (url === null) throw new Error('网页链接无效');
  if (request?.agentRequestId)
    completeAgentBrowser(request.agentRequestId, 'Navigation was superseded');
  request = {
    agentRequestId,
    agentControlled: !!agentRequestId,
    url,
    revision: ++revision,
    origin:
      request?.origin ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null),
  };
  listeners.forEach((listener) => listener());
}
export function markBrowserAgentControl(active: boolean) {
  if (!request || request.agentControlled === active) return;
  request = { ...request, agentControlled: active };
  listeners.forEach((listener) => listener());
}
export function dismissBrowser() {
  if (request?.agentRequestId) completeAgentBrowser(request.agentRequestId, 'Browser was closed');
  const origin = request?.origin;
  request = null;
  listeners.forEach((listener) => listener());
  requestAnimationFrame(() => {
    if (origin?.isConnected) origin.focus();
  });
}
export const getBrowserRequest = () => request;
export async function closeBrowserPanel(): Promise<void> {
  if (!request) return;
  if (browserAvailable()) await browserCommand({ kind: 'close' });
  dismissBrowser();
}
export function subscribeBrowserRequest(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let agentState: AgentBrowserState = { active: false, paused: false };
const agentListeners = new Set<() => void>();
export const getBrowserAgentState = () => agentState;
export function subscribeBrowserAgentState(listener: () => void) {
  agentListeners.add(listener);
  return () => {
    agentListeners.delete(listener);
  };
}
function updateAgentState(state: AgentBrowserState) {
  agentState = state;
  agentListeners.forEach((listener) => listener());
}
export const listenBrowserAgentState = () =>
  transport().subscribeAgentState?.(updateAgentState) ?? Promise.resolve(() => {});
export async function controlBrowserAgent(paused: boolean) {
  await transport().controlAgent?.(paused);
  updateAgentState({ active: false, paused });
  if (paused) markBrowserAgentControl(false);
}
