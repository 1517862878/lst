/**
 * GitHub Pages 构建后处理（FRONTEND-WORK §6.10）。
 * 用法：pnpm build && node scripts/postbuild.mjs
 * 作用：把 dist/index.html 复制为 dist/404.html（SPA 深层路由回退）。
 * 注意：本脚本仅在用户将来部署到 GitHub Pages 时使用；本地开发无需执行。
 */
import { copyFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html 不存在，请先运行 pnpm build')
  process.exit(1)
}

copyFileSync(join(dist, 'index.html'), join(dist, '404.html'))
console.log('✓ 已生成 dist/404.html（SPA 深层路由回退）')
