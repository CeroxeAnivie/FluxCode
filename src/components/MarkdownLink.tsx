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
  const [failed, setFailed] = useState(false);
  const url = webLink(href);
  const relative = projectRoot && !url ? workspaceFileLink(href) : null;
  if (relative && projectRoot)
    return (
      <>
        <button
          type="button"
          className="rendered-link"
          title={`${t('使用默认应用打开文件')} · ${relative}`}
          onClick={() => {
            setFailed(false);
            void bridge.openWorkspaceFile(projectRoot, relative).catch(() => setFailed(true));
          }}
        >
          {children}
        </button>
        {failed && <span role="alert">{t('无法使用系统默认应用打开文件')}</span>}
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
          setFailed(false);
          requestBrowser(url);
        }}
        onAuxClick={(event) => {
          if (event.button !== 1 || !browserAvailable()) return;
          event.preventDefault();
          setFailed(false);
          requestBrowser(url);
        }}
      >
        {children}
      </a>
      {failed && <span role="alert">{t('无法打开应用内浏览器')}</span>}
    </>
  );
}
