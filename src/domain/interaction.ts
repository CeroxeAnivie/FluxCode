export interface AgentQuestion {
  id: string;
  header: string;
  question: string;
  isSecret: boolean;
  options: { label: string; description: string }[] | null;
}
export interface AgentRequest {
  id: string | number;
  threadId: string;
  turnId: string;
  questions: AgentQuestion[];
}
export function parseAgentRequest(value: unknown): AgentRequest {
  const r = value as AgentRequest;
  if (
    !r ||
    !['string', 'number'].includes(typeof r.id) ||
    typeof r.threadId !== 'string' ||
    typeof r.turnId !== 'string' ||
    !Array.isArray(r.questions) ||
    r.questions.length > 10 ||
    !r.questions.every(
      (q) =>
        typeof q.id === 'string' &&
        typeof q.question === 'string' &&
        typeof q.header === 'string' &&
        typeof q.isSecret === 'boolean' &&
        (q.options === null ||
          (Array.isArray(q.options) &&
            q.options.every(
              (o) => typeof o.label === 'string' && typeof o.description === 'string',
            ))),
    )
  )
    throw new Error('Invalid agent question');
  return r;
}
