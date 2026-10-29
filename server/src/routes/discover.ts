/**
 * 发现增强路由（0029）：热门搜索、新作者、编辑精选作品流、staff 打标。
 *
 * 三个 GET 都是公开只读（匿名与登录同权），走 withAnonymous()。
 * 打标是 staff 写操作：走 withRls(actor) 且在函数内部再校验角色 —— 路由层拦一次
 * 只是为了让错误信息更早、更清楚，不是唯一防线。
 */
import type { FastifyInstance } from 'fastify'
import { withAnonymous, withRls } from '../lib/db.js'
import { forbidden, validation } from '../lib/errors.js'
import { requireUser } from '../lib/auth.js'
import {
  listFeaturedPhotos,
  listHotSearches,
  listNewAuthors,
  setEditorChoice,
} from '../repositories/discover.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isStaff(role: unknown): boolean {
  return role === 'editor' || role === 'admin'
}

function assertUuid(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) throw validation(`${label}格式无效`)
  return raw
}

export async function registerDiscoverRoutes(app: FastifyInstance): Promise<void> {
  // 热门搜索：匿名可读；聚合口径与去噪都在数据库函数里
  app.get('/api/discover/hot-searches', async (req) => {
    const query = (req.query ?? {}) as { days?: unknown; limit?: unknown }
    const items = await withAnonymous((client) => listHotSearches(client, query))
    return { items }
  })

  // 新作者推荐：只返回 username 等公开字段，不含 UUID
  app.get('/api/discover/new-authors', async (req) => {
    const query = (req.query ?? {}) as { days?: unknown; limit?: unknown }
    const items = await withAnonymous((client) => listNewAuthors(client, query))
    return { items }
  })

  // 编辑精选作品流：匿名可读，游标分页
  app.get('/api/discover/featured', async (req) => {
    const query = (req.query ?? {}) as { limit?: unknown; cursor?: unknown }
    return withAnonymous((client) => listFeaturedPhotos(client, query))
  })

  // 设为编辑精选（staff）
  app.post('/api/admin/photos/:id/feature', async (req) => {
    const user = await requireUser(req)
    if (!isStaff(user.role)) throw forbidden('需要审核权限')
    const photoId = assertUuid((req.params as { id?: unknown }).id, '作品 ID')

    return withRls(user.userId, async (client) => {
      const result = await setEditorChoice(client, { photoId, staffId: user.userId, featured: true })
      return result
    })
  })

  // 取消编辑精选（staff）
  app.delete('/api/admin/photos/:id/feature', async (req) => {
    const user = await requireUser(req)
    if (!isStaff(user.role)) throw forbidden('需要审核权限')
    const photoId = assertUuid((req.params as { id?: unknown }).id, '作品 ID')

    return withRls(user.userId, async (client) => {
      const result = await setEditorChoice(client, { photoId, staffId: user.userId, featured: false })
      return result
    })
  })
}
