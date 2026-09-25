export interface Elicitation {
  id: string | number;
  threadId: string;
  turnId?: string | null;
  serverName: string;
  message: string;
  mode: string;
  url?: string;
  requestedSchema?: {
    properties: Record<
      string,
      {
        type: string;
        title?: string;
        enum?: string[];
        minimum?: number;
        maximum?: number;
        minLength?: number;
        maxLength?: number;
      }
    >;
    required?: string[];
  };
}
export function parseElicitation(value: unknown): Elicitation {
  const item = value as Elicitation;
  if (
    !item ||
    !['string', 'number'].includes(typeof item.id) ||
    typeof item.threadId !== 'string' ||
    (item.turnId != null && typeof item.turnId !== 'string') ||
    typeof item.mode !== 'string' ||
    typeof item.serverName !== 'string'
  )
    throw new Error('Invalid elicitation');
  if (item.requestedSchema && Object.keys(item.requestedSchema.properties ?? {}).length > 64)
    throw new Error('Elicitation field limit exceeded');
  return item;
}
