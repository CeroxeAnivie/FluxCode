import { useAppearance } from '../application/AppearanceProvider';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { CornerDownLeft, LoaderCircle, Square, Terminal, Trash2, X } from 'lucide-react';
import { bridge } from '../infrastructure/bridge';
import { errorText } from '../application/useFluxCode';
import { isImeCommitKey } from '../domain/keyboard';
const InteractiveTerminal = lazy(() =>
  import('./InteractiveTerminal').then((module) => ({ default: module.InteractiveTerminal })),
);

const cap = (s: string, label: string) =>
  s.length > 300_000 ? `${label}\n` + s.slice(-280_000) : s;

export function TerminalPanel({
  cwd,
  ready,
  onClose,
  onExecuted,
  fontSize,
  active,
}: {
  cwd?: string;
  ready: boolean;
  onClose: () => void;
  onExecuted: () => void;
  fontSize: number;
  active: boolean;
}) {
  const { t } = useAppearance();
  const translate = useRef(t);
  translate.current = t;
  const limitOutput = (value: string) => cap(value, translate.current('[较早的输出已截断]'));
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<{
    kind: 'running' | 'completed' | 'failed';
    exitCode?: number;
  } | null>(null);
  const [interactiveOpened, setInteractiveOpened] = useState(true);
  const [mode, setMode] = useState<'command' | 'interactive'>('interactive');
  const [clearGeneration, setClearGeneration] = useState(0);
  const processId = useRef<string | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const commandInput = useRef<HTMLInputElement>(null);
  const decoders = useRef<Record<string, TextDecoder>>({});
  const compositionEndedAt = useRef(0);
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);
  useEffect(() => {
    if (active && mode === 'command') commandInput.current?.focus();
  }, [active, mode]);
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    void bridge
      .subscribe((event) => {
        if (
          event.method !== 'command/exec/outputDelta' ||
          event.params?.processId !== processId.current
        )
          return;
        const encoded = event.params?.deltaBase64;
        if (typeof encoded !== 'string') return;
        try {
          const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
          const stream = String(event.params?.stream ?? 'stdout');
          const decoder = (decoders.current[stream] ??= new TextDecoder('utf-8'));
          const text = decoder.decode(bytes, { stream: true });
          setOutput((current) =>
            limitOutput(
              current +
                text +
                (event.params?.capReached ? translate.current('\n[输出达到配置上限]\n') : ''),
            ),
          );
        } catch {
          setOutput((current) => limitOutput(current + translate.current('\n[输出解码失败]\n')));
        }
      })
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else off = unsubscribe;
      })
      .catch((e) => setOutput(errorText(e)));
    return () => {
      disposed = true;
      off?.();
      if (processId.current)
        void bridge.rpc('command/exec/terminate', { processId: processId.current }).catch(() => {
          /* Engine shutdown also terminates connection-owned processes. */
        });
    };
  }, []);
  async function execute() {
    if (!cwd || !ready || processId.current || !command.trim()) return;
    const id = crypto.randomUUID();
    processId.current = id;
    decoders.current = {};
    const text = command;
    setCommand('');
    setRunning(true);
    setStatus({ kind: 'running' });
    setOutput((current) => limitOutput(current + `\n› ${text}\n`));
    try {
      const result = await bridge.executeTerminal(cwd, text, id);
      setOutput((current) =>
        limitOutput(
          current + result.stdout + result.stderr + `\n[${t('退出码')} ${result.exitCode}]\n`,
        ),
      );
      setStatus({ kind: 'completed', exitCode: result.exitCode });
    } catch (e) {
      setOutput((current) => limitOutput(current + '\n' + errorText(e) + '\n'));
      setStatus({ kind: 'failed' });
    } finally {
      processId.current = null;
      setRunning(false);
      onExecuted();
    }
  }
  async function stop() {
    if (processId.current) {
      try {
        await bridge.rpc('command/exec/terminate', { processId: processId.current });
      } catch (e) {
        setOutput((current) => limitOutput(current + '\n' + errorText(e)));
      }
    }
  }
  return (
    <section className="terminal-panel">
      <header>
        <div>
          <Terminal size={14} />
          <strong>{t('终端')}</strong>
          <span>{t('完全访问')}</span>
          <button onClick={() => setMode('command')} aria-pressed={mode === 'command'}>
            {t('命令')}
          </button>
          <button
            onClick={() => {
              setInteractiveOpened(true);
              setMode('interactive');
            }}
            aria-pressed={mode === 'interactive'}
          >
            {t('交互式终端')}
          </button>
        </div>
        <div>
          <button
            className="icon-button"
            aria-label={t('清空终端')}
            onClick={() => {
              if (mode === 'interactive') setClearGeneration((value) => value + 1);
              else setOutput('');
            }}
          >
            <Trash2 size={13} />
          </button>
          {running && (
            <button className="icon-button" aria-label={t('停止命令')} onClick={() => void stop()}>
              <Square size={12} />
            </button>
          )}
          <button className="icon-button" aria-label={t('关闭终端')} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </header>
      <div hidden={mode !== 'interactive'}>
        {interactiveOpened && (
          <Suspense fallback={<p>{t('正在加载…')}</p>}>
            <InteractiveTerminal
              cwd={cwd}
              ready={ready}
              fontSize={fontSize}
              active={active && mode === 'interactive'}
              clearGeneration={clearGeneration}
            />
          </Suspense>
        )}
      </div>
      <pre
        ref={outputRef}
        className="terminal-output"
        role="log"
        aria-label={t('终端输出')}
        aria-live="off"
        hidden={mode !== 'command'}
      >
        {output ||
          (cwd
            ? `${t('工作目录')}：${cwd}\n${t('输入命令并按回车执行。')}`
            : t('先打开一个项目，再执行命令。'))}
      </pre>
      <form
        className="terminal-input"
        hidden={mode !== 'command'}
        onSubmit={(e) => {
          e.preventDefault();
          if (isImeCommitKey({ key: 'Enter' }, compositionEndedAt.current, performance.now()))
            return;
          void execute();
        }}
      >
        <span>❯</span>
        <input
          ref={commandInput}
          aria-label={t('终端命令')}
          placeholder={ready ? t('输入命令…') : t('请先连接执行引擎')}
          value={command}
          disabled={running || !ready || !cwd}
          onChange={(e) => setCommand(e.target.value)}
          onBlur={() => {
            compositionEndedAt.current = 0;
          }}
          onCompositionStart={() => {
            compositionEndedAt.current = Number.POSITIVE_INFINITY;
          }}
          onCompositionEnd={() => {
            compositionEndedAt.current = performance.now();
          }}
          spellCheck={false}
        />
        <button
          className="icon-button"
          aria-label={t('执行命令')}
          disabled={running || !ready || !cwd || !command.trim()}
          onClick={() => {
            compositionEndedAt.current = 0;
          }}
        >
          {running ? <LoaderCircle size={14} className="spin" /> : <CornerDownLeft size={14} />}
        </button>
      </form>
      <span className="sr-only" role="status">
        {status?.kind === 'running'
          ? t('正在执行命令')
          : status?.kind === 'completed'
            ? `${t('命令执行完成')} · ${t('退出码')} ${status.exitCode}`
            : status?.kind === 'failed'
              ? t('命令执行失败')
              : t('终端就绪')}
      </span>
    </section>
  );
}
