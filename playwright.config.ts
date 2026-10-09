import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3123);

export default defineConfig({
  testDir: 'e2e',
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 960, height: 540 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] },
  },
  webServer: {
    command: 'npx vite build && npx tsx server/index.ts',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PORT: String(PORT) },
  },
});
