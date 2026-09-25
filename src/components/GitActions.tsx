import { Select } from './Select';
import { ErrorNotice } from './ErrorNotice';
import { CheckpointPanel } from './CheckpointPanel';
import { useEffect, useState } from 'react';
import { bridge } from '../infrastructure/bridge';
import {
  gitChangeActions,
  gitChangeKind,
  type GitAction,
  type GitBranches,
  type GitOperation,
} from '../domain/git';
import type { Change } from '../domain/types';
import { useAppearance } from '../application/AppearanceProvider';
export function GitActions({
  root,
  changes,
  onChanged,
  onOpenConflict,
  onOpenWorkspace,
}: {
  root: string;
  changes: Change[];
  onChanged: () => void;
  onOpenConflict: (path: string) => void;
  onOpenWorkspace: (path: string) => void;
}) {
  const { t } = useAppearance();
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [branches, setBranches] = useState<GitBranches>({ current: '', branches: [] });
  const [operation, setOperation] = useState<GitOperation>({
    kind: null,
    conflicts: [],
    dirty: false,
  });
  const [target, setTarget] = useState('');
  const [pending, setPending] = useState<
    { type: 'merge' | 'rebase'; branch: string } | { type: 'abortOperation' } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [createdWorktree, setCreatedWorktree] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([bridge.gitBranches(root), bridge.gitOperation(root)])
      .then(([v, state]) => {
        if (active) {
          setBranches(v);
          setOperation(state);
          setTarget((current) =>
            v.branches.some((branch) => branch === current && branch !== v.current)
              ? current
              : (v.branches.find((branch) => branch !== v.current) ?? ''),
          );
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [root, changes]);
  async function run(action: GitAction) {
    setBusy(true);
    setError('');
    try {
      await bridge.gitAction(root, action);
      if (action.type === 'createWorktree') setCreatedWorktree(action.path);
      if (action.type === 'commit') setMessage('');
    } catch (e) {
      setError(String(e));
    } finally {
      try {
        setOperation(await bridge.gitOperation(root));
        setBranches(await bridge.gitBranches(root));
        onChanged();
      } catch (cause) {
        setError((current) => current || String(cause));
      }
      setBusy(false);
    }
  }
  return (
    <section className="git-actions">
      <CheckpointPanel root={root} onChanged={onChanged} />
      {operation.kind ? (
        <div className="git-operation" role="status">
          <strong>{t(operation.kind === 'merge' ? '正在合并' : '正在变基')}</strong>
          {operation.conflicts.length > 0 ? (
            <>
              <p>{t('先解决冲突文件，再继续操作。')}</p>
              {operation.conflicts.map((conflict) => (
                <div className="git-conflict-row" key={conflict}>
                  <span title={conflict}>{conflict}</span>
                  <button disabled={busy} onClick={() => onOpenConflict(conflict)}>
                    {t('手动编辑')}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run({ type: 'resolveConflict', path: conflict, version: 'ours' })
                    }
                  >
                    {t('保留当前版本')}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run({ type: 'resolveConflict', path: conflict, version: 'theirs' })
                    }
                  >
                    {t('采用传入版本')}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void run({ type: 'stage', path: conflict })}
                  >
                    {t('标记已解决')}
                  </button>
                </div>
              ))}
            </>
          ) : (
            <p>{t('冲突已解决，可以继续操作。')}</p>
          )}
          <div className="git-operation-actions">
            <button
              disabled={busy || operation.conflicts.length > 0}
              onClick={() => void run({ type: 'continueOperation' })}
            >
              {t('继续操作')}
            </button>
            <button disabled={busy} onClick={() => setPending({ type: 'abortOperation' })}>
              {t('中止操作')}
            </button>
          </div>
        </div>
      ) : (
        <div className="git-operation">
          <label>
            {t('目标分支')}
            <Select
              aria-label={t('目标分支')}
              value={target}
              disabled={busy || branches.branches.length < 2}
              onValueChange={setTarget}
            >
              {!target && <option value="">{t('选择目标分支')}</option>}
              {branches.branches
                .filter((branch) => branch !== branches.current)
                .map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
            </Select>
          </label>
          <div className="git-operation-actions">
            <button
              disabled={busy || operation.dirty || !target}
              onClick={() => setPending({ type: 'merge', branch: target })}
            >
              {t('合并分支')}
            </button>
            <button
              disabled={busy || operation.dirty || !target}
              onClick={() => setPending({ type: 'rebase', branch: target })}
            >
              {t('变基到分支')}
            </button>
          </div>
          {operation.dirty && <p>{t('请先提交或贮藏未提交变更。')}</p>}
        </div>
      )}
      {pending && (
        <div className="git-operation-confirm" role="alert">
          <p>
            {pending.type === 'abortOperation'
              ? t('中止会丢弃这次合并或变基中的冲突编辑；未跟踪文件会保留。')
              : `${t(pending.type === 'merge' ? '合并分支' : '变基到分支')} ${pending.branch} · ${t('操作前会创建恢复点。')}`}
          </p>
          <button onClick={() => setPending(null)}>{t('取消')}</button>
          <button
            disabled={busy}
            onClick={() => {
              const action = pending;
              setPending(null);
              void run(action);
            }}
          >
            {t('确认继续')}
          </button>
        </div>
      )}
      <Select
        aria-label={t('当前分支')}
        value={branches.current}
        disabled={busy || !!operation.kind}
        onValueChange={(value) => void run({ type: 'switchBranch', name: value })}
      >
        {!branches.current && <option value="">HEAD</option>}
        {branches.branches.map((b) => (
          <option key={b}>{b}</option>
        ))}
      </Select>
      <details>
        <summary>{t('分支与工作树')}</summary>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('新分支名称')}
          aria-label={t('新分支名称')}
        />
        <button
          disabled={busy || !!operation.kind || !name.trim()}
          onClick={() => void run({ type: 'createBranch', name })}
        >
          {t('创建并切换')}
        </button>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={t('新工作树绝对路径')}
          aria-label={t('新工作树绝对路径')}
        />
        <button
          disabled={busy || !!operation.kind || !path || !name}
          onClick={() => void run({ type: 'createWorktree', path, branch: name })}
        >
          {t('创建工作树')}
        </button>
        {createdWorktree && (
          <div role="status">
            <span>{t('工作树已创建')}</span>
            <button onClick={() => onOpenWorkspace(createdWorktree)}>{t('打开工作树')}</button>
          </div>
        )}
      </details>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t('提交说明')}
        aria-label={t('提交说明')}
        maxLength={10000}
      />
      <button
        disabled={
          busy ||
          !!operation.kind ||
          !message.trim() ||
          !changes.some((c) => c.status[0] !== ' ' && c.status[0] !== '?')
        }
        onClick={() => void run({ type: 'commit', message })}
      >
        {t('提交已暂存变更')}
      </button>
      {error && (
        <p role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
      {changes.map((change) => {
        const actions = gitChangeActions(change.status);
        const kind = t(gitChangeKind(change.status));
        return (
          <div
            className="git-action-row"
            key={change.path}
            role="group"
            aria-label={`${kind} ${change.path}`}
          >
            <span title={`${kind} · ${change.path}`}>{change.path}</span>
            {actions.stage && (
              <button
                disabled={busy || !!operation.kind}
                aria-label={`${t('暂存')} ${change.path}`}
                onClick={() => void run({ type: 'stage', path: change.path })}
              >
                {t('暂存')}
              </button>
            )}
            {actions.unstage && (
              <button
                disabled={busy || !!operation.kind}
                aria-label={`${t('取消暂存')} ${change.path}`}
                onClick={() => void run({ type: 'unstage', path: change.path })}
              >
                {t('取消暂存')}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
