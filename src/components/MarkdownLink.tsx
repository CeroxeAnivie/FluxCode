import { ErrorNotice } from './ErrorNotice';
import { useState, type ReactNode } from 'react';
import { browserAvailable, requestBrowser } from '../infrastructure/browserPanel';
import { bridge } from '../infrastructure/bridge';
import { webLink, workspaceFileLink } from '../domain/links';
import { useAppearance } from '../application/AppearanceProvider';

export function MarkdownLink({
  href,
  children,
  projectRoot,
}: {
  href?: string;
  children?: ReactNode;
  projectRoot?: string;
}) {
  const { t } = useAppearance();
  const [failed, setFailed] = useState('');
  const url = webLink(href);
  const relative = projectRoot && !url ? workspaceFileLink(href, projectRoot) : null;
  if (relative && projectRoot)
    return (
      <>
        <button
          type="button"
          className="rendered-link"
          title={`${t('使用默认应用打开文件')} · ${relative}`}
          onClick={() => {
            setFailed('');
            void bridge
              .openWorkspaceFile(projectRoot, relative)
              .catch((cause) => setFailed(String(cause)));
          }}
        >
          {children}
        </button>
        {failed && (
          <span role="alert">
            <ErrorNotice message={failed} />
          </span>
        )}
      </>
    );
  if (!url)
    return (
      <span className="rendered-link" title={href}>
        {children}
      </span>
    );
  return (
    <>
      <a
        className="rendered-link"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={`${t('在应用内浏览器中打开')} · ${url}`}
        onClick={(event) => {
          if (!browserAvailable()) return;
          event.preventDefault();
          setFailed('');
          requestBrowser(url);
        }}
        onAuxClick={(event) => {
          if (event.button !== 1 || !browserAvailable()) return;
          event.preventDefault();
          setFailed('');
          requestBrowser(url);
        }}
      >
        {children}
      </a>
      {failed && (
        <span role="alert">
          <ErrorNotice message={failed} />
        </span>
      )}
    </>
  );
}
