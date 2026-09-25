import { useMemo, useState } from 'react';
import { useAppearance } from '../application/AppearanceProvider';
import {
  mergeProviderProfiles,
  type ImportConflictStrategy,
  type ProviderProfile,
} from '../domain/provider';
import { bridge } from '../infrastructure/bridge';
import { ErrorNotice } from './ErrorNotice';

export function ChannelTransfer({
  profiles,
  onProfiles,
}: {
  profiles: ProviderProfile[];
  onProfiles: (rows: ProviderProfile[]) => void;
}) {
  const { t } = useAppearance();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ProviderProfile[] | null>(null);
  const [strategy, setStrategy] = useState<ImportConflictStrategy>('rename');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const merged = useMemo(
    () => (preview ? mergeProviderProfiles(profiles, preview, strategy) : null),
    [preview, profiles, strategy],
  );
  const selectedProfiles = profiles.filter((profile) => selected.includes(profile.name));

  async function exportProfiles(rows: ProviderProfile[]) {
    await run(async () => {
      const content = await bridge.encodeProviderProfiles(rows);
      if (await bridge.exportDocument('FluxCode-channels.toml', content)) {
        setNotice(t('渠道已导出，密钥未包含在文件中。'));
      }
    });
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="channel-transfer">
      <div className="channel-transfer-actions">
        <button disabled={busy} onClick={() => setOpen(!open)}>
          {t('批量导入渠道')}
        </button>
        <button disabled={busy || !profiles.length} onClick={() => void exportProfiles(profiles)}>
          {t('导出全部渠道')}
        </button>
        <button disabled={busy || !profiles.length} onClick={() => setSelecting(!selecting)}>
          {t('导出所选渠道')}
        </button>
      </div>
      {selecting && (
        <div className="channel-import-form">
          <p>{t('选择要导出的渠道；密钥不会写入文件。')}</p>
          <div className="channel-transfer-actions">
            <button disabled={busy} onClick={() => setSelected(profiles.map((row) => row.name))}>
              {t('全选')}
            </button>
            <button disabled={busy || !selected.length} onClick={() => setSelected([])}>
              {t('清除选择')}
            </button>
          </div>
          <ul className="import-preview">
            {profiles.map((profile) => (
              <li key={profile.name}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(profile.name)}
                    disabled={busy}
                    onChange={(event) =>
                      setSelected((before) =>
                        event.target.checked
                          ? [...before, profile.name]
                          : before.filter((name) => name !== profile.name),
                      )
                    }
                  />
                  {profile.name}
                </label>
              </li>
            ))}
          </ul>
          <button
            className="primary-button"
            disabled={busy || !selectedProfiles.length}
            onClick={() => void exportProfiles(selectedProfiles)}
          >
            {t('导出所选渠道')} · {selectedProfiles.length}
          </button>
        </div>
      )}
      {open && (
        <div className="channel-import-form">
          <p>
            {t(
              '粘贴渠道 TOML 或选择文件。预览后一次导入；同名默认自动编号，也可跳过或替换。密钥需在本机配置。',
            )}
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const value = await bridge.readDocument(['toml']);
                if (value !== null) {
                  const decoded = await bridge.decodeProviderProfiles(value);
                  setText(value);
                  setPreview(decoded);
                }
              })
            }
          >
            {t('选择渠道文件')}
          </button>
          <label className="form-field">
            {t('渠道 TOML')}
            <textarea
              rows={6}
              value={text}
              maxLength={8_388_608}
              disabled={busy}
              onChange={(event) => {
                setText(event.target.value);
                setPreview(null);
              }}
              spellCheck={false}
            />
          </label>
          {!preview && (
            <button
              disabled={busy || !text.trim()}
              onClick={() =>
                void run(async () => {
                  setPreview(await bridge.decodeProviderProfiles(text));
                })
              }
            >
              {t('预览导入')}
            </button>
          )}
          {merged && (
            <>
              <fieldset className="channel-conflict-options">
                <legend>{t('同名渠道处理')}</legend>
                {(['rename', 'skip', 'replace'] as const).map((option) => (
                  <label key={option}>
                    <input
                      type="radio"
                      name="channel-import-strategy"
                      checked={strategy === option}
                      onChange={() => setStrategy(option)}
                    />
                    {t(
                      option === 'rename'
                        ? '自动编号保留全部'
                        : option === 'skip'
                          ? '跳过同名渠道'
                          : '替换同名渠道',
                    )}
                  </label>
                ))}
              </fieldset>
              <p role="status">
                {t('待导入渠道')} · {merged.added.length}
              </p>
              {!!merged.renamed && (
                <p role="status">
                  {t('重名渠道自动编号')} · {merged.renamed}
                </p>
              )}
              {!!merged.isolatedCredentials && (
                <p role="status">
                  {t('相同地址与凭据标识已分离，导入后需为这些渠道设置密钥。')} ·{' '}
                  {merged.isolatedCredentials}
                </p>
              )}
              {!!merged.skipped && (
                <p role="status">
                  {t('跳过渠道')} · {merged.skipped}
                </p>
              )}
              {!!merged.replaced && (
                <p role="alert">
                  {t('将替换同名渠道配置；原配置无法从此操作恢复。')} · {merged.replaced}
                </p>
              )}
              <ul className="import-preview">
                {merged.added.map((row) => (
                  <li key={row.name}>
                    {row.name} · {row.models?.length ?? 1} {t('个模型')}
                  </li>
                ))}
              </ul>
              <button
                className="primary-button"
                disabled={busy || !merged.added.length || merged.profiles.length > 256}
                onClick={() =>
                  void run(async () => {
                    await bridge.saveProviderProfiles(merged.profiles, profiles);
                    onProfiles(merged.profiles);
                    setPreview(null);
                    setText('');
                    setOpen(false);
                    setNotice(t('全部渠道已导入'));
                  })
                }
              >
                {t('导入全部渠道')}
              </button>
              {merged.profiles.length > 256 && <p role="alert">{t('渠道总数不能超过 256。')}</p>}
            </>
          )}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
    </section>
  );
}
