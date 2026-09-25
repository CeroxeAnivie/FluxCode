import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Conversation } from './Conversation';
import { emptyConversation, type ChatItem } from '../domain/types';

function renderCommand(fields: Partial<ChatItem>) {
  return renderToStaticMarkup(
    <Conversation
      state={{
        ...emptyConversation(),
        items: [{ id: 'command', kind: 'command', text: 'pwd', ...fields }],
      }}
      loading={false}
      onPosition={() => {}}
    />,
  );
}

it('command details render zero exit code and duration even without a directory', () => {
  const html = renderCommand({ exitCode: 0, durationMs: 0, detail: 'output' });
  expect(html).toContain('退出码: 0');
  expect(html).toContain('耗时: 0.00 s');
  expect(html).not.toContain('工作目录:');
});

it('incomplete command details omit missing fields without leaking template text', () => {
  const html = renderCommand({ cwd: '/project', exitCode: null, durationMs: null });
  expect(html).toContain('工作目录: /project');
  expect(html).not.toContain('退出码:');
  expect(html).not.toContain('耗时:');
  expect(html).not.toContain('durationMs');
  expect(html).not.toContain('t(&quot;');
});
