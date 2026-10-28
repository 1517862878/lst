/** 运行时安全配置：生产缺关键值时立即失败。 */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = resolve(HERE, '..', '..')
const SECRET_FILE = resolve(SERVER_ROOT, '.jwt-secret')
export const IS_PRODUCTION = process.env.NODE_ENV === 'production'

function persistentDevSecret(): string {
  const fromEnv = process.env.IP_HASH_SECRET?.trim() || process.env.JWT_SECRET?.trim()
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error('IP_HASH_SECRET 至少需要 32 个字符')
    return fromEnv
  }
  if (IS_PRODUCTION) throw new Error('生产环境必须设置 IP_HASH_SECRET')
  if (existsSync(SECRET_FILE)) {
    const saved = readFileSync(SECRET_FILE, 'utf8').trim()
    if (saved.length >= 32) return saved
  }
  const fresh = randomBytes(48).toString('base64url')
  writeFileSync(SECRET_FILE, fresh, { mode: 0o600 })
  return fresh
}

export const IP_HASH_SECRET = persistentDevSecret()
// 旧 JWT 导出保留到所有旧模块删除为止；Cookie 会话不再签发 JWT。
export const JWT_SECRET = process.env.JWT_SECRET?.trim() || IP_HASH_SECRET
export const JWT_SECRET_BYTES = new TextEncoder().encode(JWT_SECRET)
export const ACCESS_TOKEN_TTL = Number(process.env.JWT_TTL ?? 7 * 24 * 3600)

export const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS ?? 7 * 24 * 3600)
export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME?.trim() || (IS_PRODUCTION ? '__Host-gk_session' : 'gk_session')
export const CSRF_COOKIE_NAME = process.env.CSRF_COOKIE_NAME?.trim() || 'gy_csrf'
export const COOKIE_SECURE = IS_PRODUCTION || /^(1|true|yes)$/i.test(process.env.COOKIE_SECURE ?? '')
export const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY ?? '')

function parseOrigins(): Set<string> {
  const raw = process.env.TRUSTED_ORIGINS?.trim()
  if (!raw && IS_PRODUCTION) throw new Error('生产环境必须设置 TRUSTED_ORIGINS')
  const defaults = ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost:4173']
  return new Set((raw ? raw.split(',') : defaults).map((x) => new URL(x.trim()).origin))
}
export const TRUSTED_ORIGINS = parseOrigins()

export const PHONE_CODE_TTL = Number(process.env.SMS_CODE_TTL ?? 300)
export const PHONE_CODE_COOLDOWN = Number(process.env.SMS_CODE_COOLDOWN ?? 60)
export const PHONE_CODE_MAX_ATTEMPTS = 5
export const EXPOSE_DEV_CODE = !IS_PRODUCTION && process.env.SMS_PROVIDER !== 'aliyun'

export const TURNSTILE_PROVIDER = (process.env.TURNSTILE_PROVIDER ?? (IS_PRODUCTION ? 'cloudflare' : 'off')).trim()
export const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET?.trim() || ''
export const TURNSTILE_SITEVERIFY_URL = process.env.TURNSTILE_SITEVERIFY_URL?.trim() || 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
export const TURNSTILE_TIMEOUT_MS = Number(process.env.TURNSTILE_TIMEOUT_MS ?? 5000)
if (IS_PRODUCTION && TURNSTILE_PROVIDER === 'cloudflare' && !TURNSTILE_SECRET) {
  throw new Error('生产环境启用 Cloudflare Turnstile 时必须设置 TURNSTILE_SECRET')
}

export const TERMS_VERSION = process.env.TERMS_VERSION?.trim() || '2026-10-28'
export const PRIVACY_VERSION = process.env.PRIVACY_VERSION?.trim() || '2026-10-28'
