import { FileText, Folder, X } from 'lucide-react';
import type { Attachment } from '../domain/attachments';
import { useAppearance } from '../application/AppearanceProvider';
import { ChatImage } from './ChatImage';
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
  return (
    <>
      {!!items.length && (
        <div className="attachment-list" aria-label={t('附件')}>
          {items.map((item) => (
            <div
              key={item.id}
              className={'attachment-item' + (item.kind === 'image' ? ' image-attachment' : '')}
              title={item.name}
            >
              {item.kind === 'image' ? (
                <ChatImage source={item.path} name={item.name} />
              ) : (
                <span className="attachment-name">
                  {item.kind === 'directory' ? <Folder size={14} /> : <FileText size={14} />}
                  <span>{item.name}</span>
                </span>
              )}
              <button
                type="button"
                className="attachment-remove"
                aria-label={t('移除') + ' ' + item.name}
                title={t('移除') + ' ' + item.name}
                onClick={() => onRemove(item.id)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {notice && (
        <p className="attachment-feedback" role="status">
          {notice.added > 0 &&
            (language === 'en'
              ? notice.added + (notice.added === 1 ? ' attachment added' : ' attachments added')
              : '已添加 ' + notice.added + ' 个附件')}
          {notice.duplicates > 0 && notice.added > 0 && ' · '}
          {notice.duplicates > 0 &&
            (language === 'en'
              ? notice.duplicates +
                (notice.duplicates === 1 ? ' duplicate skipped' : ' duplicates skipped')
              : '已跳过 ' + notice.duplicates + ' 个重复项')}
        </p>
      )}
    </>
  );
}
