import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, FileCode2, Folder, GitBranch, RefreshCw, X } from 'lucide-react';
import { bridge } from '../infrastructure/bridge';
import type { Entry, Project, RepoStatus } from '../domain/types';
import { errorText } from '../application/useFluxCode';

export function Inspector({
  project,
  revision,
  onClose,
}: {
  project?: Project;
  revision: number;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'files' | 'changes'>('files');
  const [relative, setRelative] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [repo, setRepo] = useState<RepoStatus>({ branch: '', changes: [], git: false });
  const [preview, setPreview] = useState<{ name: string; content: string; diff: boolean } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const previewEpoch = useRef(0);
  useEffect(() => {
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
  async function openFile(path: string, diff = false, status = '') {
    if (!project) return;
    setError(null);
    const epoch = ++previewEpoch.current;
    try {
      let content: string;
      if (diff && status !== '??') {
        const [working, staged] = await Promise.all([
          bridge.fileDiff(project.path, path, false),
          bridge.fileDiff(project.path, path, true),
        ]);
        content =
          [working, staged ? '# 已暂存\n' + staged : ''].filter(Boolean).join('\n') ||
          '没有文本差异（文件可能为二进制或仅权限发生变化）。';
      } else {
        content = await bridge.readFile(project.path, path);
      }
      if (epoch === previewEpoch.current)
        setPreview({ name: path, content, diff: diff && status !== '??' });
    } catch (e) {
      if (epoch === previewEpoch.current) setError(errorText(e));
    }
  }
  return (
    <aside className="inspector">
      <header className="inspector-header">
        <div className="panel-tabs">
          <button
            className={tab === 'files' ? 'active' : ''}
            onClick={() => {
              setTab('files');
              setPreview(null);
            }}
          >
            文件
          </button>
          <button
            className={tab === 'changes' ? 'active' : ''}
            onClick={() => {
              setTab('changes');
              setPreview(null);
            }}
          >
            变更{repo.changes.length > 0 && <span>{repo.changes.length}</span>}
          </button>
        </div>
        <div className="panel-actions">
          <button
            className="icon-button"
            title="刷新工作区"
            aria-label="刷新工作区"
            onClick={() => setRefresh((v) => v + 1)}
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
          <button className="icon-button" aria-label="关闭右侧面板" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </header>
      {!project ? (
        <div className="panel-empty">
          <Folder size={30} />
          <strong>还没有打开项目</strong>
          <p>打开本地文件夹，查看文件与变更。</p>
        </div>
      ) : (
        <>
          <div className="inspector-breadcrumb">
            <Folder size={13} />
            <span title={project.path}>
              {project.name}
              {relative ? ` / ${relative}` : ''}
            </span>
          </div>
          {error && (
            <p className="panel-error" role="alert">
              {error}
            </p>
          )}
          {preview ? (
            <div className="file-preview">
              <header>
                <button
                  className="icon-button"
                  aria-label="返回文件列表"
                  onClick={() => setPreview(null)}
                >
                  <ArrowLeft size={14} />
                </button>
                <span title={preview.name}>{preview.name}</span>
                <small>只读</small>
              </header>
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
            </div>
          ) : tab === 'files' ? (
            <div className="file-list">
              {relative && (
                <button
                  className="file-row"
                  onClick={() => setRelative(relative.split('/').slice(0, -1).join('/'))}
                >
                  <ArrowLeft size={14} />
                  上一级
                </button>
              )}
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  className="file-row"
                  onClick={() =>
                    entry.directory ? setRelative(entry.path) : void openFile(entry.path)
                  }
                >
                  {entry.directory ? (
                    <Folder size={15} className="folder-icon" />
                  ) : (
                    <FileCode2 size={15} />
                  )}
                  <span>{entry.name}</span>
                  {entry.directory && <ChevronRight size={12} />}
                </button>
              ))}
              {!entries.length && !loading && !error && (
                <p className="panel-note">此目录没有可显示的文件。</p>
              )}
            </div>
          ) : (
            <div className="file-list">
              <div className="git-label">
                <GitBranch size={13} />
                {repo.branch || (repo.git ? '分离的 HEAD' : '无 Git 仓库')}
              </div>
              {repo.changes.map((change) => (
                <button
                  key={change.path}
                  className="file-row change-row"
                  onClick={() => void openFile(change.path, true, change.status)}
                >
                  <FileCode2 size={15} />
                  <span title={change.path}>{change.path}</span>
                  <b>{change.status.trim()}</b>
                </button>
              ))}
              {repo.git && !repo.changes.length && (
                <div className="panel-empty">
                  <GitBranch size={27} />
                  <strong>工作区很干净</strong>
                  <p>文件修改后会出现在这里。</p>
                </div>
              )}
            </div>
          )}
          <footer className="inspector-footer">
            <GitBranch size={12} />
            <span>{repo.branch || '本地工作区'}</span>
            <span>{repo.changes.length} 个变更</span>
          </footer>
        </>
      )}
    </aside>
  );
}
