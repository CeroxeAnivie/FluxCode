import { useEffect, useRef, useState } from 'react';

export function ModelPicker({
  model,
  models,
  disabled,
  onChange,
}: {
  model: string;
  models: string[];
  disabled: boolean;
  onChange: (model: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (custom) dialog.current?.showModal();
  }, [custom]);
  return (
    <>
      <select
        className="model-select"
        aria-label="当前会话模型"
        value={model}
        disabled={disabled}
        title={disabled ? '任务结束后可更改模型' : '仅更改当前会话的模型'}
        onChange={(e) => {
          if (e.target.value === '__custom__') {
            setValue('');
            setCustom(true);
          } else onChange(e.target.value);
        }}
      >
        {!model && (
          <option value="" disabled>
            选择模型
          </option>
        )}
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        <option value="__custom__">添加模型…</option>
      </select>
      {custom && (
        <dialog ref={dialog} className="model-dialog" onCancel={() => setCustom(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) {
                onChange(value.trim());
                setCustom(false);
              }
            }}
          >
            <h2>添加模型</h2>
            <p>填写当前服务支持的模型 ID，之后可以直接从列表选择。</p>
            <label className="form-field">
              模型 ID
              <input
                autoFocus
                value={value}
                maxLength={200}
                required
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <div className="model-dialog-actions">
              <button type="button" onClick={() => setCustom(false)}>
                取消
              </button>
              <button className="primary-button" disabled={!value.trim()}>
                使用模型
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
