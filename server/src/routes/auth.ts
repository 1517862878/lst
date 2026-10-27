/**
 * 鉴权路由（第 2 步）。
 *
 * 端点与前端契约的对应：
 *   AuthRepository.signUp   → POST /api/auth/register
 *   AuthRepository.signIn   → POST /api/auth/login
 *   AuthRepository.signOut  → POST /api/auth/logout
 *   AuthRepository.getSession → GET /api/auth/session
 *   找回密码（前端 UI 后续补）→ POST /api/auth/password/request-code、/api/auth/password/reset
 *
 * 响应体统一是前端的 Session 形状（userId/username/displayName/token/expiresAt），
 * 这样前端 api 适配器几乎不用做形状转换。
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { bearerTokenOf } from '../lib/auth.js'
import {
  ACCESS_TOKEN_TTL,
  EXPOSE_DEV_CODE,
  PHONE_CODE_COOLDOWN,
  PHONE_CODE_MAX_ATTEMPTS,
  PHONE_CODE_TTL,
} from '../lib/config.js'
import { forbidden, rateLimited, unauthorized, validation } from '../lib/errors.js'
import { signAccessToken, verifyAccessToken } from '../lib/jwt.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { smsSender } from '../lib/sms.js'
import * as accounts from '../repositories/accounts.js'
import { getProfileById } from '../repositories/profiles.js'

/** 与数据库 ck_profiles_username_format 完全一致的规则（2–20 位：中文/字母/数字/下划线/连字符） */
const USERNAME_RE = /^[a-zA-Z0-9_\-\u4e00-\u9fa5]{2,20}$/u
const PHONE_RE = /^\d{4,20}$/
const CODE_RE = /^\d{6}$/

/** 找回密码这个用途在数据库侧允许的取值之一（register/reset/bind） */
const RESET_PURPOSE = 'reset'

