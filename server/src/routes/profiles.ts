/**
 * 资料路由。
 *
 * 契约对应关系：
 *   AuthRepository.getProfile(id)              → GET /api/profiles/:id
 *   AuthRepository.getProfileByUsername(name)  → GET /api/profiles/by-username/:username
 *
 * 全部返回 mapPublicProfile（不含 phone）。
 */
import type { FastifyInstance } from 'fastify'
import { currentUser } from '../lib/auth.js'
import { notFound } from '../lib/errors.js'
import { getProfileById, getProfileByUsername } from '../repositories/profiles.js'

/** 先校验 UUID 形状：否则非法 id 会以 Postgres 22P02 的形式变成 400，语义不对（应该是 404） */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function registerProfileRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/api/profiles/:id', async (req) => {
    const { id } = req.params
    if (!UUID_RE.test(id)) throw notFound(`用户不存在：${id}`)

    // 带上当前身份：本人能看到自己已注销的资料，他人看不到
    const viewer = await currentUser(req)
    const profile = await getProfileById(id, viewer?.userId ?? null)
    if (!profile) throw notFound(`用户不存在：${id}`)
    return profile
  })

  // 路径形态与 /api/profiles/:id 不冲突（段数不同），Fastify 的 find-my-way 会正确区分
  app.get<{ Params: { username: string } }>(
    '/api/profiles/by-username/:username',
    async (req) => {
      const { username } = req.params
      const viewer = await currentUser(req)
      const profile = await getProfileByUsername(username, viewer?.userId ?? null)
      if (!profile) throw notFound(`用户不存在：${username}`)
      return profile
    },
  )
}
