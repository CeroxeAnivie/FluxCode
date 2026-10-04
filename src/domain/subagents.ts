import type { AgentReference, ChatItem, Conversation } from './types';

export const agentStatusLabels: Record<string, string> = {
  waitingInput: '等待回答',
  waitingApproval: '等待审批',
  pendingInit: '正在初始化',
  running: '运行中',
  interrupted: '已中断',
  completed: '已完成',
  errored: '失败',
  shutdown: '已停止',
  notFound: '会话不存在',
  idle: '等待任务',
  unknown: '等待状态',
};
export const agentOperationLabels: Record<string, string> = {
  spawnAgent: '创建子智能体',
  sendInput: '发送任务',
  resumeAgent: '恢复子智能体',
  wait: '等待子智能体',
  closeAgent: '停止子智能体',
  sendMessage: '发送消息',
  followupTask: '追加任务',
  interruptAgent: '中断子智能体',
  listAgents: '查看子智能体',
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const text = (value: unknown) => (typeof value === 'string' ? value : '');

export function normalizeAgentReferences(item: Record<string, unknown>): AgentReference[] {
  const states = record(item.agentsStates);
  const ids = new Set(
    [
      ...(Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.map(text) : []),
      ...Object.keys(states),
    ].filter(Boolean),
  );
  return [...ids].map((threadId) => {
    const state = record(states[threadId]);
    return {
      threadId,
      ...(text(item.model) ? { identity: { model: text(item.model) } } : {}),
      status: text(state.status) || (item.tool === 'spawnAgent' ? 'pendingInit' : 'unknown'),
      message: text(state.message) || undefined,
      prompt: text(item.prompt) || undefined,
    };
  });
}

export function collectSubagents(items: ChatItem[]): AgentReference[] {
  const agents = new Map<string, AgentReference>();
  for (const item of items)
    for (const agent of item.agents ?? []) {
      const old = agents.get(agent.threadId);
      agents.set(agent.threadId, {
        ...old,
        ...agent,
        identity: agent.identity ?? old?.identity ?? item.identity,
        name: agent.name || old?.name,
        prompt: old?.prompt || agent.prompt,
        message: agent.message || old?.message,
        status: agent.status === 'unknown' ? (old?.status ?? 'unknown') : agent.status,
      });
    }
  return [...agents.values()];
}

export function isAgentActive(status: string) {
  return ['running', 'pendingInit', 'unknown', 'waitingInput', 'waitingApproval'].includes(status);
}

export function conversationAgentStatus(conversation: Conversation, fallback: string): string {
  if (conversation.busy)
    return fallback === 'waitingInput' || fallback === 'waitingApproval' ? fallback : 'running';
  if (conversation.error || conversation.lastTurnStatus === 'failed') return 'errored';
  if (conversation.lastTurnStatus === 'interrupted') return 'interrupted';
  if (conversation.lastTurnStatus === 'completed') return 'completed';
  return fallback;
}
