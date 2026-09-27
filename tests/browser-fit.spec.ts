import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const script = readFileSync('src-tauri/src/browser_fit.js', 'utf8');
test('fixed-width pages fit the panel and resize back without shrinking responsive pages', async ({
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 700 });
  await page.setContent(
    '<style>body{margin:0}.content{width:1000px;height:100px}</style><div class="content">Fixed page</div>',
  );
  await page.addScriptTag({ content: script });
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector('.content')!.getBoundingClientRect().width),
    )
    .toBeLessThanOrEqual(422);
  await page.setViewportSize({ width: 800, height: 700 });
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector('.content')!.getBoundingClientRect().width),
    )
    .toBeGreaterThan(700);
  await page.setContent(
    '<style>body{margin:0}.content{width:100%;height:100px}</style><div class="content">Responsive page</div>',
  );
  await page.addScriptTag({ content: script });
  await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe('1');
});
