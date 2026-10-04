import { MotionPanel } from './MotionPanel';
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useAppearance } from '../application/AppearanceProvider';
import { webLink } from '../domain/links';
import { browserAddress } from '../domain/browserAddress';
import {
  browserAvailable,
  getBrowserAgentState,
  subscribeBrowserAgentState,
  listenBrowserAgentState,
  controlBrowserAgent,
  closeBrowserPanel,
  markBrowserAgentControl,
  completeAgentBrowser,
  subscribeAgentBrowser,
  browserCommand,
  dismissBrowser,
  getBrowserRequest,
  requestBrowser,
  subscribeBrowser,
  subscribeBrowserRequest,
  type BrowserBounds,
  type BrowserRequest,
} from '../infrastructure/browserPanel';
import { openWebLink } from '../infrastructure/externalLinks';
import { scheduleUiStateMirror } from '../infrastructure/uiStateMirror';
import './browserPanel.css';

const browserActionLabels = {
  open: '正在打开网页',
  read_page: '正在读取网页',
  snapshot: '正在识别网页元素',
  screenshot: '正在截取网页',
  click: '正在点击网页元素',
  fill: '正在填写内容',
  press: '正在输入按键',
  select_option: '正在选择选项',
  set_checked: '正在设置勾选项',
  hover: '正在悬停查看',
  scroll: '正在滚动网页',
  handle_dialog: '正在处理网页对话框',
  back: '正在后退',
  forward: '正在前进',
  reload: '正在刷新网页',
  close: '正在关闭网页',
};
const WIDTH_KEY = 'fluxcode.browser-width.v1';
const minWidth = 320;
function clampWidth(value: number) {
  return Math.round(Math.max(minWidth, Math.min(960, window.innerWidth - 400, value)));
}

export function BrowserPanel() {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      return clampWidth(saved >= minWidth ? saved : window.innerWidth * 0.42);
    } catch {
      return clampWidth(window.innerWidth * 0.42);
    }
  });

  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    void listenBrowserAgentState()
      .then((stop) => {
        if (disposed) stop();
        else off = stop;
      })
      .catch(() => console.warn('browser_agent_state_subscription_failed'));
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  useEffect(() => {
    if (!browserAvailable()) return;
    let disposed = false;
    let off: (() => void) | undefined;
    void subscribeAgentBrowser((event) => {
      if (disposed) return;
      void (async () => {
        try {
          if (event.action === 'open') {
            if (!event.url) throw new Error('Missing URL');
            requestBrowser(event.url, event.id);
            return;
          }
          if (event.action === 'close') await closeBrowserPanel();
          else {
            if (!getBrowserRequest()) throw new Error('Browser is closed');
            markBrowserAgentControl(true);
            if (document.querySelector('dialog[open], [role="dialog"]'))
              throw new Error('An application dialog hides the browser');
            if (event.action === 'back' || event.action === 'forward' || event.action === 'reload')
              await browserCommand({ kind: event.action });
          }
          completeAgentBrowser(event.id);
        } catch {
          completeAgentBrowser(event.id, 'Browser action failed');
        }
      })();
    })
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else off = unsubscribe;
      })
      .catch(() => console.warn('browser_tool_subscription_failed'));
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  const request = useSyncExternalStore(subscribeBrowserRequest, getBrowserRequest, () => null);
  return (
    <MotionPanel open={!!request} size={`${width + 1}px`}>
      {request && <BrowserSurface request={request} width={width} setWidth={setWidth} />}
    </MotionPanel>
  );
}

