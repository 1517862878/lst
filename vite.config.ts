/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 「同源模式」显式开关（P0-2 构建期断言的一半）。
 * 生产构建必须二选一：显式给 VITE_API_BASE，或显式声明同源。两者都没有就中止构建。
 */
const SAME_ORIGIN_FLAG = 'VITE_ALLOW_SAME_ORIGIN'
const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

export default defineConfig(({ command, mode }) => {
  // 用 loadEnv 而不是 process.env：Vite 不会把 .env* 文件的内容写进 process.env，
  // 只读 process.env 会漏掉 .env / .env.production 里配置的值。
  // 前缀传空串 = 「.env 文件值与真实环境变量都要」，同名时后者优先（CI 注入的即后者）。
  const env = loadEnv(mode, process.cwd(), '')

  const apiBase = (env.VITE_API_BASE ?? '').trim()
  const sameOriginDeclared = TRUTHY.has((env[SAME_ORIGIN_FLAG] ?? '').trim().toLowerCase())
  // vitest 也会加载本配置文件，但它不是「生产构建」，不受断言约束
  const isTest = mode === 'test' || process.env.VITEST === 'true'

  // 🔴 构建期断言：宁可让构建失败，也不要线上静默失败。
  // Vite 在构建期把 VITE_API_BASE 内联进产物；漏配时线上访客的浏览器会去请求
  // 「访客自己的 127.0.0.1:3001」——现象是全站没有数据，而且与「真的还没有数据」无法区分。
  if (command === 'build' && !isTest && !apiBase && !sameOriginDeclared) {
    throw new Error(
      [
        '生产构建缺少 API 基址配置，已按设计中止（vite.config.ts 构建期断言）。',
        '',
        '请二选一后重新构建：',
        '  1) 显式指定后端地址：VITE_API_BASE=https://api.example.com',
        `  2) 显式声明同源模式（网关/Nginx 反代 /api）：${SAME_ORIGIN_FLAG}=1`,
        '',
        '说明见项目根目录 .env.example。',
      ].join('\n'),
    )
  }

  // 本地 dev 反向代理的目标：后端路由本身就是 /api/*，所以前端不需要「未配置就回退到
  // 127.0.0.1」的隐式兜底，开发与线上走同一条同源路径。
  const devApiTarget = (env.VITE_DEV_API_TARGET ?? '').trim() || 'http://127.0.0.1:3001'

  return {
    // 空字符串会让基路径失效，统一归一化成根路径。
    // 同时把部署形态显式注入应用：只有 GitHub Pages 这类“无 SPA rewrite”的静态托管才用 hash 路由；
    // 普通生产预览/云服务器仍用 BrowserRouter，避免“只要 PROD 就强制 hash”破坏主链路。
    base: (env.VITE_BASE ?? '').trim() || '/',
    define: {
      __USE_HASH_ROUTER__: JSON.stringify(TRUTHY.has((env.VITE_USE_HASH_ROUTER ?? '').trim().toLowerCase())),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      open: false,
      // 仅本地开发生效：/api/* → 本机后端，前端因此无需配置 VITE_API_BASE
      proxy: {
        '/api': { target: devApiTarget, changeOrigin: true },
      },
      watch: {
        // 忽略非源码目录：.tmp（构建 TMP + Playwright 浏览器 profile 会产生被锁文件，
        // 监视器撞上 EBUSY 会导致 dev 服务器崩溃）、产物、报告、编辑器临时文件
        ignored: [
          '**/.tmp/**',
          '**/.pnpm-store/**',
          '**/dist/**',
          '**/playwright-report/**',
          '**/test-results/**',
          '**/coverage/**',
          '**/node_modules/**',
          '**/.*.tmpdir/**',
          '**/*.tmp',
        ],
      },
    },
    build: {
      target: 'es2022',
      rollupOptions: {
        output: {
          /**
           * ⚠️ 这份分包规则同时是一个「Windows 构建能不能跑起来」的硬约束，别删。
           *
           * esbuild 的 JS API 在单次输入 **超过 1 MiB**（实测 1,048,576 B 通过、
           * 1,048,577 B 失败）时，会改为把内容写进 %TEMP%\esbuild-<hash> 临时文件
           * 而不是走 stdio；随后它删除该文件时被系统拒绝（`remove ...: Access is denied`），
           * 整个 esbuild 调用抛错。Vite 有两处会把 chunk 交给 esbuild：按 build.target
           * 降级语法、以及用 esbuild 压缩。这里的分包把**每个 chunk 都压到 1 MiB 以下**，
           * 两处都不会再触发临时文件，构建就不再中断。
           * （Linux/CI 上不受影响，所以现象是「本地 Windows 构建挂、GitHub Pages 照常发」。）
           *
           * 顺带的好处：react / 路由 / 数据层 各自独立成 chunk，改业务代码只作废
           * 那个几十 KB 的 index chunk，不再让用户重复下载整个 400 KB 主包。
           *
           * 反例：如果哪天往主 chunk 里塞回大依赖，或者单个 chunk 又涨过 1 MiB，
           * `pnpm build` 会重新出现同样的 `[vite:esbuild-transpile] remove ...: Access is denied`。
           * 见到这个报错，先看是不是某个 chunk 又超标了，而不是去查权限/杀毒软件。
           */
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react'
            if (/[\\/]node_modules[\\/]react-router/.test(id)) return 'vendor-router'
            if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return 'vendor-query'
            return 'vendor'
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['tests/**/*.test.{ts,tsx}'],
    },
  }
})
