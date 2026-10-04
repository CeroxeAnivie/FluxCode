import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { ChatImage } from './ChatImage';
import { webLink, workspaceFileLink } from '../domain/links';
import remarkGfm from 'remark-gfm';
import { MarkdownLink } from './MarkdownLink';
import { useAppearance } from '../application/AppearanceProvider';

export function MarkdownContent({ text, projectRoot }: { text: string; projectRoot?: string }) {
  const { t } = useAppearance();
  const imageSource = (url: string | undefined) => {
    if (!url) return null;
    if (webLink(url)) return url;
    if (/^data:image\/(png|jpeg|gif|webp);base64,/.test(url) && url.length <= 28 * 1024 * 1024)
      return url;
    const relative = projectRoot && workspaceFileLink(url, projectRoot);
    return relative ? projectRoot + '/' + relative : null;
  };
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url, key) =>
        key === 'src' && imageSource(url)
          ? url
          : key === 'href' && projectRoot && workspaceFileLink(url, projectRoot)
            ? url
            : defaultUrlTransform(url)
      }
      components={{
        a: ({ href, children }) => (
          <MarkdownLink href={href} projectRoot={projectRoot}>
            {children}
          </MarkdownLink>
        ),
        img: ({ src, alt }) => {
          const source = imageSource(src);
          return source ? (
            <ChatImage source={source} name={alt || t('图片')} />
          ) : (
            <span>
              [{t('图片')}：{alt}]
            </span>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
