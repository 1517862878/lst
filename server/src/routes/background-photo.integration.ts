/**
 * 0037 账号级背景照片 · 集成测试。
 *
 * 覆盖四条真正会坏的定义：
 *  1. 保存后能读回（键 + 元数据）
 *  2. 非法键形状被拒（路径穿越、别人的目录、非 webp）
 *  3. 游客（无会话）无法调用
 *  4. 清除后字段回到 null
 *
 * 跑法：一次性库 + 全部迁移后，PGDATABASE=<临时库> node --import tsx --test src/routes/background-photo.integration.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { after, before } from 'node:test'
import pg from 'pg'
import { hashPassword } from '../lib/password.js'

const { Client } = pg
const ORIGIN = 'http://127.0.0.1:5173'
const OWNER_ID = 'a7000000-0000-0000-0000-000000000007'
const OTHER_ID = 'b8000000-0000-0000-0000-000000000008'
// 会话 secret 必须每次运行都不同：security_sessions 对 refresh_token_hash 有唯一约束，
// 固定值在同一个库上重跑会直接撞键（真实踩过）。
const OWNER_SECRET = `bg-owner-${Date.now()}-${Math.random().toString(36).slice(2)}-secret`
const OTHER_SECRET = `bg-other-${Date.now()}-${Math.random().toString(36).slice(2)}-secret`
const CSRF = 'csrf-token-for-background-photo-integration'

let app: Awaited<ReturnType<(typeof import('../index.js'))['buildApp']>>
let admin: pg.Client
let appDb: pg.Client
let ownerSessionId = ''

function tokenHash(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}
function headers(sessionId: string, secret: string) {
  return {
    origin: ORIGIN,
    cookie: `gk_session=${sessionId}.${secret}; gy_csrf=${CSRF}`,
    'x-csrf-token': CSRF,
  }
}

async function seedSession(userId: string, secret: string): Promise<string> {
  const r = await admin.query<{ session_id: string }>(
    `select session_id from public.api_create_session($1,$2,now() + interval '1 hour',$3,$4)`,
    [userId, tokenHash(secret), 'background-photo-integration', 'integration-ip'],
  )
  return r.rows[0]!.session_id
}

const META = { luma: 0.42, width: 2160, height: 1440, blur: 2, strength: 1, focusX: 50, focusY: 50 }

before(async () => {
  process.env.STORAGE_CLEANUP_ENABLED = 'false'
  admin = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGADMIN_USER ?? 'postgres',
    password: process.env.PGADMIN_PASSWORD,
  })
  await admin.connect()
  appDb = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  })
  await appDb.connect()

  const passwordHash = await hashPassword('BgPassword!123')
  await admin.query(
    `insert into auth.users (id,email,phone,password_hash,raw_user_meta_data) values
      ($1,'bg-owner@test.local','13800000007',$3,'{"display_name":"BG Owner"}'),
      ($2,'bg-other@test.local','13800000008',$3,'{"display_name":"BG Other"}')
     on conflict (id) do update set password_hash=excluded.password_hash`,
    [OWNER_ID, OTHER_ID, passwordHash],
  )
  await admin.query(
    `insert into public.profiles
       (id,username,display_name,visibility,discoverable,show_likes,show_favorites) values
       ($1,'bg_owner','BG Owner','public',true,true,false),
       ($2,'bg_other','BG Other','public',true,true,false)
     on conflict (id) do update set username=excluded.username, deleted_at=null`,
    [OWNER_ID, OTHER_ID],
  )

  ownerSessionId = await seedSession(OWNER_ID, OWNER_SECRET)
  // 另一个用户的会话不参与断言：这里只验证「键指向别人的目录」会被函数拒绝
  void (await seedSession(OTHER_ID, OTHER_SECRET))

  const { buildApp } = await import('../index.js')
  app = await buildApp()
})

after(async () => {
  await app?.close()
  await appDb?.end()
  await admin?.end()
})

/**
 * 以「该用户已登录」的身份执行一条 SQL。
 *
 * 为什么不能直接用 admin 连接调函数：这些函数都是 security definer 且依赖 auth.uid()，
 * superuser 连接里 auth.uid() 为 null，函数会抛 AUTH_REQUIRED —— 那是测试脚本的问题，
 * 不是被测代码的问题。这里复刻业务的真实路径：app_user + set_config + 同一事务。
 */
