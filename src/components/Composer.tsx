import { ArrowUp, FolderOpen, ShieldCheck, Square } from 'lucide-react';
import { useRef } from 'react';
import { ModelPicker } from './ModelPicker';
import { reasoningEfforts } from '../domain/modelSelection';
import type { ModelSelection } from '../domain/modelSelection';

interface Props {
  project?: string;
  model: string;
  models: string[];
  selection: ModelSelection;
  onSelection: (selection: ModelSelection) => void;
  busy: boolean;
  sending: boolean;
  disabled: boolean;
  text: string;
  onChange: (text: string) => void;
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
}

export function Composer({
  project,
  model,
  models,
  selection,
  onSelection,
  busy,
  sending,
  disabled,
  text,
  onChange,
  onSend,
  onStop,
}: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  const submit = async () => {
    const submitted = text;
    if (!submitted.trim() || sending || busy || disabled) return;
    await onSend(submitted);
  };
  return (
    <div className="composer-wrap">
      <div className={`composer ${busy ? 'working' : ''}`}>
        <textarea
          ref={input}
          aria-label="任务描述"
          placeholder="描述一个任务，或提出关于代码的问题…"
          value={text}
          maxLength={100_000}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-options">
            <span className="composer-project">
              <FolderOpen size={14} />
              {project ?? '未选择项目'}
            </span>
            <span className="toolbar-divider" />
            <ModelPicker
              model={model}
              models={models}
              disabled={busy || sending || disabled}
              onChange={(model) => onSelection({ ...selection, model })}
            />
            <select
              className="effort-select"
              aria-label="推理强度"
              value={selection.effort}
              disabled={busy || sending || disabled || !model}
              title={
                busy || sending
                  ? '任务结束后可更改推理强度'
                  : 'Off：不发送 effort，由服务决定；None：显式不推理。支持的强度取决于模型。'
              }
              onChange={(e) =>
                onSelection({ ...selection, effort: e.target.value as ModelSelection['effort'] })
              }
            >
              {reasoningEfforts.map((effort) => (
                <option key={effort} value={effort}>
                  {effort === 'off'
                    ? 'Off · 服务默认'
                    : effort === 'none'
                      ? 'None · 不推理'
                      : effort[0].toUpperCase() + effort.slice(1)}
                </option>
              ))}
            </select>
          </div>
          {busy ? (
            <button className="send-button stop" aria-label="停止任务" onClick={onStop}>
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              className="send-button"
              aria-label="发送任务"
              onClick={() => void submit()}
              disabled={!text.trim() || disabled || sending}
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>
      <div className="composer-footnote">
        <span>
          <ShieldCheck size={12} />
          完全访问
        </span>
        <span>Enter 发送 · Shift Enter 换行</span>
      </div>
    </div>
  );
}
