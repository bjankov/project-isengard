import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { API_PORT, DEMO_API_PORT, DEMO_BASE_URL, DEMO_WEB_PORT, WEB_PORT } from './e2e/env';

/**
 * Fresh, isolated app data folders for every e2e run. Most tests start from an empty library
 * (`APP_DEMO=0`); the first-launch tests (`first-launch.spec.ts`) get their own server pair
 * with the demo content, at `DEMO_BASE_URL`.
 */
const appHome = mkdtempSync(join(tmpdir(), 'app-e2e-'));
const demoHome = mkdtempSync(join(tmpdir(), 'app-e2e-demo-'));
const apiPort = API_PORT;
const webPort = WEB_PORT;
const demoApiPort = DEMO_API_PORT;
const demoWebPort = DEMO_WEB_PORT;

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
      env: { APP_HOME: appHome, APP_DEMO: '0', PORT: String(apiPort), LOG_LEVEL: 'error' },
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @app/web exec vite --port ${webPort} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${webPort}`,
      env: { PORT: String(apiPort), APP_NO_OPEN: '1' },
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @app/server start',
      url: `http://127.0.0.1:${demoApiPort}/api/health`,
      env: { APP_HOME: demoHome, PORT: String(demoApiPort), LOG_LEVEL: 'error' },
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @app/web exec vite --port ${demoWebPort} --strictPort --host 127.0.0.1`,
      url: DEMO_BASE_URL,
      env: { PORT: String(demoApiPort), APP_NO_OPEN: '1' },
      reuseExistingServer: false,
    },
  ],
});
