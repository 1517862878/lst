import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME, TRUSTED_ORIGINS } from './config.js'
import { forbidden } from './errors.js'

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

function equal(a: string, b: string): boolean {
  const aa = Buffer.from(a)
  const bb = Buffer.from(b)
  return aa.length === bb.length && timingSafeEqual(aa, bb)
}

export function registerRequestSecurity(app: FastifyInstance): void {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (SAFE.has(req.method)) return
    const origin = req.headers.origin
    if (!origin || origin === 'null' || !TRUSTED_ORIGINS.has(origin)) {
      throw forbidden('请求来源不受信任')
    }
    // 登录/注册/发码尚无会话；严格 Origin 已覆盖登录 CSRF。
    if (!req.cookies[SESSION_COOKIE_NAME]) return
    const cookie = req.cookies[CSRF_COOKIE_NAME]
    const header = req.headers['x-csrf-token']
    if (!cookie || typeof header !== 'string' || !equal(cookie, header)) {
      throw forbidden('CSRF 校验失败，请刷新页面后重试')
    }
  })
}
