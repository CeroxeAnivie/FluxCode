import { Minus, Square, X, PanelLeft } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function TitleBar({
  toggleSidebar,
  report,
}: {
  toggleSidebar: () => void;
  report: (message: string) => void;
}) {
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
        title="切换侧边栏"
        aria-label="切换侧边栏"
        onClick={toggleSidebar}
      >
        <PanelLeft size={16} />
      </button>
      <div className="titlebar-drag" data-tauri-drag-region />
      <span className="titlebar-caption">你的代码，你的工作空间</span>
      <div className="window-controls">
        <button aria-label="最小化" onClick={() => action(() => getCurrentWindow().minimize())}>
          <Minus size={14} />
        </button>
        <button
          aria-label="最大化"
          onClick={() => action(() => getCurrentWindow().toggleMaximize())}
        >
          <Square size={11} />
        </button>
        <button
          className="close-window"
          aria-label="关闭窗口"
          onClick={() => action(() => getCurrentWindow().close())}
        >
          <X size={15} />
        </button>
      </div>
    </header>
  );
}
