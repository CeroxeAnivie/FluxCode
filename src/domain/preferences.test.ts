import { describe, expect, it } from 'vitest';
import { parseAppearance, resolveLanguage } from './appearance';
import { emptySession, parseSession } from './workspaceSession';
import { validateAttachments } from './attachments';
import { parseAgentRequest } from './interaction';
describe('workspace and user preference contracts', () => {
  it('uses the system language only when requested', () => {
    expect(resolveLanguage('system', ['zh-TW'])).toBe('zh-CN');
    expect(resolveLanguage('system', ['fr-FR'])).toBe('en');
    expect(resolveLanguage('en', ['zh-CN'])).toBe('en');
    expect(() => parseAppearance({ theme: 'pink', language: 'en' })).toThrow();
  });
  it('round trips unfinished work and rejects corrupt or oversized state', () => {
    const session = {
      ...emptySession(),
      projectId: 'p',
      taskId: 't',
      drafts: { t: '继续处理' },
      positions: { t: 123 },
      selections: { t: { model: 'x', effort: 'high' } },
    };
    expect(parseSession(JSON.stringify(session))).toEqual(session);
    expect(() => parseSession('{')).toThrow();
    expect(() => parseSession(JSON.stringify({ ...session, positions: { t: -1 } }))).toThrow();
    expect(() =>
      parseSession(JSON.stringify({ ...session, drafts: { t: 'x'.repeat(100001) } })),
    ).toThrow();
  });
  it('bounds attachments and validates interactive questions', () => {
    expect(() =>
      validateAttachments(
        Array.from({ length: 21 }, (_, i) => ({
          id: String(i),
          kind: 'file',
          path: 'x',
          name: 'x',
        })),
      ),
    ).toThrow();
    expect(() =>
      parseAgentRequest({
        id: 1,
        threadId: 't',
        turnId: 'u',
        questions: [
          {
            id: 'q',
            header: 'Question',
            question: 'Choose',
            isSecret: false,
            options: [{ label: 'A', description: 'B' }],
          },
        ],
      }),
    ).not.toThrow();
    expect(() => parseAgentRequest({ id: 1, questions: [{}] })).toThrow();
  });
});
