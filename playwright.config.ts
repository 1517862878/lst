/**
 * Playwright 配置（ROADMAP G-4：三条主链路 E2E）。
 *
 * 设计说明：
 *   1) 优先用系统已装的 Chrome（channel: 'chrome'），避免下载 ~150MB 浏览器包
 *   2) webServer 用 vite preview 跑构建产物 —— 测的是"真实上线的代码"，不是 dev 模式
 *   3) 构建需要 esbuild，受限沙箱会 EPERM，故通过环境变量在 CI/本地放宽
 */
import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
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
        // 用系统 Chrome，避免 npx playwright install 下载浏览器
        channel: 'chrome',
        viewport: { width: 1440, height: 900 },
      },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // 用 process.execPath 而非裸 "node"：本机 PATH 上没有 node（DSH 捆绑运行时）
        command: `"${process.execPath}" scripts/serve-dist.mjs ${PORT}`,
        url: BASE_URL,
        // 不复用旧服务：复用会拿到上一次构建的产物，导致改了 dist 仍在测旧代码
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
})
