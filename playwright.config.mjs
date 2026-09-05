import { defineConfig, devices } from '@playwright/test';

const PORT = 8080;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL,
    trace: 'on-first-retry',        // 失敗した時だけ再実行してトレースを残す
    screenshot: 'only-on-failure',
    video: 'off'
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // 指での操作を実機に近い条件で検証する（hasTouch / pointer:coarse になる）
    { name: 'mobile', use: { ...devices['Pixel 5'] } }
  ],

  webServer: {
    command: `node tests/serve.mjs`,
    env: { PORT: String(PORT) },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
