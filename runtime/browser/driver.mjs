import { chromium } from 'playwright-core';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

// This process only attaches to the app-owned, isolated remote-page WebView2.
// It never launches a browser or evaluates model-supplied JavaScript.
let browser;
let page;
let snapshotId;
let refs = new Set();
let active = false;
let dialog;
let pendingAction;
const timeout = 8000;
const invalidate = () => {
  snapshotId = undefined;
  refs.clear();
};
const safeUrl = (value) => {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    ['tauri.localhost', 'asset.localhost', 'ipc.localhost'].includes(url.hostname)
  )
    throw new Error('UNSAFE_PAGE');
};
async function snapshot() {
  safeUrl(page.url());
  if (dialog)
    return {
      url: page.url(),
      dialog: { type: dialog.type(), message: dialog.message().slice(0, 1000) },
      note: 'Use handle_dialog before interacting with the page.',
    };
  const tree = (await page.ariaSnapshot({ mode: 'ai', depth: 24, timeout })).slice(0, 60000);
  refs = new Set([...tree.matchAll(/\[ref=([a-zA-Z0-9]+)\]/g)].map((match) => match[1]));
  snapshotId = randomUUID();
  return {
    snapshotId,
    url: page.url(),
    title: await page.title(),
    untrustedPageContent: tree,
    dialog: dialog ? { type: dialog.type(), message: dialog.message().slice(0, 1000) } : null,
  };
}
async function target(input) {
  if (!snapshotId || input.snapshotId !== snapshotId || !refs.has(input.ref))
    throw new Error('STALE_TARGET');
  const locator = page.locator('aria-ref=' + input.ref);
  if ((await locator.count()) !== 1) throw new Error('STALE_TARGET');
  await locator.scrollIntoViewIfNeeded({ timeout });
  // Outline is temporary and does not change layout or steal input focus.
  await locator.evaluate((element) => {
    const old = element.style.outline;
    element.style.outline = '2px solid #60a5fa';
    setTimeout(() => {
      element.style.outline = old;
    }, 700);
  });
  return locator;
}
async function execute(input) {
  if (input.action === 'connect') {
    const endpoint = new URL(input.endpoint);
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port)
      throw new Error('INVALID_ENDPOINT');
    browser = await chromium.connectOverCDP(input.endpoint, { timeout, isLocal: true });
    const candidates = browser.contexts().flatMap((context) => context.pages());
    for (const candidate of candidates) {
      if (
        await candidate
          .evaluate((token) => globalThis.__fluxcodeBrowserSurface === token, input.surface)
          .catch(() => false)
      ) {
        if (page) throw new Error('AMBIGUOUS_SURFACE');
        page = candidate;
      }
    }
    if (!page) throw new Error('SURFACE_NOT_FOUND');
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);
    page.on('framenavigated', invalidate);
    page.on('close', invalidate);
    page.on('dialog', (value) => {
      dialog = value;
    });
    return { connected: true };
  }
  if (!page || page.isClosed()) throw new Error('BROWSER_CLOSED');
  safeUrl(page.url());
  if (input.action === 'snapshot' || input.action === 'read_page') return snapshot();
  if (input.action === 'screenshot') {
    if (dialog) throw new Error('DIALOG_PENDING');
    const bytes = await page.screenshot({ type: 'jpeg', quality: 70, timeout, fullPage: false });
    if (bytes.length > 4 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');
    return { url: page.url(), image: { mimeType: 'image/jpeg', data: bytes.toString('base64') } };
  }
  if (input.action === 'handle_dialog') {
    if (!dialog) throw new Error('NO_DIALOG');
    const current = dialog;
    if (input.accept) await current.accept(input.text ?? undefined);
    else await current.dismiss();
    dialog = undefined;
    await pendingAction;
    pendingAction = undefined;
    return { performed: true, ...(await snapshot()) };
  }
  if (dialog) throw new Error('DIALOG_PENDING');
  let locator;
  if (['click', 'fill', 'press', 'select_option', 'set_checked', 'hover'].includes(input.action))
    locator = await target(input);
  // Native dialogs block the triggering action until a later tool call answers.
  // Race observation, not mutation: the original action is dispatched only once.
  let onDialog;
  const opened = new Promise((resolve) => {
    onDialog = () => resolve({ dialog: true });
    page.once('dialog', onDialog);
  });
  pendingAction = (async () => {
    switch (input.action) {
      case 'click':
        await locator.click({ timeout, noWaitAfter: true });
        break;
      case 'fill':
        await locator.fill(input.text, { timeout });
        break;
      case 'press':
        await locator.press(input.key, { timeout, noWaitAfter: true });
        break;
      case 'select_option':
        await locator.selectOption(input.values, { timeout });
        break;
      case 'set_checked':
        await locator.setChecked(input.checked, { timeout });
        break;
      case 'hover':
        await locator.hover({ timeout });
        break;
      case 'scroll':
        await page.mouse.wheel(input.deltaX ?? 0, input.deltaY ?? 0);
        break;
      default:
        throw new Error('UNKNOWN_ACTION');
    }
  })().then(
    () => ({}),
    (error) => ({ error }),
  );
  const outcome = await Promise.race([pendingAction, opened]);
  page.off('dialog', onDialog);
  if (outcome.error) {
    pendingAction = undefined;
    throw outcome.error;
  }
  if (!dialog) pendingAction = undefined;
  invalidate();
  if (dialog)
    return {
      performed: true,
      dialog: { type: dialog.type(), message: dialog.message().slice(0, 1000) },
      note: 'A page dialog requires handle_dialog.',
    };
  // Never repeat a mutation because observing its result fails.
  try {
    return { performed: true, ...(await snapshot()) };
  } catch {
    return {
      performed: true,
      url: page.url(),
      observationPending: true,
      note: 'Action was dispatched. Read a new snapshot to inspect the result; do not repeat a submission.',
    };
  }
}
const errors = {
  STALE_TARGET: 'The page or target changed. Take a new snapshot before acting.',
  BROWSER_CLOSED: 'The visible browser is closed. Open it first.',
  UNSAFE_PAGE: 'This page cannot be controlled by the browser tool.',
  SURFACE_NOT_FOUND: 'The visible browser is not ready. Retry snapshot after it loads.',
  DIALOG_PENDING: 'A page dialog is pending. Use handle_dialog to accept or dismiss it.',
  NO_DIALOG: 'There is no pending page dialog.',
};
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', async (line) => {
  if (active || line.length > 150000) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        code: 'BUSY',
        error: 'Browser operation is busy or too large.',
      }) + '\n',
    );
    return;
  }
  active = true;
  try {
    const result = await execute(JSON.parse(line));
    process.stdout.write(JSON.stringify({ ok: true, result }) + '\n');
  } catch (error) {
    const code =
      error.name === 'TimeoutError'
        ? 'TIMEOUT'
        : errors[error.message]
          ? error.message
          : 'ACTION_FAILED';
    process.stdout.write(
      JSON.stringify({
        ok: false,
        code,
        error:
          errors[code] ??
          'Browser operation did not complete. Inspect the page before retrying; do not automatically repeat a submission.',
      }) + '\n',
    );
  } finally {
    active = false;
  }
});
lines.on('close', () => process.exit(0));
