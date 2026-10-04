import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import { useAppearance } from '../application/AppearanceProvider';
export default function ImageViewer({
  source,
  name,
  onClose,
}: {
  source: string;
  name: string;
  onClose: () => void;
}) {
  const { t } = useAppearance();
  return (
    <Lightbox
      open
      close={onClose}
      slides={[{ src: source, alt: name }]}
      plugins={[Zoom]}
      carousel={{ finite: true }}
      controller={{ closeOnBackdropClick: true }}
      labels={{
        Close: t('关闭图片预览'),
        Lightbox: t('图片预览'),
        'Photo gallery': t('图片预览'),
        Slide: t('图片'),
        Carousel: t('图片预览'),
        '{index} of {total}': '{index} / {total}',
        'Zoom in': t('放大图片'),
        'Zoom out': t('缩小图片'),
        Previous: t('上一张'),
        Next: t('下一张'),
      }}
      render={{ buttonPrev: () => null, buttonNext: () => null }}
    />
  );
}