function BrowserSurface({
  request,
  width,
  setWidth,
}: {
  request: BrowserRequest;
  width: number;
  setWidth: Dispatch<SetStateAction<number>>;
}) {
  const { t } = useAppearance();
  const agent = useSyncExternalStore(
    subscribeBrowserAgentState,
    getBrowserAgentState,
    getBrowserAgentState,
  );
  async function takeOver() {
    if (agent.active || request.agentControlled) await controlBrowserAgent(true);
  }
  async function manualCommand(kind: 'back' | 'forward' | 'reload') {
    try {
      await takeOver();
      markBrowserAgentControl(false);
      await browserCommand({ kind });
    } catch {
      report();
    }
  }
  const [address, setAddress] = useState(request.url);
  const [currentUrl, setCurrentUrl] = useState(request.url);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const mounted = useRef(false);
  const composing = useRef(false);
  const available = browserAvailable();

  function bounds(): BrowserBounds | null {
    const rect = viewport.current?.getBoundingClientRect();
    return rect && rect.width >= 1 && rect.height >= 1
      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      : null;
  }
  function report() {
    if (mounted.current) {
      setLoading(false);
      setError('浏览器操作未完成，请重试');
    }
  }
  function saveWidth(next: number) {
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
      scheduleUiStateMirror();
    } catch {
      setError('浏览器宽度未能保存，当前调整仍然有效');
    }
  }
  async function close() {
    setClosing(true);
    try {
      await takeOver();
      if (available) await browserCommand({ kind: 'close' });
      dismissBrowser();
    } catch {
      report();
      setClosing(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    let stop: (() => void) | undefined;
    if (available)
      void subscribeBrowser((state) => {
        if (!mounted.current) return;
        if (state.url && webLink(state.url)) {
          setCurrentUrl(state.url);
          if (!document.hasFocus() || document.activeElement !== addressInput.current)
            setAddress(state.url);
        }
        setLoading(state.loading);
        if (state.notice) setError(state.notice);
        else if (state.loading) setError('');
      })
        .then((unlisten) => {
          if (mounted.current) stop = unlisten;
          else unlisten();
        })
        .catch(report);
    const resize = () => setWidth((value) => clampWidth(value));
    window.addEventListener('resize', resize);
    return () => {
      mounted.current = false;
      stop?.();
      window.removeEventListener('resize', resize);
    };
  }, [available]);

  useEffect(() => {
    setAddress(request.url);
    setCurrentUrl(request.url);
    setError('');
    if (!request.url) {
      addressInput.current?.focus();
      return;
    }
    const rect = bounds();
    if (!available || !rect) return;
    setLoading(true);
    let active = true;
    void browserCommand({ kind: 'navigate', url: request.url, bounds: rect })
      .then(() => {
        if (active && request.agentRequestId) completeAgentBrowser(request.agentRequestId);
      })
      .catch(() => {
        if (active) {
          report();
          if (request.agentRequestId)
            completeAgentBrowser(request.agentRequestId, 'Navigation failed');
        }
      });
    return () => {
      active = false;
    };
  }, [request.revision, available]);

  useEffect(() => {
    if (!loading) return;
    const timeout = setTimeout(() => {
      setError('网页加载时间较长，可刷新或在系统浏览器中打开');
      setLoading(false);
    }, 30000);
    return () => clearTimeout(timeout);
  }, [loading, currentUrl]);

  useEffect(() => {
    if (!available || !viewport.current) return;
    let frame = 0;
    let stopped = false;
    let running = false;
    let again = false;
    let previous = '';
    const sync = async () => {
      if (running) {
        again = true;
        return;
      }
      const rect = bounds();
      if (stopped || !rect) return;
      const visible =
        !document.querySelector('dialog[open], [role="dialog"], [role="listbox"]') &&
        !document.hidden &&
        !!getBrowserRequest() &&
        !viewport.current?.closest('[inert], .motion-panel[data-moving="true"]');
      const next = JSON.stringify({ rect, visible });
      if (next === previous) return;
      running = true;
      try {
        await browserCommand({ kind: 'layout', bounds: rect, visible });
        previous = next;
      } catch {
        report();
      } finally {
        running = false;
        if (again && !stopped) {
          again = false;
          schedule();
        }
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void sync());
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(viewport.current);
    resize.observe(document.querySelector('.app-body') ?? document.body);
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open', 'role', 'style', 'inert', 'data-moving'],
    });
    window.addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', schedule);
    schedule();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [available, request.revision]);

  async function reloadPage() {
    try {
      await takeOver();
      const rect = bounds();
      if (!rect) return;
      setError('');
      setLoading(true);
      markBrowserAgentControl(false);
      // Navigation also recreates a surface whose initial creation failed.
      await browserCommand({ kind: 'navigate', url: currentUrl, bounds: rect });
    } catch {
      report();
    }
  }
  async function navigate() {
    const url = browserAddress(address);
    if (!url) {
      setError('网页链接无效');
      return;
    }
    try {
      await takeOver();
      requestBrowser(url);
      addressInput.current?.blur();
    } catch {
      report();
    }
  }
  return (
    <>
      <div
        className="panel-resize browser-resize"
        role="separator"
        tabIndex={0}
        aria-label={t('调整浏览器宽度')}
        aria-orientation="vertical"
        aria-valuemin={minWidth}
        aria-valuemax={Math.max(minWidth, Math.min(960, window.innerWidth - 400))}
        aria-valuenow={width}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          drag.current = { x: event.clientX, width };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          if (drag.current)
            setWidth(clampWidth(drag.current.width + drag.current.x - event.clientX));
        }}
        onPointerUp={(event) => {
          if (drag.current) {
            drag.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
            saveWidth(width);
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
          saveWidth(width);
        }}
        onDoubleClick={() => {
          const next = clampWidth(window.innerWidth * 0.42);
          setWidth(next);
          saveWidth(next);
        }}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = clampWidth(
            event.key === 'Home'
              ? minWidth
              : event.key === 'End'
                ? 960
                : width + (event.key === 'ArrowLeft' ? 24 : -24),
          );
          setWidth(next);
          saveWidth(next);
        }}
      />
      <aside className="browser-panel" style={{ width }} aria-label={t('应用内浏览器')}>
        <header className="browser-heading">
          <span>
            <Globe size={15} />
            {t('浏览器')}
          </span>
          {request.agentControlled && (
            <span className="browser-agent-badge" role="status">
              {t('智能体浏览')}
            </span>
          )}
          <button
            className="icon-button"
            aria-label={t('关闭浏览器')}
            title={t('关闭浏览器')}
            disabled={closing}
            onClick={() => void close()}
          >
            <X size={17} />
          </button>
        </header>
        {(agent.active || agent.paused || request.agentControlled) && (
          <div className="browser-agent-controls" role="status">
            <span>
              {agent.paused
                ? t('浏览器已由你接管')
                : agent.active
                  ? t(browserActionLabels[agent.action ?? 'snapshot'])
                  : t('智能体浏览')}
            </span>
            <button
              type="button"
              onClick={() => void controlBrowserAgent(!agent.paused).catch(report)}
            >
              {agent.paused ? t('允许智能体继续') : t('停止并接管')}
            </button>
          </div>
        )}
        <form
          className="browser-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            if (composing.current) return;
            void navigate();
          }}
        >
          <button
            type="button"
            className="icon-button"
            aria-label={t('后退')}
            title={t('后退')}
            disabled={!currentUrl || !available}
            onClick={() => {
              void manualCommand('back');
            }}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t('前进')}
            title={t('前进')}
            disabled={!currentUrl || !available}
            onClick={() => {
              void manualCommand('forward');
            }}
          >
            <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t('刷新网页')}
            title={t('刷新网页')}
            disabled={!currentUrl || !available}
            onClick={() => {
              void reloadPage();
            }}
          >
            <RotateCw size={15} />
          </button>
          <input
            ref={addressInput}
            aria-label={t('网页地址')}
            placeholder={t('搜索 Bing 或输入网址')}
            value={address}
            spellCheck={false}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229))
                event.preventDefault();
            }}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.target.select()}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={t('在默认浏览器中打开')}
            title={t('在默认浏览器中打开')}
            disabled={!currentUrl}
            onClick={() =>
              void openWebLink(currentUrl).catch(() => setError('无法打开系统默认浏览器'))
            }
          >
            <ExternalLink size={16} />
          </button>
        </form>
        <div
          className={`browser-progress${loading ? ' loading' : ''}`}
          role="status"
          aria-label={loading ? t('正在加载网页') : t('网页就绪')}
        />
        {error && (
          <div className="browser-notice" role="alert">
            <span>{t(error)}</span>
            <button className="icon-button" aria-label={t('关闭提示')} onClick={() => setError('')}>
              <X size={14} />
            </button>
          </div>
        )}
        <div ref={viewport} className="browser-viewport">
          {(!currentUrl || !available) && (
            <div className="browser-empty">
              <Globe size={28} />
              <p>{t(available ? '输入网址，或点击对话中的网页链接' : '请在桌面应用中打开网页')}</p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
