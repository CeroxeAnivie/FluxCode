import { useEffect, useRef, useState } from 'react';
import type { Schedule } from '../domain/schedules';
import { bridge } from '../infrastructure/bridge';
import { useAppearance } from '../application/AppearanceProvider';
import { ErrorNotice } from './ErrorNotice';
import { useModalDialog } from './useModalDialog';
export function SchedulesDialog({
  project,
  onClose,
  onOpen,
}: {
  project?: string;
  onClose: () => void;
  onOpen: (job: Schedule) => Promise<void>;
}) {
  const { t, language } = useAppearance();
  const dialog = useModalDialog();
  const [items, setItems] = useState<Schedule[]>([]);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;
    void bridge
      .subscribe((e) => {
        if (e.method === 'schedule/updated') setGeneration((v) => v + 1);
      })
      .then((fn) => {
        if (disposed) fn();
        else off = fn;
      })
      .catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  useEffect(() => {
    let active = true;
    void bridge
      .listSchedules()
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [generation]);
  async function run(action: () => Promise<unknown>, successMessage?: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setGeneration((v) => v + 1);
      if (successMessage) setNotice(t(successMessage));
    } catch (e) {
      setError(String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="capabilities-dialog"
      aria-label={t('定时任务')}
      onCancel={onClose}
    >
      <header>
        <h2>{t('定时任务')}</h2>
        <button onClick={onClose} aria-label={t('关闭')}>
          ×
        </button>
      </header>
      <p>
        {t(
          '仅在应用打开且引擎连接时运行。错过的任务不会补跑；异常中断后需手动恢复。每次最多运行一个定时任务。',
        )}
      </p>
      <form
        aria-busy={busy}
        onSubmit={(e) => {
          e.preventDefault();
          if (project && !busyRef.current)
            void run(async () => {
              await bridge.saveSchedule({
                id: crypto.randomUUID(),
                name,
                project,
                prompt,
                intervalMinutes: minutes,
                enabled: true,
                nextRun: 0,
                status: 'waiting',
                lastThreadId: null,
              });
              setName('');
              setPrompt('');
              setMinutes(60);
            }, '定时任务已创建');
        }}
      >
        <label className="form-field">
          {t('任务名称')}
          <input
            value={name}
            maxLength={200}
            required
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="form-field">
          {t('任务指令')}
          <textarea
            value={prompt}
            maxLength={100000}
            required
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
        <label className="form-field">
          {t('间隔分钟')}
          <input
            type="number"
            min={1}
            max={525600}
            required
            disabled={busy}
            value={minutes}
            onChange={(e) => setMinutes(e.target.valueAsNumber)}
          />
        </label>
        <p>{project ?? t('先打开一个项目')}</p>
        <button disabled={busy || !project}>{t('创建定时任务')}</button>
      </form>
      {error && (
        <p role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {items.map((job) => (
        <article key={job.id}>
          <strong>{job.name}</strong>
          <small>{job.project}</small>
          <p>
            {t(
              (
                {
                  running: '进行中',
                  completed: '已完成',
                  failed: '失败',
                  paused: '已暂停',
                  waiting: '等待执行',
                } as Record<string, string>
              )[job.status] ?? '状态未知',
            )}
            {job.enabled ? ' · ' + new Date(job.nextRun * 1000).toLocaleString(language) : ''}
          </p>
          <button
            disabled={busy || job.status === 'running'}
            onClick={() => void run(() => bridge.saveSchedule({ ...job, enabled: !job.enabled }))}
          >
            {t(job.enabled ? '暂停' : '恢复')}
          </button>
          <button disabled={busy || job.status === 'running'} onClick={() => setRemoving(job.id)}>
            {t('移除')}
          </button>
          {removing === job.id && (
            <div role="alert" className="schedule-remove-confirm">
              <span>{t('确认移除此定时任务？')}</span>
              <button disabled={busy} onClick={() => setRemoving(null)}>
                {t('取消')}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await bridge.removeSchedule(job.id);
                    setRemoving(null);
                  }, '定时任务已移除')
                }
              >
                {t('确认删除')}
              </button>
            </div>
          )}
          {job.lastThreadId && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await onOpen(job);
                  onClose();
                })
              }
            >
              {t('打开执行记录')}
            </button>
          )}
        </article>
      ))}
    </dialog>
  );
}
