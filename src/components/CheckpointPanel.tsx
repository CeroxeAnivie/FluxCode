import { Select } from './Select';
import { ErrorNotice } from './ErrorNotice';
import { useEffect, useState } from 'react';
import { bridge } from '../infrastructure/bridge';
import type { Checkpoint } from '../domain/git';
import { useAppearance } from '../application/AppearanceProvider';
export function CheckpointPanel({ root, onChanged }: { root: string; onChanged: () => void }) {
  const { t } = useAppearance();
  const [items, setItems] = useState<Checkpoint[]>([]);
  const [revision, setRevision] = useState('');
  const [label, setLabel] = useState('');
  const [path, setPath] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let active = true;
    void bridge
      .listCheckpoints(root)
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [root, generation]);
  async function run(restore: boolean) {
    setBusy(true);
    setError('');
    try {
      await bridge.gitAction(
        root,
        restore ? { type: 'restoreCheckpoint', revision, path } : { type: 'checkpoint', label },
      );
      setGeneration((v) => v + 1);
      setConfirm(false);
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="checkpoint-panel">
      <summary>{t('检查点与文件恢复')}</summary>
      <p>{t('保存当前已跟踪和未忽略文件，不改变暂存区。恢复前自动创建备份检查点。')}</p>
      <label>
        {t('检查点名称')}
        <input value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <button type="button" disabled={busy || !label.trim()} onClick={() => void run(false)}>
        {t('创建检查点')}
      </button>
      <label>
        {t('恢复来源')}
        <Select
          value={revision}
          onValueChange={(value) => {
            setRevision(value);
            setConfirm(false);
          }}
        >
          <option value="">{t('选择检查点')}</option>
          {items.map((item) => (
            <option key={item.revision} value={item.revision}>
              {item.label}
            </option>
          ))}
        </Select>
      </label>
      <label>
        {t('文件相对路径')}
        <input
          value={path}
          onChange={(e) => {
            setPath(e.target.value);
            setConfirm(false);
          }}
        />
      </label>
      {confirm && (
        <p role="status">{t('将用检查点内容替换此文件。当前内容会先保存到备份检查点。')}</p>
      )}
      <button
        type="button"
        disabled={busy || !revision || !path}
        onClick={() => (confirm ? void run(true) : setConfirm(true))}
      >
        {t(confirm ? '确认恢复此文件' : '恢复此文件')}
      </button>
      {error && (
        <p role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
    </details>
  );
}
