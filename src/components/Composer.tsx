import { Select } from './Select';
import { useAppearance } from '../application/AppearanceProvider';
import { ArrowUp, FolderOpen, Paperclip, ShieldCheck, Square } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ModelPicker } from './ModelPicker';
import { reasoningEfforts } from '../domain/modelSelection';
import type { ModelSelection } from '../domain/modelSelection';
import type { Attachment } from '../domain/attachments';
import { AttachmentList } from './AttachmentList';
import { shouldQueueOnEnter, shouldSubmitOnEnter } from '../domain/keyboard';

interface Props {
  project?: string;
  model: string;
  models: string[];
  modelLabels?: Record<string, string>;
  selection: ModelSelection;
  onSelection: (selection: ModelSelection) => void;
  busy: boolean;
  sending: boolean;
  disabled: boolean;
  sendBlocked?: boolean;
  contextControl?: ReactNode;
  queueControl?: ReactNode;
  text: string;
  onChange: (text: string) => void;
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  onQueue: (text: string) => string | false | Promise<string | false>;
  onPromote: (id: string) => Promise<boolean>;
  queueScope: string;
  queuedIds: string[];
  attachments: Attachment[];
  attachmentNotice: { added: number; duplicates: number } | null;
  onAttach: () => void;
  onImageFiles?: (files: File[]) => Promise<void>;
  importingAttachments?: boolean;
  onRemoveAttachment: (id: string) => void;
  onConfigureModel?: () => void;
  onChooseProject: () => void;
}

export function Composer({
  project,
  model,
  models,
  modelLabels = {},
  selection,
  onSelection,
  busy,
  sending,
  disabled,
  sendBlocked = false,
  contextControl,
  queueControl,
  text,
  onChange,
  onSend,
  onStop,
  onQueue,
  onPromote,
  queueScope,
  queuedIds,
  attachments,
  attachmentNotice,
  onAttach,
  onImageFiles,
  importingAttachments = false,
  onRemoveAttachment,
  onConfigureModel,
  onChooseProject,
}: Props) {
  const { t } = useAppearance();
  const input = useRef<HTMLTextAreaElement>(null);
  const compositionEndedAt = useRef(0);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const queued = useRef<{
    scope: string;
    result: Promise<string | false>;
    promoting: boolean;
  } | null>(null);
  const mounted = useRef(true);
  const current = useRef({ text, busy, queueScope, onPromote });
  current.current = { text, busy, queueScope, onPromote };
  const submitting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queued.current = null;
    };
  }, []);
  useEffect(() => {
    queued.current = null;
    setQueuedId(null);
  }, [queueScope, busy]);
  const canPromote =
    !!queuedId && queuedIds.includes(queuedId) && busy && !text && !attachments.length;
  const submit = async (shortcut = false) => {
    const pending = queued.current;
    if (
      shortcut &&
      pending &&
      !pending.promoting &&
      pending.scope === queueScope &&
      busy &&
      (!text.trim() || submitting.current) &&
      (!attachments.length || submitting.current)
    ) {
      pending.promoting = true;
      const id = await pending.result;
      if (
        id &&
        mounted.current &&
        queued.current === pending &&
        current.current.busy &&
        current.current.queueScope === pending.scope &&
        !current.current.text.trim()
      ) {
        await current.current.onPromote(id);
      }
      if (queued.current === pending) {
        queued.current = null;
        setQueuedId(null);
      }
      return;
    }
    const submitted = text;
    if (
      (!submitted.trim() && !attachments.length) ||
      importingAttachments ||
      submitting.current ||
      sending ||
      disabled ||
      sendBlocked
    )
      return;
    submitting.current = true;
    try {
      if (busy) {
        const entry = {
          scope: queueScope,
          result: Promise.resolve(onQueue(submitted)),
          promoting: false,
        };
        queued.current = shortcut ? entry : null;
        const id = await entry.result;
        if (
          id &&
          mounted.current &&
          current.current.queueScope === entry.scope &&
          current.current.text === submitted
        ) {
          // Update the ref before clearing the controlled draft so a rapid second
          // keypress sees the accepted submission without waiting for a render.
          current.current.text = '';
          onChange('');
          if (queued.current === entry) setQueuedId(id);
        }
      } else {
        await onSend(submitted);
      }
    } finally {
      submitting.current = false;
    }
  };
  return (
    <div className="composer-wrap">
      {queueControl}
      <div className={`composer ${busy ? 'working' : ''}`}>
        <AttachmentList
          items={attachments}
          notice={attachmentNotice}
          onRemove={onRemoveAttachment}
        />
        {importingAttachments && (
          <span role="status" className="attachment-feedback">
            {t('正在添加图片…')}
          </span>
        )}
        <textarea
          ref={input}
          aria-label={t('任务描述')}
          placeholder={t('描述一个任务，或提出关于代码的问题…')}
          value={text}
          maxLength={100_000}
          rows={3}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith('image/'),
            );
            if (files.length && onImageFiles) {
              event.preventDefault();
              void onImageFiles(files);
            }
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) event.preventDefault();
          }}
          onDrop={(event) => {
            const files = Array.from(event.dataTransfer.files).filter((file) =>
              file.type.startsWith('image/'),
            );
            if (files.length && onImageFiles) {
              event.preventDefault();
              event.stopPropagation();
              void onImageFiles(files);
            }
          }}
          onChange={(e) => {
            queued.current = null;
            setQueuedId(null);
            onChange(e.target.value);
          }}
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
            if (shouldQueueOnEnter(e.nativeEvent, compositionEndedAt.current, performance.now())) {
              e.preventDefault();
              void submit(true);
            } else if (
              e.ctrlKey &&
              !e.shiftKey &&
              !e.altKey &&
              !e.metaKey &&
              e.repeat &&
              e.key === 'Enter'
            ) {
              e.preventDefault();
            } else if (
              shouldSubmitOnEnter(e.nativeEvent, compositionEndedAt.current, performance.now())
            ) {
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
              <Paperclip size={16} />
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
          </div>
          <div className="composer-right">
            <div className="composer-options composer-model-options">
              <ModelPicker
                onConfigure={onConfigureModel}
                model={model}
                models={models}
                labels={modelLabels}
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
              <button
                className="send-button stop"
                aria-label={t('停止任务')}
                title={t('停止任务')}
                onClick={onStop}
              >
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                className="send-button"
                aria-label={t('发送任务')}
                onClick={() => void submit()}
                disabled={
                  (!text.trim() && !attachments.length) ||
                  importingAttachments ||
                  disabled ||
                  sendBlocked ||
                  sending
                }
                title={
                  sendBlocked
                    ? t('请先完成输入框上方的准备步骤')
                    : t('Enter 发送 · Shift Enter 换行')
                }
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="composer-footnote">
        {busy && (
          <span className="composer-shortcut" role="status">
            {canPromote
              ? t('已加入队列 · 再按 Ctrl + Enter 立即插入')
              : t('Ctrl + Enter 加入队列 · 再按一次立即插入')}
          </span>
        )}
        {contextControl}
        <span>
          <ShieldCheck size={12} />
          {t('完全访问')}
        </span>
      </div>
    </div>
  );
}
