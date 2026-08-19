import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 60_000,
  retries: 1,
  workers: 1,
  reporter: 'list',
  use: {
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },
  projects: [
    {
      name: 'api',
      testDir: './e2e/api',
      use: { baseURL: 'http://localhost:4001' },
    },
    {
      name: 'ui',
      testDir: './e2e/ui',
      use: {
        baseURL: 'http://localhost:5173',
        browserName: 'chromium',
        headless: true,
        screenshot: 'only-on-failure',
        trace: 'on-first-retry',
      },
    },
    {
      name: 'live-api',
      testDir: './e2e/live-api',
      use: {
        baseURL: 'https://zoyd.onrender.com',
        extraHTTPHeaders: {
          'Origin': 'https://zoyd.vercel.app',
        },
      },
    },
    {
      name: 'live-ui',
      testDir: './e2e/live-ui',
      use: {
        baseURL: 'https://zoyd.vercel.app',
        browserName: 'chromium',
        headless: true,
        screenshot: 'only-on-failure',
        trace: 'on-first-retry',
      },
    },
  ],
});
