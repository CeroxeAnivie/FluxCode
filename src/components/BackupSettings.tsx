import { useEffect, useRef, useState } from 'react';
import { ArchiveRestore, FolderOpen, ShieldCheck } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { useAppearance } from '../application/AppearanceProvider';
import {
  backups,
  type BackupDetail,
  type BackupProgress,
  type BackupSummary,
} from '../infrastructure/backup';
import { restoreBlockers } from '../infrastructure/backup';
import { allowWorkspaceNavigation } from '../infrastructure/navigationGuard';
import { ErrorNotice } from './ErrorNotice';

const formatSize = (size: number) =>
  size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KiB` : `${(size / (1024 * 1024)).toFixed(1)} MiB`;
const DETAIL_PAGE_SIZE = 50;

export function BackupSettings({
  busyWork,
  unsavedSettings,
  hasUnsentDraft = false,
  onActivity,
}: {
  busyWork: boolean;
  unsavedSettings: boolean;
  hasUnsentDraft?: boolean;
  onActivity: (busy: boolean) => void;
}) {
  const { t, language } = useAppearance();
  const [items, setItems] = useState<BackupSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [manualJobId, setManualJobId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; action: 'restore' | 'remove' } | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<BackupDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [verified, setVerified] = useState<Record<string, 'passed' | 'failed'>>({});
  const detailRequest = useRef(0);

  async function reload(): Promise<boolean> {
    if (!isTauri()) return false;
    setListLoading(true);
    setListError('');
    try {
      setItems(await backups.list());
      return true;
    } catch (cause) {
      setListError(String(cause));
      return false;
    } finally {
      setListLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    onActivity(true);
    setError('');
    setNotice('');
    setBlockers([]);
    try {
      await action();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message === '备份已取消') setNotice(t('备份已取消，未创建新备份。'));
      else setError(message);
    } finally {
      setBusy(false);
      setProgress(null);
      setManualJobId(null);
      setCancelling(false);
      onActivity(false);
    }
  }

  async function loadDetail(id: string, offset: number) {
    const request = ++detailRequest.current;
    setDetailLoading(true);
    setDetailError('');
    try {
      const next = await backups.detail(id, offset, DETAIL_PAGE_SIZE);
      if (request !== detailRequest.current) return;
      setDetail((current) =>
        offset === 0 || !current || current.summary.id !== id
          ? next
          : { ...next, files: [...current.files, ...next.files] },
      );
    } catch (cause) {
      if (request === detailRequest.current) setDetailError(String(cause));
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }

  function toggleDetail(item: BackupSummary) {
    detailRequest.current++;
    if (expanded === item.id) {
      setExpanded(null);
      return;
    }
    setExpanded(item.id);
    setDetail(null);
    setDetailError('');
    if (!item.error) void loadDetail(item.id, 0);
  }

  async function cancelManualBackup() {
    if (!manualJobId || cancelling) return;
    setCancelling(true);
    try {
      if (!(await backups.cancel(manualJobId))) {
        setCancelling(false);
        setNotice(t('备份已进入发布阶段，无法取消。'));
      }
    } catch (cause) {
      setCancelling(false);
      setError(String(cause));
    }
  }

  return (
    <section className="backup-settings">
      <div className="backup-heading">
        <div>
          <h3>{t('数据备份与恢复')}</h3>
          <p>
            {t(
              '备份保存在程序目录的 data/backups。包含任务、配置和草稿；不包含项目源文件、外部附件和系统凭据。',
            )}
          </p>
        </div>
        <div className="backup-heading-actions">
          <button
            type="button"
            disabled={busy || !isTauri()}
            onClick={() => void run(() => backups.openLocation())}
          >
            <FolderOpen size={16} /> {t('打开备份位置')}
          </button>
          <button
            type="button"
            disabled={busy || busyWork || !isTauri()}
            onClick={() =>
              void run(async () => {
                setProgress({ jobId: '', stage: 'preparing', files: 0, bytes: 0 });
                const job = backups.createManual(setProgress);
                setManualJobId(job.id);
                const created = await job.promise;
                setNotice(`${t('备份已完成并保存在本机。')} ${formatSize(created.sizeBytes)}`);
                if (!(await reload())) setError(t('备份已保存，但列表刷新失败。'));
              })
            }
          >
            <ShieldCheck size={16} /> {t('立即备份')}
          </button>
        </div>
      </div>
      {progress && (
        <div className="backup-progress" role="status">
          <div>
            <strong>
              {t(
                cancelling
                  ? '正在取消备份…'
                  : progress.stage === 'preparing'
                    ? '正在准备备份…'
                    : progress.stage === 'copying'
                      ? '正在复制并校验…'
                      : '正在发布备份…',
              )}
            </strong>
            <span>
              {progress.files} {t('个文件')} · {formatSize(progress.bytes)}
            </span>
          </div>
          <progress aria-label={t('备份进度')} />
          {manualJobId && progress.jobId === manualJobId && progress.stage !== 'publishing' && (
            <button type="button" disabled={cancelling} onClick={() => void cancelManualBackup()}>
              {t('取消备份')}
            </button>
          )}
        </div>
      )}
      {busy && !progress && <p role="status">{t('正在处理备份…')}</p>}
      {busyWork && <p role="status">{t('任务或终端运行时无法备份或恢复。')}</p>}
      {unsavedSettings && (
        <p role="status">{t('仍有未保存的设置，请先保存或放弃修改后再恢复。')}</p>
      )}
      {hasUnsentDraft && <p role="status">{t('仍有未发送的输入，请先发送或清空后再恢复。')}</p>}
      {listLoading && !items.length && <p role="status">{t('正在读取备份列表…')}</p>}
      {listError && (
        <div role="alert" className="backup-list-error">
          <span>{t('无法读取备份列表，请重试。')}</span>
          <ErrorNotice message={listError} />
          <button type="button" disabled={busy || listLoading} onClick={() => void reload()}>
            {t('重试读取备份列表')}
          </button>
        </div>
      )}
      {!listLoading && !listError && !items.length && (
        <p className="field-help">{t('尚无备份。')}</p>
      )}
      <div className="backup-list">
        {items.map((item) => (
          <div className="backup-entry" key={item.id}>
            <div className="backup-row">
              <div>
                <strong>
                  {new Date(item.createdAt).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN')}
                </strong>
                <small>
                  {item.error
                    ? t('备份清单损坏，无法恢复。')
                    : `${formatSize(item.sizeBytes)} · ${item.fileCount} ${t('个文件')} · ${t(item.automatic ? '自动备份' : '手动备份')}`}
                </small>
              </div>
              <div className="backup-actions">
                <button
                  type="button"
                  aria-expanded={expanded === item.id}
                  disabled={busy}
                  onClick={() => toggleDetail(item)}
                >
                  {t('详情')}
                </button>
                <button
                  type="button"
                  disabled={busy || !!item.error}
                  onClick={() =>
                    void run(async () => {
                      try {
                        await backups.verify(item.id);
                        setVerified((current) => ({ ...current, [item.id]: 'passed' }));
                        setNotice(t('备份校验通过。'));
                      } catch (cause) {
                        setVerified((current) => ({ ...current, [item.id]: 'failed' }));
                        throw cause;
                      }
                    })
                  }
                >
                  {t('校验')}
                </button>
                <button
                  type="button"
                  disabled={busy || busyWork || unsavedSettings || hasUnsentDraft || !!item.error}
                  onClick={() => setConfirm({ id: item.id, action: 'restore' })}
                >
                  <ArchiveRestore size={15} /> {t('恢复')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirm({ id: item.id, action: 'remove' })}
                >
                  {t('删除')}
                </button>
              </div>
            </div>
            {expanded === item.id && (
              <div className="backup-detail">
                <dl>
                  <div>
                    <dt>{t('状态')}</dt>
                    <dd>
                      {t(
                        item.error
                          ? '清单损坏'
                          : verified[item.id] === 'passed'
                            ? '校验通过'
                            : verified[item.id] === 'failed'
                              ? '校验失败'
                              : '尚未校验',
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('备份类型')}</dt>
                    <dd>{t(item.automatic ? '自动备份' : '手动备份')}</dd>
                  </div>
                  <div>
                    <dt>{t('数据范围')}</dt>
                    <dd>{t('程序配置、会话历史、任务索引与本地界面状态')}</dd>
                  </div>
                </dl>
                {item.error && (
                  <p role="alert">
                    <ErrorNotice message={item.error} />
                  </p>
                )}
                {detailError && (
                  <div role="alert" className="backup-list-error">
                    <span>{t('无法读取备份详情，请重试。')}</span>
                    <ErrorNotice message={detailError} />
                    <button
                      type="button"
                      disabled={detailLoading}
                      onClick={() => void loadDetail(item.id, 0)}
                    >
                      {t('重试读取备份详情')}
                    </button>
                  </div>
                )}
                {detail && detail.summary.id === item.id && (
                  <>
                    <h4>
                      {t('文件清单')} · {detail.totalFiles}
                    </h4>
                    <ul className="backup-files">
                      {detail.files.map((file) => (
                        <li key={file.path}>
                          <code title={file.sha256}>{file.path}</code>
                          <span>{formatSize(file.sizeBytes)}</span>
                        </li>
                      ))}
                    </ul>
                    {detail.files.length < detail.totalFiles && (
                      <button
                        type="button"
                        disabled={detailLoading}
                        onClick={() => void loadDetail(item.id, detail.files.length)}
                      >
                        {t('加载更多文件')}
                      </button>
                    )}
                  </>
                )}
                {detailLoading && <p role="status">{t('正在读取备份详情…')}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
      {confirm && (
        <div className="backup-confirm" role="alert">
          <p>
            {t(
              confirm.action === 'restore'
                ? '恢复前会自动备份当前数据，然后重启应用。请先保存打开的文件和待发送内容。'
                : '确认删除此备份？',
            )}
          </p>
          <button type="button" disabled={busy} onClick={() => setConfirm(null)}>
            {t('取消')}
          </button>
          <button
            type="button"
            disabled={
              busy ||
              (confirm.action === 'restore' && (busyWork || unsavedSettings || hasUnsentDraft))
            }
            onClick={() =>
              void run(async () => {
                if (confirm.action === 'restore') {
                  if (!allowWorkspaceNavigation()) {
                    setBlockers(['文件编辑草稿未能保存，请保留当前窗口并重试。']);
                    return;
                  }
                  const issues = restoreBlockers();
                  if (issues.length) {
                    setBlockers(issues);
                    return;
                  }
                  const safety = await backups.restore(confirm.id);
                  setNotice(`${t('当前状态已保护为备份')} ${safety.id}`);
                  await backups.restart();
                } else {
                  await backups.remove(confirm.id);
                  setVerified((current) => {
                    const next = { ...current };
                    delete next[confirm.id];
                    return next;
                  });
                  if (expanded === confirm.id) setExpanded(null);
                  setNotice(t('备份已删除。'));
                  await reload();
                }
                setConfirm(null);
              })
            }
          >
            {t(confirm.action === 'restore' ? '确认恢复并重启' : '确认删除')}
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="channel-notice">
          {notice}
        </p>
      )}
      {!!blockers.length && (
        <div role="alert">
          {blockers.map((blocker) => (
            <p key={blocker}>{t(blocker)}</p>
          ))}
        </div>
      )}
      {error && (
        <p role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
      <p className="field-help">
        <FolderOpen size={13} />{' '}
        {t('备份随程序数据目录保留；移动程序目录时请连同 data 文件夹一起移动。')}
      </p>
    </section>
  );
}
