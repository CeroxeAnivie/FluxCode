import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAppearance } from '../application/AppearanceProvider';
import { useWorkspaceContinuity } from '../application/useWorkspaceContinuity';
import { useContextAttachments } from '../application/useContextAttachments';
import {
  initialWorkspaceProject,
  requestWorkspace,
  subscribeWorkspace,
  subscribeWorkspaceRefresh,
  focusMainWindow,
  openWorkspaceWindow,
} from '../infrastructure/workspaceWindows';
import { subscribeToResume } from '../infrastructure/resumeSignals';
import { allowWorkspaceNavigation } from '../infrastructure/navigationGuard';
import type { WorkspaceCommand, WorkspaceSnapshot } from '../domain/workspaceWindow';
import { emptyConversation } from '../domain/types';
import { TitleBar } from './TitleBar';
import { Conversation, Welcome } from './Conversation';
import { Composer } from './Composer';
import { Inspector } from './Inspector';
import { TerminalDock } from './TerminalDock';
import { ErrorNotice } from './ErrorNotice';
import { QueuedMessages } from './QueuedMessages';
import { AgentQuestionCard } from './AgentQuestionCard';
import { ElicitationCard } from './ElicitationCard';
import { BrowserPanel } from './BrowserPanel';
import { PanelResizeHandle } from './PanelResizeHandle';
import { Select } from './Select';
import { SharedWorkspaceNotice } from './SharedWorkspaceNotice';
import { sharedWorkspaceTasks } from '../domain/sharedWorkspace';
import { getBrowserRequest, subscribeBrowserRequest } from '../infrastructure/browserPanel';