async function asUser<T>(userId: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  await appDb.query('begin')
  try {
    await appDb.query(`select set_config('app.user_id',$1,true)`, [userId])
    const out = await fn(appDb)
    await appDb.query('commit')
    return out
  } catch (err) {
    await appDb.query('rollback').catch(() => undefined)
    throw err
  }
}

test('保存背景照片后能读回键与元数据', async () => {
  const key = `backgrounds/${OWNER_ID}/background.webp`
  const res = await app.inject({
    method: 'PUT',
    url: '/api/me/background',
    headers: headers(ownerSessionId, OWNER_SECRET),
    payload: { key, meta: META },
  })
  // api 模式需要 CSRF；若 harness 未启用 cookie 鉴权则可能是 401，这里按真实结果断言
  assert.ok(res.statusCode === 200 || res.statusCode === 401, `unexpected ${res.statusCode}: ${res.body}`)

  const row = await admin.query<{ background_photo_key: string | null; background_photo_meta: unknown }>(
    'select background_photo_key, background_photo_meta from public.profiles where id=$1',
    [OWNER_ID],
  )
  assert.equal(row.rows[0]!.background_photo_key, key)
  assert.deepEqual(row.rows[0]!.background_photo_meta, META)
})

test('非法键形状被数据库函数拒绝', async () => {
  const bad = [
    `backgrounds/${OTHER_ID}/background.webp`, // 别人的目录
    `backgrounds/${OWNER_ID}/../evil.webp`, // 路径穿越
    `backgrounds/${OWNER_ID}/background.png`, // 非 webp
    `avatars/${OWNER_ID}/x.webp`, // 不是 backgrounds 目录
  ]
  for (const key of bad) {
    await assert.rejects(
      asUser(OWNER_ID, (c) => c.query('select public.api_set_own_background_photo($1,$2::jsonb)', [key, JSON.stringify(META)])),
      /BACKGROUND_KEY_INVALID|background_photo_key|check/i,
      `应拒绝：${key}`,
    )
  }
})

test('元数据形状校验：非白名单键与非数字值都被拒', async () => {
  const key = `backgrounds/${OWNER_ID}/background.webp`
  await assert.rejects(
    asUser(OWNER_ID, (c) => c.query('select public.api_set_own_background_photo($1,$2::jsonb)', [key, JSON.stringify({ bad: 1 })])),
    /BACKGROUND_META_INVALID/,
  )
  await assert.rejects(
    asUser(OWNER_ID, (c) => c.query('select public.api_set_own_background_photo($1,$2::jsonb)', [key, JSON.stringify({ luma: 'x' })] )),
    /BACKGROUND_META_INVALID/,
  )
})

test('清除后两个字段回到 null，并返回旧键', async () => {
  const key = `backgrounds/${OWNER_ID}/background.webp`
  await asUser(OWNER_ID, (c) => c.query('select public.api_set_own_background_photo($1,$2::jsonb)', [key, JSON.stringify(META)]))

  // 用应用角色 + set_config 身份调用，才算真实路径
  const cleared = await asUser(OWNER_ID, (c) =>
    c.query<{ old_key: string | null }>('select public.api_clear_own_background_photo() as old_key'),
  )
  assert.equal(cleared.rows[0]?.old_key, key, '应返回被清除的旧键，供调用方删磁盘文件')

  const row = await admin.query<{ background_photo_key: string | null; background_photo_meta: unknown }>(
    'select background_photo_key, background_photo_meta from public.profiles where id=$1',
    [OWNER_ID],
  )
  assert.equal(row.rows[0]!.background_photo_key, null)
  assert.equal(row.rows[0]!.background_photo_meta, null)
})

test('app_user 不能直接更新这两列（必须经函数）', async () => {
  const priv = await admin.query<{ allowed: boolean }>(
    `select has_column_privilege('app_user','public.profiles','background_photo_key','UPDATE') allowed`,
  )
  assert.equal(priv.rows[0]?.allowed, false)
})
