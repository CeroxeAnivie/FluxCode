import { useEffect, useRef, useState } from 'react';
import { FileText, Folder, Image, X } from 'lucide-react';
import type { Attachment } from '../domain/attachments';
import { bridge } from '../infrastructure/bridge';
import { useAppearance } from '../application/AppearanceProvider';
import { ErrorNotice } from './ErrorNotice';

export function AttachmentList({
  items,
  notice,
  onRemove,
}: {
  items: Attachment[];
  notice: { added: number; duplicates: number } | null;
  onRemove: (id: string) => void;
}) {
  const { t, language } = useAppearance();
  const [preview, setPreview] = useState<{
    item: Attachment;
    source?: string;
    error?: string;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const request = useRef(0);

  useEffect(() => {
    if (preview && !dialog.current?.open) {
      dialog.current?.showModal();
      closeButton.current?.focus();
    } else if (!preview && dialog.current?.open) {
      dialog.current.close();
      origin.current?.focus();
    }
  }, [preview]);

  useEffect(() => {
    if (preview && !items.some((item) => item.id === preview.item.id)) closePreview();
  }, [items, preview]);

  function closePreview() {
    request.current++;
    setPreview(null);
    origin.current?.focus();
  }

  async function openPreview(item: Attachment, button: HTMLElement) {
    const current = ++request.current;
    origin.current = button;
    setPreview({ item });
    try {
      const source = await bridge.previewAttachment(item.path);
      if (
        source.length > 2_000_000 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(source)
      )
        throw new Error('图片预览数据无效');
      if (current === request.current) setPreview({ item, source });
    } catch (error) {
      if (current === request.current) setPreview({ item, error: String(error) });
    }
  }

  return (
    <>
      {!!items.length && (
        <div className="attachment-list" aria-label={t('附件')}>
          {items.map((item) => {
            const Icon =
              item.kind === 'image' ? Image : item.kind === 'directory' ? Folder : FileText;
            return (
              <div className="attachment-item" key={item.id} title={item.path}>
                {item.kind === 'image' ? (
                  <button
                    type="button"
                    className="attachment-preview-button"
                    aria-label={`${t('预览图片')} ${item.name}`}
                    title={`${t('预览图片')} · ${item.path}`}
                    onClick={(event) => void openPreview(item, event.currentTarget)}
                  >
                    <Icon size={14} />
                    <span>{item.name}</span>
                  </button>
                ) : (
                  <span className="attachment-name">
                    <Icon size={14} />
                    <span>{item.name}</span>
                  </span>
                )}
                <button
                  type="button"
                  className="attachment-remove"
                  aria-label={`${t('移除')} ${item.name}`}
                  title={`${t('移除')} ${item.name}`}
                  onClick={() => onRemove(item.id)}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {notice && (
        <p className="attachment-feedback" role="status">
          {notice.added > 0 &&
            (language === 'en'
              ? `${notice.added} ${notice.added === 1 ? 'attachment' : 'attachments'} added`
              : `已添加 ${notice.added} 个附件`)}
          {notice.duplicates > 0 && notice.added > 0 && ' · '}
          {notice.duplicates > 0 &&
            (language === 'en'
              ? `${notice.duplicates} ${notice.duplicates === 1 ? 'duplicate' : 'duplicates'} skipped`
              : `已跳过 ${notice.duplicates} 个重复项`)}
        </p>
      )}
      <dialog
        ref={dialog}
        className="attachment-preview-dialog"
        aria-label={`${t('预览图片')} ${preview?.item.name ?? ''}`}
        onClose={closePreview}
      >
        <header>
          <span title={preview?.item.path}>{preview?.item.name}</span>
          <button
            ref={closeButton}
            type="button"
            className="icon-button"
            aria-label={t('关闭图片预览')}
            onClick={closePreview}
          >
            <X size={16} />
          </button>
        </header>
        {preview?.source ? (
          <img
            src={preview.source}
            alt={preview.item.name}
            onError={() =>
              setPreview((current) =>
                current?.item.id === preview.item.id
                  ? { item: current.item, error: '图片已损坏或无法解码' }
                  : current,
              )
            }
          />
        ) : preview?.error ? (
          <p role="alert">
            {t('无法预览图片，请检查文件后重试。')} <ErrorNotice message={preview.error} />
          </p>
        ) : (
          <p role="status">{t('正在加载图片…')}</p>
        )}
      </dialog>
    </>
  );
}
