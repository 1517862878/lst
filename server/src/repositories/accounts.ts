/**
 * 账号仓储：包装 0013 迁移里的 security definer 函数。
 *
 * 为什么"登录/注册"在数据层是"调函数"，而不是直接读写表：
 *   0013 已收回 app_user 对 auth.users 的 SELECT/INSERT，以及
 *   phone_verifications 的全部权限。凭据与验证码现在只有这几个 definer 函数能碰。
 *   这是刻意的边界 —— 应用角色即使代码写错、SQL 注入成功，也拿不到 password_hash 的读取能力。
 *
 * 为什么用 withRls(null) 而不是 withSystem：
 *   withSystem 是"绕过 RLS 的运维通道"，db.ts 里明令禁止用它读用户私有数据。
 *   这里走 withRls(null)：仍然是普通 app_user + 显式事务，
 *   实例能力来自函数自身的 security definer，而不是来自连接身份。
 */
import type pg from 'pg'
import { withRls } from '../lib/db.js'

/** 登录/找回密码所需的凭据行 */
export interface Credential {
  userId: string
  username: string
  displayName: string
  role: string
  phone: string | null
  /** 只用于喂给 argon2 校验，绝不返回给调用方 */
  passwordHash: string | null
  /** 是否已注销（软删）。注销账号不允许登录 */
  deleted: boolean
}

interface CredentialRow {
  user_id: string
  user_name: string
  display_name: string
  user_role: string
  phone: string | null
  password_hash: string | null
  deleted_at: Date | null
}

export interface RegisteredAccount {
  userId: string
  username: string
  displayName: string
  role: string
  phone: string | null
}

interface RegisterRow {
  user_id: string
  user_name: string
  display_name: string
  user_role: string
  phone: string | null
}

/**
 * 按"用户名或手机号"查凭据。
 *
 * 注意：这里能读到 password_hash，这是整个后端唯一能碰到哈希的地方。
 * 调用方（路由）必须只拿它去 verifyPassword，不得写进日志、不得进入响应体。
 */
export async function findCredential(identifier: string): Promise<Credential | null> {
  return withRls(null, async (c: pg.PoolClient) => {
    const r = await c.query<CredentialRow>(
      `select user_id, user_name, display_name, user_role, phone, password_hash, deleted_at
         from public.api_find_credential($1)`,
      [identifier],
    )
    const row = r.rows[0]
    if (!row) return null
    return {
      userId: row.user_id,
      username: row.user_name,
      displayName: row.display_name,
      role: row.user_role,
      phone: row.phone,
      passwordHash: row.password_hash,
      deleted: row.deleted_at !== null,
    }
  })
}

/**
 * 注册账号（同时建 auth.users 与 profiles）。
 *
 * 错误由数据库抛出，交给 errors.ts 的 translateDbError 统一翻译：
 *   23505 重名     → CONFLICT 409
 *   23514 格式不合 → VALIDATION 400
 * 所以这里不重复做一遍"是否重名"的预查询 —— 预查询有竞态，
 * 唯一约束才是最终裁判（先查后插在并发下两个请求会同时通过）。
 */
export async function registerAccount(input: {
  username: string
  displayName: string
  passwordHash: string
  phone: string | null
}): Promise<RegisteredAccount> {
  return withRls(null, async (c: pg.PoolClient) => {
    const r = await c.query<RegisterRow>(
      `select user_id, user_name, display_name, user_role, phone
         from public.api_register_account($1, $2, $3, $4)`,
      [input.username, input.displayName, input.passwordHash, input.phone],
    )
    const row = r.rows[0]
    if (!row) {
      // 函数签名保证必返回一行；走到这里说明迁移与代码不匹配，必须炸出来而不是假装成功
      throw new Error('api_register_account 未返回账号信息（迁移与代码版本不一致？）')
    }
    return {
      userId: row.user_id,
      username: row.user_name,
      displayName: row.display_name,
      role: row.user_role,
      phone: row.phone,
    }
  })
}

/** 重设密码哈希（找回密码 / 后续改密用） */
export async function setPassword(userId: string, passwordHash: string): Promise<void> {
  await withRls(null, (c: pg.PoolClient) =>
    c.query('select public.api_set_password($1, $2)', [userId, passwordHash]),
  )
}

// ===== 手机验证码 =====

export interface IssuedCode {
  /** 冷却中时为 null：表示"没有新发码"，不是"发失败" */
  codeId: string | null
  expiresAt: string | null
  /** 距可以再次发送还剩多少秒；0 表示这次真的发出去了 */
  cooldownRemaining: number
}

export async function createPhoneCode(input: {
  phone: string
  purpose: string
  codeHash: string
  salt: string
  ttlSeconds: number
  cooldownSeconds: number
}): Promise<IssuedCode> {
  return withRls(null, async (c: pg.PoolClient) => {
    const r = await c.query<{
      code_id: string | null
      expires_at: Date | null
      cooldown_remaining: number | null
    }>(
      `select code_id, expires_at, cooldown_remaining
         from public.api_create_phone_code($1, $2, $3, $4, $5, $6)`,
      [
        input.phone,
        input.purpose,
        input.codeHash,
        input.salt,
        input.ttlSeconds,
        input.cooldownSeconds,
      ],
    )
    const row = r.rows[0]
    return {
      codeId: row?.code_id ?? null,
      expiresAt: row?.expires_at ? new Date(row.expires_at).toISOString() : null,
      cooldownRemaining: row?.cooldown_remaining ?? 0,
    }
  })
}

export interface LatestCode {
  codeId: string
  codeHash: string
  salt: string
  expiresAt: string
  attemptCount: number
  expired: boolean
}

export async function latestPhoneCode(phone: string, purpose: string): Promise<LatestCode | null> {
  return withRls(null, async (c: pg.PoolClient) => {
    const r = await c.query<{
      code_id: string
      code_hash: string
      salt: string
      expires_at: Date
      attempt_count: number
      expired: boolean
    }>(
      `select code_id, code_hash, salt, expires_at, attempt_count, expired
         from public.api_latest_phone_code($1, $2)`,
      [phone, purpose],
    )
    const row = r.rows[0]
    if (!row) return null
    return {
      codeId: row.code_id,
      codeHash: row.code_hash,
      salt: row.salt,
      expiresAt: new Date(row.expires_at).toISOString(),
      attemptCount: row.attempt_count,
      expired: row.expired,
    }
  })
}

export interface CodeOutcome {
  /** 累计失败次数 */
  attempts: number
  /** 是否已达尝试上限被锁死 */
  locked: boolean
}

export async function finishPhoneCode(codeId: string, matched: boolean): Promise<CodeOutcome> {
  return withRls(null, async (c: pg.PoolClient) => {
    const r = await c.query<{ attempts: number; locked: boolean }>(
      'select attempts, locked from public.api_finish_phone_code($1, $2)',
      [codeId, matched],
    )
    const row = r.rows[0]
    return { attempts: row?.attempts ?? 0, locked: row?.locked ?? false }
  })
}
