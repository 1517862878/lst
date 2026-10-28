/**
 * 社交关系闭环路由（0022）：关注 / 粉丝、关注动态流、通知中心。
 *
 * 约定（与 profiles.ts / account-center.ts 保持一致）：
 *   * 读接口用 currentUser + withRls(uid ?? null)：游客也能看公开粉丝列表，
 *     但私密资料的粉丝列表由数据库函数按 0018 的可见性语义挡掉（404）；
 *   * 写接口用 requireUser：拿不到会话直接 401；
 *   * 写接口的 Origin / CSRF 校验由 lib/request-security.ts 的全局 onRequest 钩子
 *     统一执行，这里不再重复；
 *   * 关注关系与通知都由 SECURITY DEFINER 函数在事务里落库，函数自带幂等。
 */
import type { FastifyInstance } from 'fastify'
import { currentUser, requireUser } from '../lib/auth.js'
import { withRls } from '../lib/db.js'
import { validation } from '../lib/errors.js'
import {
  followUser,
  getUnreadNotificationCount,
  listFeed,
  listFollowers,
  listFollowing,
  listNotifications,
  markNotificationsRead,
  MAX_PAGE_SIZE,
  unfollowUser,
} from '../repositories/social.js'

const FOLLOW_RATE_LIMIT = { max: 60, timeWindow: '1 minute' } as const
const NOTIFICATION_RATE_LIMIT = { max: 60, timeWindow: '1 minute' } as const

/** profiles.username 的库内约束：^[a-z0-9_-]{3,20}$（citext，大小写不敏感）。 */
const USERNAME_PATTERN = /^[a-z0-9_-]{3,20}$/i
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** 一次最多标记多少条通知为已读：防止一个超长数组把 SQL 拖成全表更新。 */
const MAX_MARK_READ_IDS = 200

function parseUsername(raw: string | undefined): string {
  const username = (raw ?? '').trim()
  if (!USERNAME_PATTERN.test(username)) throw validation('用户名不合法')
  return username
}

/** cursor + limit(1–50)；limit 缺省 20，超上限直接钳住而不是报错（与 /api/photos 一致）。 */
function parsePaging(query: { cursor?: string; limit?: string }): { cursor?: string; limit: number } {
  const limit = query.limit === undefined ? 20 : Number(query.limit)
  if (!Number.isInteger(limit) || limit < 1) throw validation('limit 必须是正整数')
  return {
    ...(query.cursor ? { cursor: query.cursor } : {}),
    limit: Math.min(limit, MAX_PAGE_SIZE),
  }
}

