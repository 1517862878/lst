/**
 * 数据库连接池与 RLS 上下文管理。
 *
 * 核心设计（务必理解，否则安全模型会失效）：
 *
 * 1) 用【普通角色】连接，不用 postgres
 *    postgres 是 superuser，会【完全绕过 RLS】。
 *    上一轮实测过：用 postgres 身份时，替他人点赞、自提 admin 全部成功。
 *    必须用 app_user 这类非超级用户，RLS 才真正生效。
 *
 * 2) 每个请求在【同一事务】内设置 app.user_id
 *    RLS 策略通过 auth.uid() 读 current_setting('app.user_id')。
 *    必须用 set_config(..., true)（等价 SET LOCAL）—— 事务结束自动失效，
 *    不会污染连接池里的下个请求。
 *
 * 3) 所有查询都走 withUser / withAnonymous
 *    不允许裸 pool.query —— 否则丢掉 RLS 上下文，等于没有保护。
 */
import pg from 'pg'

const { Pool } = pg

/** 数据库连接配置（从环境变量读，不硬编码密码） */
function buildConfig() {
  return {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'gongke',
    // 关键：应用角色，不是 postgres
    user: process.env.PGUSER ?? 'app_user',
    password: process.env.PGPASSWORD ?? '',
    // 连接池大小：本项目初期并发不高，10 足够
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  }
}

export const pool = new Pool(buildConfig())

pool.on('error', (err) => {
  console.error('[pg] 连接池异常:', err.message)
})

/** RLS 上下文中的用户信息 */
export interface RlsContext {
  userId: string | null
}

/**
 * 在带 RLS 上下文的事务里执行回调。
 *
 * @param userId 当前登录用户 id；null 表示匿名
 * @param fn 回调收到的 client 已设置好 app.user_id
 *
 * 为什么必须包事务：SET LOCAL 只在事务内有效。
 * 事务外的 set_config(..., true) 会被忽略（只报 warning），
 * 于是 auth.uid() 返回 null —— 匿名身份，但你以为自己设置了。
 */
export async function withRls<T>(
  userId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    // 第三个参数 true = 事务级设置（等价 SET LOCAL）
    await client.query('select set_config($1, $2, true)', [
      'app.user_id',
      userId ?? '',
    ])
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    try {
      await client.query('rollback')
    } catch {
      // 回滚失败不影响原始错误抛出
    }
    throw err
  } finally {
    client.release()
  }
}

/** 匿名访问（公开数据） */
export function withAnonymous<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withRls(null, fn)
}

/**
 * 不带 RLS 上下文的连接（app.user_id 不设置，为匿名）。
 *
 * 【更正一处长期误述】这里并【不】绕过 RLS：
 * 连接用的仍是 app_user（非 superuser、非 BYPASSRLS），
 * 策略与表权限照常生效 —— 它只是"没有登录身份"而已。
 * 因此它只能用于：健康检查、以及经 security definer 函数访问的运维路径。
 * 【明确禁止】用它读用户私有数据。
 *
 * 反面教材：图片清理 worker 曾以为"withSystem 能绕过权限"，
 * 于是直接 update 了一张对 app_user 完全收回的表，结果每轮 42501。
 */
export async function withSystem<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

/** 健康检查：确认数据库可达且角色正确 */
export async function healthCheck(): Promise<{
  ok: boolean
  version?: string
  role?: string
  isSuperuser?: boolean
  error?: string
}> {
  try {
    const r = await withSystem(async (c) => {
      const v = await c.query('select version() as v')
      const who = await c.query(
        "select current_user as role, (select rolsuper from pg_roles where rolname = current_user) as su",
      )
      return {
        version: String(v.rows[0]?.v ?? '').split(' on ')[0],
        role: String(who.rows[0]?.role ?? ''),
        isSuperuser: Boolean(who.rows[0]?.su),
      }
    })
    return { ok: true, ...r }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
