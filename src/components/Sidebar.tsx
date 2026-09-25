import { useAppearance } from '../application/AppearanceProvider';
import {
  Archive,
  ChevronDown,
  Circle,
  Folder,
  FolderPlus,
  GitBranch,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  SquarePen,
} from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { FluxController } from '../application/useFluxCode';
import type { Project, Task } from '../domain/types';
import { TaskActionsDialog } from './TaskActionsDialog';

type SidebarRow =
  | { kind: 'project'; project: Project; key: string }
  | { kind: 'task'; task: Task; key: string }
  | { kind: 'empty'; key: string };

export function Sidebar({
  app,
  onSettings,
  onChannels,
  onSearchConversations,
  onImportConversations,
  onManageWorkspaces,
}: {
  app: FluxController;
  onSettings: () => void;
  onChannels: () => void;
  onSearchConversations: () => void;
  onImportConversations: () => void;
  onManageWorkspaces: () => void;
}) {
  const { t } = useAppearance();
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const [editingTask, setEditingTask] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMessage, setBatchMessage] = useState('');
  const scrollParent = useRef<HTMLDivElement>(null);
  const [keyboardRow, setKeyboardRow] = useState<number | null>(null);
  const focusPending = useRef(false);
  const closedProjects = useMemo(
    () =>
      new Set(
        app.catalog.projects.filter((project) => project.closed).map((project) => project.id),
      ),
    [app.catalog.projects],
  );
  const tasks = useMemo(
    () =>
      app.catalog.tasks
        .filter(
          (task) =>
            !closedProjects.has(task.projectId) &&
            task.archived === archived &&
            task.title.toLowerCase().includes(search.toLowerCase()),
        )
        .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt),
    [app.catalog.tasks, closedProjects, archived, search],
  );
  const groupedTasks = useMemo(() => {
    const groups = new Map<string, Task[]>();
    for (const task of tasks) {
      const group = groups.get(task.projectId) ?? [];
      group.push(task);
      groups.set(task.projectId, group);
    }
    return groups;
  }, [tasks]);
  const rows = useMemo(() => {
    const result: SidebarRow[] = [];
    for (const project of app.catalog.projects) {
      if (project.closed) continue;
      result.push({ kind: 'project', project, key: `project:${project.id}` });
      if (collapsed.has(project.id)) continue;
      const group = groupedTasks.get(project.id) ?? [];
      for (const task of group) result.push({ kind: 'task', task, key: `task:${task.id}` });
      if (!group.length) result.push({ kind: 'empty', key: `empty:${project.id}` });
    }
    return result;
  }, [app.catalog.projects, groupedTasks, collapsed]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollParent.current,
    estimateSize: (index) => (rows[index].kind === 'project' ? 47 : 38),
    getItemKey: (index) => rows[index].key,
    overscan: 10,
    rangeExtractor: (range) =>
      [
        ...new Set([
          ...defaultRangeExtractor(range),
          ...(keyboardRow === null ? [] : [keyboardRow]),
        ]),
      ]
        .filter((index) => index < rows.length)
        .sort((a, b) => a - b),
  });
  useLayoutEffect(() => {
    if (!focusPending.current || keyboardRow === null) return;
    focusPending.current = false;
    const row = scrollParent.current?.querySelector(`[data-sidebar-index="${keyboardRow}"]`);
    (
      row?.querySelector<HTMLButtonElement>('.task-select:not(:disabled), .project-name') ??
      row?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    )?.focus();
  }, [keyboardRow]);
  const selectedIds = [...selected].filter((id) =>
    app.catalog.tasks.some((task) => task.id === id && !closedProjects.has(task.projectId)),
  );
  async function organize(archive: boolean) {
    setBatchBusy(true);
    setBatchMessage('');
    try {
      const result = await app.organizeTasks(selectedIds, archive);
      setSelected(new Set(result.failures.map((item) => item.id)));
      setBatchMessage(
        `${t('已完成')} ${result.success.length} · ${t('失败')} ${result.failures.length}${result.failures.length ? `: ${result.failures.map((item) => `${item.id}: ${t(item.reason)}`).join('; ')}` : ''}`,
      );
    } catch (cause) {
      setBatchMessage(String(cause));
    } finally {
      setBatchBusy(false);
    }
  }
  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <button className="nav-action" onClick={onChannels}>
          {t('渠道管理')}
        </button>
        <button className="nav-action new-task" onClick={app.newTask}>
          <SquarePen size={17} />
          <span>{t('新建任务')}</span>
          <kbd>Ctrl N</kbd>
        </button>
        <label className="search-field">
          <Search size={15} />
          <input
            ref={searchInput}
            placeholder={t('搜索任务')}
            aria-label={t('搜索任务')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button className="nav-action" onClick={onSearchConversations}>
          <Search size={15} /> {t('搜索对话正文')}
        </button>
        <button className="nav-action" onClick={onImportConversations}>
          {t('导入对话')}
        </button>
        <button
          className="nav-action"
          aria-pressed={selecting}
          onClick={() => {
            setSelecting(!selecting);
            setSelected(new Set());
            setBatchMessage('');
          }}
        >
          {t(selecting ? '完成整理' : '批量整理')}
        </button>
        {selecting && (
          <div className="sidebar-batch" role="group" aria-label={t('批量整理')}>
            <span>
              {t('已选择')} {selectedIds.length}
            </span>
            <button
              disabled={batchBusy || !tasks.length}
              onClick={() => setSelected(new Set(tasks.map((task) => task.id)))}
            >
              {t('全选当前筛选')}
            </button>
            <button
              disabled={batchBusy || !selectedIds.length}
              onClick={() => setSelected(new Set())}
            >
              {t('取消选择')}
            </button>
            <button
              disabled={batchBusy || !selectedIds.length}
              onClick={() => void organize(!archived)}
            >
              {t(archived ? '批量恢复' : '批量归档')}
            </button>
            <button
              disabled={batchBusy || !selectedIds.length || selectedIds.length > 100}
              onClick={() => {
                setBatchBusy(true);
                setBatchMessage('');
                void app
                  .exportTasks(selectedIds)
                  .then((saved) => {
                    if (saved) setBatchMessage(t('任务已导出'));
                  })
                  .catch((cause) => setBatchMessage(String(cause)))
                  .finally(() => setBatchBusy(false));
              }}
            >
              {t('批量导出')}
            </button>
            {selectedIds.length > 100 && <small>{t('每次最多导出 100 个任务。')}</small>}
            {batchMessage && <p role="status">{batchMessage}</p>}
          </div>
        )}
      </div>
      <div className="section-heading">
        <button aria-pressed={archived} onClick={() => setArchived((v) => !v)}>
          {t(archived ? '返回任务' : '已归档')}
        </button>
        <span>{t('项目')}</span>
        <button
          className="icon-button"
          aria-label={t('工作区管理')}
          title={t('工作区管理')}
          onClick={onManageWorkspaces}
        >
          <Settings2 size={16} />
        </button>
        <button
          className="icon-button"
          aria-label={t('打开项目')}
          title={t('打开项目')}
          onClick={() => void app.addProject()}
        >
          <FolderPlus size={16} />
        </button>
      </div>
      <div
        className="project-list"
        ref={scrollParent}
        onFocusCapture={(event) => {
          const row = (event.target as HTMLElement).closest<HTMLElement>('[data-sidebar-index]');
          if (row) setKeyboardRow(Number(row.dataset.sidebarIndex));
        }}
        onKeyDown={(event) => {
          const target = event.target as HTMLElement;
          const row = target.closest<HTMLElement>('[data-sidebar-index]');
          if (!row || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          const current = Number(row.dataset.sidebarIndex);
          let next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? rows.length - 1
                : Math.max(
                    0,
                    Math.min(rows.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)),
                  );
          event.preventDefault();
          const step = event.key === 'End' || event.key === 'ArrowUp' ? -1 : 1;
          while (rows[next]?.kind === 'empty') next += step;
          if (next < 0 || next >= rows.length) return;
          if (next === current) return;
          focusPending.current = true;
          virtualizer.scrollToIndex(next, { align: 'auto' });
          setKeyboardRow(next);
        }}
      >
        {!app.catalog.projects.some((p) => !p.closed) && (
          <button className="empty-project" onClick={() => void app.addProject()}>
            <FolderPlus size={22} />
            <span>{t(app.catalog.projects.length ? '打开其他项目' : '打开你的第一个项目')}</span>
            <small>{t('从本地文件夹开始')}</small>
          </button>
        )}
        <div className="project-virtual-space" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (row.kind === 'empty')
              return (
                <div
                  key={row.key}
                  className="project-virtual-row"
                  data-sidebar-index={virtualRow.index}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div className="task-list">
                    <div className="no-tasks">
                      <p>{search ? t('没有匹配的任务') : t('还没有任务')}</p>
                      {search && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearch('');
                            searchInput.current?.focus();
                          }}
                        >
                          {t('清除搜索')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            if (row.kind === 'task') {
              const { task } = row;
              return (
                <div
                  key={row.key}
                  className="project-virtual-row"
                  data-sidebar-index={virtualRow.index}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div className="task-list">
                    <div className={`task-row ${app.selectedTaskId === task.id ? 'active' : ''}`}>
                      {selecting && (
                        <input
                          type="checkbox"
                          aria-label={`${t('选择任务')} ${task.title}`}
                          checked={selected.has(task.id)}
                          disabled={batchBusy}
                          onChange={(event) =>
                            setSelected((previous) => {
                              const next = new Set(previous);
                              if (event.target.checked) next.add(task.id);
                              else next.delete(task.id);
                              return next;
                            })
                          }
                        />
                      )}
                      <button
                        className="task-select"
                        disabled={archived}
                        onClick={() => void app.selectTask(task.id)}
                      >
                        <span
                          className={`task-dot ${app.conversations[task.id]?.busy ? 'running' : ''}`}
                        />
                        <span>
                          {task.forkedFrom && (
                            <span title={t('分支任务')}>
                              <GitBranch
                                size={13}
                                className="task-fork-icon"
                                aria-label={t('分支任务')}
                              />
                            </span>
                          )}
                          {task.imported && <small>{t('只读')}</small>}
                          {task.pinned ? '★ ' : ''}
                          {task.title}
                        </span>
                      </button>
                      <button
                        className="icon-button task-menu"
                        aria-label={t('整理任务') + ' ' + task.title}
                        onClick={() => setEditingTask(task.id)}
                      >
                        ⋯
                      </button>
                      {archived && (
                        <button
                          onClick={() =>
                            void app.unarchiveTask(task.id).catch((e) => app.setError(String(e)))
                          }
                        >
                          {t('恢复')}
                        </button>
                      )}
                      <button
                        hidden={archived}
                        className="icon-button archive-task"
                        title={t('归档任务')}
                        aria-label={`${t('归档任务')} ${task.title}`}
                        onClick={() => void app.archive(task.id)}
                      >
                        <Archive size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            }
            const { project } = row;
            return (
              <section
                className="project-virtual-row"
                data-sidebar-index={virtualRow.index}
                key={row.key}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <div
                  className={`project-row ${app.selectedProjectId === project.id ? 'selected-project' : ''}`}
                >
                  <button
                    className={`icon-button chevron ${collapsed.has(project.id) ? 'collapsed' : ''}`}
                    aria-label={`${t('折叠')} ${project.imported ? t('导入的对话') : project.name}`}
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
                    title={project.imported ? t('导入的对话') : project.path}
                  >
                    <Folder size={15} />
                    <span>{project.imported ? t('导入的对话') : project.name}</span>
                  </button>
                  <button
                    className="icon-button project-new"
                    aria-label={`${t('新建任务')} · ${project.imported ? t('导入的对话') : project.name}`}
                    onClick={() => app.selectProject(project.id)}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <div className="sidebar-bottom">
        <div className="workspace-note">
          <MessageSquare size={16} />
          <div>
            <strong>{t('专注每一次构建')}</strong>
            <span>{t('在本地工作空间中完成任务')}</span>
          </div>
        </div>
        <button className="settings-nav" aria-label={t('设置')} onClick={onSettings}>
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
                ? t('执行引擎已就绪')
                : app.connection === 'connecting'
                  ? t('正在连接…')
                  : t('配置模型服务')}
            </small>
          </span>
          <Settings2 size={17} />
        </button>
      </div>
      {editingTask && app.catalog.tasks.find((task) => task.id === editingTask) && (
        <TaskActionsDialog
          task={app.catalog.tasks.find((task) => task.id === editingTask)!}
          app={app}
          onClose={() => setEditingTask(null)}
        />
      )}
    </aside>
  );
}
