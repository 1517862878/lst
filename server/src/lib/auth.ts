/** Cookie 会话身份解析。Bearer 令牌不再被接受。 */
import type { FastifyRequest } from 'fastify'
import { unauthorized } from './errors.js'
import { resolveSession } from './session.js'
import { getOwnProfile } from '../repositories/profiles.js'

export interface AuthPrincipal {
  userId: string
  username: string
  role: string
  sessionId: string
  expiresAt: Date
}

export async function currentUser(req: FastifyRequest): Promise<AuthPrincipal | null> {
  const session = await resolveSession(req)
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
