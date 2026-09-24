import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, LoaderCircle, Square, Terminal, Trash2, X } from 'lucide-react';
import { bridge } from '../infrastructure/bridge';
import { errorText } from '../application/useFluxCode';

const cap = (s: string) => (s.length > 300_000 ? '[较早的输出已截断]\n' + s.slice(-280_000) : s);

export function TerminalPanel({
  cwd,
  ready,
  onClose,
  onExecuted,
}: {
  cwd?: string;
  ready: boolean;
  onClose: () => void;
  onExecuted: () => void;
}) {
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const processId = useRef<string | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const decoders = useRef<Record<string, TextDecoder>>({});
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);
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
            cap(current + text + (event.params?.capReached ? '\n[输出达到配置上限]\n' : '')),
          );
        } catch {
          setOutput((current) => cap(current + '\n[输出解码失败]\n'));
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
    setOutput((current) => cap(current + `\n› ${text}\n`));
    try {
      const result = await bridge.executeTerminal(cwd, text, id);
      setOutput((current) =>
        cap(current + result.stdout + result.stderr + `\n[退出码 ${result.exitCode}]\n`),
      );
    } catch (e) {
      setOutput((current) => cap(current + '\n' + errorText(e) + '\n'));
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
        setOutput((current) => cap(current + '\n' + errorText(e)));
      }
    }
  }
  return (
    <section className="terminal-panel">
      <header>
        <div>
          <Terminal size={14} />
          <strong>终端</strong>
          <span>完全访问</span>
        </div>
        <div>
          <button className="icon-button" aria-label="清空终端" onClick={() => setOutput('')}>
            <Trash2 size={13} />
          </button>
          {running && (
            <button className="icon-button" aria-label="停止命令" onClick={() => void stop()}>
              <Square size={12} />
            </button>
          )}
          <button
            className="icon-button"
            aria-label="关闭终端"
            disabled={running}
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </header>
      <pre ref={outputRef} className="terminal-output">
        {output ||
          (cwd ? `工作目录：${cwd}\n输入命令并按 Enter 执行。` : '先打开一个项目，再执行命令。')}
      </pre>
      <form
        className="terminal-input"
        onSubmit={(e) => {
          e.preventDefault();
          void execute();
        }}
      >
        <span>❯</span>
        <input
          aria-label="终端命令"
          placeholder={ready ? '输入命令…' : '请先连接执行引擎'}
          value={command}
          disabled={running || !ready || !cwd}
          onChange={(e) => setCommand(e.target.value)}
          spellCheck={false}
        />
        <button
          className="icon-button"
          aria-label="执行命令"
          disabled={running || !ready || !cwd || !command.trim()}
        >
          {running ? <LoaderCircle size={14} className="spin" /> : <CornerDownLeft size={14} />}
        </button>
      </form>
    </section>
  );
}
