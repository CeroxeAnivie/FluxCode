import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownLink } from './MarkdownLink';
import { useAppearance } from '../application/AppearanceProvider';

export function MarkdownContent({ text, projectRoot }: { text: string; projectRoot?: string }) {
  const { t } = useAppearance();
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
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
