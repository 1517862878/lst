/**
 * 创作者统计路由（0030）：`/api/me/stats` 与 `/api/me/stats/photos`。
 *
 * 都是「本人数据」，必须登录；用户 id 只从会话取，不接受 query/body 传参，
 * 因此不存在越权读别人统计的入口。
 */
import type { FastifyInstance } from 'fastify'
import { withRls } from '../lib/db.js'
import { requireUser } from '../lib/auth.js'
import { forbidden, validation } from '../lib/errors.js'
import { getCreatorStats, listPhotoStats } from '../repositories/stats.js'

export async function registerStatsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/me/stats', async (req) => {
    const user = await requireUser(req)
    return withRls(user.userId, (client) => getCreatorStats(client, user.userId))
  })

  app.get('/api/me/stats/photos', async (req) => {
    const user = await requireUser(req)
    const query = (req.query ?? {}) as { limit?: unknown; offset?: unknown }
    const items = await withRls(user.userId, (client) => listPhotoStats(client, user.userId, query))
    return { items }
  })

  // 榜单通知的运维入口：快照发布后调用一次即可（没有调度器，所以做成显式动作）。
  // 只有 staff 能触发，且函数内部幂等（同一快照同一作品不重复发）。
  app.post('/api/admin/rankings/:id/notify', async (req) => {
    const user = await requireUser(req)
    if (user.role !== 'editor' && user.role !== 'admin') throw forbidden('需要审核权限')
    const id = (req.params as { id?: unknown }).id
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw validation('快照 ID 格式无效')
    }
    return withRls(user.userId, async (client) => {
      const { rows } = await client.query<{ created: number }>(
        'select public.api_notify_weekly_rank($1) as created',
        [id],
      )
      return { snapshotId: id, created: Number(rows[0]?.created ?? 0) }
    })
  })
}
