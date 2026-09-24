import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultSettings, emptyConversation, validateSettings } from '../domain/types';
import type { Catalog, Conversation, Project, RpcEvent, Settings } from '../domain/types';
import { reduceEvent } from '../domain/conversation';
import { bridge } from '../infrastructure/bridge';
import { emptyCatalog, loadCatalog, saveCatalog } from '../infrastructure/catalog';
import { resumeThread, startThread, startTurn } from '../infrastructure/codex';
import { isModelSelection } from '../domain/modelSelection';
import type { ModelSelection } from '../domain/modelSelection';

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function useFluxCode() {
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [connection, setConnection] = useState<'offline' | 'connecting' | 'ready'>('offline');
  const [error, setError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Record<string, Conversation>>({});
  const [loadingTask, setLoadingTask] = useState(false);
  const [sending, setSending] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftSelections, setDraftSelections] = useState<Record<string, ModelSelection>>({});
  const [revision, setRevision] = useState(0);
  const [fontSize, setFontSize] = useState(14);
  const loaded = useRef(new Set<string>());
  const hydration = useRef(new Map<string, RpcEvent[]>());
  const sendLock = useRef(false);
  const connectLock = useRef(false);
  const selectionEpoch = useRef(0);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const updateCatalog = useCallback((fn: (c: Catalog) => Catalog) => {
    setCatalog((current) => {
      const next = fn(current);
      try {
        saveCatalog(next);
      } catch {
        queueMicrotask(() => setError('项目索引保存失败，请检查磁盘空间。'));
      }
      return next;
    });
  }, []);

  useEffect(() => {
    try {
      const c = loadCatalog();
      setCatalog(c);
      setSelectedProjectId(c.projects[0]?.id ?? null);
    } catch (e) {
      setError(errorText(e));
    }
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      unsubscribe = await bridge.subscribe((event) => {
        if (event.method === 'engine/disconnected') {
          setConnection('offline');
          loaded.current.clear();
          setConversations((current) =>
            Object.fromEntries(
              Object.entries(current).map(([id, c]) => [id, { ...c, busy: false, turnId: null }]),
            ),
          );
          setError('执行引擎已断开。重新连接后可恢复任务。');
          return;
        }
        if (event.method === 'engine/unsupportedRequest') {
          setError('引擎请求了尚未支持的交互工具。请在对话中提供信息后继续。');
          return;
        }
        const threadId = event.params?.threadId;
        if (typeof threadId !== 'string') return;
        hydration.current.get(threadId)?.push(event);
        setConversations((current) => ({
          ...current,
          [threadId]: reduceEvent(current[threadId] ?? emptyConversation(), event),
        }));
        if (event.method === 'turn/completed') setRevision((v) => v + 1);
      });
      if (disposed) {
        unsubscribe();
        return;
      }
      const saved = await bridge.loadSettings();
      if (!disposed) setSettings(saved);
      const ui = await bridge.loadPreferences();
      if (!disposed) {
        setFontSize(ui.font_size);
        document.documentElement.style.setProperty('--font-size', `${ui.font_size}px`);
        document.documentElement.style.setProperty('--sidebar-width', `${ui.sidebar_width}px`);
        document.documentElement.style.setProperty('--inspector-width', `${ui.inspector_width}px`);
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
      if (!disposed) setError(errorText(e));
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  async function connect(next: Settings, apiKey?: string, rememberKey = false): Promise<boolean> {
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
    setConnection('connecting');
    setError(null);
    try {
      await bridge.connect(next, apiKey, rememberKey);
      loaded.current.clear();
      setSettings(next);
      setConnection('ready');
      return true;
    } catch (e) {
      setConnection('offline');
      setError(errorText(e));
      return false;
    } finally {
      connectLock.current = false;
    }
  }

  async function addProject() {
    try {
      const path = await bridge.chooseDirectory();
      if (!path) return;
      const existing = catalog.projects.find((p) => p.path === path);
      const project: Project = existing ?? {
        id: crypto.randomUUID(),
        name:
          path
            .replace(/[/\\]+$/, '')
            .split(/[/\\]/)
            .at(-1) || path,
        path,
      };
      if (!existing) updateCatalog((c) => ({ ...c, projects: [...c.projects, project] }));
      selectProject(project.id);
    } catch (e) {
      setError(errorText(e));
    }
  }

  function selectProject(id: string) {
    if (sendLock.current) return;
    selectionEpoch.current++;
    setSelectedProjectId(id);
    setSelectedTaskId(null);
    setLoadingTask(false);
  }

  function newTask() {
    if (sendLock.current) return;
    selectionEpoch.current++;
    setSelectedTaskId(null);
    if (!drafts[`new:${selectedProjectId}`]?.trim())
      setDraftSelections((current) => {
        const next = { ...current };
        delete next[`new:${selectedProjectId}`];
        return next;
      });
    setLoadingTask(false);
    setError(null);
  }

  async function selectTask(id: string) {
    if (sendLock.current) return;
    const task = catalog.tasks.find((t) => t.id === id);
    if (!task) return;
    const epoch = ++selectionEpoch.current;
    setSelectedProjectId(task.projectId);
    setSelectedTaskId(id);
    if (loaded.current.has(id)) {
      setLoadingTask(false);
      return;
    }
    if (connection !== 'ready') {
      setError('请先连接模型服务，再恢复历史任务。');
      return;
    }
    setLoadingTask(true);
    hydration.current.set(id, []);
    try {
      const conversation = await resumeThread(id);
      if (!task.selection) {
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
      const events = hydration.current.get(id) ?? [];
      setConversations((c) => ({ ...c, [id]: events.reduce(reduceEvent, conversation) }));
      loaded.current.add(id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      hydration.current.delete(id);
      if (epoch === selectionEpoch.current) setLoadingTask(false);
    }
  }

  async function send(message: string): Promise<boolean> {
    if (sendLock.current || loadingTask || !message.trim()) return false;
    const project = catalog.projects.find((p) => p.id === selectedProjectId);
    if (!project) {
      setError('请先打开一个项目文件夹。');
      return false;
    }
    if (connection !== 'ready') {
      setError('请先在设置中连接模型服务。');
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
        setDrafts((d) => ({ ...d, [taskId]: message, [originDraftKey]: '' }));
        setDraftSelections((d) => {
          const next = { ...d };
          delete next[originDraftKey];
          return next;
        });
        loaded.current.add(id);
      } else if (!loaded.current.has(id)) {
        const restored = await resumeThread(id);
        if (!catalog.tasks.find((t) => t.id === id)?.selection) {
          turnSelection = restored.selection ?? selection;
          const recovered = turnSelection;
          updateCatalog((c) => ({
            ...c,
            tasks: c.tasks.map((t) => (t.id === id ? { ...t, selection: recovered } : t)),
          }));
        }
        setConversations((c) => ({ ...c, [id!]: restored }));
        loaded.current.add(id);
      }
      const taskId = id;
      setConversations((c) => ({
        ...c,
        [taskId]: { ...(c[taskId] ?? emptyConversation()), busy: true, error: null },
      }));
      const result = await startTurn(id, message, turnSelection);
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
          [taskId]: { ...(c[taskId] ?? emptyConversation()), busy: false, error: message },
        }));
      }
      return false;
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  async function stop() {
    if (!selectedTaskId) return;
    const turnId = conversations[selectedTaskId]?.turnId;
    if (!turnId) return;
    try {
      await bridge.rpc('turn/interrupt', { threadId: selectedTaskId, turnId });
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function archive(id: string) {
    if (conversations[id]?.busy) {
      setError('请先停止任务再归档。');
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

  const draftKey = selectedTaskId ?? `new:${selectedProjectId}`;
  const selection: ModelSelection = selectedTaskId
    ? (catalog.tasks.find((t) => t.id === selectedTaskId)?.selection ?? {
        model: settings.model,
        effort: 'off',
      })
    : (draftSelections[draftKey] ?? { model: catalog.lastModel ?? settings.model, effort: 'off' });
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
    if (!selectedTaskId) setDraftSelections((d) => ({ ...d, [draftKey]: next }));
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
        catalog.lastModel,
        ...catalog.tasks.map((t) => t.selection?.model),
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
    catalog,
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
    selectProject,
    newTask,
    selectTask,
    send,
    stop,
    archive,
    draft: drafts[draftKey] ?? '',
    setDraft,
    available: bridge.available,
  };
}

export type FluxController = ReturnType<typeof useFluxCode>;
