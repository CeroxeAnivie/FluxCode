import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { workspaceFileLink } from '../domain/links';
import remarkGfm from 'remark-gfm';
import { MarkdownLink } from './MarkdownLink';
import { useAppearance } from '../application/AppearanceProvider';

export function MarkdownContent({ text, projectRoot }: { text: string; projectRoot?: string }) {
  const { t } = useAppearance();
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url, key) =>
        key === 'href' && projectRoot && workspaceFileLink(url, projectRoot)
          ? url
          : defaultUrlTransform(url)
      }
      components={{
        a: ({ href, children }) => (
          <MarkdownLink href={href} projectRoot={projectRoot}>
            {children}
          </MarkdownLink>
        ),
        img: ({ alt }) => (
          <span>
            [{t('图片')}：{alt}]
          </span>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