/** 宽松取字段：请求体不是对象、字段不是字符串时一律当作空串，交给下面的校验统一报错 */
function field(body: unknown, key: string): string {
  if (typeof body !== 'object' || body === null) return ''
  const v = (body as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : ''
}

function assertUsername(username: string): void {
  if (!USERNAME_RE.test(username)) {
    throw validation('用户名需 2–20 位，可用中文、字母、数字、下划线、连字符')
  }
}

function assertPassword(password: string): void {
  // 上限 64 与前端 passwordSchema 一致；没有上限的话 argon2 会变成一个 CPU 放大器
  if (password.length < 6 || password.length > 64) {
    throw validation('密码需 6–64 位')
  }
}

/** 验证码只存哈希：sha256(salt + ':' + code)。salt 每次发送都重新生成 */
function hashCode(salt: string, code: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex')
}

/** 常量时间比较，避免"第几位开始不匹配"的时序侧信道 */
function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  if (ba.length === 0 || ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** 签发令牌并组装前端契约里的 Session */
async function issueSession(account: {
  userId: string
  username: string
  displayName: string
  role: string
}) {
  const { token, expiresAt } = await signAccessToken({
    userId: account.userId,
    username: account.username,
    role: account.role,
    ttlSeconds: ACCESS_TOKEN_TTL,
  })
  return {
    userId: account.userId,
    username: account.username,
    displayName: account.displayName,
    token,
    expiresAt: expiresAt.toISOString(),
  }
}

export async function registerAuthRoutes(app: FastifyInstance) {
  // ==========================================================================
  // 注册
  // ==========================================================================
  app.post('/api/auth/register', async (req) => {
    const username = field(req.body, 'username').trim()
    const displayName = field(req.body, 'displayName').trim()
    const password = field(req.body, 'password')

    assertUsername(username)
    if (displayName.length < 1 || displayName.length > 30) {
      throw validation('昵称需 1–30 个字符')
    }
    assertPassword(password)

    const passwordHash = await hashPassword(password)

    // 不做"先查重名再插入"：那有竞态（并发两个请求会同时通过预检查）。
    // 直接插，让 profiles_username_key 唯一约束当裁判，重名会抛 23505 → 409 CONFLICT。
    const account = await accounts.registerAccount({
      username,
      displayName: displayName === '' ? username : displayName,
      passwordHash,
      phone: null,
    })

    return issueSession(account)
  })

  // ==========================================================================
  // 登录
  // ==========================================================================
  app.post('/api/auth/login', async (req) => {
    // 该字段允许填用户名或手机号（数据库侧按 username 或 phone 匹配）
    const identifier = field(req.body, 'username').trim()
    const password = field(req.body, 'password')
    if (identifier === '' || password === '') {
      throw validation('请填写用户名和密码')
    }

    const credential = await accounts.findCredential(identifier)
    // verifyPassword 在用户不存在时也会空跑一次同开销的哈希：
    // 否则"响应快 = 用户不存在"就成了用户名枚举器。
    const ok = await verifyPassword(credential?.passwordHash ?? null, password)

    // 刻意合并两种情况、同一句文案：不告诉攻击者"用户存在但密码错"
    if (!credential || !ok) throw unauthorized('用户名或密码错误')

    if (credential.deleted) throw forbidden('该账号已注销')

    // 用户名/昵称以 profiles 为准（触发器可能对初始值做过推导）
    const profile = await getProfileById(credential.userId, credential.userId)

    return issueSession({
      userId: credential.userId,
      username: profile?.username ?? credential.username,
      displayName: profile?.displayName ?? credential.displayName,
      role: credential.role,
    })
  })

  // ==========================================================================
  // 读取当前会话
  // ==========================================================================
  app.get('/api/auth/session', async (req, reply: FastifyReply) => {
    const token = bearerTokenOf(req)

    // 没带令牌 = "没登录"，这是正常状态，不是错误。
    // 显式回 JSON 字面量 null（契约是 getSession(): Promise<Session | null>），
    // 用 200 + null 与下面"令牌无效"的 401 区分开：
    // 令牌无效必须 401，前端 client.ts 收到 401 才会清掉本地脏令牌。
    if (!token) return reply.type('application/json').send('null')

    const claims = await verifyAccessToken(token)
    if (!claims) throw unauthorized('登录状态已失效，请重新登录')

    const profile = await getProfileById(claims.userId, claims.userId)
    if (!profile) throw unauthorized('账号不存在或已注销')

    return {
      userId: claims.userId,
      username: profile.username,
      displayName: profile.displayName,
      token,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
    }
  })

  // ==========================================================================
  // 登出
  // ==========================================================================
  app.post('/api/auth/logout', async (_req, reply: FastifyReply) => {
    // 令牌是无状态 JWT，服务端此刻没有任何东西可以清理。
    // 保留这个端点是为了：① 前端登出流程只有一个调用点；
    // ② 将来接入"可撤销会话表"时前端不用改。
    // ⚠️ 已知限制：登出后旧令牌在有效期内仍然可用（见 lib/config.ts 里 ACCESS_TOKEN_TTL 的说明）。
    return reply.code(204).send()
  })

  // ==========================================================================
  // 找回密码：请求验证码
  // ==========================================================================
  app.post('/api/auth/password/request-code', async (req) => {
    const phone = field(req.body, 'phone').trim()
    if (!PHONE_RE.test(phone)) throw validation('请填写正确的手机号')

    const credential = await accounts.findCredential(phone)

    // 刻意不区分"手机号已注册 / 未注册"：响应体形状完全一致。
    // 否则这个接口就是一个免费的手机号枚举器（能查出某人是否在本站注册过）。
    if (!credential || credential.deleted) {
      return { sent: true as const }
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    const salt = randomBytes(16).toString('hex')

    // 冷却、旧码作废、尝试次数全在数据库函数里做：
    // 这些是安全属性，必须落在权威存储上，不能放在无状态、多进程的 Node 内存里。
    const issued = await accounts.createPhoneCode({
      phone,
      purpose: RESET_PURPOSE,
      codeHash: hashCode(salt, code),
      salt,
      ttlSeconds: PHONE_CODE_TTL,
      cooldownSeconds: PHONE_CODE_COOLDOWN,
    })

    // codeId 为 null 说明处于冷却期，没有发新码
    if (!issued.codeId) {
      throw rateLimited(`请求过于频繁，请 ${Math.max(1, issued.cooldownRemaining)} 秒后再试`)
    }

    await smsSender.send({ phone, code, purpose: RESET_PURPOSE, ttlSeconds: PHONE_CODE_TTL })

    return {
      sent: true as const,
      expiresAt: issued.expiresAt,
      // 仅开发期（console 通道 + 非生产）回显，免去翻日志；
      // 生产环境该字段不会出现（见 lib/config.ts EXPOSE_DEV_CODE）。
      ...(EXPOSE_DEV_CODE ? { devCode: code } : {}),
    }
  })

  // ==========================================================================
  // 找回密码：校验验证码并重设
  // ==========================================================================
  app.post('/api/auth/password/reset', async (req) => {
    const phone = field(req.body, 'phone').trim()
    const code = field(req.body, 'code').trim()
    const newPassword = field(req.body, 'newPassword')

    if (!PHONE_RE.test(phone)) throw validation('请填写正确的手机号')
    if (!CODE_RE.test(code)) throw validation('验证码为 6 位数字')
    assertPassword(newPassword)

    const credential = await accounts.findCredential(phone)
    const latest = await accounts.latestPhoneCode(phone, RESET_PURPOSE)

    // 与"验证码错误"共用同一句文案，不暴露手机号是否注册
    if (!credential || !latest) {
      throw validation('验证码不正确或已过期，请重新获取')
    }
    if (latest.expired) throw validation('验证码已过期，请重新获取')

    const matched = safeEqualHex(hashCode(latest.salt, code), latest.codeHash)

    // 无论成功失败都要落库：失败要累加次数，成功要置 consumed_at
    const outcome = await accounts.finishPhoneCode(latest.codeId, matched)

    if (!matched) {
      if (outcome.locked) throw rateLimited('尝试次数过多，请重新获取验证码')
      const left = Math.max(0, PHONE_CODE_MAX_ATTEMPTS - outcome.attempts)
      throw validation(`验证码不正确，还可尝试 ${left} 次`)
    }

    const passwordHash = await hashPassword(newPassword)
    await accounts.setPassword(credential.userId, passwordHash)

    // ⚠️ 已知限制：改密后旧令牌仍有效（无状态 JWT 无法作废）。
    // 接入可撤销 refresh 会话后，这里要顺手吊销该用户全部会话。
    return { ok: true as const }
  })
}