export async function registerSocialRoutes(app: FastifyInstance): Promise<void> {
  // ==========================================================================
  // 关注关系
  // ==========================================================================

  /**
   * 关注。幂等：重复调用不会重复计数，也不会报错。
   * 返回最新的关注状态与两侧计数，前端一次请求就能同时刷新按钮和数字。
   */
  app.put<{ Params: { username: string } }>(
    '/api/profiles/:username/follow',
    { config: { rateLimit: FOLLOW_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      const username = parseUsername(req.params.username)
      return withRls(user.userId, (c) => followUser(c, username))
    },
  )

  /** 取关。同样幂等：没关注也返回成功（isFollowing=false）。 */
  app.delete<{ Params: { username: string } }>(
    '/api/profiles/:username/follow',
    { config: { rateLimit: FOLLOW_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      const username = parseUsername(req.params.username)
      return withRls(user.userId, (c) => unfollowUser(c, username))
    },
  )

  /**
   * 粉丝列表。游客可读公开资料；私密资料只有本人能读（否则 404）。
   * 每行带 isFollowing，供列表里的关注按钮回填。
   */
  app.get<{ Params: { username: string }; Querystring: { cursor?: string; limit?: string } }>(
    '/api/profiles/:username/followers',
    async (req) => {
      const user = await currentUser(req)
      const username = parseUsername(req.params.username)
      const paging = parsePaging(req.query)
      return withRls(user?.userId ?? null, (c) => listFollowers(c, { username, ...paging }))
    },
  )

  /** 关注列表，语义同粉丝列表。 */
  app.get<{ Params: { username: string }; Querystring: { cursor?: string; limit?: string } }>(
    '/api/profiles/:username/following',
    async (req) => {
      const user = await currentUser(req)
      const username = parseUsername(req.params.username)
      const paging = parsePaging(req.query)
      return withRls(user?.userId ?? null, (c) => listFollowing(c, { username, ...paging }))
    },
  )

  // ==========================================================================
  // 关注动态流
  // ==========================================================================

  /**
   * 关注动态流：我关注的人的已发布作品，最新在前。
   * 只含 published + 未删除 + 作者未注销（数据库函数里显式重申，不依赖 RLS）。
   */
  app.get<{ Querystring: { cursor?: string; limit?: string } }>('/api/feed', async (req) => {
    const user = await requireUser(req)
    const paging = parsePaging(req.query)
    return withRls(user.userId, (c) => listFeed(c, paging))
  })

  // ==========================================================================
  // 通知中心
  // ==========================================================================

  /**
   * 通知列表。一次事务里同时取未读数，避免列表与角标不一致。
   * 不返回 total：通知没有“总数”语义（读过就沉底），未读数才是前端要的数字。
   */
  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    '/api/me/notifications',
    async (req) => {
      const user = await requireUser(req)
      const paging = parsePaging(req.query)
      return withRls(user.userId, async (c) => {
        const page = await listNotifications(c, paging)
        return { ...page, unreadCount: await getUnreadNotificationCount(c) }
      })
    },
  )

  /**
   * 未读角标。
   * 字段名是 count 而不是 unreadCount：端点名已经说明「数的是什么」，
   * 返回 { count } 是最直白的形状，前端 src/data/api/social.ts 的客户端也按
   * { count } 解析（它接受裸数字或 { count }，不接受 { unreadCount }）。
   * 复合响应（通知列表、标记已读）里仍然叫 unreadCount —— 那些对象里字段需要
   * 限定词才不含糊，"count" 混在 items 里会被读成「本页条数」。
   */
  app.get('/api/me/notifications/unread-count', async (req) => {
    const user = await requireUser(req)
    return { count: await withRls(user.userId, (c) => getUnreadNotificationCount(c)) }
  })

  /**
   * 标记已读。
   *   {}                       → 全部标记为已读（省略 ids 即“全部”，前端就是这么发的）
   *   { all: true }            → 同上，写得更显式
   *   { ids: ["...", "..."] }  → 只标记这些（最多 200 条，不属于自己的 id 静默忽略）
   * 返回 markedCount 与最新未读数，前端可以直接用它更新角标。
   */
  app.post<{ Body: { ids?: unknown; all?: unknown } }>(
    '/api/me/notifications/read',
    { config: { rateLimit: NOTIFICATION_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      const body = req.body ?? {}

      const unknownKeys = Object.keys(body).filter((key) => key !== 'ids' && key !== 'all')
      if (unknownKeys.length > 0) throw validation('包含未知字段', { fields: unknownKeys })
      if (body.all !== undefined && typeof body.all !== 'boolean') {
        throw validation('all 必须是布尔值')
      }

      let ids: string[] | null = null
      if (body.ids === undefined || body.all === true) {
        if (body.ids !== undefined && body.all === true) throw validation('ids 与 all 只能二选一')
        ids = null
      } else {
        if (!Array.isArray(body.ids) || body.ids.length === 0) {
          throw validation('ids 必须是非空数组；要全部标记已读就不要传 ids')
        }
        if (body.ids.length > MAX_MARK_READ_IDS) {
          throw validation(`一次最多标记 ${MAX_MARK_READ_IDS} 条通知`)
        }
        const list = [...new Set(body.ids.map((id) => (typeof id === 'string' ? id.trim() : '')))]
        if (list.some((id) => !UUID_PATTERN.test(id))) throw validation('ids 含非法的通知 id')
        ids = list
      }

      return withRls(user.userId, async (c) => {
        const markedCount = await markNotificationsRead(c, ids)
        return { markedCount, unreadCount: await getUnreadNotificationCount(c) }
      })
    },
  )
}
