import { parseSession, type WorkspaceSession } from '../domain/workspaceSession';
import { readDurable, writeDurable } from './durableStorage';
const KEY = 'fluxcode.workspace.v1';
export const loadWorkspaceSession = () => readDurable(KEY, parseSession);
export function saveWorkspaceSession(session: WorkspaceSession): void {
  writeDurable(KEY, session, parseSession);
}
