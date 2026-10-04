import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Release Windows executables use the GUI subsystem. Verify that the MCP helper
// still inherits stdio correctly without creating the desktop or touching user data.
export async function assertBrowserMcpExecutable(executable) {
  const child = spawn(
    executable,
    ['--fluxcode-browser-mcp', String.raw`\\.\pipe\fluxcode-browser-release-verification`],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  const lines = createInterface({ input: child.stdout });
  const send = (message) =>
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  child.stderr.resume();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Packaged browser MCP handshake timed out')),
        12000,
      );
      const fail = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      child.once('error', fail);
      child.stdin.once('error', fail);
      child.once('exit', (code) => fail(new Error('Packaged browser MCP exited early: ' + code)));
      lines.on('line', (line) => {
        try {
          assert.ok(line.length < 100000, 'Unexpected MCP response size');
          const message = JSON.parse(line);
          if (message.id === 1) {
            assert.ok(message.result?.capabilities?.tools, 'Missing tool capability');
            send({ method: 'notifications/initialized' });
            send({ id: 2, method: 'tools/list', params: {} });
          } else if (message.id === 2) {
            assert.ok(
              message.result?.tools?.some((tool) => tool.name === 'browser'),
              'Missing browser tool',
            );
            clearTimeout(timer);
            resolve();
          }
        } catch (error) {
          fail(error);
        }
      });
      send({
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'fluxcode-release-verification', version: '1.0.0' },
        },
      });
    });
  } finally {
    lines.close();
    child.stdin.end();
    if (child.exitCode === null) child.kill();
  }
}
