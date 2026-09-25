import { eventBatch } from '../infrastructure/eventBatch';
import { subscribeToResume } from '../infrastructure/resumeSignals';
import {
  allowWorkspaceNavigation,
  guardWorkspaceNavigation,
} from '../infrastructure/navigationGuard';
import { providerModels, sameProvider, type ProviderProfile } from '../domain/provider';
import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultSettings, emptyConversation, validateSettings } from '../domain/types';
import type { Catalog, Conversation, Project, RpcEvent, Settings } from '../domain/types';
import { reduceEvent } from '../domain/conversation';
import { recoverFinishedTurn } from '../domain/turnRecovery';
import type { ThreadTurnsListResponse } from '../generated/codex/v2/ThreadTurnsListResponse';
import { bridge } from '../infrastructure/bridge';
import { emptyCatalog, loadCatalog, saveCatalog } from '../infrastructure/catalog';
import { resumeThread, startThread, startTurn } from '../infrastructure/codex';
import { isModelSelection } from '../domain/modelSelection';
import type { ModelSelection } from '../domain/modelSelection';
import { useWorkspaceContinuity } from './useWorkspaceContinuity';
import { useConfigurationUpdates } from './useConfigurationUpdates';
import type { Schedule } from '../domain/schedules';
import { exportTask as serializeTask } from '../domain/taskExport';
import type { QueuedMessage } from '../domain/queuedMessage';
import type { Attachment } from '../domain/attachments';
import { planTaskImport } from '../domain/taskImport';
import {
  loadImportedHistory,
  removeImportedHistory,
  saveImportedHistory,
} from '../infrastructure/importedHistory';

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function useFluxCode() {
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog);
  const [catalogSaveFailed, setCatalogSaveFailed] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>([]);
  const [connection, setConnection] = useState<'offline' | 'connecting' | 'ready'>('offline');
  const [error, setError] = useState<string | null>(null);
  const continuity = useWorkspaceContinuity(setError);
  const [startup, setStartup] = useState<{ ready: boolean; error: string | null }>({
    ready: false,
    error: null,
  });
  const initialSession = continuity.initial;
  const restoreTask = useRef(initialSession.taskId);
  const [sessionReady, setSessionReady] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Record<string, Conversation>>({});
  const [loadingTask, setLoadingTask] = useState(false);
  const [sending, setSending] = useState(false);
  const [drafts, setDrafts] = useState(initialSession.drafts);
  const [draftSelections, setDraftSelections] = useState(initialSession.selections);
  const [revision, setRevision] = useState(0);
  const [fontSize, setFontSize] = useState(14);
  const loaded = useRef(new Set<string>());
  const engineGeneration = useRef(0);
  const hydration = useRef(new Map<string, RpcEvent[]>());
  const resuming = useRef(
    new Map<string, Promise<Conversation & { selection?: ModelSelection }>>(),
  );
  const sendLock = useRef(false);
  const connectLock = useRef(false);
  const selectionEpoch = useRef(0);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const importLock = useRef(false);

  const markDisconnected = useCallback((message: string) => {
    engineGeneration.current++;
    resuming.current.clear();
    hydration.current.clear();
    loaded.current.clear();
    setConnection('offline');
    setConversations((current) => {
      const next = Object.fromEntries(
        Object.entries(current).map(([id, conversation]) => [
          id,
          {
            ...conversation,
            busy: false,
            turnId: null,
            error: conversation.busy ? '连接已断开，请确认执行状态后重试。' : conversation.error,
          },
        ]),
      );
      conversationsRef.current = next;
      return next;
    });
    setError(message);
  }, []);

  const updateCatalog = useCallback((fn: (c: Catalog) => Catalog) => {
    const next = fn(catalogRef.current);
    try {
      saveCatalog(next);
      queueMicrotask(() => setCatalogSaveFailed(false));
    } catch {
      queueMicrotask(() => {
        setCatalogSaveFailed(true);
        setError('项目索引保存失败，请检查磁盘空间。');
      });
    }
    catalogRef.current = next;
    setCatalog(next);
  }, []);

  function retryCatalogSave() {
    try {
      saveCatalog(catalogRef.current);
      setCatalogSaveFailed(false);
      return true;
    } catch {
      setCatalogSaveFailed(true);
      return false;
    }
  }
  useEffect(() => {
    if (!catalogSaveFailed) return;
    const unguard = guardWorkspaceNavigation(retryCatalogSave);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!retryCatalogSave()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      unguard();
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [catalogSaveFailed]);

  useEffect(() => {
    let localError = continuity.loadError;
    try {
      const c = loadCatalog();
      setCatalog(c);
      const previous = initialSession;
      const task = c.tasks.find(
        (t) =>
          t.id === previous.taskId &&
          !t.archived &&
          !c.projects.find((p) => p.id === t.projectId)?.closed,
      );
      setSelectedProjectId(
        task?.projectId ??
          c.projects.find((p) => p.id === previous.projectId && !p.closed)?.id ??
          c.projects.find((p) => !p.closed)?.id ??
          null,
      );
      setSelectedTaskId(task?.id ?? null);
      restoreTask.current = task?.id ?? null;
      setSessionReady(true);
    } catch (e) {
      localError = errorText(e);
      setError(localError);
      setStartup({ ready: false, error: localError });
    }
    let disposed = false;
    const batch = eventBatch((events) => {
      setConversations((current) => {
        const next = { ...current };
        for (const event of events) {
          const id = event.params?.threadId;
          if (typeof id === 'string')
            next[id] = reduceEvent(next[id] ?? emptyConversation(), event);
        }
        conversationsRef.current = next;
        return next;
      });
    });
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      unsubscribe = await bridge.subscribe((event) => {
        if (event.method === 'engine/disconnected') {
          batch.flush();
          markDisconnected('执行引擎已断开。重新连接后可恢复任务。');
          return;
        }
        if (event.method === 'engine/unsupportedRequest') {
          setError('引擎请求了尚未支持的交互工具。请在对话中提供信息后继续。');
          return;
        }
        const threadId = event.params?.threadId;
        if (typeof threadId !== 'string') return;
        hydration.current.get(threadId)?.push(event);
        batch.push(event);
        if (event.method === 'turn/completed') setRevision((v) => v + 1);
      });
      if (disposed) {
        unsubscribe();
        return;
      }
      const saved = await bridge.loadSettings();
      if (!disposed) setSettings(saved);
      try {
        const profiles = await bridge.listProviderProfiles();
        if (!disposed) setProviderProfiles(profiles);
      } catch (e) {
        if (!disposed) {
          localError ??= errorText(e);
          setError(errorText(e));
        }
      }
      const ui = await bridge.loadPreferences();
      if (!disposed) {
        setFontSize(ui.font_size);
        document.documentElement.style.setProperty('--font-size', `${ui.font_size}px`);
        document.documentElement.style.setProperty('--sidebar-width', `${ui.sidebar_width}px`);
        document.documentElement.style.setProperty('--inspector-width', `${ui.inspector_width}px`);
        setStartup({ ready: !localError, error: localError });
      }
      if (!disposed && bridge.available && !validateSettings(saved)) {
        connectLock.current = true;
        setConnection('connecting');
        try {
          await bridge.connect(saved);
          if (!disposed) setConnection('ready');
        } catch (e) {
          if (!disposed) {
            setConnection('offline');
            setError(errorText(e));
          }
        } finally {
          connectLock.current = false;
        }
      }
    })().catch((e) => {
      if (!disposed) {
        const message = errorText(e);
        setError(message);
        setStartup({ ready: false, error: message });
      }
    });
    return () => {
      disposed = true;
      unsubscribe?.();
      batch.dispose();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let probing = false;
    const onResume = () => {
      if (document.visibilityState !== 'visible' || connection !== 'ready' || probing) return;
      probing = true;
      const generation = engineGeneration.current;
      void bridge
        .rpc('thread/list', { limit: 1 })
        .then(async () => {
          const active = Object.entries(conversationsRef.current).filter(
            ([, c]) => c.busy && c.turnId,
          );
          // Read only: never restart a turn whose execution outcome is uncertain.
          for (const [threadId, before] of active) {
            if (disposed || generation !== engineGeneration.current) return;
            try {
              const snapshot = await bridge.rpc<ThreadTurnsListResponse>('thread/turns/list', {
                threadId,
                limit: 20,
                sortDirection: 'desc',
                itemsView: 'full',
              });
              const turn = snapshot.data.find((candidate) => candidate.id === before.turnId);
              if (!turn || disposed || generation !== engineGeneration.current) continue;
              setConversations((current) => {
                if (disposed || generation !== engineGeneration.current || !current[threadId])
                  return current;
                const recovered = recoverFinishedTurn(current[threadId], turn);
                if (recovered === current[threadId]) return current;
                const next = { ...current, [threadId]: recovered };
                conversationsRef.current = next;
                return next;
              });
            } catch (cause) {
              if (!disposed && generation === engineGeneration.current) setError(errorText(cause));
            }
          }
        })
        .catch((cause) => {
          if (disposed || generation !== engineGeneration.current) return;
          markDisconnected(`系统从睡眠或后台恢复后连接不可用：${errorText(cause)}`);
        })
        .finally(() => {
          probing = false;
        });
    };
    const unsubscribe = subscribeToResume(onResume);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [connection, markDisconnected]);

  async function connect(
    next: Settings,
    apiKey?: string,
    rememberKey = false,
    expectedRevision?: number,
    forceReconnect = false,
  ): Promise<boolean> {
    const invalid = validateSettings(next);
    if (invalid) {
      setError(invalid);
      return false;
    }
    if (connectLock.current) return false;
    if (Object.values(conversationsRef.current).some((c) => c.busy) || sendLock.current) {
      setError('请先停止正在运行的任务，再修改连接。');
      return false;
    }
    connectLock.current = true;
    const wasReady = connection === 'ready';
    setConnection('connecting');
    setError(null);
    try {
      await bridge.connect(next, apiKey, rememberKey, expectedRevision, forceReconnect);
      engineGeneration.current++;
      resuming.current.clear();
      hydration.current.clear();
      loaded.current.clear();
      setSettings(next);
      restoreTask.current = selectedTaskId;
      setConnection('ready');
      return true;
    } catch (e) {
      setConnection(wasReady ? 'ready' : 'offline');
      setError(errorText(e));
      return false;
    } finally {
      connectLock.current = false;
    }
  }

  const configurationUpdates = useConfigurationUpdates(
    settings,
    connection === 'ready',
    sending || Object.values(conversations).some((c) => c.busy),
    (settings, revision) => connect(settings, undefined, false, revision),
    setFontSize,
  );

  async function addProject(givenPath?: string, worktreeParentId?: string, select = true) {
    try {
      const path = givenPath ?? (await bridge.chooseDirectory());
      if (!path) return;
      const pathKey = (value: string) =>
        value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      const existing = catalog.projects.find((p) => pathKey(p.path) === pathKey(path));
      const project: Project = existing ?? {
        id: crypto.randomUUID(),
        worktreeParentId,
        name:
          path
            .replace(/[/\\]+$/, '')
            .split(/[/\\]/)
            .at(-1) || path,
        path,
      };
      if (!existing) updateCatalog((c) => ({ ...c, projects: [...c.projects, project] }));
      if (select) selectProject(project.id);
      return project.id;
    } catch (e) {
      setError(errorText(e));
    }
  }

  function selectProject(id: string) {
    if (!allowWorkspaceNavigation() || sendLock.current) return false;
    if (catalogRef.current.projects.some((p) => p.id === id && p.closed))
      updateCatalog((c) => ({
        ...c,
        projects: c.projects.map((p) => (p.id === id ? { ...p, closed: false } : p)),
      }));
    if (!selectedProjectId && !selectedTaskId) {
      setDrafts((current) => {
        const unassigned = current['new:null'];
        if (!unassigned) return current;
        const target = `new:${id}`;
        return {
          ...current,
          [target]: [current[target], unassigned].filter(Boolean).join('\n\n'),
          'new:null': '',
        };
      });
    }
    selectionEpoch.current++;
    restoreTask.current = null;
    setSelectedProjectId(id);
    setSelectedTaskId(null);
    setLoadingTask(false);
    return true;
  }

  function renameProject(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) throw new Error('工作区名称须为 1 到 100 个字符。');
    updateCatalog((c) => ({
      ...c,
      projects: c.projects.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
    }));
  }

  function closeProject(id: string) {
    if (
      sendLock.current ||
      catalogRef.current.tasks.some(
        (task) => task.projectId === id && conversationsRef.current[task.id]?.busy,
      )
    )
      throw new Error('请先停止此工作区中的运行任务。');
    if (!allowWorkspaceNavigation()) throw new Error('请先保存当前编辑，再关闭工作区。');
    updateCatalog((c) => ({
      ...c,
      projects: c.projects.map((p) => (p.id === id ? { ...p, closed: true } : p)),
    }));
    if (selectedProjectId === id) {
      selectionEpoch.current++;
      restoreTask.current = null;
      setSelectedTaskId(null);
      setSelectedProjectId(
        catalogRef.current.projects.find((p) => p.id !== id && !p.closed)?.id ?? null,
      );
      setLoadingTask(false);
    }
  }

  function newTask() {
    if (!allowWorkspaceNavigation()) return;
    if (sendLock.current) return;
    selectionEpoch.current++;
    restoreTask.current = null;
    setSelectedTaskId(null);
    if (catalog.projects.find((project) => project.id === selectedProjectId)?.imported)
      setSelectedProjectId(
        catalog.projects.find((project) => !project.imported && !project.closed)?.id ?? null,
      );
    if (!drafts[`new:${selectedProjectId}`]?.trim())
      setDraftSelections((current) => {
        const next = { ...current };
        const key = `new:${selectedProjectId}:${settings.baseUrl}:${settings.apiKeyEnv}`;
        next[key] = { model: current[key]?.model ?? settings.model, effort: 'off' };
        return next;
      });
    setLoadingTask(false);
    setError(null);
  }

  async function hydrate(id: string): Promise<Conversation & { selection?: ModelSelection }> {
    if (catalogRef.current.tasks.some((task) => task.id === id && task.imported)) {
      const imported = await loadImportedHistory(id);
      conversationsRef.current = { ...conversationsRef.current, [id]: imported };
      setConversations((current) => ({ ...current, [id]: imported }));
      loaded.current.add(id);
      return imported;
    }
    const existing = resuming.current.get(id);
    if (existing) return existing;
    hydration.current.set(id, []);
    const generation = engineGeneration.current;
    const pending = resumeThread(id)
      .then((restored) => {
        if (generation !== engineGeneration.current)
          throw new Error('连接已变化，请重新打开任务。');
        const next = (hydration.current.get(id) ?? []).reduce(reduceEvent, restored);
        conversationsRef.current = { ...conversationsRef.current, [id]: next };
        setConversations((current) => ({ ...current, [id]: next }));
        loaded.current.add(id);
        return { ...next, selection: restored.selection };
      })
      .finally(() => {
        if (resuming.current.get(id) === pending) {
          hydration.current.delete(id);
          resuming.current.delete(id);
        }
      });
    resuming.current.set(id, pending);
    return pending;
  }

  async function selectTask(id: string) {
    if (!allowWorkspaceNavigation()) return false;
    if (sendLock.current) return false;
    const task = catalog.tasks.find((t) => t.id === id);
    if (!task) return false;
    if (catalog.projects.some((p) => p.id === task.projectId && p.closed))
      updateCatalog((c) => ({
        ...c,
        projects: c.projects.map((p) => (p.id === task.projectId ? { ...p, closed: false } : p)),
      }));
    const epoch = ++selectionEpoch.current;
    setSelectedProjectId(task.projectId);
    setSelectedTaskId(id);
    if (loaded.current.has(id)) {
      setLoadingTask(false);
      return true;
    }
    if (connection !== 'ready' && !task.imported) {
      setError((current) => current ?? '请先连接模型服务，再恢复历史任务。');
      return false;
    }
    setLoadingTask(true);
    try {
      const conversation = await hydrate(id);
      if (!task.imported && !task.selection) {
        const restoredSelection = conversation.selection ?? {
          model: settings.model,
          effort: 'off' as const,
        };
        updateCatalog((c) => ({
          ...c,
          tasks: c.tasks.map((t) =>
            t.id === id && !t.selection ? { ...t, selection: restoredSelection } : t,
          ),
        }));
      }
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      if (epoch === selectionEpoch.current) setLoadingTask(false);
    }
  }

  async function send(
    message: string,
    attachments: Attachment[] = [],
    onCreated?: (id: string) => void,
  ): Promise<boolean> {
    if (sendLock.current || loadingTask || !message.trim()) return false;
    const project = catalog.projects.find((p) => p.id === selectedProjectId);
    if (!project) {
      setError('请先打开一个项目文件夹。');
      return false;
    }
    if (
      project.imported ||
      (selectedTaskId && catalog.tasks.some((task) => task.id === selectedTaskId && task.imported))
    ) {
      setError('导入的历史仅供阅读和搜索，请打开真实项目开始新任务。');
      return false;
    }
    if (connection !== 'ready') {
      setError('请先选择或导入模型渠道。');
      return false;
    }
    if (selectedTaskId && conversationsRef.current[selectedTaskId]?.busy) return false;
    sendLock.current = true;
    setSending(true);
    setError(null);
    let id = selectedTaskId;
    let turnSelection = selection;
    const originDraftKey = selectedTaskId ?? `new:${project.id}`;
    try {
      if (!id) {
        id = await startThread(project.path, { ...settings, model: selection.model });
        const taskId = id;
        updateCatalog((c) => ({
          ...c,
          tasks: [
            {
              id: taskId,
              projectId: project.id,
              title: message.trim().slice(0, 52),
              updatedAt: Date.now(),
              archived: false,
              selection,
            },
            ...c.tasks,
          ],
        }));
        setSelectedTaskId(id);
        onCreated?.(id);
        setDrafts((d) => ({ ...d, [taskId]: message, [originDraftKey]: '' }));
        setDraftSelections((d) => {
          const next = { ...d };
          delete next[originDraftKey];
          return next;
        });
        loaded.current.add(id);
      } else if (!loaded.current.has(id)) {
        const restored = await hydrate(id);
        if (!catalog.tasks.find((t) => t.id === id)?.selection) {
          turnSelection = restored.selection ?? selection;
          const recovered = turnSelection;
          updateCatalog((c) => ({
            ...c,
            tasks: c.tasks.map((t) => (t.id === id ? { ...t, selection: recovered } : t)),
          }));
        }
        if (restored.busy) throw new Error('任务忙碌，请稍后重试。');
      }
      const taskId = id;
      setConversations((c) => ({
        ...c,
        [taskId]: {
          ...(c[taskId] ?? emptyConversation()),
          activeModel: turnSelection.model,
          busy: true,
          error: null,
        },
      }));
      const result = await startTurn(id, message, turnSelection, attachments);
      setConversations((c) => ({
        ...c,
        [taskId]: {
          ...(c[taskId] ?? emptyConversation()),
          turnId: c[taskId]?.busy ? result.turn.id : null,
        },
      }));
      updateCatalog((c) => ({
        ...c,
        tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, updatedAt: Date.now() } : t)),
      }));
      setDrafts((d) => ({ ...d, [taskId]: d[taskId] === message ? '' : (d[taskId] ?? '') }));
      return true;
    } catch (e) {
      const message = errorText(e);
      setError(message);
      if (id) {
        const taskId = id;
        setConversations((c) => ({
          ...c,
          [taskId]: {
            ...(c[taskId] ?? emptyConversation()),
            busy: !!c[taskId]?.turnId && c[taskId]?.busy,
            error: message,
          },
        }));
        loaded.current.delete(taskId);
        try {
          await hydrate(taskId);
        } catch (recoveryError) {
          setError(`${message}\n${errorText(recoveryError)}`);
        }
      }
      return false;
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  async function createWindowTask(projectId: string, title: string, selection: ModelSelection) {
    const project = catalogRef.current.projects.find(
      (project) => project.id === projectId && !project.imported && !project.closed,
    );
    if (!project || typeof title !== 'string' || !title.trim() || !isModelSelection(selection))
      throw new Error('项目或任务内容无效');
    if (sendLock.current || connectLock.current || connection !== 'ready')
      throw new Error('任务忙碌，请稍后重试。');
    sendLock.current = true;
    try {
      const id = await startThread(project.path, { ...settings, model: selection.model });
      updateCatalog((current) => ({
        ...current,
        tasks: [
          {
            id,
            projectId,
            title: title.trim().slice(0, 52),
            updatedAt: Date.now(),
            archived: false,
            selection,
          },
          ...current.tasks,
        ],
      }));
      loaded.current.add(id);
      return id;
    } finally {
      sendLock.current = false;
    }
  }

  async function sendQueued(item: QueuedMessage) {
    const id = item.threadId;
    let turnSubmitted = false;
    if (
      sendLock.current ||
      connectLock.current ||
      connection !== 'ready' ||
      conversationsRef.current[id]?.busy
    )
      throw new Error('任务忙碌，请稍后重试。');
    const task = catalogRef.current.tasks.find((task) => task.id === id && !task.archived);
    if (!task || task.imported) throw new Error('任务不存在、已归档或是只读导入历史。');
    updateCatalog((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === id ? { ...task, selection: item.selection, updatedAt: Date.now() } : task,
      ),
    }));
    sendLock.current = true;
    try {
      if (!loaded.current.has(id)) {
        const next = await hydrate(id);
        if (next.busy) throw new Error('任务忙碌，请稍后重试。');
      }
      const pending = {
        ...(conversationsRef.current[id] ?? emptyConversation()),
        activeModel: item.selection.model,
        busy: true,
        error: null,
      };
      conversationsRef.current = { ...conversationsRef.current, [id]: pending };
      setConversations((c) => ({ ...c, [id]: pending }));
      turnSubmitted = true;
      const result = await startTurn(id, item.text, item.selection, item.attachments);
      setConversations((c) => ({
        ...c,
        [id]: { ...c[id], turnId: c[id]?.busy ? result.turn.id : null },
      }));
      return { turnId: result.turn.id };
    } catch (e) {
      setConversations((c) => ({
        ...c,
        [id]: {
          ...(c[id] ?? emptyConversation()),
          busy: !!c[id]?.turnId && c[id]?.busy,
          error: errorText(e),
        },
      }));
      loaded.current.delete(id);
      try {
        const recovered = await hydrate(id);
        if (turnSubmitted && recovered.busy && recovered.turnId)
          return { turnId: recovered.turnId };
      } catch (recoveryError) {
        setError(errorText(recoveryError));
      }
      throw e;
    } finally {
      sendLock.current = false;
    }
  }

  async function review() {
    const id = selectedTaskId;
    if (
      !id ||
      catalog.tasks.some((task) => task.id === id && task.imported) ||
      connection !== 'ready' ||
      loadingTask ||
      sendLock.current ||
      conversationsRef.current[id]?.busy
    )
      return;
    sendLock.current = true;
    setSending(true);
    try {
      await bridge.rpc('review/start', {
        threadId: id,
        target: { type: 'uncommittedChanges' },
        delivery: 'inline',
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }
  async function compact() {
    const id = selectedTaskId;
    if (
      !id ||
      catalog.tasks.some((task) => task.id === id && task.imported) ||
      connection !== 'ready' ||
      loadingTask ||
      sendLock.current ||
      conversationsRef.current[id]?.busy
    )
      return;
    sendLock.current = true;
    setSending(true);
    const current = {
      ...(conversationsRef.current[id] ?? emptyConversation()),
      busy: true,
      error: null,
    };
    conversationsRef.current = { ...conversationsRef.current, [id]: current };
    setConversations((c) => ({ ...c, [id]: current }));
    try {
      // The RPC acknowledges scheduling only. Native turn notifications own completion.
      await bridge.rpc('thread/compact/start', { threadId: id });
    } catch (e) {
      const message = errorText(e);
      setError(message);
      setConversations((c) => ({ ...c, [id]: { ...c[id], busy: false, error: message } }));
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  async function stopTask(id: string) {
    const turnId = conversationsRef.current[id]?.turnId;
    if (!turnId) return;
    await bridge.rpc('turn/interrupt', { threadId: id, turnId });
  }
  async function stop() {
    if (!selectedTaskId) return;
    try {
      await stopTask(selectedTaskId);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function archive(id: string) {
    if (conversations[id]?.busy) {
      setError('请先停止任务再归档。');
      return;
    }
    if (catalog.tasks.some((task) => task.id === id && task.imported)) {
      updateCatalog((current) => ({
        ...current,
        tasks: current.tasks.map((task) => (task.id === id ? { ...task, archived: true } : task)),
      }));
      if (selectedTaskId === id) newTask();
      return;
    }
    if (connection !== 'ready') {
      setError('请先连接执行引擎。');
      return;
    }
    try {
      await bridge.rpc('thread/archive', { threadId: id });
      updateCatalog((c) => ({
        ...c,
        tasks: c.tasks.map((t) => (t.id === id ? { ...t, archived: true } : t)),
      }));
      if (selectedTaskId === id) newTask();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function openScheduledTask(job: Schedule) {
    const id = job.lastThreadId;
    if (!id) return;
    const project = catalog.projects.find((p) => p.path === job.project) ?? {
      id: crypto.randomUUID(),
      name: job.project.split(/[/\\]/).at(-1) ?? job.name,
      path: job.project,
    };
    hydration.current.set(id, []);
    try {
      const restored = await resumeThread(id);
      const conversation = (hydration.current.get(id) ?? []).reduce(reduceEvent, restored);
      updateCatalog((c) => ({
        ...c,
        projects: c.projects.some((p) => p.id === project.id)
          ? c.projects
          : [...c.projects, project],
        tasks: c.tasks.some((t) => t.id === id)
          ? c.tasks
          : [
              ...c.tasks,
              {
                id,
                projectId: project.id,
                title: job.name,
                archived: false,
                updatedAt: Date.now(),
                selection: restored.selection,
              },
            ],
      }));
      setConversations((c) => ({ ...c, [id]: conversation }));
      loaded.current.add(id);
      setSelectedProjectId(project.id);
      setSelectedTaskId(id);
    } finally {
      hydration.current.delete(id);
    }
  }
  async function exportTask(id: string, format: 'markdown' | 'json') {
    const task = catalog.tasks.find((task) => task.id === id);
    if (!task) throw new Error('任务不存在或已归档。');
    const conversation =
      conversationsRef.current[id] ??
      (task.imported ? await loadImportedHistory(id) : await resumeThread(id));
    const content = serializeTask(task, conversation, format);
    return bridge.exportDocument(
      `FluxCode-${id.replace(/[^a-zA-Z0-9-]/g, '')}.${format === 'json' ? 'json' : 'md'}`,
      content,
    );
  }
  async function renameTask(id: string, title: string) {
    const name = title.trim();
    if (!name || name.length > 200) throw new Error('Task title must contain 1–200 characters');
    if (!catalog.tasks.some((task) => task.id === id && task.imported))
      await bridge.rpc('thread/name/set', { threadId: id, name });
    updateCatalog((c) => ({
      ...c,
      tasks: c.tasks.map((t) => (t.id === id ? { ...t, title: name } : t)),
    }));
  }
  async function forkTask(id: string) {
    const source = catalog.tasks.find((task) => task.id === id);
    if (source?.imported) throw new Error('导入历史为只读记录，不能创建引擎分支。');
    if (!source || conversationsRef.current[id]?.busy || sendLock.current)
      throw new Error('请先停止任务再创建分支。');
    const result = await bridge.rpc<{ thread: { id: string } }>('thread/fork', {
      threadId: id,
      excludeTurns: true,
      deferGoalContinuation: true,
    });
    const fork = {
      ...source,
      id: result.thread.id,
      title: source.title,
      forkedFrom: source.id,
      pinned: false,
      archived: false,
      updatedAt: Date.now(),
    };
    updateCatalog((current) => ({ ...current, tasks: [fork, ...current.tasks] }));
    const conversation = await hydrate(fork.id);
    setSelectedProjectId(fork.projectId);
    setSelectedTaskId(fork.id);
    setConversations((current) => ({ ...current, [fork.id]: conversation }));
  }
  function pinTask(id: string) {
    updateCatalog((c) => ({
      ...c,
      tasks: c.tasks.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)),
    }));
  }
  async function unarchiveTask(id: string) {
    if (!catalog.tasks.some((task) => task.id === id && task.imported))
      await bridge.rpc('thread/unarchive', { threadId: id });
    updateCatalog((c) => ({
      ...c,
      tasks: c.tasks.map((t) => (t.id === id ? { ...t, archived: false } : t)),
    }));
  }

  async function organizeTasks(ids: string[], archived: boolean) {
    const success: string[] = [];
    const failures: { id: string; reason: string }[] = [];
    for (const id of ids) {
      const task = catalog.tasks.find((item) => item.id === id);
      if (!task || task.archived === archived) {
        failures.push({ id, reason: '任务状态已变化' });
        continue;
      }
      if (conversationsRef.current[id]?.busy) {
        failures.push({ id, reason: '任务正在运行' });
        continue;
      }
      try {
        if (!task.imported)
          await bridge.rpc(archived ? 'thread/archive' : 'thread/unarchive', { threadId: id });
        success.push(id);
        updateCatalog((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === id ? { ...item, archived } : item)),
        }));
      } catch (cause) {
        failures.push({ id, reason: errorText(cause) });
      }
    }
    if (archived && selectedTaskId && success.includes(selectedTaskId)) newTask();
    return { success, failures };
  }

  async function exportTasks(ids: string[]) {
    if (!ids.length || ids.length > 100) throw new Error('每次可导出 1 到 100 个任务。');
    const tasks = ids.map((id) => catalog.tasks.find((task) => task.id === id));
    if (tasks.some((task) => !task)) throw new Error('部分任务已被移除，请重新选择。');
    const entries = [];
    for (const task of tasks) {
      const row = task!;
      const conversation =
        conversationsRef.current[row.id] ??
        (row.imported ? await loadImportedHistory(row.id) : await resumeThread(row.id));
      const project = catalog.projects.find((item) => item.id === row.projectId);
      entries.push({
        project: project
          ? { name: row.imported?.sourceProject ?? project.name, path: project.path }
          : null,
        task: row,
        messages: conversation.items,
      });
    }
    return bridge.exportDocument(
      `FluxCode-conversations-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), entries }, null, 2),
    );
  }

  async function importConversations(text: string, includeDuplicates = false) {
    if (importLock.current) throw new Error('导入正在进行，请等待完成。');
    importLock.current = true;
    const saved: string[] = [];
    try {
      const current = catalogRef.current;
      const plan = await planTaskImport(text, current);
      const selected = plan.entries.filter((entry) => includeDuplicates || !entry.duplicate);
      if (!selected.length) return { imported: 0, skipped: plan.duplicateCount };
      const project = current.projects.find((item) => item.imported) ?? {
        id: crypto.randomUUID(),
        name: '导入的对话',
        path: '',
        imported: true,
      };
      const imported = [];
      for (const entry of selected) {
        const id = crypto.randomUUID();
        await saveImportedHistory(id, entry.messages);
        saved.push(id);
        imported.push({
          id,
          projectId: project.id,
          title: entry.title,
          updatedAt: entry.updatedAt,
          archived: false,
          imported: {
            fingerprint: entry.fingerprint,
            sourceId: entry.sourceId,
            sourceProject: entry.projectName,
          },
        });
      }
      const next = {
        ...current,
        projects: current.projects.some((item) => item.id === project.id)
          ? current.projects
          : [...current.projects, project],
        tasks: [...imported, ...current.tasks],
      };
      saveCatalog(next);
      saved.length = 0;
      catalogRef.current = next;
      setCatalog(next);
      const first = imported[0];
      const conversation = { ...emptyConversation(), items: selected[0].messages };
      conversationsRef.current = { ...conversationsRef.current, [first.id]: conversation };
      setConversations((current) => ({ ...current, [first.id]: conversation }));
      loaded.current.add(first.id);
      selectionEpoch.current++;
      restoreTask.current = null;
      setSelectedProjectId(project.id);
      setSelectedTaskId(first.id);
      setLoadingTask(false);
      return { imported: imported.length, skipped: plan.entries.length - selected.length };
    } catch (error) {
      const cleanup = await Promise.allSettled(saved.map(removeImportedHistory));
      if (cleanup.some((result) => result.status === 'rejected'))
        throw new Error(`${errorText(error)}；未完成导入的历史文件清理失败，请检查程序数据目录。`);
      throw error;
    } finally {
      importLock.current = false;
    }
  }

  useEffect(() => {
    const idle = Object.keys(conversations).filter(
      (id) => id !== selectedTaskId && !conversations[id].busy && !resuming.current.has(id),
    );
    if (idle.length <= 12) return;
    const age = new Map(catalog.tasks.map((task) => [task.id, task.updatedAt]));
    const evict = idle
      .sort((a, b) => (age.get(a) ?? 0) - (age.get(b) ?? 0))
      .slice(0, idle.length - 12);
    for (const id of evict) loaded.current.delete(id);
    setConversations((current) => {
      const next = { ...current };
      for (const id of evict) if (id !== selectedTaskId && !next[id]?.busy) delete next[id];
      return next;
    });
  }, [conversations, selectedTaskId, catalog.tasks]);

  const draftKey = selectedTaskId ?? `new:${selectedProjectId}`;
  const modelDraftKey = `${draftKey}:${settings.baseUrl}:${settings.apiKeyEnv}`;
  useEffect(() => {
    if (
      (connection === 'ready' ||
        catalog.tasks.some((task) => task.id === restoreTask.current && task.imported)) &&
      restoreTask.current
    ) {
      const id = restoreTask.current;
      restoreTask.current = null;
      void selectTask(id);
    }
  }, [connection, catalog.tasks]);
  useEffect(() => {
    if (sessionReady)
      continuity.update({
        projectId: selectedProjectId,
        taskId: selectedTaskId,
        drafts,
        selections: draftSelections,
      });
  }, [sessionReady, selectedProjectId, selectedTaskId, drafts, draftSelections]);
  const selection: ModelSelection = selectedTaskId
    ? (catalog.tasks.find((t) => t.id === selectedTaskId)?.selection ?? {
        model: settings.model,
        effort: 'off',
      })
    : (draftSelections[modelDraftKey] ?? { model: settings.model, effort: 'off' });
  function setSelection(next: ModelSelection) {
    if (
      sendLock.current ||
      loadingTask ||
      (selectedTaskId && conversationsRef.current[selectedTaskId]?.busy)
    )
      return;
    if (!isModelSelection(next)) {
      setError('请输入有效的模型 ID（最多 200 字符）。');
      return;
    }
    if (!selectedTaskId) setDraftSelections((d) => ({ ...d, [modelDraftKey]: next }));
    const provider = providerProfiles.find((p) => sameProvider(p.settings, settings));
    if (provider && !providerModels(provider).includes(next.model)) {
      const rows = providerProfiles.map((p) =>
        p === provider ? { ...p, models: [...providerModels(p), next.model] } : p,
      );
      void bridge
        .saveProviderProfiles(rows, providerProfiles)
        .then(() => setProviderProfiles(rows))
        .catch((e) => setError(errorText(e)));
    }
    updateCatalog((c) => ({
      ...c,
      lastModel: next.model,
      tasks: c.tasks.map((t) => (t.id === selectedTaskId ? { ...t, selection: next } : t)),
    }));
  }
  const models = [
    ...new Set(
      [
        selection.model,
        settings.model,
        ...providerProfiles
          .filter((p) => sameProvider(p.settings, settings))
          .flatMap(providerModels),
      ].filter((m): m is string => !!m),
    ),
  ];
  const setDraft = (text: string) => setDrafts((d) => ({ ...d, [draftKey]: text }));
  async function changeFontSize(size: number) {
    await bridge.saveFontSize(size);
    setFontSize(size);
    document.documentElement.style.setProperty('--font-size', `${size}px`);
  }
  return {
    createWindowTask,
    hydrateForWindow: (id: string) =>
      loaded.current.has(id)
        ? Promise.resolve(conversationsRef.current[id] ?? emptyConversation())
        : hydrate(id),
    startup,
    workspaceSaveFailed: continuity.saveFailed || catalogSaveFailed,
    retryWorkspaceSave: () => {
      const catalogSaved = retryCatalogSave();
      const workspaceSaved = continuity.retry();
      return catalogSaved && workspaceSaved;
    },
    exportDrafts: () =>
      bridge.exportDocument(
        'FluxCode-drafts.json',
        JSON.stringify({ schemaVersion: 1, drafts, catalog }, null, 2),
      ),
    providerProfiles,
    setProviderProfiles,
    configurationUpdates,
    catalog,
    panels: continuity.session.panels,
    togglePanel: (key: keyof typeof continuity.session.panels) => {
      if (key === 'inspector' && !allowWorkspaceNavigation()) return;
      continuity.setSession((s) => ({ ...s, panels: { ...s.panels, [key]: !s.panels[key] } }));
    },
    positions: continuity.session.positions,
    setPosition: (id: string, top: number) =>
      continuity.setSession((s) => ({ ...s, positions: { ...s.positions, [id]: top } })),
    settings,
    selection,
    setSelection,
    models,
    fontSize,
    changeFontSize,
    connection,
    error,
    setError,
    selectedProjectId,
    selectedTaskId,
    conversations,
    loadingTask,
    sending,
    revision,
    connect,
    addProject,
    renameProject,
    closeProject,
    selectProject,
    newTask,
    selectTask,
    send,
    stop,
    stopTask,
    compact,
    review,
    sendQueued,
    archive,
    renameTask,
    forkTask,
    exportTask,
    openScheduledTask,
    pinTask,
    unarchiveTask,
    organizeTasks,
    exportTasks,
    importConversations,
    draft: drafts[draftKey] ?? '',
    hasUnsentDraft: Object.values(drafts).some((text) => text.trim().length > 0),
    setDraft,
    available: bridge.available,
  };
}

export type FluxController = ReturnType<typeof useFluxCode>;
