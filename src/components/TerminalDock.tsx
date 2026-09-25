import { useEffect, useState } from 'react';
import type { Project } from '../domain/types';
import { TerminalPanel } from './TerminalPanel';
import { useAppearance } from '../application/AppearanceProvider';
export function TerminalDock({
  project,
  visible,
  ready,
  fontSize,
  onClose,
  onExecuted,
}: {
  project?: Project;
  visible: boolean;
  ready: boolean;
  fontSize: number;
  onClose: () => void;
  onExecuted: () => void;
}) {
  const { t } = useAppearance();
  const [sessions, setSessions] = useState<(Project & { projectId: string })[]>([]);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!visible || !project) return;
    setSessions((rows) =>
      rows.some((row) => row.projectId === project.id)
        ? rows
        : rows.length < 8
          ? [...rows, { ...project, projectId: project.id }]
          : rows,
    );
    setActive((current) =>
      sessions.some((row) => row.id === current && row.projectId === project.id)
        ? current
        : (sessions.find((row) => row.projectId === project.id)?.id ?? project.id),
    );
  }, [project?.id, visible]);
  return (
    <section className="terminal-dock" hidden={!visible}>
      <nav className="terminal-tabs">
        <button
          aria-label={t('新建终端')}
          disabled={!project || sessions.length >= 8}
          onClick={() => {
            if (!project) return;
            const id = crypto.randomUUID();
            setSessions((rows) => [
              ...rows,
              {
                ...project,
                id,
                projectId: project.id,
                name: `${project.name} · ${rows.filter((row) => row.projectId === project.id).length + 1}`,
              },
            ]);
            setActive(id);
          }}
        >
          ＋
        </button>
        {sessions.map((session) => (
          <span key={session.id}>
            <button aria-pressed={active === session.id} onClick={() => setActive(session.id)}>
              {session.name}
            </button>
            <button
              aria-label={`${t('结束终端会话')} ${session.name}`}
              onClick={() => {
                setSessions((rows) => rows.filter((row) => row.id !== session.id));
                if (active === session.id)
                  setActive(sessions.find((row) => row.id !== session.id)?.id ?? null);
              }}
            >
              ×
            </button>
          </span>
        ))}
      </nav>
      {!sessions.some((row) => row.id === active) && (
        <p>
          {t(
            sessions.length >= 8
              ? '最多保留 8 个终端会话，请先结束一个会话。'
              : '打开项目后可使用终端。',
          )}
        </p>
      )}
      {sessions.map((session) => (
        <div hidden={session.id !== active} key={session.id}>
          <TerminalPanel
            cwd={session.path}
            ready={ready}
            fontSize={fontSize}
            active={visible && session.id === active}
            onClose={onClose}
            onExecuted={onExecuted}
          />
        </div>
      ))}
    </section>
  );
}
