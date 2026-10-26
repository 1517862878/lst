/**
 * Playwright 配置（ROADMAP G-4：三条主链路 E2E）。
 *
 * 设计说明：
 *   1) 优先用系统已装的 Chrome（channel: 'chrome'），避免下载 ~150MB 浏览器包
 *   2) webServer 跑构建产物 —— 测的是"真实上线的代码"，不是 dev 模式
 *   3) 子路径部署测试（04-subpath-deploy）单独用 playwright.subpath.config.ts，
 *      因为它要求 dist 以 VITE_BASE=/lst/ 构建、并挂在 /lst/ 前缀下，
 *      与默认 base='/' 的服务器不兼容，混跑会全部失败。
 */
import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

/**
 * 是否使用系统已安装的 Chrome。
 * 本机（Windows 开发机）装了 Chrome，用它可省去下载 ~150MB 浏览器包；
 * CI（GitHub Actions）没有系统 Chrome，用的是 `playwright install` 装的 chromium。
 * 设 E2E_SYSTEM_CHROME=0 可强制使用 Playwright 自带浏览器。
 */
const useSystemChrome = process.env.E2E_SYSTEM_CHROME !== '0' && !process.env.CI

export default defineConfig({
  testDir: './tests/e2e',
  // 排除子路径部署测试（需单独的 config 与构建）
  testIgnore: ['**/04-subpath-deploy.spec.ts'],
  // 主链路测试串行执行：避免多个 worker 同时灌种子数据导致 IndexedDB 竞争
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // 不录视频：视频需要 ffmpeg 二进制，缺失时会直接导致 newPage 失败
    video: 'off',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(useSystemChrome ? { channel: 'chrome' as const } : {}),
        viewport: { width: 1440, height: 900 },
      },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // 用 process.execPath 而非裸 "node"：本机 PATH 上没有 node（DSH 捆绑运行时），
        // 而 process.execPath 在 CI 与本地都指向正确的 node 可执行文件
        command: `"${process.execPath}" scripts/serve-dist.mjs ${PORT}`,
        // 探活打根路径（返回 200）；深链接在这套服务器下会 SPA 回退，状态码仍是 200，
        // 但为与 GitHub Pages 行为保持一致，这里统一用根路径
        url: BASE_URL + '/',
        // 不复用旧服务：复用会拿到上一次构建的产物，导致改了 dist 仍在测旧代码
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
})
