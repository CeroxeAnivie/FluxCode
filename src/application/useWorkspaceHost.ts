import { useEffect, useRef } from 'react';
import type { useFluxCode } from './useFluxCode';
import type { useTurnQueue } from './useTurnQueue';
import type { useAgentInteraction } from './useAgentInteraction';
import { emptyConversation } from '../domain/types';
import { isModelSelection } from '../domain/modelSelection';
import { validateAttachments } from '../domain/attachments';
import type { WorkspaceSnapshot, WorkspaceCommand } from '../domain/workspaceWindow';
import {
  windowsAvailable,
  subscribeWorkspaceCommands,
  subscribeWorkspaceClosed,
  completeWorkspaceRequest,
  publishWorkspaceState,
  announceWorkspaceHost,
} from '../infrastructure/workspaceWindows';

export function useWorkspaceHost(
  app: ReturnType<typeof useFluxCode>,
  queue: ReturnType<typeof useTurnQueue>,
  interactions: ReturnType<typeof useAgentInteraction>,
) {
  const current = useRef({ app, queue, interactions });
  current.current = { app, queue, interactions };
  const subscribers = useRef(new Map<string, { projectId: string; taskId: string | null }>());
  useEffect(() => {
    if (windowsAvailable && app.startup.ready)
      void announceWorkspaceHost().catch((error) => app.setError(String(error)));
  }, [app.startup.ready, app.connection]);
  function snapshot(target: { projectId: string; taskId: string | null }): WorkspaceSnapshot {
    const { app, queue, interactions } = current.current;
    return {
      ...target,
      catalog: app.catalog,
      conversation: target.taskId
        ? (app.conversations[target.taskId] ?? emptyConversation())
        : emptyConversation(),
      settings: app.settings,
      models: app.models,
      ready: app.connection === 'ready',
      runningTaskIds: Object.entries(app.conversations)
        .filter(([, value]) => value.busy)
        .map(([id]) => id),
      fontSize: app.fontSize,
      queue: queue.items.filter((row) => row.threadId === target.taskId),
      questions: interactions.requests.filter((row) => row.threadId === target.taskId),
      elicitations: interactions.elicitations.filter((row) => row.threadId === target.taskId),
    };
  }
  useEffect(() => {
    if (!windowsAvailable) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    let releaseOwner: (() => void) | undefined;
    async function execute(label: string, command: WorkspaceCommand): Promise<unknown> {
      const { app, queue, interactions } = current.current;
      if (!command || typeof command.kind !== 'string') throw new Error('窗口请求无效');
      if (command.kind === 'openProject') {
        const id = await app.addProject(command.path, command.parentId, false);
        if (!id) throw new Error('无法打开项目');
        return id;
      }
      if (command.kind === 'answer') {
        const request = interactions.requests.find((row) => row.id === command.id);
        if (!request) throw new Error('此问题已处理或已过期。');
        return interactions.answer(request, command.answers);
      }
      if (command.kind === 'elicitation')
        return interactions.answerElicitation(command.id, command.action, command.content);
      if (command.kind === 'snapshot' || command.kind === 'hydrate') {
        if (
          !app.catalog.projects.some(
            (project) => project.id === command.projectId && !project.imported,
          )
        )
          throw new Error('项目不存在');
        if (
          command.taskId &&
          !app.catalog.tasks.some(
            (task) => task.id === command.taskId && task.projectId === command.projectId,
          )
        )
          throw new Error('任务不存在');
        subscribers.current.set(label, { projectId: command.projectId, taskId: command.taskId });
        if (!releaseOwner && navigator.locks) {
          const held = new Promise<void>((resolve) => {
            releaseOwner = resolve;
          });
          void navigator.locks
            .request('fluxcode-workspace-owner', () => held)
            .catch((error) => current.current.app.setError(String(error)));
        }
        if (command.kind === 'hydrate' && command.taskId)
          await app.hydrateForWindow(command.taskId);
        return snapshot(command);
      }
      if (command.kind === 'create') {
        if (!isModelSelection(command.selection)) throw new Error('模型选择无效');
        return app.createWindowTask(command.projectId, command.title, command.selection);
      }
      if (command.kind === 'stop') return app.stopTask(command.taskId);
      if (command.kind === 'removeQueue') return queue.remove(command.id);
      if (command.kind === 'retryQueue') return queue.retry(command.id);
      if (command.kind === 'send' || command.kind === 'queue' || command.kind === 'steer') {
        if (
          typeof command.text !== 'string' ||
          !command.text.trim() ||
          command.text.length > 100_000 ||
          !isModelSelection(command.selection)
        )
          throw new Error('发送内容无效');
        validateAttachments(command.attachments);
        if (command.kind === 'queue') {
          if (!queue.enqueue(command.taskId, command.text, command.selection, command.attachments))
            throw new Error('待发送消息保存失败，请检查主窗口。');
          return true;
        }
        if (command.kind === 'steer') {
          const turnId = app.conversations[command.taskId]?.turnId;
          if (!turnId) throw new Error('任务已结束，请重新发送。');
          await queue.steer(command.taskId, turnId, command.text, command.attachments);
          return true;
        }
        return app.sendQueued({
          id: crypto.randomUUID(),
          threadId: command.taskId,
          text: command.text,
          selection: command.selection,
          attachments: command.attachments,
          status: 'waiting',
        });
      }
      throw new Error('窗口操作不受支持');
    }
    void Promise.all([
      subscribeWorkspaceCommands((event) => {
        void execute(event.window, event.command)
          .then(
            (result) => completeWorkspaceRequest(event.id, result),
            (error) => completeWorkspaceRequest(event.id, null, String(error)),
          )
          .catch((error) => current.current.app.setError(String(error)));
      }),
      subscribeWorkspaceClosed((label) => {
        subscribers.current.delete(label);
        if (!subscribers.current.size) {
          releaseOwner?.();
          releaseOwner = undefined;
        }
      }),
    ])
      .then((stops) => {
        if (disposed) stops.forEach((stop) => stop());
        else cleanups.push(...stops);
      })
      .catch((error) => current.current.app.setError(String(error)));
    return () => {
      disposed = true;
      releaseOwner?.();
      cleanups.forEach((stop) => stop());
    };
  }, []);
  useEffect(() => {
    if (!windowsAvailable || !subscribers.current.size) return;
    const timer = window.setTimeout(() => {
      void publishWorkspaceState(
        Array.from(subscribers.current, ([window, target]) => ({
          window,
          snapshot: snapshot(target),
        })),
      ).catch((error) => current.current.app.setError(String(error)));
    }, 40);
    return () => clearTimeout(timer);
  }, [
    app.catalog,
    app.conversations,
    app.connection,
    app.settings,
    app.models,
    app.fontSize,
    queue.items,
    interactions.requests,
    interactions.elicitations,
  ]);
}
