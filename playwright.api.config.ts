/**
 * API 模式浏览器旅程：真实 PostgreSQL + Fastify + 生产前端构建。
 *
 * 与 mock E2E 隔离，避免 IndexedDB 种子与真实数据库状态互相污染。
 * webServer 由 api-e2e-harness 统一管理临时库、API 与静态服务器生命周期。
 */
import { defineConfig, devices } from '@playwright/test'

const PORT = 4190
const BASE_URL = process.env.E2E_API_BASE_URL ?? `http://127.0.0.1:${PORT}`
const useSystemChrome = process.env.E2E_SYSTEM_CHROME !== '0' && !process.env.CI

export default defineConfig({
  testDir: './tests/e2e-api',
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-api' }]]
    : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
  projects: [
    {
      name: 'chromium-api',
      use: {
        ...devices['Desktop Chrome'],
        ...(useSystemChrome ? { channel: 'chrome' as const } : {}),
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  ...(process.env.E2E_API_BASE_URL
    ? {}
    : {
        webServer: {
          command: `"${process.execPath}" scripts/api-e2e-harness.mjs`,
          url: `${BASE_URL}/`,
          reuseExistingServer: false,
          timeout: 180_000,
          stdout: 'pipe' as const,
          stderr: 'pipe' as const,
        },
      }),
})
