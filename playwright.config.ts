import { defineConfig } from '@playwright/test';

const port = Number(process.env.FLUXCODE_E2E_PORT ?? 1420);
const outputDir = `work/e2e-dist-${port}`;
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: 0,
  use: {
    ...(proxy ? { proxy: { server: proxy, bypass: '<-loopback>' } } : {}),
    locale: 'zh-CN',
    colorScheme: 'dark',
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 940 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm exec vite build --mode test --outDir ${outputDir} && pnpm exec vite preview --host 127.0.0.1 --port ${port} --outDir ${outputDir}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
