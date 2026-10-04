import { Check, Circle, CircleAlert, LoaderCircle } from 'lucide-react';
import { useAppearance } from '../application/AppearanceProvider';
import { agentStatusLabels, isAgentActive } from '../domain/subagents';
export function AgentStatus({ status }: { status: string }) {
  const { t } = useAppearance();
  const active = isAgentActive(status);
  const Icon = active
    ? LoaderCircle
    : status === 'completed'
      ? Check
      : status === 'errored' || status === 'notFound'
        ? CircleAlert
        : Circle;
  return (
    <span className={`agent-status agent-status-${status}`}>
      <Icon size={13} className={active ? 'spin' : undefined} />
      <span>{t(agentStatusLabels[status] ?? '等待状态')}</span>
    </span>
  );
}
