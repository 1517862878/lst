/**
 * 模拟 GitHub Pages 子路径部署（http://127.0.0.1:PORT/lst/）。
 *
 * 为什么需要它：项目部署在 /lst/ 子路径下，本地默认 base='/' 测不出问题。
 * 这个服务器把 /lst/* 映射到 dist/*，并复现 Pages 的行为：
 *   - 找不到的深链接返回 404 状态 + 404.html 内容（SPA 外壳仍会加载）
 * 用法：node scripts/serve-subpath.mjs [port] [prefix]
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = resolve(root, 'dist')
const PORT = Number(process.argv[2] ?? 4180)
const PREFIX = (process.argv[3] ?? '/lst/').replace(/\/+$/, '') // '/lst'

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
}

async function tryFile(p) {
  try {
    const s = await stat(p)
    return s.isFile() ? p : null
  } catch {
    return null
  }
}

function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type ?? 'text/plain; charset=utf-8' })
  res.end(body)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = decodeURIComponent(url.pathname)

    // 根路径重定向到带前缀（模拟 GitHub Pages 对 /lst 的处理）
    if (pathname === PREFIX || pathname === '/') {
      res.writeHead(302, { location: PREFIX + '/' })
      res.end()
      return
    }

    if (!pathname.startsWith(PREFIX + '/')) {
      send(res, 404, 'not under prefix')
      return
    }

    const relPath = pathname.slice(PREFIX.length + 1) // 去掉 '/lst/'

    // 根路径（'/lst/'）→ 直接给 index.html。
    // 注意不能靠 normalize(join('.', '')) 判断：它会返回 '.' 而不是空串。
    if (relPath === '') {
      const idx = await tryFile(join(DIST, 'index.html'))
      if (idx) {
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' })
        res.end(await readFile(idx))
        return
      }
      send(res, 404, 'index.html missing')
      return
    }

    // 防目录穿越
    const rel = normalize(join('.', relPath)).replace(/^(\.\.[/\\])+/, '')
    let file = await tryFile(join(DIST, rel))

    // 目录形式 → index.html
    if (!file && rel === 'index.html') {
      file = await tryFile(join(DIST, 'index.html'))
    }

    if (file) {
      const ext = extname(file).toLowerCase()
      const headers = { 'content-type': MIME[ext] ?? 'application/octet-stream' }
      if (ext === '.html') headers['cache-control'] = 'no-cache'
      res.writeHead(200, headers)
      res.end(await readFile(file))
      return
    }

    // GitHub Pages 行为：无扩展名的深链接返回 404 状态 + 404.html 内容
    const nf = await tryFile(join(DIST, '404.html'))
    if (nf) {
      send(res, 404, await readFile(nf), MIME['.html'])
      return
    }
    send(res, 404, 'not found')
  } catch (e) {
    send(res, 500, String(e))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${DIST} at http://127.0.0.1:${PORT}${PREFIX}/`)
})
