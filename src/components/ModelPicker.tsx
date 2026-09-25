import { Command } from 'cmdk';
import { ChevronDown, Check, X } from 'lucide-react';
import { useAppearance } from '../application/AppearanceProvider';
import { useEffect, useRef, useState } from 'react';

export function ModelPicker({
  model,
  models,
  disabled,
  onChange,
  onConfigure,
}: {
  model: string;
  models: string[];
  disabled: boolean;
  onChange: (model: string) => void;
  onConfigure?: () => void;
}) {
  const { t } = useAppearance();
  const [mode, setMode] = useState<'list' | 'custom' | null>(null);
  const [value, setValue] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (mode) dialog.current?.showModal();
  }, [mode]);
  function close() {
    setMode(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  function select(next: string) {
    onChange(next);
    close();
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={t('当前会话模型')}
        aria-expanded={!!mode}
        aria-haspopup="dialog"
        data-value={model}
        className="select-trigger model-select"
        disabled={disabled}
        title={t('选择当前会话模型')}
        onClick={() => (onConfigure ? onConfigure() : setMode('list'))}
      >
        <span>{model || t('选择模型')}</span>
        <ChevronDown size={14} />
      </button>
      {mode && (
        <dialog
          ref={dialog}
          className="model-dialog model-picker-dialog"
          aria-label={t('选择模型')}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <header>
            <h2>{t(mode === 'custom' ? '添加模型' : '选择模型')}</h2>
            <button type="button" className="icon-button" aria-label={t('关闭')} onClick={close}>
              <X size={18} />
            </button>
          </header>
          {mode === 'list' ? (
            <Command label={t('搜索模型')} loop>
              <Command.Input autoFocus placeholder={t('搜索模型')} aria-label={t('搜索模型')} />
              <Command.List>
                <Command.Empty>{t('没有匹配模型')}</Command.Empty>
                <Command.Group>
                  {models.map((id) => (
                    <Command.Item
                      key={id}
                      value={id}
                      className="select-item"
                      data-value={id}
                      onSelect={() => select(id)}
                    >
                      <span>{id}</span>
                      {id === model && <Check size={14} />}
                    </Command.Item>
                  ))}
                </Command.Group>
                <Command.Item
                  className="select-item"
                  data-value="__custom__"
                  value="__custom__"
                  keywords={[t('添加模型…')]}
                  onSelect={() => {
                    setValue('');
                    setMode('custom');
                  }}
                >
                  {t('添加模型…')}
                </Command.Item>
              </Command.List>
            </Command>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (value.trim()) select(value.trim());
              }}
            >
              <label className="form-field">
                {t('模型 ID')}
                <input
                  autoFocus
                  required
                  value={value}
                  maxLength={200}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
              <div className="model-dialog-actions">
                <button type="button" onClick={() => setMode('list')}>
                  {t('返回模型列表')}
                </button>
                <button className="primary-button" disabled={!value.trim()}>
                  {t('使用模型')}
                </button>
              </div>
            </form>
          )}
        </dialog>
      )}
    </>
  );
}
