export const reasoningEfforts = [
  'off',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];
export interface ModelSelection {
  model: string;
  effort: ReasoningEffort;
}

export function isModelSelection(value: unknown): value is ModelSelection {
  if (!value || typeof value !== 'object') return false;
  const selection = value as ModelSelection;
  return (
    typeof selection.model === 'string' &&
    selection.model.trim().length > 0 &&
    selection.model.length <= 200 &&
    reasoningEfforts.includes(selection.effort)
  );
}

/** Off delegates effort to the provider; native none explicitly disables reasoning. */
export function turnModelSettings(selection: ModelSelection) {
  if (!isModelSelection(selection)) throw new Error('模型或推理强度无效。');
  return {
    model: selection.model,
    collaborationMode: {
      mode: 'default' as const,
      settings: {
        model: selection.model,
        reasoning_effort: selection.effort === 'off' ? null : selection.effort,
        developer_instructions: '',
      },
    },
  };
}
