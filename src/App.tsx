const SchedulesDialog = lazy(() =>
  import('./components/SchedulesDialog').then((module) => ({ default: module.SchedulesDialog })),
);
const TaskActivityDialog = lazy(() =>
  import('./components/TaskActivityDialog').then((module) => ({
    default: module.TaskActivityDialog,
  })),
);
import { ErrorNotice } from './components/ErrorNotice';
import { useAppearance } from './application/AppearanceProvider';
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { useRef } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette })),
);
import {
  ChevronRight,
  Circle,
  FolderOpen,
  Globe,
  PanelRight,
  Settings2,
  Terminal,
  X,
} from 'lucide-react';
import { BrowserPanel } from './components/BrowserPanel';
import {
  getBrowserRequest,
  closeBrowserPanel,
  requestBrowser,
  subscribeBrowserRequest,
} from './infrastructure/browserPanel';
import { useFluxCode } from './application/useFluxCode';
import { emptyConversation } from './domain/types';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
const WorkspaceManager = lazy(() =>
  import('./components/WorkspaceManager').then((module) => ({ default: module.WorkspaceManager })),
);
import { PanelResizeHandle } from './components/PanelResizeHandle';
import { Composer } from './components/Composer';
import { SharedWorkspaceNotice } from './components/SharedWorkspaceNotice';
import { sharedWorkspaceTasks } from './domain/sharedWorkspace';
import { Conversation, Welcome } from './components/Conversation';
const SettingsDialog = lazy(() =>
  import('./components/SettingsDialog').then((module) => ({ default: module.SettingsDialog })),
);
const ChannelsDialog = lazy(() =>
  import('./components/ChannelsDialog').then((module) => ({ default: module.ChannelsDialog })),
);
import { sameProvider } from './domain/provider';
const Inspector = lazy(() =>
  import('./components/Inspector').then((module) => ({ default: module.Inspector })),
);
import { TerminalDock } from './components/TerminalDock';
import { useAgentInteraction } from './application/useAgentInteraction';
import { ElicitationCard } from './components/ElicitationCard';
import { AgentQuestionCard } from './components/AgentQuestionCard';
import { useTurnQueue } from './application/useTurnQueue';
import { useWorkspaceHost } from './application/useWorkspaceHost';
import { openWorkspaceWindow, windowsAvailable } from './infrastructure/workspaceWindows';
import { QueuedMessages } from './components/QueuedMessages';
import { useContextAttachments } from './application/useContextAttachments';
import { useAutomaticBackup } from './application/useAutomaticBackup';
import { UsageIndicator } from './components/UsageIndicator';
const CapabilitiesDialog = lazy(() =>
  import('./components/CapabilitiesDialog').then((module) => ({
    default: module.CapabilitiesDialog,
  })),
);
const ConversationSearchDialog = lazy(() =>
  import('./components/ConversationSearchDialog').then((module) => ({
    default: module.ConversationSearchDialog,
  })),
);
const ConversationImportDialog = lazy(() =>
  import('./components/ConversationImportDialog').then((module) => ({
    default: module.ConversationImportDialog,
  })),
);
import type { SearchHit } from './domain/conversationSearch';
import { shortcutBelongsToEditor } from './domain/keyboard';
import { routeDroppedItems } from './domain/dropRouting';
import { retryUiStateMirror, uiStorageErrorEvent } from './infrastructure/uiStateMirror';

