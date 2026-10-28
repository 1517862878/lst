import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  COOKIE_SECURE,
  CSRF_COOKIE_NAME,
  IP_HASH_SECRET,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from './config.js'
import * as accounts from '../repositories/accounts.js'

export interface SessionPrincipal {
  userId: string
  sessionId: string
  expiresAt: Date
}

const SESSION_COOKIE = {
  path: '/',
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: 'lax' as const,
}

export function requestIpHash(req: FastifyRequest): string {
  return createHmac('sha256', IP_HASH_SECRET).update(req.ip).digest('base64url')
}

function tokenHash(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

function parseCookie(value: string | undefined): { sessionId: string; secret: string } | null {
  if (!value) return null
  const [sessionId, secret, extra] = value.split('.')
  if (extra || !sessionId || !secret || !/^[0-9a-f-]{36}$/i.test(sessionId) || secret.length < 32) return null
  return { sessionId, secret }
}

export async function createSession(userId: string, req: FastifyRequest): Promise<{ cookieValue: string; expiresAt: Date }> {
  const secret = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
  const row = await accounts.createSession({
    userId,
    tokenHash: tokenHash(secret),
    expiresAt,
    userAgent: req.headers['user-agent']?.slice(0, 512) ?? null,
    ipHash: requestIpHash(req),
  })
  return { cookieValue: `${row.sessionId}.${secret}`, expiresAt: row.expiresAt }
}

export async function resolveSession(req: FastifyRequest): Promise<SessionPrincipal | null> {
  const parsed = parseCookie(req.cookies[SESSION_COOKIE_NAME])
  if (!parsed) return null
  const stored = await accounts.getSessionForAuth(parsed.sessionId)
  if (!stored || stored.expiresAt.getTime() <= Date.now()) return null
  const actual = Buffer.from(tokenHash(parsed.secret))
  const expected = Buffer.from(stored.tokenHash)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  if (!(await accounts.sessionIsActive(stored.sessionId, stored.userId))) return null
  return { userId: stored.userId, sessionId: stored.sessionId, expiresAt: stored.expiresAt }
}

export async function revokeSession(req: FastifyRequest): Promise<void> {
  const current = await resolveSession(req)
  if (current) await accounts.revokeSession(current.sessionId, current.userId)
}

export function setSessionCookie(reply: FastifyReply, value: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE_NAME, value, { ...SESSION_COOKIE, expires: expiresAt })
  const csrf = randomBytes(24).toString('base64url')
  reply.setCookie(CSRF_COOKIE_NAME, csrf, {
    path: '/',
    httpOnly: false,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    expires: expiresAt,
  })
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, SESSION_COOKIE)
  reply.clearCookie(CSRF_COOKIE_NAME, { path: '/', secure: COOKIE_SECURE, sameSite: 'lax' })
}
