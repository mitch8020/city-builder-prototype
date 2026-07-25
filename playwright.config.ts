import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 3,
  use: {
    baseURL: 'http://127.0.0.1:20073',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:20073',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
