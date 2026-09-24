import {
  Archive,
  ChevronDown,
  Circle,
  Folder,
  FolderPlus,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  SquarePen,
} from 'lucide-react';
import { useState } from 'react';
import type { FluxController } from '../application/useFluxCode';

export function Sidebar({ app, onSettings }: { app: FluxController; onSettings: () => void }) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tasks = app.catalog.tasks.filter(
    (t) => !t.archived && t.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <button className="nav-action new-task" onClick={app.newTask}>
          <SquarePen size={17} />
          <span>新建任务</span>
          <kbd>Ctrl N</kbd>
        </button>
        <label className="search-field">
          <Search size={15} />
          <input
            placeholder="搜索任务"
            aria-label="搜索任务"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <div className="section-heading">
        <span>项目</span>
        <button
          className="icon-button"
          aria-label="打开项目"
          title="打开项目"
          onClick={() => void app.addProject()}
        >
          <FolderPlus size={16} />
        </button>
      </div>
      <div className="project-list">
        {app.catalog.projects.length === 0 && (
          <button className="empty-project" onClick={() => void app.addProject()}>
            <FolderPlus size={22} />
            <span>打开你的第一个项目</span>
            <small>从本地文件夹开始</small>
          </button>
        )}
        {app.catalog.projects.map((project) => (
          <section className="project-group" key={project.id}>
            <div
              className={`project-row ${app.selectedProjectId === project.id ? 'selected-project' : ''}`}
            >
              <button
                className={`icon-button chevron ${collapsed.has(project.id) ? 'collapsed' : ''}`}
                aria-label={`折叠 ${project.name}`}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(project.id)) next.delete(project.id);
                    else next.add(project.id);
                    return next;
                  })
                }
              >
                <ChevronDown size={13} />
              </button>
              <button
                className="project-name"
                onClick={() => app.selectProject(project.id)}
                title={project.path}
              >
                <Folder size={15} />
                <span>{project.name}</span>
              </button>
              <button
                className="icon-button project-new"
                aria-label={`在 ${project.name} 新建任务`}
                onClick={() => app.selectProject(project.id)}
              >
                <Plus size={14} />
              </button>
            </div>
            {!collapsed.has(project.id) && (
              <div className="task-list">
                {tasks
                  .filter((t) => t.projectId === project.id)
                  .map((task) => (
                    <div
                      key={task.id}
                      className={`task-row ${app.selectedTaskId === task.id ? 'active' : ''}`}
                    >
                      <button className="task-select" onClick={() => void app.selectTask(task.id)}>
                        <span
                          className={`task-dot ${app.conversations[task.id]?.busy ? 'running' : ''}`}
                        />
                        <span>{task.title}</span>
                      </button>
                      <button
                        className="icon-button archive-task"
                        title="归档任务"
                        aria-label={`归档 ${task.title}`}
                        onClick={() => void app.archive(task.id)}
                      >
                        <Archive size={13} />
                      </button>
                    </div>
                  ))}
                {!tasks.some((t) => t.projectId === project.id) && (
                  <p className="no-tasks">{search ? '没有匹配的任务' : '还没有任务'}</p>
                )}
              </div>
            )}
          </section>
        ))}
      </div>
      <div className="sidebar-bottom">
        <div className="workspace-note">
          <MessageSquare size={16} />
          <div>
            <strong>专注每一次构建</strong>
            <span>在本地工作空间中完成任务</span>
          </div>
        </div>
        <button className="settings-nav" aria-label="设置" onClick={onSettings}>
          <span className="avatar">F</span>
          <span className="settings-copy">
            <strong>FluxCode</strong>
            <small>
              <Circle
                size={7}
                fill="currentColor"
                className={app.connection === 'ready' ? 'green' : ''}
              />
              {app.connection === 'ready'
                ? '执行引擎已就绪'
                : app.connection === 'connecting'
                  ? '正在连接…'
                  : '配置模型服务'}
            </small>
          </span>
          <Settings2 size={17} />
        </button>
      </div>
    </aside>
  );
}
