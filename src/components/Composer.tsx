import { Select } from './Select';
import { useAppearance } from '../application/AppearanceProvider';
import { ArrowUp, FolderOpen, ShieldCheck, Square } from 'lucide-react';
import { useRef } from 'react';
import { ModelPicker } from './ModelPicker';
import { reasoningEfforts } from '../domain/modelSelection';
import type { ModelSelection } from '../domain/modelSelection';
import type { Attachment } from '../domain/attachments';
import { AttachmentList } from './AttachmentList';
import { shouldSubmitOnEnter } from '../domain/keyboard';

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
  onQueue: (text: string) => boolean | Promise<boolean>;
  onSteer: (text: string) => Promise<boolean>;
  attachments: Attachment[];
  attachmentNotice: { added: number; duplicates: number } | null;
  onAttach: () => void;
  onRemoveAttachment: (id: string) => void;
  onConfigureModel?: () => void;
  onChooseProject: () => void;
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
  onQueue,
  onSteer,
  attachments,
  attachmentNotice,
  onAttach,
  onRemoveAttachment,
  onConfigureModel,
  onChooseProject,
}: Props) {
  const { t } = useAppearance();
  const input = useRef<HTMLTextAreaElement>(null);
  const compositionEndedAt = useRef(0);
  const submit = async () => {
    const submitted = text;
    if (!submitted.trim() || sending || disabled) return;
    if (busy) {
      if (await onQueue(submitted)) onChange('');
      return;
    }
    await onSend(submitted);
  };
  return (
    <div className="composer-wrap">
      <div className={`composer ${busy ? 'working' : ''}`}>
        <AttachmentList
          items={attachments}
          notice={attachmentNotice}
          onRemove={onRemoveAttachment}
        />
        <textarea
          ref={input}
          aria-label={t('任务描述')}
          placeholder={t('描述一个任务，或提出关于代码的问题…')}
          value={text}
          maxLength={100_000}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            compositionEndedAt.current = 0;
          }}
          onCompositionStart={() => {
            compositionEndedAt.current = Number.POSITIVE_INFINITY;
          }}
          onCompositionEnd={() => {
            compositionEndedAt.current = performance.now();
          }}
          onKeyDown={(e) => {
            if (shouldSubmitOnEnter(e.nativeEvent, compositionEndedAt.current, performance.now())) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-options">
            <button
              className="attach-button"
              title={t('添加文件或图片')}
              aria-label={t('添加文件或图片')}
              onClick={onAttach}
            >
              ＋
            </button>
            <button
              type="button"
              className="composer-project"
              onClick={onChooseProject}
              aria-label={t('选择项目')}
              title={t('打开项目')}
            >
              <FolderOpen size={14} />
              {project ?? t('未选择项目')}
            </button>
            <span className="toolbar-divider" />
            <ModelPicker
              onConfigure={onConfigureModel}
              model={model}
              models={models}
              disabled={busy || sending || disabled}
              onChange={(model) => onSelection({ ...selection, model })}
            />
            <Select
              className="effort-select"
              aria-label={t('推理强度')}
              value={selection.effort}
              disabled={busy || sending || disabled || !model}
              title={
                busy || sending
                  ? t('任务结束后可更改推理强度')
                  : t(
                      '模型默认：不指定推理强度，由模型决定；不推理：明确请求关闭推理。可用档位取决于模型和服务。',
                    )
              }
              onValueChange={(value) =>
                onSelection({ ...selection, effort: value as ModelSelection['effort'] })
              }
            >
              {reasoningEfforts.map((effort) => (
                <option key={effort} value={effort}>
                  {effort === 'off'
                    ? t('模型默认')
                    : effort === 'none'
                      ? t('不推理')
                      : t(
                          (
                            {
                              minimal: '最低',
                              low: '低',
                              medium: '中',
                              high: '高',
                              xhigh: '极高',
                              max: '最高',
                            } as const
                          )[effort],
                        )}
                </option>
              ))}
            </Select>
          </div>
          {busy ? (
            <div className="running-actions">
              <button
                disabled={!text.trim() || sending}
                onClick={async () => {
                  if (await onQueue(text)) onChange('');
                }}
              >
                {t('排队发送')}
              </button>
              <button
                disabled={!text.trim() || sending}
                onClick={() =>
                  void onSteer(text).then((ok) => {
                    if (ok) onChange('');
                  })
                }
              >
                {t('立即补充')}
              </button>
              <button className="send-button stop" aria-label={t('停止任务')} onClick={onStop}>
                <Square size={13} fill="currentColor" />
              </button>
            </div>
          ) : (
            <button
              className="send-button"
              aria-label={t('发送任务')}
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
          {t('完全访问')}
        </span>
        <span>
          {t(busy ? 'Enter 排队发送 · Shift Enter 换行' : 'Enter 发送 · Shift Enter 换行')}
        </span>
      </div>
    </div>
  );
}
