import { createHash, randomBytes, randomInt } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { currentUser } from '../lib/auth.js'
import {
  EXPOSE_DEV_CODE, PHONE_CODE_COOLDOWN, PHONE_CODE_MAX_ATTEMPTS, PHONE_CODE_TTL,
  PRIVACY_VERSION, TERMS_VERSION,
} from '../lib/config.js'
import { forbidden, rateLimited, unauthorized, validation } from '../lib/errors.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { restrictionFor, toRestrictionView } from '../lib/restrictions.js'
import { clearSessionCookie, createSession, requestIpHash, revokeSession, setSessionCookie } from '../lib/session.js'
import { smsSender } from '../lib/sms.js'
import { botVerifier } from '../lib/turnstile.js'
import * as accounts from '../repositories/accounts.js'
import { getOwnProfile } from '../repositories/profiles.js'

const USERNAME_RE = /^[a-zA-Z0-9_\-\u4e00-\u9fa5]{2,20}$/u
const PHONE_RE = /^\d{4,20}$/
const CODE_RE = /^\d{6}$/
const REGISTER_PURPOSE = 'register'
const RESET_PURPOSE = 'reset'

function field(body: unknown, key: string): string {
  if (typeof body !== 'object' || body === null) return ''
  const v = (body as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : ''
}
function flag(body: unknown, key: string): boolean {
  return typeof body === 'object' && body !== null && (body as Record<string, unknown>)[key] === true
}
function assertUsername(username: string): void {
  if (!USERNAME_RE.test(username)) throw validation('用户名需 2–20 位，可用中文、字母、数字、下划线、连字符')
}
function assertPassword(password: string): void {
  if (password.length < 6 || password.length > 64) throw validation('密码需 6–64 位')
}
function hashCode(salt: string, code: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex')
}
async function sessionResponse(account: { userId: string; username: string; displayName: string }, req: FastifyRequest, reply: FastifyReply) {
  const session = await createSession(account.userId, req)
  setSessionCookie(reply, session.cookieValue, session.expiresAt)
  const profile = await getOwnProfile(account.userId)
  return { userId: account.userId, username: account.username, displayName: account.displayName, avatarKey: profile?.avatarKey ?? null, role: profile?.role ?? 'user', expiresAt: session.expiresAt.toISOString() }
}
async function issuePhoneCode(phone: string, purpose: string) {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const salt = randomBytes(16).toString('hex')
  const issued = await accounts.createPhoneCode({ phone, purpose, codeHash: hashCode(salt, code), salt, ttlSeconds: PHONE_CODE_TTL, cooldownSeconds: PHONE_CODE_COOLDOWN })
  if (!issued.codeId) throw rateLimited(`请求过于频繁，请 ${Math.max(1, issued.cooldownRemaining)} 秒后再试`)
  await smsSender.send({ phone, code, purpose, ttlSeconds: PHONE_CODE_TTL })
  return { sent: true as const, expiresAt: issued.expiresAt, ...(EXPOSE_DEV_CODE ? { devCode: code } : {}) }
}

/**
 * 登录限流上限（每个 IP / 10 分钟）。
 *
 * 生产默认 10——足够挡住撞库脚本，又不会误伤「密码输错两次再试」的正常用户。
 * 真实 API 的浏览器套件会在一轮里登录七八次（两个账号 × 几个用例），必然超限，
 * 所以允许用环境变量放宽；**只有测试哈枞会设置它**，生产不设即为默认值。
 */
const LOGIN_RATE_MAX = Number(process.env.AUTH_LOGIN_RATE_MAX ?? '10') || 10

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/register/request-code', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const phone = field(req.body, 'phone').trim()
    if (!PHONE_RE.test(phone)) throw validation('请填写正确的手机号')
    await botVerifier.verify({ token: field(req.body, 'turnstileToken'), remoteIp: req.ip, action: 'register_code' })
    return issuePhoneCode(phone, REGISTER_PURPOSE)
  })

  app.post('/api/auth/register', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const username = field(req.body, 'username').trim()
    const displayName = field(req.body, 'displayName').trim()
    const password = field(req.body, 'password')
    const phone = field(req.body, 'phone').trim()
    const code = field(req.body, 'code').trim()
    assertUsername(username)
    if (displayName.length < 1 || displayName.length > 30) throw validation('昵称需 1–30 个字符')
    assertPassword(password)
    if (!PHONE_RE.test(phone)) throw validation('请填写正确的手机号')
    if (!CODE_RE.test(code)) throw validation('验证码为 6 位数字')
    if (!flag(req.body, 'termsAccepted') || !flag(req.body, 'privacyAccepted')) throw validation('必须同意用户协议和隐私政策')
    const latest = await accounts.latestPhoneCode(phone, REGISTER_PURPOSE)
    if (!latest) throw validation('验证码不正确或已过期，请重新获取')
    const result = await accounts.registerVerifiedAccount({
      username, displayName, passwordHash: await hashPassword(password), phone, codeId: latest.codeId,
      codeHash: hashCode(latest.salt, code), termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION,
      ipHash: requestIpHash(req), userAgent: req.headers['user-agent']?.slice(0,512) ?? null,
    })
    if (!result.ok) {
      if (result.reason === 'locked') throw rateLimited('尝试次数过多，请重新获取验证码')
      throw validation(result.reason === 'expired' ? '验证码已过期，请重新获取' : '验证码不正确或已失效')
    }
    return sessionResponse(result.account, req, reply)
  })

  app.post('/api/auth/login', { config: { rateLimit: { max: LOGIN_RATE_MAX, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const identifier = field(req.body, 'username').trim(); const password = field(req.body, 'password')
    if (!identifier || !password) throw validation('请填写用户名和密码')
    await botVerifier.verify({ token: field(req.body, 'turnstileToken'), remoteIp: req.ip, action: 'login' })
    const credential = await accounts.findCredential(identifier)
    const ok = await verifyPassword(credential?.passwordHash ?? null, password)
    if (!credential || !ok) throw unauthorized('用户名或密码错误')
    if (credential.deleted) throw forbidden('该账号已注销')
    const profile = await getOwnProfile(credential.userId)
    if (!profile) throw unauthorized('账号不存在或已注销')
    return sessionResponse({ userId: credential.userId, username: profile.username, displayName: profile.displayName }, req, reply)
  })

  app.get('/api/auth/session', async (req, reply) => {
    const user = await currentUser(req)
    if (!user) return reply.type('application/json').send('null')
    const profile = await getOwnProfile(user.userId)
    if (!profile) { clearSessionCookie(reply); return reply.type('application/json').send('null') }
    // 0026：受限账号也能登录，所以登录态里必须带上"当前处罚"，否则前端只能靠
    // 某个写接口撞 403 才知道自己被限制（P0-18 要求处罚可见）。
    // restrictionFor 走请求级缓存，守卫已经查过的请求在这里不会再查一次库。
    return {
      userId: user.userId,
      username: profile.username,
      displayName: profile.displayName,
      avatarKey: profile.avatarKey,
      role: profile.role,
      expiresAt: user.expiresAt.toISOString(),
      // null = 无生效处罚（含 warning 已过期、处罚已撤销/已到期）
      restriction: toRestrictionView(await restrictionFor(req)),
    }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    await revokeSession(req); clearSessionCookie(reply); return reply.code(204).send()
  })

  app.post('/api/auth/password/request-code', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const phone = field(req.body, 'phone').trim()
    if (!PHONE_RE.test(phone)) throw validation('请填写正确的手机号')
    const credential = await accounts.findCredential(phone)
    if (!credential || credential.deleted) return { sent: true as const }
    return issuePhoneCode(phone, RESET_PURPOSE)
  })

  app.post('/api/auth/password/reset', { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const phone=field(req.body,'phone').trim(), code=field(req.body,'code').trim(), newPassword=field(req.body,'newPassword')
    if (!PHONE_RE.test(phone)) throw validation('请填写正确的手机号')
    if (!CODE_RE.test(code)) throw validation('验证码为 6 位数字')
    assertPassword(newPassword)
    const latest = await accounts.latestPhoneCode(phone, RESET_PURPOSE)
    if (!latest || latest.expired) throw validation('验证码不正确或已过期，请重新获取')
    const outcome = await accounts.resetPasswordWithCode({
      codeId: latest.codeId,
      phone,
      codeHash: hashCode(latest.salt, code),
      passwordHash: await hashPassword(newPassword),
    })
    if (!outcome.ok) {
      if (outcome.locked) throw rateLimited('尝试次数过多，请重新获取验证码')
      if (outcome.reason === 'expired') throw validation('验证码已过期，请重新获取')
      throw validation(`验证码不正确，还可尝试 ${Math.max(0, PHONE_CODE_MAX_ATTEMPTS - outcome.attempts)} 次`)
    }
    clearSessionCookie(reply)
    return { ok:true as const }
  })
}
