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
  webServer: [
    {
      command: 'node server/realtime-server.mjs',
      port: 4001,
      reuseExistingServer: true,
      timeout: 30_000,
      // Les specs lisent body.token après login/register. Depuis le passage en
      // cookie-only, le token n'est renvoyé que si ALLOW_DEBUG_CODES=true
      // (jamais en prod). Sans ça, TOUTES les assertions de token échouent en
      // 401 et l'E2E ne testait plus rien — en silence, car la CI ne lance
      // pas Playwright.
      env: { ...process.env, ALLOW_DEBUG_CODES: 'true', NODE_ENV: 'test' },
    },
    {
      command: 'npx vite --port 5173',
      port: 5173,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
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
