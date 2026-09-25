import type { Catalog, Conversation, Settings } from './types';
import type { ModelSelection } from './modelSelection';
import type { Attachment } from './attachments';
import type { QueuedMessage } from './queuedMessage';
import type { AgentRequest } from './interaction';
import type { Elicitation } from './elicitation';

export interface WorkspaceSnapshot {
  projectId: string;
  taskId: string | null;
  catalog: Catalog;
  conversation: Conversation;
  settings: Settings;
  models: string[];
  ready: boolean;
  runningTaskIds: string[];
  fontSize: number;
  queue: QueuedMessage[];
  questions: AgentRequest[];
  elicitations: Elicitation[];
}
export type WorkspaceCommand =
  | { kind: 'openProject'; path: string; parentId: string }
  | { kind: 'answer'; id: string | number; answers: Record<string, string> }
  | {
      kind: 'elicitation';
      id: string | number;
      action: string;
      content: Record<string, unknown> | null;
    }
  | { kind: 'snapshot' | 'hydrate'; projectId: string; taskId: string | null }
  | { kind: 'create'; projectId: string; title: string; selection: ModelSelection }
  | {
      kind: 'send' | 'queue' | 'steer';
      taskId: string;
      text: string;
      selection: ModelSelection;
      attachments: Attachment[];
    }
  | { kind: 'stop'; taskId: string }
  | { kind: 'removeQueue' | 'retryQueue'; id: string };
