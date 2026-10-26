/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    open: false,
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
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
