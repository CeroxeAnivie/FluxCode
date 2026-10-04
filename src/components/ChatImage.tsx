import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ImageOff, LoaderCircle } from 'lucide-react';
import { bridge } from '../infrastructure/bridge';
import { useAppearance } from '../application/AppearanceProvider';
import './chatImage.css';
const ImageViewer = lazy(() => import('./ImageViewer'));
export interface ChatImageSource {
  source: string;
  name: string;
}
export function ChatImage({ source, name }: ChatImageSource) {
  const { t } = useAppearance();
  const displayName = name === '图片' ? t('图片') : name;
  const anchor = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [thumbnail, setThumbnail] = useState('');
  const [full, setFull] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: '200px' },
    );
    if (anchor.current) observer.observe(anchor.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setThumbnail('');
    setFull('');
    setError('');
    setOpen(false);
  }, [source]);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    setError('');
    void bridge
      .loadChatImage(source, false)
      .then((value) => {
        if (live) setThumbnail(value);
      })
      .catch(() => {
        if (live) setError('图片加载失败');
      });
    return () => {
      live = false;
    };
  }, [source, visible, attempt]);
  useEffect(() => {
    if (!open || full) return;
    let live = true;
    void bridge
      .loadChatImage(source, true)
      .then((value) => {
        if (live) setFull(value);
      })
      .catch(() => {
        if (live) setError('高清预览加载失败，可查看缩略图');
      });
    return () => {
      live = false;
    };
  }, [source, open, full]);
  return (
    <span ref={anchor} className="chat-image">
      <button
        type="button"
        className="chat-image-open"
        aria-label={t('预览图片') + ' ' + displayName}
        onClick={() => (thumbnail ? setOpen(true) : setAttempt((value) => value + 1))}
      >
        {thumbnail ? (
          <img src={thumbnail} alt={displayName} loading="lazy" />
        ) : error ? (
          <>
            <ImageOff size={22} />
            <span>{t('图片加载失败，点击重试')}</span>
          </>
        ) : (
          <LoaderCircle className="spin" size={20} />
        )}
      </button>
      {open && (
        <Suspense fallback={<span role="status">{t('正在加载图片…')}</span>}>
          <ImageViewer
            source={full || thumbnail}
            name={displayName}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
      {open && error && <span role="status">{t(error)}</span>}
    </span>
  );
}
