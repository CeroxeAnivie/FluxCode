import { WorkspaceFileList } from './WorkspaceFileList';
import { WorkspaceSearch } from './WorkspaceSearch';
import { ErrorNotice } from './ErrorNotice';
import { useAppearance } from '../application/AppearanceProvider';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
const CodeEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })));
const DiffReview = lazy(() => import('./DiffReview').then((m) => ({ default: m.DiffReview })));
import { ArrowLeft, ExternalLink, FileCode2, Folder, GitBranch, RefreshCw, X } from 'lucide-react';
import { bridge } from '../infrastructure/bridge';
import { allowWorkspaceNavigation } from '../infrastructure/navigationGuard';
import type { Entry, Project, RepoStatus } from '../domain/types';
import { errorText } from '../application/useFluxCode';
import { FileEditor } from './FileEditor';
import { GitActions } from './GitActions';
import { GitConflictEditor } from './GitConflictEditor';
import { gitChangeKind } from '../domain/git';

export function Inspector({
  project,
  revision,
  onClose,
  onReference,
  onOpenWorkspace,
}: {
  project?: Project;
  revision: number;
  onClose: () => void;
  onReference: (path: string, kind: 'file' | 'directory') => void;
  onOpenWorkspace: (path: string) => void;
}) {
  const { t } = useAppearance();
  const [tab, setTab] = useState<'files' | 'changes'>('files');
  const [editing, setEditing] = useState(false);
  const [conflictPath, setConflictPath] = useState<string | null>(null);
  const [relative, setRelative] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [repo, setRepo] = useState<RepoStatus>({ branch: '', changes: [], git: false });
  const [preview, setPreview] = useState<{
    name: string;
    content: string;
    diff: boolean;
    staged?: string;
    status?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const previewEpoch = useRef(0);
  const lastFile = useRef<string | undefined>(undefined);
  const inspector = useRef<HTMLElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const previewOrigin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (preview && !editing) backButton.current?.focus();
  }, [preview?.name, editing]);
  useEffect(() => {
    setEditing(false);
    setConflictPath(null);
    setRelative('');
    setPreview(null);
    previewEpoch.current++;
  }, [project?.id]);
  useEffect(() => {
    if (!project || !bridge.available) return;
    let disposed = false;
    setLoading(true);
    setError(null);
    void Promise.allSettled([
      bridge.listFiles(project.path, relative),
      bridge.repoStatus(project.path),
    ]).then(([files, status]) => {
      if (disposed) return;
      if (files.status === 'fulfilled') setEntries(files.value);
      else {
        setEntries([]);
        setError(errorText(files.reason));
      }
      if (status.status === 'fulfilled') setRepo(status.value);
      else {
        setRepo({ git: false, branch: '', changes: [] });
        setError(errorText(status.reason));
      }
      setLoading(false);
    });
    return () => {
      disposed = true;
    };
  }, [project, relative, revision, refresh]);
  async function openFile(path: string, diff = false, status = '', preserveOrigin = false) {
    if (!allowWorkspaceNavigation()) return false;
    if (!project) return false;
    if (!preserveOrigin) {
      previewOrigin.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setError(null);
    setEditing(false);
    const epoch = ++previewEpoch.current;
    try {
      let content: string;
      let stagedContent: string | undefined;
      if (diff && status !== '??') {
        const [working, staged] = await Promise.all([
          bridge.fileDiff(project.path, path, false),
          bridge.fileDiff(project.path, path, true),
        ]);
        content = working;
        stagedContent = staged;
      } else {
        content = await bridge.readFile(project.path, path);
      }
      if (epoch === previewEpoch.current) {
        setPreview({
          name: path,
          content,
          diff: diff && status !== '??',
          staged: stagedContent,
          status,
        });
        return true;
      }
    } catch (e) {
      if (epoch === previewEpoch.current) setError(errorText(e));
    }
    return false;
  }
  function closePreview() {
    const origin = previewOrigin.current;
    const path = preview?.name;
    lastFile.current = path;
    setEditing(false);
    setPreview(null);
    requestAnimationFrame(() => {
      if (origin?.isConnected) {
        origin.focus();
        return;
      }
      const row = Array.from(
        inspector.current?.querySelectorAll<HTMLButtonElement>('.file-row[data-path]') ?? [],
      ).find((button) => button.dataset.path === path);
      (row ?? inspector.current?.querySelector<HTMLButtonElement>('.panel-tabs .active'))?.focus();
    });
  }
  return (
    <aside className="inspector" ref={inspector}>
      <header className="inspector-header">
        <div className="panel-tabs">
          <button
            className={tab === 'files' ? 'active' : ''}
            onClick={() => {
              if (!allowWorkspaceNavigation()) return;
              setTab('files');
              setPreview(null);
            }}
          >
            {t('文件')}
          </button>
          <button
            className={tab === 'changes' ? 'active' : ''}
            onClick={() => {
              if (!allowWorkspaceNavigation()) return;
              setTab('changes');
              setPreview(null);
            }}
          >
            {t('变更')}
            {repo.changes.length > 0 && <span>{repo.changes.length}</span>}
          </button>
        </div>
        <div className="panel-actions">
          <button
            className="icon-button"
            title={t('刷新工作区')}
            aria-label={t('刷新工作区')}
            onClick={() => setRefresh((v) => v + 1)}
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
          <button className="icon-button" aria-label={t('关闭右侧面板')} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </header>
      {!project ? (
        <div className="panel-empty">
          <Folder size={30} />
          <strong>{t('还没有打开项目')}</strong>
          <p>{t('打开本地文件夹，查看文件与变更。')}</p>
        </div>
      ) : (
        <>
          <WorkspaceSearch
            key={project.id}
            root={project.path}
            onOpen={(path) => void openFile(path)}
          />
          <div className="inspector-breadcrumb">
            <Folder size={13} />
            <span title={project.path}>
              {project.name}
              {relative ? ` / ${relative}` : ''}
            </span>
          </div>
          {error && (
            <p className="panel-error" role="alert">
              <ErrorNotice message={error} />
            </p>
          )}
          {preview && editing ? (
            <FileEditor
              key={`${project.id}:${preview.name}`}
              root={project.path}
              path={preview.name}
              content={preview.content}
              onSaved={() => setRefresh((v) => v + 1)}
              onClose={closePreview}
            />
          ) : preview ? (
            <div className="file-preview">
              <header>
                <button
                  ref={backButton}
                  className="icon-button"
                  aria-label={t('返回文件列表')}
                  onClick={closePreview}
                >
                  <ArrowLeft size={14} />
                </button>
                <span title={preview.name}>{preview.name}</span>
                {!preview.diff && (
                  <button
                    className="icon-button"
                    title={t('使用默认应用打开文件')}
                    aria-label={t('使用默认应用打开文件')}
                    onClick={() =>
                      void bridge
                        .openWorkspaceFile(project.path, preview.name)
                        .catch((cause) => setError(errorText(cause)))
                    }
                  >
                    <ExternalLink size={14} />
                  </button>
                )}
                {!preview.status?.includes('D') && (
                  <button onClick={() => onReference(preview.name, 'file')}>
                    {t('引用到对话')}
                  </button>
                )}
                {!preview.diff && <button onClick={() => setEditing(true)}>{t('编辑')}</button>}
              </header>
              {preview.diff ? (
                <Suspense fallback={<p>{t('正在加载…')}</p>}>
                  <DiffReview
                    key={preview.name}
                    content={preview.content}
                    staged={preview.staged}
                    root={project.path}
                    path={preview.name}
                    status={preview.status}
                    onChanged={async () => {
                      setRefresh((value) => value + 1);
                      await openFile(preview.name, true, preview.status, true);
                    }}
                  />
                </Suspense>
              ) : preview.content.length > 50_000 ? (
                <Suspense fallback={<p>{t('正在加载…')}</p>}>
                  <CodeEditor path={preview.name} value={preview.content} readOnly />
                </Suspense>
              ) : (
                <pre>
                  {preview.content.split('\n').map((line, i) => (
                    <div
                      className={
                        preview.diff
                          ? line.startsWith('+')
                            ? 'diff-add'
                            : line.startsWith('-')
                              ? 'diff-remove'
                              : ''
                          : ''
                      }
                      key={i}
                    >
                      <span className="line-number">{i + 1}</span>
                      <span>{line || ' '}</span>
                    </div>
                  ))}
                </pre>
              )}
            </div>
          ) : tab === 'files' ? (
            <WorkspaceFileList
              key={project.id + ':' + relative}
              entries={entries}
              parent={!!relative}
              restorePath={lastFile.current}
              onParent={() => setRelative(relative.split('/').slice(0, -1).join('/'))}
              onOpen={(entry) =>
                entry.directory ? setRelative(entry.path) : void openFile(entry.path)
              }
            />
          ) : (
            <div className="file-list">
              <div className="git-label">
                <GitBranch size={13} />
                {repo.branch || (repo.git ? t('分离的 HEAD') : t('无 Git 仓库'))}
              </div>
              {repo.git && (
                <GitActions
                  key={project.path}
                  root={project.path}
                  onOpenWorkspace={onOpenWorkspace}
                  changes={repo.changes}
                  onChanged={() => setRefresh((v) => v + 1)}
                  onOpenConflict={(path) => {
                    setConflictPath(path);
                  }}
                />
              )}
              {repo.changes.map((change) => (
                <button
                  key={change.path}
                  data-path={change.path}
                  className="file-row change-row"
                  aria-label={`${t(gitChangeKind(change.status))} ${change.path}`}
                  onClick={() => {
                    if (change.status === '??' && /[\\/]$/.test(change.path)) {
                      setRelative(change.path.replace(/[\\/]+$/, ''));
                      setTab('files');
                      requestAnimationFrame(() =>
                        inspector.current
                          ?.querySelector<HTMLButtonElement>('.panel-tabs button')
                          ?.focus(),
                      );
                    } else {
                      void openFile(change.path, true, change.status);
                    }
                  }}
                >
                  {change.status === '??' && /[\\/]$/.test(change.path) ? (
                    <Folder size={15} className="folder-icon" />
                  ) : (
                    <FileCode2 size={15} />
                  )}
                  <span title={change.path}>{change.path}</span>
                  <b title={change.status}>{t(gitChangeKind(change.status))}</b>
                </button>
              ))}
              {repo.git && !repo.changes.length && (
                <div className="panel-empty">
                  <GitBranch size={27} />
                  <strong>{t('工作区很干净')}</strong>
                  <p>{t('文件修改后会出现在这里。')}</p>
                </div>
              )}
            </div>
          )}
          <footer className="inspector-footer">
            <GitBranch size={12} />
            <span>{repo.branch || t('本地工作区')}</span>
            <span>
              {repo.changes.length} {t('个变更')}
            </span>
          </footer>
        </>
      )}
      {conflictPath && project && (
        <GitConflictEditor
          root={project.path}
          path={conflictPath}
          onResolved={() => setRefresh((value) => value + 1)}
          onClose={() => setConflictPath(null)}
        />
      )}
    </aside>
  );
}
