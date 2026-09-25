import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { WorkspaceCommand, WorkspaceSnapshot } from '../domain/workspaceWindow';

export const workspaceWindow = new URLSearchParams(window.location.search).get('workspace');
export const initialWorkspaceProject = new URLSearchParams(window.location.search).get('project');
export const isWorkspaceWindow = /^workspace-[1-8]$/.test(workspaceWindow ?? '');
export const windowsAvailable = isTauri();
export const openWorkspaceWindow = (projectId: string) =>
  invoke<string>('open_workspace_window', { projectId });
export const focusMainWindow = () => invoke('focus_main_window');
export const requestWorkspace = <T = unknown>(command: WorkspaceCommand) =>
  invoke<T>('workspace_request', { command });
export const subscribeWorkspace = (handler: (snapshot: WorkspaceSnapshot) => void) =>
  listen<WorkspaceSnapshot>('workspace-state', ({ payload }) => handler(payload));

export interface WorkspaceEnvelope {
  id: number;
  window: string;
  command: WorkspaceCommand;
}
export const subscribeWorkspaceCommands = (handler: (event: WorkspaceEnvelope) => void) =>
  listen<WorkspaceEnvelope>('workspace-command', ({ payload }) => handler(payload));
export const subscribeWorkspaceClosed = (handler: (label: string) => void) =>
  listen<string>('workspace-closed', ({ payload }) => handler(payload));
export const announceWorkspaceHost = () => invoke('workspace_host_ready');
export const subscribeWorkspaceRefresh = (handler: () => void) =>
  listen('workspace-refresh', handler);
export const completeWorkspaceRequest = (id: number, result: unknown, error?: string) =>
  invoke('complete_workspace_request', { id, result: result ?? null, error: error ?? null });
export const publishWorkspaceState = (
  publications: { window: string; snapshot: WorkspaceSnapshot }[],
) => invoke('publish_workspace_state', { publications });
