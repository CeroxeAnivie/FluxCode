import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const resume = process.env.FLUXCODE_ACCEPTANCE_DATA;
const data = resume ? resolve(resume) : resolve(root, 'work', `native-provider-${Date.now()}`);
const relativeData = relative(resolve(root, 'work'), data);
assert.ok(
  relativeData && !relativeData.startsWith('..') && !isAbsolute(relativeData),
  'Use an isolated directory below work',
);
await mkdir(data, { recursive: true });
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
const env = {
  ...process.env,
  FLUXCODE_TEST_DATA_DIR: data,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [
    '--remote-debugging-port=0',
    ...(proxy ? [`--proxy-server=${proxy}`, '--proxy-bypass-list=<-loopback>'] : []),
  ].join(' '),
};
delete env.WEBVIEW2_USER_DATA_FOLDER;
delete env.FLUXCODE_ACCEPTANCE_KEY;
const key = process.env.FLUXCODE_ACCEPTANCE_KEY;
assert.ok(key, 'FLUXCODE_ACCEPTANCE_KEY must be supplied');
const baseUrl = process.env.FLUXCODE_ACCEPTANCE_URL;
assert.ok(baseUrl, 'FLUXCODE_ACCEPTANCE_URL must be supplied');
const report = { checks: [], scope: 'One authorized real provider, native Windows application' };
const child = spawn(resolve(root, 'src-tauri/target/debug/fluxcode.exe'), [], {
  env,
  windowsHide: true,
  stdio: 'ignore',
});
let browser;
try {
  for (let attempt = 0; attempt < 60 && !browser; attempt++) {
    const files = await readdir(resolve(data, 'webview'), { recursive: true }).catch(() => []);
    for (const file of files.filter((name) => name.endsWith('DevToolsActivePort'))) {
      const port = (await readFile(resolve(data, 'webview', file), 'utf8')).split(/\r?\n/)[0];
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
      if (browser) break;
    }
    if (!browser) await new Promise((done) => setTimeout(done, 250));
  }
  assert.ok(browser, 'Native browser must start');
  const page = browser.contexts()[0].pages()[0];
  await page.getByRole('button', { name: '关闭窗口', exact: true }).waitFor();
  page.setDefaultTimeout(30000);
  if (!resume) {
    await page.evaluate(async (path) => {
      const snapshot = await window.__TAURI_INTERNALS__.invoke('load_ui_state');
      const values = { ...(snapshot?.values ?? {}) };
      values['fluxcode.catalog.v1'] = JSON.stringify({
        version: 1,
        projects: [{ id: 'real-provider', name: '渠道验收', path }],
        tasks: [],
      });
      await window.__TAURI_INTERNALS__.invoke('save_ui_state', {
        expectedGeneration: snapshot?.generation ?? null,
        values,
      });
    }, data);
    await page.reload();
    await page.getByRole('button', { name: '渠道管理', exact: true }).click();
    await page.getByRole('button', { name: '添加渠道', exact: true }).click();
    await page.getByLabel('服务地址', { exact: true }).fill(baseUrl);
    await page.getByLabel('访问密钥', { exact: true }).fill(key);
    await page.getByLabel('渠道名称', { exact: false }).fill('真实渠道限额验收');
    await page.getByRole('button', { name: '导入并使用', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const profiles = await page.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke('list_provider_profiles'),
    );
    report.models = profiles[0].models;
    assert.ok(report.models.includes('gpt-5.6-sol'));
    report.checks.push('native model discovery and import');
    await page.getByRole('combobox', { name: '当前会话模型' }).click();
    await page.locator('.select-item[data-value="gpt-5.6-sol"]').click();
  } else {
    await page.evaluate(async (apiKey) => {
      const settings = await window.__TAURI_INTERNALS__.invoke('load_settings');
      await window.__TAURI_INTERNALS__.invoke('connect_engine', {
        settings,
        apiKey,
        rememberKey: false,
      });
    }, key);
    await page.reload();
  }
  const effort = page.getByRole('combobox', { name: '推理强度' });
  if (!resume) await expect(effort).toHaveAttribute('data-value', 'off');
  const input = page.getByRole('textbox', { name: '任务描述' });
  async function send(text) {
    await input.fill(text);
    await page.getByRole('button', { name: '发送任务', exact: true }).click();
    await page.getByRole('button', { name: '停止任务', exact: true }).waitFor();
    await page
      .getByRole('button', { name: '停止任务', exact: true })
      .waitFor({ state: 'hidden', timeout: 90000 });
  }
  if (!resume) {
    await send(
      '只调用一次终端工具，在当前工作目录创建 acceptance-proof.txt，内容必须是 FLUX_REAL_TOOL_OK。必须实际执行，不要仅输出代码。完成后只回复 FLUX_TOOL_DONE。',
    );
    assert.equal(
      (await readFile(resolve(data, 'acceptance-proof.txt'), 'utf8')).trim(),
      'FLUX_REAL_TOOL_OK',
    );
    await expect(page.locator('.assistant-message').last()).toContainText('FLUX_TOOL_DONE');
    report.checks.push('default effort Responses stream and real terminal tool round trip');
    await effort.click();
    await page.locator('.select-item[data-value="low"]').click();
    await send('只回答 17+25 的数字结果，不调用工具。');
    await expect(page.locator('.assistant-message').last()).toContainText('42');
    report.checks.push('low reasoning effort real completion');
    await page.reload();
    await expect(page.getByRole('combobox', { name: '当前会话模型' })).toHaveAttribute(
      'data-value',
      'gpt-5.6-sol',
    );
    await expect(effort).toHaveAttribute('data-value', 'low');
    report.checks.push('conversation model and effort persist after reload');
  }
  if (!process.argv.includes('--continue-only')) {
    await expect(page.locator('.assistant-message').last()).toContainText('42', { timeout: 30000 });
    await input.fill('先调用终端运行 Start-Sleep -Seconds 20，之后只回复 DONE。');
    await page.getByRole('button', { name: '发送任务', exact: true }).click();
    await page.getByRole('button', { name: '停止任务', exact: true }).click();
    await page.getByRole('button', { name: '停止任务', exact: true }).waitFor({ state: 'hidden' });
    report.checks.push('native stop settles UI (server billing cancellation not observable)');
    if (!(await page.locator('.usage-indicator').getAttribute('open')))
      await page.locator('.usage-indicator summary').click();
    await page.getByRole('button', { name: '压缩上下文', exact: true }).click();
    await page.getByText('上下文已压缩', { exact: true }).first().waitFor({ timeout: 90000 });
    report.checks.push('real context compaction');
  }
  await send('只回复 FLUX_AFTER_COMPACT，不调用工具。');
  await expect(page.locator('.assistant-message').last()).toContainText('FLUX_AFTER_COMPACT');
  report.checks.push('continuation after compaction');
  report.result = 'passed';
} catch (error) {
  report.result = 'failed';
  report.error = String(error).split(key).join('[REDACTED]');
  const page = browser?.contexts()[0]?.pages()[0];
  report.alerts = page
    ? (await page.locator('[role=alert]').allTextContents()).map((x) =>
        x.split(key).join('[REDACTED]'),
      )
    : [];
  process.exitCode = 1;
} finally {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page)
      await page
        .evaluate(async () => {
          const profiles = await window.__TAURI_INTERNALS__.invoke('list_provider_profiles');
          for (const profile of profiles)
            await window.__TAURI_INTERNALS__.invoke('forget_api_key', {
              settings: profile.settings,
            });
        })
        .catch(() => {
          report.cleanup = 'credential cleanup failed';
          report.result = 'failed';
          process.exitCode = 1;
        });
  }
  await writeFile(
    resolve(data, `result-${Date.now()}.json`),
    JSON.stringify(report, null, 2) + '\n',
    'utf8',
  );
  console.log(JSON.stringify({ data, ...report }, null, 2));
  if (child.exitCode === null)
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  await browser?.close().catch(() => {});
}
