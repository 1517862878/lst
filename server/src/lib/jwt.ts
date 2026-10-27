/**
 * JWT 签发与校验（HS256）。
 *
 * 为什么用 jose 而不是自己拼 base64：
 *   签发/校验要正确处理 base64url 补齐、常量时间比较、时钟偏移，
 *   尤其是 **alg 混淆攻击**（alg=none、或把 RS256 伪造为 HS256 让我们用公钥当密钥）。
 *   手写这些正是漏洞来源。
 *
 * 本项目最关键的安全点：校验时显式写死 `algorithms: ['HS256']`。
 * 不写的话 jose 会信任令牌头里的 alg —— 而 alg 是攻击者完全可控的字段。
 */
import { randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { JWT_SECRET_BYTES } from './config.js'

export interface TokenClaims {
  userId: string
  username: string
  /**
   * 签发时的角色，仅供参考展示用。
   *
   * ⚠️ 不要拿它做授权判断：角色可能已被管理员改动而过期。
   * 真正的授权由数据库 RLS（is_editor_or_admin() 读 profiles.role）决定，
   * 前端只传 `sub`，服务端只信 `sub`。
   */
  role: string
  /** 过期时间（秒级 Unix 时间戳） */
  exp: number
}

export interface IssuedToken {
  token: string
  /** 与令牌内 exp 声明完全一致的过期时刻（不是"约等于"） */
  expiresAt: Date
}

export async function signAccessToken(input: {
  userId: string
  username: string
  role: string
  ttlSeconds: number
}): Promise<IssuedToken> {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + input.ttlSeconds
  const token = await new SignJWT({ username: input.username, role: input.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(input.userId)
    // jti 让每次签发都是唯一的。
    // 不加的话，同一秒内签发的令牌字节完全相同（载荷只有 sub/iat/exp），
    // 这会让"每枚令牌可单独追踪/吊销"的后续能力没法实现。
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(JWT_SECRET_BYTES)
  return { token, expiresAt: new Date(exp * 1000) }
}

/**
 * 校验令牌。
 * 无效 / 过期 / 签名不符一律返回 null —— 不区分原因，避免给攻击者额外反馈。
 */
export async function verifyAccessToken(token: string): Promise<TokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_BYTES, {
      // 显式限定算法，防 alg 混淆
      algorithms: ['HS256'],
    })

    const userId = payload.sub
    if (typeof userId !== 'string' || userId === '') return null
    if (typeof payload.exp !== 'number') return null

    return {
      userId,
      username: typeof payload.username === 'string' ? payload.username : '',
      role: typeof payload.role === 'string' ? payload.role : 'user',
      exp: payload.exp,
    }
  } catch {
    return null
  }
}
