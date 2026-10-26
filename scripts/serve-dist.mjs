/**
 * 生产用静态服务器：把 dist/ 跑起来，供 E2E 使用。
 * 与 vite preview 行为一致（SPA 回退 index.html），但不加载 vite.config，
 * 从而避开 esbuild 在受限沙箱下 spawn EPERM 的问题。
 *
 * 用法：node scripts/serve-dist.mjs [port]
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = resolve(root, 'dist')
const PORT = Number(process.argv[2] ?? 4173)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

async function tryFile(p) {
  try {
    const s = await stat(p)
    return s.isFile() ? p : null
  } catch {
    return null
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = decodeURIComponent(url.pathname)

    // 防目录穿越
    const rel = normalize(join('.', pathname)).replace(/^(\.\.[/\\])+/, '')
    let file = await tryFile(join(DIST, rel))

    // SPA 回退：无扩展名的深链接一律回 index.html
    if (!file && !extname(pathname)) {
      file = await tryFile(join(DIST, 'index.html'))
    }

    if (!file) {
      const nf = await tryFile(join(DIST, '404.html'))
      if (nf) {
        res.writeHead(404, { 'content-type': MIME['.html'] })
        res.end(await readFile(nf))
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }

    const ext = extname(file).toLowerCase()
    const headers = { 'content-type': MIME[ext] ?? 'application/octet-stream' }
    if (ext === '.html') headers['cache-control'] = 'no-cache'

    res.writeHead(200, headers)
    res.end(await readFile(file))
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(String(e))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${DIST} at http://127.0.0.1:${PORT}/`)
})
