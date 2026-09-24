import { describe, expect, it } from 'vitest';
import { isModelSelection, reasoningEfforts, turnModelSettings } from './modelSelection';

describe('conversation model selections', () => {
  it('clears inherited effort for Off without sending native none', () => {
    const result = turnModelSettings({ model: 'test-model', effort: 'off' });
    expect(result).not.toHaveProperty('effort');
    expect(result.collaborationMode.settings.reasoning_effort).toBeNull();
    expect(
      turnModelSettings({ model: 'test-model', effort: 'none' }).collaborationMode.settings
        .reasoning_effort,
    ).toBe('none');
  });
  it.each(reasoningEfforts.filter((effort) => effort !== 'off'))(
    'preserves native %s',
    (effort) => {
      expect(
        turnModelSettings({ model: 'custom-model', effort }).collaborationMode.settings
          .reasoning_effort,
      ).toBe(effort);
    },
  );
  it('rejects malformed selections', () => {
    for (const value of [
      null,
      {},
      { model: '', effort: 'off' },
      { model: 'x', effort: 'invalid' },
      { model: 'x'.repeat(201), effort: 'high' },
    ])
      expect(isModelSelection(value)).toBe(false);
  });
});
