import { useEffect, useRef } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { AgentStatus } from './AgentStatus';
import { useAppearance } from '../application/AppearanceProvider';
import type { SubagentsController } from '../application/useSubagents';
import { isAgentActive } from '../domain/subagents';
import { emptyConversation } from '../domain/types';
import { Conversation } from './Conversation';
import { ErrorNotice } from './ErrorNotice';

export function SubagentPanel({
  controller,
  projectRoot,
}: {
  controller: SubagentsController;
  projectRoot?: string;
}) {
  const { t } = useAppearance();
  const closeButton = useRef<HTMLButtonElement>(null);
  const agent = controller.selected;
  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [agent?.threadId]);
  if (!agent) return null;
  const number = controller.agents.findIndex((item) => item.threadId === agent.threadId) + 1;
  return (
    <aside
      className="subagent-panel"
      aria-label={t('子智能体详情')}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
          event.preventDefault();
          controller.close();
        }
      }}
    >
      <header className="subagent-panel-header">
        <div>
          <strong>{agent.name || `${t('子智能体')} ${number}`}</strong>
          <AgentStatus status={agent.status} />
        </div>
        <button
          className="icon-button"
          aria-label={t('刷新子智能体')}
          title={t('刷新子智能体')}
          disabled={!controller.connected || agent.loading}
          onClick={controller.refresh}
        >
          <RefreshCw size={16} />
        </button>
        <button
          ref={closeButton}
          className="icon-button"
          aria-label={t('关闭子智能体详情')}
          onClick={controller.close}
        >
          <X size={17} />
        </button>
      </header>
      {agent.prompt && (
        <details className="subagent-task">
          <summary>{t('分配的任务')}</summary>
          <p>{agent.prompt}</p>
        </details>
      )}
      {!controller.connected && (
        <p className="subagent-notice" role="status">
          {t('连接已断开，显示最后收到的内容。')}
        </p>
      )}
      {agent.readError && (
        <div className="subagent-notice" role="alert">
          <ErrorNotice message={agent.readError} />
          <button onClick={controller.refresh} disabled={!controller.connected}>
            {t('重试')}
          </button>
        </div>
      )}
      {agent.truncated && (
        <p className="subagent-notice">{t('仅显示最近 2000 条记录，完整历史仍保存在本地。')}</p>
      )}
      {agent.message && !agent.conversation?.items.length && (
        <p className="subagent-notice">{agent.message}</p>
      )}
      {agent.conversation?.items.length || agent.loading ? (
        <Conversation
          key={agent.threadId}
          state={agent.conversation ?? emptyConversation()}
          loading={!!agent.loading}
          projectRoot={projectRoot}
          onPosition={() => {}}
          assistantName={agent.identity?.model}
        />
      ) : (
        <p className="subagent-notice" role="status">
          {t(
            isAgentActive(agent.status)
              ? '正在等待子智能体输出…'
              : '此子智能体尚无可显示的运行记录。',
          )}
        </p>
      )}
    </aside>
  );
}
