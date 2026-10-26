/**
 * 子路径部署测试专用配置。
 *
 * 与主配置的区别：
 *   - 只跑 04-subpath-deploy.spec.ts
 *   - 服务器是 serve-subpath.mjs，把 dist 挂在 /lst/ 前缀下（模拟 GitHub Pages）
 *   - 要求 dist 以 VITE_BASE=/lst/ 构建
 *
 * 用法：
 *   VITE_BASE=/lst/ pnpm build && node scripts/postbuild.mjs
 *   pnpm test:e2e:subpath
 */
import { defineConfig, devices } from '@playwright/test'

const PORT = 4180
const PREFIX = '/lst'
const BASE_URL = process.env.E2E_SUBPATH_URL ?? `http://127.0.0.1:${PORT}${PREFIX}`

/** 本机用系统 Chrome 省下载；CI 用 Playwright 自带 chromium（见 playwright.config.ts 说明） */
const useSystemChrome = process.env.E2E_SYSTEM_CHROME !== '0' && !process.env.CI

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/04-subpath-deploy.spec.ts'],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],

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
      name: 'chromium-subpath',
      use: {
        ...devices['Desktop Chrome'],
        ...(useSystemChrome ? { channel: 'chrome' as const } : {}),
        viewport: { width: 1440, height: 900 },
      },
    },
  ],

  webServer: process.env.E2E_SUBPATH_URL
    ? undefined
    : {
        command: `"${process.execPath}" scripts/serve-subpath.mjs ${PORT} ${PREFIX}/`,
        // 探活打根路径（返回 200），不要打深链接 ——
        // GitHub Pages 对深链接返回 404 状态 + 404.html 内容，探活会误判为服务未就绪
        url: BASE_URL + '/',
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
})
