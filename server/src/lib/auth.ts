/** Cookie 会话身份解析。Bearer 令牌不再被接受。 */
import type { FastifyRequest } from 'fastify'
import { unauthorized } from './errors.js'
import { resolveSession, type SessionPrincipal } from './session.js'
import { getOwnProfile } from '../repositories/profiles.js'

export interface AuthPrincipal {
  userId: string
  username: string
  role: string
  sessionId: string
  expiresAt: Date
}

/**
 * 请求级会话缓存。
 *
 * 为什么需要：处罚守卫（onRequest）与业务处理（requireUser / currentUser）都要知道
 * "这个请求是谁"。不做缓存，一次受限用户写请求就要解析两遍 Cookie + 打两遍库
 * （api_get_session_for_auth + api_session_is_active）。
 *
 * 为什么用 WeakMap 挂在 request 上：请求结束自动回收，不会像"按 userId 做 TTL 缓存"
 * 那样在登出/换号后串味；同一请求内 session 也不会变（Cookie 不会中途改）。
 * 缓存的是 Promise，并发调用（守卫与 handler 都 await 同一 tick）只会查一次库。
 */
const sessionCache = new WeakMap<FastifyRequest, Promise<SessionPrincipal | null>>()

export function sessionOf(req: FastifyRequest): Promise<SessionPrincipal | null> {
  const cached = sessionCache.get(req)
  if (cached) return cached
  const pending = resolveSession(req)
  sessionCache.set(req, pending)
  return pending
}

export async function currentUser(req: FastifyRequest): Promise<AuthPrincipal | null> {
  const session = await sessionOf(req)
  if (!session) return null
  const profile = await getOwnProfile(session.userId)
  if (!profile) return null
  return {
    userId: session.userId,
    username: profile.username,
    role: profile.role,
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
  }
}

export async function requireUser(req: FastifyRequest): Promise<AuthPrincipal> {
  const user = await currentUser(req)
  if (!user) throw unauthorized('登录状态已失效，请重新登录')
  return user
}
