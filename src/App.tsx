import { useEffect, useState } from 'react';
import { ChevronRight, Circle, FolderOpen, PanelRight, Settings2, Terminal, X } from 'lucide-react';
import { useFluxCode } from './application/useFluxCode';
import { emptyConversation } from './domain/types';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { Composer } from './components/Composer';
import { Conversation, Welcome } from './components/Conversation';
import { SettingsDialog } from './components/SettingsDialog';
import { Inspector } from './components/Inspector';
import { TerminalPanel } from './components/TerminalPanel';

export default function App() {
  const app = useFluxCode();
  const [sidebar, setSidebar] = useState(true);
  const [inspector, setInspector] = useState(true);
  const [terminal, setTerminal] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const project = app.catalog.projects.find((p) => p.id === app.selectedProjectId);
  const task = app.catalog.tasks.find((t) => t.id === app.selectedTaskId);
  const conversation = app.selectedTaskId
    ? (app.conversations[app.selectedTaskId] ?? emptyConversation())
    : emptyConversation();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
        setTerminal((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [app.newTask]);
  return (
    <div className="app-shell">
      <TitleBar toggleSidebar={() => setSidebar((v) => !v)} report={app.setError} />
      <div className="app-body">
        {sidebar && <Sidebar app={app} onSettings={() => setSettingsOpen(true)} />}
        <main className="main-workspace">
          <header className="workspace-header">
            <div className="breadcrumbs">
              <button onClick={() => void app.addProject()} title="打开项目">
                <FolderOpen size={16} />
                {project?.name ?? '工作空间'}
              </button>
              <ChevronRight size={13} />
              <span>{task?.title ?? '新建任务'}</span>
            </div>
            <div className="workspace-actions">
              <button
                className={`icon-button ${terminal ? 'selected' : ''}`}
                title="终端 · Ctrl `"
                aria-label="切换终端"
                onClick={() => setTerminal((v) => !v)}
              >
                <Terminal size={17} />
              </button>
              <button
                className={`icon-button ${inspector ? 'selected' : ''}`}
                title="文件与变更"
                aria-label="切换文件面板"
                onClick={() => setInspector((v) => !v)}
              >
                <PanelRight size={17} />
              </button>
            </div>
          </header>
          {!app.available && (
            <div className="preview-banner">浏览器预览 · 本地文件和执行能力在桌面应用中启用</div>
          )}
          {app.error && (
            <div className="error-banner" role="alert">
              <span>{app.error}</span>
              <button
                className="icon-button"
                aria-label="关闭提示"
                onClick={() => app.setError(null)}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="chat-area">
            {task ? (
              <Conversation state={conversation} loading={app.loadingTask} />
            ) : (
              <Welcome project={project?.name} onSuggestion={app.setDraft} />
            )}
            <Composer
              project={project?.name}
              model={app.selection.model}
              models={app.models}
              selection={app.selection}
              onSelection={app.setSelection}
              busy={conversation.busy}
              sending={app.sending}
              disabled={app.loadingTask}
              text={app.draft}
              onChange={app.setDraft}
              onSend={app.send}
              onStop={() => void app.stop()}
            />
          </div>
          {terminal && (
            <TerminalPanel
              key={project?.id ?? 'none'}
              cwd={project?.path}
              ready={app.connection === 'ready'}
              onClose={() => setTerminal(false)}
              onExecuted={() => setRevision((v) => v + 1)}
            />
          )}
          <footer className="statusbar">
            <span>
              <Circle
                size={7}
                fill="currentColor"
                className={app.connection === 'ready' ? 'green' : ''}
              />
              {app.connection === 'ready'
                ? '就绪'
                : app.connection === 'connecting'
                  ? '正在连接'
                  : '未连接'}
              <span className="status-separator">/</span>本地工作空间
            </span>
            <button onClick={() => setSettingsOpen(true)}>
              <Settings2 size={12} />
              {app.selection.model || '配置模型服务'}
            </button>
          </footer>
        </main>
        {inspector && (
          <Inspector
            project={project}
            revision={app.revision + revision}
            onClose={() => setInspector(false)}
          />
        )}
      </div>
      {settingsOpen && (
        <SettingsDialog
          fontSize={app.fontSize}
          onFontSize={app.changeFontSize}
          initial={app.settings}
          connecting={app.connection === 'connecting'}
          onClose={() => setSettingsOpen(false)}
          onConnect={app.connect}
        />
      )}
    </div>
  );
}