/** A collaborative view; shared task mutations execute once in the main renderer. */
export function WorkspaceWindow() {
  const { t } = useAppearance();
  const browserRequest = useSyncExternalStore(
    subscribeBrowserRequest,
    getBrowserRequest,
    () => null,
  );
  const [error, setError] = useState('');
  const report = useCallback((message: string) => setError(message), []);
  const continuity = useWorkspaceContinuity(report);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [projectId, setProjectId] = useState(
    initialWorkspaceProject ?? continuity.initial.projectId ?? '',
  );
  const [taskId, setTaskId] = useState<string | null>(
    continuity.initial.projectId === initialWorkspaceProject ? continuity.initial.taskId : null,
  );
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>({});
  const [forms, setForms] = useState<Record<string, Record<string, unknown>>>({});
  const selected = useRef({ projectId, taskId });
  selected.current = { projectId, taskId };
  const epoch = useRef(0);
  const key = taskId ?? `new:${projectId}`;
  const attachments = useContextAttachments(key, report);
  const session = continuity.session;
  const project = snapshot?.catalog.projects.find((row) => row.id === projectId);
  const task = snapshot?.catalog.tasks.find((row) => row.id === taskId);
  const state = snapshot?.taskId === taskId ? snapshot.conversation : emptyConversation();
  const selection = session.selections[key] ??
    task?.selection ?? { model: snapshot?.settings.model ?? '', effort: 'off' as const };
  const text = session.drafts[key] ?? '';
  const toggle = (panel: keyof typeof session.panels) => {
    if (!allowWorkspaceNavigation()) return;
    continuity.setSession((current) => ({
      ...current,
      panels: { ...current.panels, [panel]: !current.panels[panel] },
    }));
  };
  const applySnapshot = (next: WorkspaceSnapshot) => {
    if (next.projectId === selected.current.projectId && next.taskId === selected.current.taskId)
      setSnapshot(next);
  };
  async function refresh(hydrate = false) {
    const generation = ++epoch.current;
    setLoading(true);
    try {
      const next = await requestWorkspace<WorkspaceSnapshot>({
        kind: hydrate ? 'hydrate' : 'snapshot',
        ...selected.current,
      });
      if (generation === epoch.current) {
        applySnapshot(next);
        setError('');
      }
    } catch (cause) {
      if (generation === epoch.current) setError(String(cause));
    } finally {
      if (generation === epoch.current) setLoading(false);
    }
  }
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    let stopRefresh: (() => void) | undefined;
    void subscribeWorkspace(applySnapshot)
      .then((off) => {
        if (disposed) off();
        else stop = off;
      })
      .catch((e) => setError(String(e)));
    void subscribeWorkspaceRefresh(() => void refresh(true))
      .then((off) => {
        if (disposed) off();
        else stopRefresh = off;
      })
      .catch((e) => setError(String(e)));
    const resume = subscribeToResume(() => void refresh(true));
    return () => {
      disposed = true;
      stop?.();
      stopRefresh?.();
      resume();
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    continuity.update({ projectId, taskId });
    void refresh(!!taskId);
  }, [projectId, taskId]);
  useEffect(() => {
    const questions = new Set(snapshot?.questions.map((row) => String(row.id)) ?? []);
    const elicitations = new Set(snapshot?.elicitations.map((row) => String(row.id)) ?? []);
    setAnswers((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => questions.has(id))),
    );
    setForms((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => elicitations.has(id))),
    );
  }, [snapshot?.questions, snapshot?.elicitations]);
  const setText = (value: string) =>
    continuity.setSession((current) => ({
      ...current,
      drafts: { ...current.drafts, [key]: value },
    }));
  async function submit(kind: 'send' | 'queue' | 'steer', text: string): Promise<boolean> {
    if (sendingRef.current) return false;
    sendingRef.current = true;
    setSending(true);
    setError('');
    let id = taskId;
    try {
      if (!id) {
        id = await requestWorkspace<string>({ kind: 'create', projectId, title: text, selection });
        attachments.transfer(id);
        const created = id;
        continuity.setSession((current) => ({
          ...current,
          taskId: created,
          drafts: { ...current.drafts, [key]: '', [created]: text },
          selections: { ...current.selections, [created]: selection },
        }));
        selected.current = { projectId, taskId: id };
        setTaskId(id);
      }
      await requestWorkspace({ kind, taskId: id, text, selection, attachments: attachments.items });
      const sent = id;
      continuity.setSession((current) => ({
        ...current,
        drafts: {
          ...current.drafts,
          [sent]: current.drafts[sent] === text ? '' : (current.drafts[sent] ?? ''),
        },
      }));
      attachments.clear(id);
      await refresh();
      return true;
    } catch (cause) {
      setError(String(cause));
      return false;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  function navigate(project: string, task: string | null) {
    if (sendingRef.current || !allowWorkspaceNavigation()) return;
    setProjectId(project);
    setTaskId(task);
  }
  const command = (value: WorkspaceCommand) => {
    void requestWorkspace(value)
      .then(() => refresh())
      .catch((cause) => setError(String(cause)));
  };
  return (
    <div className="app-shell workspace-window-shell">
      <TitleBar
        toggleSidebar={() => toggle('sidebar')}
        report={report}
        onNewWindow={() => void openWorkspaceWindow(projectId).catch((e) => setError(String(e)))}
      />
      <div className="workspace-window-body">
        {session.panels.sidebar && (
          <aside className="workspace-window-sidebar">
            <button onClick={() => navigate(projectId, null)} disabled={sending}>
              {t('新建任务')}
            </button>
            <button onClick={() => void focusMainWindow().catch((e) => setError(String(e)))}>
              {t('打开主窗口')}
            </button>
            <label>
              {t('项目')}
              <Select
                aria-label={t('项目')}
                value={projectId}
                onValueChange={(value) => navigate(value, null)}
              >
                {snapshot?.catalog.projects
                  .filter((p) => !p.closed && !p.imported)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </label>
            <nav aria-label={t('任务列表')}>
              {snapshot?.catalog.tasks
                .filter((row) => row.projectId === projectId && !row.archived)
                .map((row) => (
                  <button
                    key={row.id}
                    aria-current={row.id === taskId ? 'page' : undefined}
                    onClick={() => navigate(projectId, row.id)}
                    title={row.title}
                  >
                    {row.title}
                  </button>
                ))}
            </nav>
          </aside>
        )}
        <main className="workspace-window-main">
          <div className="workspace-window-toolbar">
            <strong>{task?.title ?? project?.name ?? t('工作区')}</strong>
            <button onClick={() => toggle('terminal')}>{t('切换终端')}</button>
            <button onClick={() => toggle('inspector')}>{t('切换文件面板')}</button>
            <button disabled={loading} onClick={() => void refresh(true)}>
              {t('刷新状态')}
            </button>
          </div>
          {error && (
            <div role="alert">
              <ErrorNotice message={error} />
            </div>
          )}
          {continuity.saveFailed && (
            <button onClick={() => continuity.retry()}>{t('重试保存草稿')}</button>
          )}
          <div className="workspace-window-conversation">
            {taskId ? (
              <Conversation
                key={taskId}
                state={state}
                loading={loading}
                projectRoot={project?.path}
                initialPosition={session.positions[taskId]}
                onPosition={(position) =>
                  continuity.setSession((current) => ({
                    ...current,
                    positions: { ...current.positions, [taskId]: position },
                  }))
                }
              />
            ) : (
              <Welcome project={project?.name} onSuggestion={setText} />
            )}
          </div>
          {snapshot && (
            <SharedWorkspaceNotice
              tasks={sharedWorkspaceTasks(
                snapshot.catalog,
                Object.fromEntries(
                  snapshot.runningTaskIds.map((id) => [id, { ...emptyConversation(), busy: true }]),
                ),
                projectId,
                taskId,
              )}
              onSelect={(id) => {
                const target = snapshot.catalog.tasks.find((task) => task.id === id);
                if (target) navigate(target.projectId, id);
              }}
              onInspect={() => {
                if (!session.panels.inspector) toggle('inspector');
              }}
            />
          )}
          <Composer
            project={project?.name}
            model={selection.model}
            models={snapshot?.models ?? []}
            selection={selection}
            onSelection={(value) =>
              continuity.setSession((current) => ({
                ...current,
                selections: { ...current.selections, [key]: value },
              }))
            }
            busy={state.busy}
            sending={sending}
            disabled={loading || !snapshot?.ready || !!task?.imported}
            text={text}
            onChange={setText}
            onSend={(value) => submit('send', value)}
            onQueue={(value) => submit('queue', value)}
            onSteer={(value) => submit('steer', value)}
            onStop={() => taskId && command({ kind: 'stop', taskId })}
            attachments={attachments.items}
            attachmentNotice={attachments.notice}
            onAttach={() => void attachments.choose()}
            onRemoveAttachment={attachments.remove}
            onChooseProject={() => void focusMainWindow()}
            onConfigureModel={() => void focusMainWindow()}
          />
          <QueuedMessages
            items={snapshot?.queue ?? []}
            busy={state.busy}
            onRemove={(id) => command({ kind: 'removeQueue', id })}
            onRetry={(id) => command({ kind: 'retryQueue', id })}
          />
          {snapshot?.questions.map((request) => (
            <AgentQuestionCard
              key={request.id}
              request={request}
              answers={answers[String(request.id)] ?? {}}
              onChange={(value) =>
                setAnswers((current) => ({ ...current, [String(request.id)]: value }))
              }
              onAnswer={async (value) => {
                await requestWorkspace({ kind: 'answer', id: request.id, answers: value });
                await refresh();
              }}
            />
          ))}
          {snapshot?.elicitations.map((request) => (
            <ElicitationCard
              key={request.id}
              request={request}
              answers={forms[String(request.id)] ?? {}}
              onChange={(value) =>
                setForms((current) => ({ ...current, [String(request.id)]: value }))
              }
              onAnswer={async (action, content) => {
                await requestWorkspace({ kind: 'elicitation', id: request.id, action, content });
                await refresh();
              }}
            />
          ))}
          <TerminalDock
            project={project}
            visible={session.panels.terminal}
            ready={!!snapshot?.ready}
            fontSize={snapshot?.fontSize ?? 14}
            onClose={() => toggle('terminal')}
            onExecuted={() => setRevision((value) => value + 1)}
          />
        </main>
        {session.panels.inspector && (
          <div style={{ display: browserRequest ? 'none' : 'contents' }}>
            <PanelResizeHandle panel="inspector" report={report} />
            <Inspector
              project={project}
              revision={revision}
              onClose={() => toggle('inspector')}
              onReference={(path, kind) => attachments.add(`${project!.path}/${path}`, kind)}
              onOpenWorkspace={(path) => {
                void requestWorkspace<string>({ kind: 'openProject', path, parentId: projectId })
                  .then((id) => navigate(id, null))
                  .catch((e) => setError(String(e)));
              }}
            />
          </div>
        )}
        <BrowserPanel />
      </div>
    </div>
  );
}
