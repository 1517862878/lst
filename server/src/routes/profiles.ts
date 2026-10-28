/**
 * 公开资料路由。
 *
 * 稳定 user UUID 属于内部身份，不提供 `/api/profiles/:id` 查询旁路。
 * 公共读取只能按 username 进入数据库受控函数，且响应不含 profiles.id。
 */
import type { FastifyInstance } from 'fastify'
import { currentUser } from '../lib/auth.js'
import { withRls } from '../lib/db.js'
import { notFound, validation } from '../lib/errors.js'
import { listProfileInteractions } from '../repositories/interactions.js'
import { getProfileByUsername } from '../repositories/profiles.js'

export async function registerProfileRoutes(app: FastifyInstance) {
  app.get<{ Params: { username: string } }>(
    '/api/profiles/by-username/:username',
    async (req) => {
      const username = req.params.username.trim()
      if (!username || username.length > 20) throw validation('用户名格式不正确')
      const viewer = await currentUser(req)
      const profile = await getProfileByUsername(username, viewer?.userId ?? null)
      if (!profile) throw notFound(`用户不存在：${username}`)
      return profile
    },
  )

  // --------------------------------------------------------------------------
  // 个人主页的「喜欢 / 收藏」列表（0023）
  //
  // 入口按 username 而不是 UUID：0018 之后公开资料接口不再返回稳定 user UUID，
  // 前端个人主页手里只有 username。可见性判定全部在 0023 的 SECURITY DEFINER
  // 函数里（private 仅本人；show_likes/show_favorites 关闭时本人以外返回空集；
  // 只含已发布作品），路由层不重复实现，避免两处规则漂移。
  //
  // 状态码语义：
  //   200 + {items:[]} —— 资料可见但没有公开的这类互动（开关关闭 / 本来就没有）；
  //   404             —— 资料不存在，或 private 且调用者不是本人。
  // --------------------------------------------------------------------------
  app.get<{
    Params: { username: string }
    Querystring: { kind?: string; cursor?: string; limit?: string }
  }>('/api/profiles/:username/interactions', async (req) => {
    const username = req.params.username.trim()
    if (!username || username.length > 20) throw validation('用户名格式不正确')

    const kind = req.query.kind
    if (kind !== 'likes' && kind !== 'favorites') throw validation('kind 必须是 likes 或 favorites')

    const limit = req.query.limit === undefined ? undefined : Number(req.query.limit)
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw validation('limit 必须是正整数')
    }

    // 游客（未登录）可以读公开数据：withRls(null) 让 auth.uid() 为空，
    // 「是不是本人」由数据库函数自己判断，路由不猜。
    const viewer = await currentUser(req)
    return withRls(viewer?.userId ?? null, (c) =>
      listProfileInteractions(c, {
        username,
        kind,
        cursor: req.query.cursor,
        limit,
      }),
    )
  })
}
