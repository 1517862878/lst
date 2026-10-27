/**
 * 请求身份解析（第 2 步：替换原来的 userIdOf 占位实现）。
 *
 * 原实现把 `Bearer <任意 uuid>` 直接当成用户 id：
 * 任何人手写一个 uuid 就能以他人身份读写，甚至可以自封 admin（ROADMAP R-01、D1）。
 * 现在必须验签，伪造令牌在密码学上不可行。
 */
import type { FastifyRequest } from 'fastify'
import { unauthorized } from './errors.js'
import { verifyAccessToken, type TokenClaims } from './jwt.js'

/** 从 Authorization 头取 Bearer 令牌；没有或格式不对返回 null */
export function bearerTokenOf(req: FastifyRequest): string | null {
  const h = req.headers.authorization
  if (typeof h !== 'string') return null
  const m = /^Bearer\s+(.+)$/i.exec(h)
  const token = m?.[1]?.trim()
  return token ? token : null
}

/** 解析当前用户；未登录或令牌无效返回 null（不抛错，供"可选身份"的接口用） */
export async function currentUser(req: FastifyRequest): Promise<TokenClaims | null> {
  const token = bearerTokenOf(req)
  if (!token) return null
  return verifyAccessToken(token)
}

/** 必须登录，否则 401（前端 client.ts 收到 401 会清令牌并跳登录） */
export async function requireUser(req: FastifyRequest): Promise<TokenClaims> {
  const user = await currentUser(req)
  if (!user) throw unauthorized('登录状态已失效，请重新登录')
  return user
}
