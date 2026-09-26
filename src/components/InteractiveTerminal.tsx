import { ErrorNotice } from './ErrorNotice';
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { bridge } from '../infrastructure/bridge';
import { subscribeToResume } from '../infrastructure/resumeSignals';
import { useAppearance } from '../application/AppearanceProvider';

export function InteractiveTerminal({
  cwd,
  ready,
  fontSize,
  active,
  clearGeneration,
}: {
  cwd?: string;
  ready: boolean;
  fontSize: number;
  active: boolean;
  clearGeneration: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const resizeTerminal = useRef<(() => void) | null>(null);
  const { theme, t } = useAppearance();
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!host.current || !cwd || !ready) return;
    let disposed = false;
    let started = false;
    let off: (() => void) | undefined;
    const id = crypto.randomUUID();
    const term = new Terminal({
      cursorBlink: true,
      scrollback: 5000,
      fontSize,
      convertEol: false,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      allowProposedApi: false,
      screenReaderMode: true,
    });
    terminal.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();
    let writes = Promise.resolve();
    let pendingBytes = 0;
    const input = term.onData((data) => {
      const bytes = new TextEncoder().encode(data);
      if (pendingBytes + bytes.length > 262144) {
        setError(t('终端输入过快，请稍后重试。'));
        return;
      }
      pendingBytes += bytes.length;
      const encoded = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
      writes = writes
        .then(() => bridge.rpc('command/exec/write', { processId: id, deltaBase64: encoded }))
        .then(() => {})
        .catch((e) => {
          if (!disposed) setError(String(e));
        })
        .finally(() => {
          pendingBytes -= bytes.length;
        });
    });
    const resize = () => {
      if (disposed) return;
      if (!host.current?.clientWidth || !host.current.clientHeight) return;
      fit.fit();
      if (started)
        void bridge
          .rpc('command/exec/resize', { processId: id, size: { rows: term.rows, cols: term.cols } })
          .catch((e) => {
            if (!disposed) setError(String(e));
          });
    };
    resizeTerminal.current = resize;
    let resumeFrame: number | undefined;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (resumeFrame !== undefined) cancelAnimationFrame(resumeFrame);
      resumeFrame = requestAnimationFrame(() => {
        resumeFrame = undefined;
        resize();
      });
    };
    const unsubscribeResume = subscribeToResume(refresh);
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    void (async () => {
      off = await bridge.subscribe((event) => {
        if (event.method === 'engine/disconnected') {
          term.writeln(`\r\n[${t('未连接')}]`);
          return;
        }
        if (
          event.method === 'command/exec/outputDelta' &&
          event.params?.processId === id &&
          typeof event.params.deltaBase64 === 'string'
        ) {
          term.write(Uint8Array.from(atob(event.params.deltaBase64), (c) => c.charCodeAt(0)));
        }
      });
      if (disposed) {
        off();
        return;
      }
      started = true;
      if (active) term.focus();
      const result = await bridge.openTerminal(cwd, id, term.rows, term.cols);
      if (!disposed) term.writeln(`\r\n[${t('退出码')} ${result.exitCode}]`);
    })().catch((e) => {
      if (!disposed) setError(String(e));
    });
    return () => {
      disposed = true;
      unsubscribeResume();
      if (resumeFrame !== undefined) cancelAnimationFrame(resumeFrame);
      observer.disconnect();
      input.dispose();
      off?.();
      terminal.current = null;
      resizeTerminal.current = null;
      term.dispose();
      if (started) void bridge.rpc('command/exec/terminate', { processId: id }).catch(() => {});
    };
  }, [cwd, ready, generation]);
  useEffect(() => {
    if (clearGeneration > 0) terminal.current?.clear();
  }, [clearGeneration]);
  useEffect(() => {
    if (active) {
      resizeTerminal.current?.();
      terminal.current?.focus();
    }
  }, [active]);
  useEffect(() => {
    if (terminal.current) {
      terminal.current.options.fontSize = fontSize;
      terminal.current.options.theme =
        theme === 'dark'
          ? { background: '#0f0f10', foreground: '#e4e4e7', cursor: '#60a5fa' }
          : { background: '#f5f7fb', foreground: '#202632', cursor: '#2563eb' };
      resizeTerminal.current?.();
    }
  }, [theme, fontSize, cwd, ready, generation]);
  return (
    <div className="interactive-terminal">
      <div className="terminal-session-actions">
        <span>{cwd ?? t('先打开一个项目')}</span>
        <button
          onClick={() => {
            setError('');
            setGeneration((n) => n + 1);
          }}
          disabled={!ready || !cwd}
        >
          {t('重启终端')}
        </button>
      </div>
      {!ready && <p>{t('请先连接执行引擎')}</p>}
      {error && (
        <p role="alert">
          <ErrorNotice message={error} />
        </p>
      )}
      <div className="terminal-screen" ref={host} aria-label={t('交互式终端')} />
    </div>
  );
}