export default function App({
  onStartupReady,
  onStartupFailure,
}: {
  onStartupReady?: () => void;
  onStartupFailure?: (message: string) => void;
} = {}) {
  const { t, loadError } = useAppearance();
  const app = useFluxCode();
  const [workspacesOpen, setWorkspacesOpen] = useState(false);
  const [nativeStorageFailed, setNativeStorageFailed] = useState(false);
  const [retryingStorage, setRetryingStorage] = useState(false);
  const browserRequest = useSyncExternalStore(
    subscribeBrowserRequest,
    getBrowserRequest,
    () => null,
  );
  useEffect(() => {
    const report = (event: Event) => {
      setNativeStorageFailed(true);
      app.setError((event as CustomEvent<string>).detail);
    };
    window.addEventListener(uiStorageErrorEvent, report);
    return () => window.removeEventListener(uiStorageErrorEvent, report);
  }, [app.setError]);
  useEffect(() => {
    const failure = loadError || app.startup.error;
    if (failure) onStartupFailure?.(failure);
    else if (app.startup.ready) onStartupReady?.();
  }, [app.startup.ready, app.startup.error, loadError, onStartupReady, onStartupFailure]);
  const interactions = useAgentInteraction(
    app.setError,
    app.connection === 'ready',
    app.conversations,
  );
  const queue = useTurnQueue(
    app.conversations,
    app.connection === 'ready',
    app.setError,
    app.sendQueued,
  );
  const context = useContextAttachments(
    app.selectedTaskId ?? `new:${app.selectedProjectId}`,
    app.setError,
  );
  useWorkspaceHost(app, queue, interactions);
  const [dragging, setDragging] = useState(false);
  const dropAction = useRef<(paths: string[]) => Promise<void>>(async () => {});
  dropAction.current = async (paths) => {
    if (document.querySelector('dialog[open]')) {
      app.setError(t('请先关闭对话框，再拖入附件。'));
      return;
    }
    const items = await bridge.inspectDroppedPaths(paths);
    const target = routeDroppedItems(items, !!app.selectedProjectId);
    if (target.projectPath) {
      await app.addProject(target.projectPath);
      return;
    }
    context.addMany(target.attachments);
  };
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'enter') setDragging(true);
        if (event.payload.type === 'leave' || event.payload.type === 'drop') setDragging(false);
        if (event.payload.type === 'drop') {
          void dropAction
            .current(event.payload.paths)
            .catch((cause) => app.setError(String(cause)));
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((cause) => app.setError(String(cause)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useAutomaticBackup(
    !app.sending && !Object.values(app.conversations).some((conversation) => conversation.busy),
    app.setError,
  );
  const { sidebar, inspector, terminal } = app.panels;
  const toggleInspector = async () => {
    if (browserRequest) {
      try {
        await closeBrowserPanel();
        if (!inspector) app.togglePanel('inspector');
      } catch {
        app.setError(t('浏览器操作未完成，请重试'));
      }
    } else app.togglePanel('inspector');
  };
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const channelButton = useRef<HTMLButtonElement>(null);
  const channelsReturnFocus = useRef<HTMLElement | null>(null);
  const openChannels = () => {
    const active = document.activeElement;
    channelsReturnFocus.current =
      active instanceof HTMLElement && !active.closest('dialog') ? active : channelButton.current;
    setChannelsOpen(true);
  };
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false);
  const [conversationImportOpen, setConversationImportOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<SearchHit | null>(null);
  const [channelsMounted, setChannelsMounted] = useState(false);
  useEffect(() => {
    if (channelsOpen) setChannelsMounted(true);
  }, [channelsOpen]);
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const project = app.catalog.projects.find((p) => p.id === app.selectedProjectId);
  const task = app.catalog.tasks.find((t) => t.id === app.selectedTaskId);
  const conversation = app.selectedTaskId
    ? (app.conversations[app.selectedTaskId] ?? emptyConversation())
    : emptyConversation();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.altKey ||
        e.repeat ||
        e.keyCode === 229 ||
        document.querySelector('dialog[open]') ||
        shortcutBelongsToEditor(e.target)
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandsOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        app.newTask();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        app.togglePanel('terminal');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [app.newTask]);
  return (
    <div className="app-shell">
      {dragging && (
        <div className="drop-overlay" role="status">
          {t(
            app.selectedProjectId ? '松开以添加文件或目录' : '松开以添加文件；单个目录可打开为项目',
          )}
        </div>
      )}
      <TitleBar
        toggleSidebar={() => app.togglePanel('sidebar')}
        report={app.setError}
        onNewWindow={
          windowsAvailable && app.selectedProjectId
            ? () => {
                void openWorkspaceWindow(app.selectedProjectId!).catch((error) =>
                  app.setError(String(error)),
                );
              }
            : undefined
        }
      />
      <div className={`app-body${browserRequest ? ' browser-open' : ''}`}>
        {sidebar && (
          <Sidebar
            app={app}
            onSettings={() => setSettingsOpen(true)}
            onChannels={openChannels}
            onSearchConversations={() => setConversationSearchOpen(true)}
            onImportConversations={() => setConversationImportOpen(true)}
            onManageWorkspaces={() => setWorkspacesOpen(true)}
          />
        )}
        {sidebar && <PanelResizeHandle panel="sidebar" report={app.setError} />}
        <main className="main-workspace">
          {app.configurationUpdates.message && (
            <div className="configuration-notice" role="status">
              <span>{t(app.configurationUpdates.message)}</span>
              <button onClick={() => void bridge.openUserFile('config').catch(app.setError)}>
                {t('打开配置文件')}
              </button>
              {app.configurationUpdates.failed && (
                <button onClick={app.configurationUpdates.retry}>{t('重试应用')}</button>
              )}
            </div>
          )}
          <header className="workspace-header">
            <div className="breadcrumbs">
              <button onClick={() => void app.addProject()} title={t('打开项目')}>
                <FolderOpen size={16} />
                {project?.imported ? t('导入的对话') : (project?.name ?? t('工作空间'))}
              </button>
              <ChevronRight size={13} />
              <span>{task?.title ?? t('新建任务')}</span>
            </div>
            <div className="workspace-actions">
              <button
                ref={channelButton}
                onClick={openChannels}
                title={t('切换渠道')}
                aria-label={t('切换渠道')}
              >
                {app.providerProfiles.find((p) => sameProvider(p.settings, app.settings))?.name ??
                  t('选择渠道')}
              </button>
              <button title="Ctrl K" onClick={() => setCommandsOpen(true)}>
                {t('命令面板')}
              </button>
              <button onClick={() => setSchedulesOpen(true)}>{t('定时任务')}</button>
              <button onClick={() => setActivityOpen(true)}>{t('任务总览')}</button>
              {task && !task.imported && (
                <button
                  disabled={
                    conversation.busy ||
                    app.sending ||
                    app.loadingTask ||
                    app.connection !== 'ready'
                  }
                  onClick={() => void app.review()}
                >
                  {t('审查变更')}
                </button>
              )}
              <button
                disabled={app.connection !== 'ready' || conversation.busy || app.sending}
                onClick={() => setCapabilitiesOpen(true)}
              >
                {t('模型与扩展')}
              </button>
              <button
                className={`icon-button ${terminal ? 'selected' : ''}`}
                title={t('终端 · Ctrl `')}
                aria-label={t('切换终端')}
                onClick={() => app.togglePanel('terminal')}
              >
                <Terminal size={17} />
              </button>
              <button
                className={`icon-button ${inspector && !browserRequest ? 'selected' : ''}`}
                title={t('文件与变更')}
                aria-label={t('切换文件面板')}
                onClick={() => void toggleInspector()}
              >
                <PanelRight size={17} />
              </button>
              <button
                className={`icon-button ${browserRequest ? 'selected' : ''}`}
                title={t('打开浏览器')}
                aria-label={t('打开浏览器')}
                onClick={() => {
                  if (!browserRequest) requestBrowser();
                }}
              >
                <Globe size={17} />
              </button>
            </div>
          </header>
          {!app.available && (
            <div className="preview-banner">
              {t('浏览器预览 · 本地文件和执行能力在桌面应用中启用')}
            </div>
          )}
          {app.error && (
            <div className="error-banner" role="alert">
              <ErrorNotice message={app.error} />
              {app.connection === 'offline' && (
                <button
                  className="reconnect-button"
                  onClick={() => {
                    void app.connect(app.settings);
                  }}
                >
                  {t('重新连接')}
                </button>
              )}
              <button
                className="icon-button"
                aria-label={t('关闭提示')}
                onClick={() => app.setError(null)}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="chat-area">
            {(app.workspaceSaveFailed || nativeStorageFailed) && (
              <div className="configuration-notice" role="alert">
                <span>{t('草稿仍保留在内存中，请重试保存或另存后再退出。')}</span>
                <button
                  disabled={retryingStorage}
                  onClick={() => {
                    if (!app.retryWorkspaceSave()) return;
                    setRetryingStorage(true);
                    void retryUiStateMirror()
                      .then(() => setNativeStorageFailed(false))
                      .catch((cause) => app.setError(String(cause)))
                      .finally(() => setRetryingStorage(false));
                  }}
                >
                  {t('重试保存草稿')}
                </button>
                <button
                  onClick={() =>
                    void app.exportDrafts().catch((error) => app.setError(String(error)))
                  }
                >
                  {t('另存全部草稿')}
                </button>
              </div>
            )}
            {task?.imported && (
              <div className="setup-next-step" role="status">
                {t('导入的历史仅供阅读和搜索，不能继续原引擎会话。')}
                <button onClick={app.newTask}>{t('新建任务')}</button>
              </div>
            )}
            {task ? (
              <Conversation
                key={task.id}
                jumpTarget={searchTarget?.taskId === task.id ? searchTarget.itemId : undefined}
                state={conversation}
                loading={app.loadingTask}
                projectRoot={project?.imported ? undefined : project?.path}
                initialPosition={app.positions[task.id]}
                onPosition={(top) => app.setPosition(task.id, top)}
              />
            ) : (
              <Welcome
                project={project?.imported ? t('导入的对话') : project?.name}
                onSuggestion={app.setDraft}
              />
            )}
            {!task?.imported && (!project || app.connection !== 'ready') && (
              <div className="setup-next-step" role="status">
                <span>
                  {t(
                    !project
                      ? '选择项目后开始任务，输入的内容会保留。'
                      : '连接模型渠道后即可发送，输入的内容会保留。',
                  )}
                </span>
                <button
                  onClick={() => {
                    if (!project) void app.addProject();
                    else openChannels();
                  }}
                >
                  {t(!project ? '选择项目' : '选择渠道')}
                </button>
              </div>
            )}
            {!task?.imported && !project?.imported && (
              <SharedWorkspaceNotice
                tasks={sharedWorkspaceTasks(
                  app.catalog,
                  app.conversations,
                  app.selectedProjectId,
                  app.selectedTaskId,
                )}
                onSelect={(id) => void app.selectTask(id)}
                onInspect={() => {
                  if (!inspector) app.togglePanel('inspector');
                  closeBrowserPanel();
                }}
              />
            )}
            {!task?.imported && !project?.imported && (
              <Composer
                onConfigureModel={!app.settings.model ? openChannels : undefined}
                onChooseProject={() => void app.addProject()}
                attachments={context.items}
                attachmentNotice={context.notice}
                onAttach={() => void context.choose()}
                onRemoveAttachment={context.remove}
                onQueue={(text) => {
                  const ok = app.selectedTaskId
                    ? queue.enqueue(app.selectedTaskId, text, app.selection, context.items)
                    : false;
                  if (ok) context.clear();
                  return ok;
                }}
                onSteer={async (text) => {
                  if (!app.selectedTaskId || !conversation.turnId) return false;
                  try {
                    await queue.steer(app.selectedTaskId, conversation.turnId, text, context.items);
                    context.clear();
                    return true;
                  } catch (e) {
                    app.setError(String(e));
                    return false;
                  }
                }}
                project={project?.imported ? t('导入的对话') : project?.name}
                model={app.selection.model}
                models={app.models}
                selection={app.selection}
                onSelection={app.setSelection}
                busy={conversation.busy}
                sending={app.sending}
                disabled={app.loadingTask}
                text={app.draft}
                onChange={app.setDraft}
                onSend={async (text) => {
                  let created: string | undefined;
                  const ok = await app.send(text, context.items, (id) => {
                    created = id;
                    context.transfer(id);
                  });
                  if (ok) context.clear(created);
                  return ok;
                }}
                onStop={() => {
                  if (app.selectedTaskId) queue.pause(app.selectedTaskId);
                  void app.stop();
                }}
              />
            )}
            <QueuedMessages
              items={queue.items.filter((item) => item.threadId === app.selectedTaskId)}
              busy={conversation.busy}
              onRemove={queue.remove}
              onRetry={queue.retry}
            />
            {interactions.elicitations
              .filter((r) => r.threadId === app.selectedTaskId)
              .map((request) => (
                <ElicitationCard
                  key={request.id}
                  request={request}
                  answers={interactions.elicitationAnswersFor(request.id)}
                  onChange={(answers) => interactions.updateElicitationAnswers(request.id, answers)}
                  onAnswer={(action, content) =>
                    interactions.answerElicitation(request.id, action, content)
                  }
                />
              ))}
            {interactions.requests
              .filter((r) => r.threadId === app.selectedTaskId)
              .map((request) => (
                <AgentQuestionCard
                  key={request.id}
                  request={request}
                  answers={interactions.answersFor(request.id)}
                  onChange={(answers) => interactions.updateAnswers(request.id, answers)}
                  onAnswer={(answers) => interactions.answer(request, answers)}
                />
              ))}
          </div>
          <TerminalDock
            project={project?.imported ? undefined : project}
            visible={terminal}
            ready={app.connection === 'ready'}
            fontSize={app.fontSize}
            onClose={() => app.togglePanel('terminal')}
            onExecuted={() => setRevision((v) => v + 1)}
          />
          <footer className="statusbar">
            <UsageIndicator
              pricing={app.settings.pricing}
              usage={conversation.usage}
              canCompact={
                !!task &&
                !conversation.busy &&
                !app.sending &&
                !app.loadingTask &&
                app.connection === 'ready'
              }
              onCompact={() => void app.compact()}
            />
            <span>
              <Circle
                size={7}
                fill="currentColor"
                className={app.connection === 'ready' ? 'green' : ''}
              />
              {app.connection === 'ready'
                ? t('就绪')
                : app.connection === 'connecting'
                  ? t('正在连接')
                  : t('未连接')}
              <span className="status-separator">/</span>
              {t('本地工作空间')}
            </span>
            <button onClick={openChannels}>
              <Settings2 size={12} />
              {app.selection.model || t('配置模型服务')}
            </button>
          </footer>
        </main>
        {inspector && !project?.imported && (
          <div style={{ display: browserRequest ? 'none' : 'contents' }}>
            <PanelResizeHandle panel="inspector" report={app.setError} />
            <Suspense fallback={null}>
              <Inspector
                onOpenWorkspace={(path) => void app.addProject(path, project?.id)}
                onReference={(path, kind) => context.add(`${project!.path}/${path}`, kind)}
                project={project}
                revision={app.revision + revision}
                onClose={() => app.togglePanel('inspector')}
              />
            </Suspense>
          </div>
        )}
        <BrowserPanel />
      </div>
      {commandsOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            onClose={() => setCommandsOpen(false)}
            tasks={app.catalog.tasks}
            onTask={(id) => {
              void app.selectTask(id);
            }}
            actions={[
              { id: 'new', label: t('新建任务'), shortcut: 'Ctrl N', run: app.newTask },
              {
                id: 'open',
                label: t('打开项目'),
                run: () => {
                  void app.addProject();
                },
              },
              {
                id: 'settings',
                label: t('工作空间设置'),
                shortcut: 'Ctrl ,',
                run: () => setSettingsOpen(true),
              },
              {
                id: 'terminal',
                label: t('切换终端'),
                shortcut: 'Ctrl `',
                run: () => app.togglePanel('terminal'),
              },
              {
                id: 'files',
                label: t('切换文件面板'),
                run: () => {
                  void toggleInspector();
                },
              },
              { id: 'schedules', label: t('定时任务'), run: () => setSchedulesOpen(true) },
              {
                id: 'reconnect',
                label: t('重新连接'),
                disabled:
                  app.connection === 'connecting' ||
                  Object.values(app.conversations).some((c) => c.busy),
                run: () => {
                  void app.connect(app.settings);
                },
              },
            ]}
          />
        </Suspense>
      )}
      <Suspense
        fallback={
          <div role="status" className="loading-overlay">
            {t('正在加载…')}
          </div>
        }
      >
        {schedulesOpen && (
          <SchedulesDialog
            project={project?.path}
            onClose={() => setSchedulesOpen(false)}
            onOpen={app.openScheduledTask}
          />
        )}
        {workspacesOpen && (
          <WorkspaceManager
            projects={app.catalog.projects}
            onRename={app.renameProject}
            onSelect={(id) => {
              if (!app.selectProject(id)) throw new Error('请先保存当前编辑，再切换工作区。');
            }}
            onCloseProject={(id) => {
              const tasks = app.catalog.tasks.filter((task) => task.projectId === id);
              if (tasks.some((task) => app.conversations[task.id]?.busy))
                throw new Error('请先停止此工作区中的运行任务。');
              for (const task of tasks) {
                if (
                  queue.items.some((item) => item.threadId === task.id && item.status === 'sending')
                )
                  throw new Error('请先停止此工作区中的运行任务。');
                if (
                  queue.items.some(
                    (item) => item.threadId === task.id && item.status === 'waiting',
                  ) &&
                  !queue.pause(task.id)
                )
                  throw new Error('待发送队列未能保存，请重试。');
              }
              app.closeProject(id);
            }}
            onClose={() => setWorkspacesOpen(false)}
          />
        )}
        {activityOpen && (
          <TaskActivityDialog
            catalog={app.catalog}
            conversations={app.conversations}
            queue={queue.items}
            waiting={
              new Set(
                [...interactions.requests, ...interactions.elicitations]
                  .map((request) => request.threadId)
                  .filter((id): id is string => !!id),
              )
            }
            onSelect={app.selectTask}
            onStop={async (id) => {
              queue.pause(id);
              await app.stopTask(id);
            }}
            onClose={() => setActivityOpen(false)}
          />
        )}
        {conversationSearchOpen && (
          <ConversationSearchDialog
            catalog={app.catalog}
            onClose={() => setConversationSearchOpen(false)}
            onHit={async (hit) => {
              if (!(await app.selectTask(hit.taskId)))
                throw new Error(t('无法打开匹配的任务，请检查连接后重试。'));
              setSearchTarget(hit);
              setConversationSearchOpen(false);
            }}
          />
        )}
        {conversationImportOpen && (
          <ConversationImportDialog
            catalog={app.catalog}
            onImport={app.importConversations}
            onClose={() => setConversationImportOpen(false)}
          />
        )}
        {settingsOpen && (
          <SettingsDialog
            hasUnsentDraft={app.hasUnsentDraft}
            busyWork={
              app.sending ||
              Object.values(app.conversations).some((conversation) => conversation.busy)
            }
            onChannels={() => {
              setSettingsOpen(false);
              openChannels();
            }}
            settingsRevision={app.configurationUpdates.snapshot?.settingsRevision}
            fontSize={app.fontSize}
            onFontSize={app.changeFontSize}
            initial={app.configurationUpdates.snapshot?.settings ?? app.settings}
            connecting={app.connection === 'connecting'}
            connectionError={app.error}
            onClose={() => setSettingsOpen(false)}
            onConnect={app.connect}
          />
        )}
        {(channelsOpen || channelsMounted) && (
          <Suspense
            fallback={
              <div role="status" className="loading-overlay">
                {t('正在加载…')}
              </div>
            }
          >
            <ChannelsDialog
              open={channelsOpen}
              returnFocus={channelsReturnFocus.current}
              connectionError={app.error}
              settings={app.settings}
              profiles={app.providerProfiles}
              onProfiles={app.setProviderProfiles}
              onConnect={(settings) => app.connect(settings, undefined, false, undefined, true)}
              connected={app.connection === 'ready'}
              locked={app.sending || Object.values(app.conversations).some((c) => c.busy)}
              onClose={() => setChannelsOpen(false)}
            />
          </Suspense>
        )}
        {capabilitiesOpen && (
          <CapabilitiesDialog
            cwd={project?.path}
            threadId={task?.id}
            onClose={() => setCapabilitiesOpen(false)}
            onModel={(model) => app.setSelection({ ...app.selection, model })}
          />
        )}
      </Suspense>
    </div>
  );
}
import { bridge } from './infrastructure/bridge';
