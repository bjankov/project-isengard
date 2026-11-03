import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/** Fresh, isolated app data folder for every e2e run. */
const appHome = mkdtempSync(join(tmpdir(), 'app-e2e-'));
const apiPort = 4417;
const webPort = 5299;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    // Use the locally installed Chrome; no browser download needed.
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @app/server start',
      url: `http://127.0.0.1:${apiPort}/api/health`,
      env: { APP_HOME: appHome, PORT: String(apiPort), LOG_LEVEL: 'error' },
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @app/web exec vite --port ${webPort} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${webPort}`,
      env: { PORT: String(apiPort), APP_NO_OPEN: '1' },
      reuseExistingServer: false,
    },
  ],
});
