/**
 * 运行时配置。
 *
 * 只放「启动时就要确定、且散落在多处容易被写歪」的配置。
 * 密钥绝不硬编码：JWT_SECRET 优先读环境变量，开发期落盘到 server/.jwt-secret。
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // server/src/lib
const SERVER_ROOT = resolve(HERE, '..', '..') // server/
const SECRET_FILE = resolve(SERVER_ROOT, '.jwt-secret')

const isProduction = process.env.NODE_ENV === 'production'

function loadJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim()
  if (fromEnv) {
    if (fromEnv.length < 32) {
      throw new Error('JWT_SECRET 至少需要 32 个字符（HS256 密钥强度下限）')
    }
    return fromEnv
  }

  // 生产环境必须显式提供。若回退到"自动生成并落盘"，容器/ECS 重建后文件丢失，
  // 表现是「所有人突然被登出，且日志里没有任何报错」——极难排查。
  if (isProduction) {
    throw new Error('生产环境必须设置 JWT_SECRET 环境变量')
  }

  // 开发期：首次启动生成并落盘，避免每次热重载都让已发令牌失效。
  // 该文件已在 .gitignore 中，绝不入库。
  if (existsSync(SECRET_FILE)) {
    const saved = readFileSync(SECRET_FILE, 'utf8').trim()
    if (saved.length >= 32) return saved
  }
  const fresh = randomBytes(48).toString('base64url')
  writeFileSync(SECRET_FILE, fresh, { mode: 0o600 })
  return fresh
}

export const JWT_SECRET = loadJwtSecret()

/** jose 需要 Uint8Array 形式的密钥 */
export const JWT_SECRET_BYTES = new TextEncoder().encode(JWT_SECRET)

/**
 * 访问令牌有效期（秒）。
 *
 * 默认 7 天：与静态期 mock 的 7 天会话、以及前端 Session.expiresAt 的语义保持一致。
 *
 * ⚠️ 这是**无状态且不可撤销**的令牌。上云（公网）前必须改成
 * access 15 分钟（JWT_TTL=900）+ 可撤销的 refresh，
 * 否则令牌一旦泄露，在有效期内无法作废 —— 见《上云优化方案》§2.3 与 ROADMAP R-01。
 */
export const ACCESS_TOKEN_TTL = Number(process.env.JWT_TTL ?? 7 * 24 * 3600)

/** 短信验证码有效期（秒） */
export const PHONE_CODE_TTL = Number(process.env.SMS_CODE_TTL ?? 300)

/** 同一手机号 + 同一用途的发送冷却（秒） */
export const PHONE_CODE_COOLDOWN = Number(process.env.SMS_CODE_COOLDOWN ?? 60)

/** 验证码可尝试次数上限（与 0013 迁移 api_finish_phone_code 里的 5 次一致） */
export const PHONE_CODE_MAX_ATTEMPTS = 5

/** 是否把验证码一并回给调用方（仅开发期，用于免看日志联调） */
export const EXPOSE_DEV_CODE = !isProduction && process.env.SMS_PROVIDER !== 'aliyun'
