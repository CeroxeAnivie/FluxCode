import { useAppearance } from '../application/AppearanceProvider';
import { Minus, Square, Copy, X, PanelLeft, PanelsTopLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function TitleBar({
  toggleSidebar,
  report,
  onNewWindow,
}: {
  toggleSidebar: () => void;
  report: (message: string) => void;
  onNewWindow?: () => void;
}) {
  const { t } = useAppearance();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const window = getCurrentWindow();
    const refresh = async () => {
      try {
        const value = await window.isMaximized();
        if (!disposed) setMaximized(value);
      } catch (error) {
        if (!disposed) report(String(error));
      }
    };
    void window
      .onResized(() => void refresh())
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        if (!disposed) report(String(error));
      });
    void refresh();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [report]);
  const action = (fn: () => Promise<unknown>) => {
    if (isTauri()) void fn().catch((e) => report(String(e)));
  };
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand">
        <span className="brand-mark">F</span>
        <span>FluxCode</span>
      </div>
      <button
        className="icon-button sidebar-toggle"
        title={t('切换侧边栏')}
        aria-label={t('切换侧边栏')}
        onClick={toggleSidebar}
      >
        <PanelLeft size={16} />
      </button>
      <div className="titlebar-drag" data-tauri-drag-region />
      {onNewWindow && (
        <button
          className="icon-button"
          aria-label={t('在新窗口打开工作区')}
          title={t('在新窗口打开工作区')}
          onClick={onNewWindow}
        >
          <PanelsTopLeft size={16} />
        </button>
      )}
      <span className="titlebar-caption">{t('你的代码，你的工作空间')}</span>
      <div className="window-controls">
        <button
          aria-label={t('最小化')}
          onClick={() => action(() => getCurrentWindow().minimize())}
        >
          <Minus size={14} />
        </button>
        <button
          aria-label={t(maximized ? '还原窗口' : '最大化')}
          onClick={() => action(() => getCurrentWindow().toggleMaximize())}
        >
          {maximized ? <Copy size={11} /> : <Square size={11} />}
        </button>
        <button
          className="close-window"
          aria-label={t('关闭窗口')}
          onClick={() => action(() => getCurrentWindow().close())}
        >
          <X size={15} />
        </button>
      </div>
    </header>
  );
}
