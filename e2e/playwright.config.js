import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }, // the engine hybrid iOS apps run on
  ],
})
