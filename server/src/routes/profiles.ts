/**
 * 公开资料路由。
 *
 * 稳定 user UUID 属于内部身份，不提供 `/api/profiles/:id` 查询旁路。
 * 公共读取只能按 username 进入数据库受控函数，且响应不含 profiles.id。
 */
import type { FastifyInstance } from 'fastify'
import { currentUser } from '../lib/auth.js'
import { notFound, validation } from '../lib/errors.js'
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
}
