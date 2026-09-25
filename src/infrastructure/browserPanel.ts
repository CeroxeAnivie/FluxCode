import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { webLink } from '../domain/links';

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
export interface BrowserTransport {
  command(action: BrowserAction): Promise<void>;
  subscribe(handler: (event: BrowserPageState) => void): Promise<() => void>;
}
declare global {
  interface Window {
    __FLUX_TEST_BROWSER__?: BrowserTransport;
  }
}

const native: BrowserTransport = {
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

// One browser surface per workspace window, shared by Markdown and the toolbar.
export interface BrowserRequest {
  url: string;
  revision: number;
  origin: HTMLElement | null;
}
let request: BrowserRequest | null = null;
let revision = 0;
const listeners = new Set<() => void>();
export function requestBrowser(value = '') {
  const url = value ? webLink(value) : '';
  if (url === null) throw new Error('网页链接无效');
  request = {
    url,
    revision: ++revision,
    origin:
      request?.origin ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null),
  };
  listeners.forEach((listener) => listener());
}
export function dismissBrowser() {
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
