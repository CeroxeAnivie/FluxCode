import { useState } from 'react';
import { useAppearance } from '../application/AppearanceProvider';
import type { Project } from '../domain/types';
import { ErrorNotice } from './ErrorNotice';
import { useModalDialog } from './useModalDialog';

export function WorkspaceManager({
  projects,
  onRename,
  onSelect,
  onCloseProject,
  onClose,
}: {
  projects: Project[];
  onRename: (id: string, name: string) => void;
  onSelect: (id: string) => void;
  onCloseProject: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useAppearance();
  const dialog = useModalDialog();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(50);
  const visible = projects.filter(
    (p) =>
      !p.imported &&
      `${p.name} ${p.path}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  function run(action: () => void) {
    setError('');
    try {
      action();
    } catch (cause) {
      setError(String(cause));
    }
  }
  return (
    <dialog
      ref={dialog}
      className="model-dialog workspace-manager"
      aria-label={t('工作区管理')}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2>{t('工作区管理')}</h2>
      <p>{t('关闭仅收起工作区，历史、草稿和文件都会保留；已有终端继续运行。')}</p>
      <label className="form-field">
        {t('搜索名称或路径')}
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(50);
          }}
        />
      </label>
      {error && (
        <p role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
      <ul className="task-activity-list">
        {visible.slice(0, limit).map((project) => (
          <li key={project.id}>
            <div className="workspace-manager-details">
              <strong>{project.name}</strong>
              <span title={project.path}>{project.path}</span>
              {project.worktreeParentId && (
                <small>
                  {t('来源工作区')} ·{' '}
                  {projects.find((p) => p.id === project.worktreeParentId)?.name ??
                    project.worktreeParentId}
                </small>
              )}
              <small>{t(project.closed ? '已关闭' : '已打开')}</small>
              {editing === project.id && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(() => {
                      onRename(project.id, name);
                      setEditing(null);
                    });
                  }}
                >
                  <input
                    aria-label={t('工作区名称')}
                    autoFocus
                    value={name}
                    maxLength={100}
                    required
                    onChange={(event) => setName(event.target.value)}
                  />
                  <button type="submit" disabled={!name.trim()}>
                    {t('保存')}
                  </button>
                  <button type="button" onClick={() => setEditing(null)}>
                    {t('取消')}
                  </button>
                </form>
              )}
            </div>
            <div className="workspace-manager-actions">
              <button
                onClick={() =>
                  run(() => {
                    onSelect(project.id);
                    onClose();
                  })
                }
              >
                {t(project.closed ? '重新打开' : '切换到此工作区')}
              </button>
              <button
                onClick={() => {
                  setEditing(project.id);
                  setName(project.name);
                }}
              >
                {t('修改名称')}
              </button>
              {!project.closed && (
                <button onClick={() => run(() => onCloseProject(project.id))}>
                  {t('关闭工作区')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!visible.length && (
        <p>
          {t('没有匹配的工作区')}
          {query && <button onClick={() => setQuery('')}>{t('清除搜索')}</button>}
        </p>
      )}
      {visible.length > limit && (
        <button onClick={() => setLimit((count) => count + 50)}>{t('显示更多工作区')}</button>
      )}
      <div className="model-dialog-actions">
        <button onClick={onClose}>{t('关闭')}</button>
      </div>
    </dialog>
  );
}
