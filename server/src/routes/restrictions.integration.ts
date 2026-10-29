/**
 * 处罚分级与写操作守卫集成测试（0026 + server/src/lib/restrictions.ts）。
 *
 * 要证明的产品闭环（.tmp/phase82-addendum.md §5.2 P0-18/P0-19）：
 *   处罚生效以后，账号仍然**进得来**：
 *     能登录、能浏览、能看自己的处罚、能举报、能申诉；
 *   但**写不动**：
 *     content_restriction 只拦发布类写，suspension/ban 连互动与通知也拦，
 *     且拦截必须发生在参数校验之前（受限用户提交半截请求也得到同一个 403）。
 *   撤销以后必须立刻恢复（不能靠重启进程或等缓存过期）。
 *
 * 断言口径：只断言对外契约（HTTP 状态、响应形状、库内可见状态）与分级表的
 * 四类 × 七类矩阵，不断言内部实现（守卫挂在哪个 hook、缓存怎么存都不该影响本套件）。
 * 需要读库的地方一律用 admin 连接：app_user 对 user_sanctions 没有直接权限，
 * 那是设计意图。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { after, before } from 'node:test'
import pg from 'pg'

const { Client } = pg
const ORIGIN = 'http://127.0.0.1:5173'

const ADMIN_ID = 'c8200000-0000-4000-8000-000000000001'
const AUTHOR_ID = 'c8200000-0000-4000-8000-000000000002'
const BANNED_ID = 'c8200000-0000-4000-8000-000000000003'
const SUSPENDED_ID = 'c8200000-0000-4000-8000-000000000004'
const LIMITED_ID = 'c8200000-0000-4000-8000-000000000005'
const WARNED_ID = 'c8200000-0000-4000-8000-000000000006'
const CLEAN_ID = 'c8200000-0000-4000-8000-000000000007'

const ADMIN_SECRET = 'restriction-admin-session-secret-long-enough-01'
const AUTHOR_SECRET = 'restriction-author-session-secret-long-enough-02'
const LIMITED_SECRET = 'restriction-limited-session-secret-long-enough-03'
const WARNED_SECRET = 'restriction-warned-session-secret-long-enough-04'
const CLEAN_SECRET = 'restriction-clean-session-secret-long-enough-05'
const CSRF = 'csrf-token-for-restriction-guard-integration'

/** 全员同一密码：本套件要真的走一次 POST /api/auth/login。 */
const PASSWORD = 'Restriction#2026'

const TARGET_PHOTO_ID = 'd8200000-0000-4000-8000-000000000001'
const LIMITED_PHOTO_ID = 'd8200000-0000-4000-8000-000000000002'

const BAN_SANCTION_ID = 'e8200000-0000-4000-8000-000000000001'
const SUSPEND_SANCTION_ID = 'e8200000-0000-4000-8000-000000000002'
const CONTENT_SANCTION_ID = 'e8200000-0000-4000-8000-000000000003'
const WARN_SANCTION_ID = 'e8200000-0000-4000-8000-000000000004'

const PLACEHOLDER_HASH = '$2b$12$restrictionguardintegrationplaceholderhash00000000'

type App = Awaited<ReturnType<(typeof import('../index.js'))['buildApp']>>
type Restrictions = typeof import('../lib/restrictions.js')

let app: App
let admin: pg.Client
let restrictions: Restrictions

let adminSessionId = ''
let authorSessionId = ''
let limitedSessionId = ''
let warnedSessionId = ''
let cleanSessionId = ''
/** 受限账号的会话由 POST /api/auth/login 现场换取（登录放行本身就是被测行为）。 */
let bannedSession = { cookie: '', csrf: '' }
let suspendedSession = { cookie: '', csrf: '' }

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

function cookieHeaders(session: { cookie: string; csrf: string }) {
  return {
    origin: ORIGIN,
    cookie: `${session.cookie}; gy_csrf=${session.csrf}`,
    'x-csrf-token': session.csrf,
  }
}

/** 从 inject 响应的 set-cookie 里取某个 cookie 的值（登录响应会同时种会话与 CSRF）。 */
function pickCookie(response: { headers: Record<string, unknown> }, name: string): string {
  const raw = response.headers['set-cookie']
  const list = Array.isArray(raw) ? raw : [String(raw ?? '')]
  for (const line of list) {
    const match = new RegExp(`(?:^|[,\\s])${name}=([^;]+)`).exec(String(line))
    if (match) return match[1]!
  }
  return ''
}

async function seedSession(userId: string, secret: string): Promise<string> {
  const result = await admin.query<{ session_id: string }>(
    `select session_id from public.api_create_session($1,$2,now() + interval '2 hours',$3,$4)`,
    [userId, tokenHash(secret), 'restriction-guard-integration', 'integration-ip'],
  )
  return result.rows[0]!.session_id
}

/** 403 信封统一断言：code/message/details 三项，details 只有 sanctionKind 与 endsAt。 */
function assertForbidden(
  response: { statusCode: number; body: string },
  expected: { sanctionKind: string; endsAt: string | null; messageContains: string },
): void {
  assert.equal(response.statusCode, 403, response.body)
  const body = JSON.parse(response.body) as {
    code: string
    message: string
    details: Record<string, unknown>
  }
  assert.equal(body.code, 'FORBIDDEN')
  assert.match(body.message, new RegExp(expected.messageContains))
  assert.equal(body.details.sanctionKind, expected.sanctionKind)
  assert.equal(body.details.endsAt, expected.endsAt)
  assert.deepEqual(Object.keys(body.details).sort(), ['endsAt', 'sanctionKind'])
}

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

  const { hashPassword } = await import('../lib/password.js')
  const realHash = await hashPassword(PASSWORD)

  // auth.users.ck_auth_users_pw_len 要求 20–255 字符：不走密码登录的账号给占位哈希。
  await admin.query(
    `insert into auth.users (id,email,phone,password_hash,raw_user_meta_data) values
       ($1,'rg-admin@test.local','13920000001',$8,'{"display_name":"RG Admin"}'),
       ($2,'rg-author@test.local','13920000002',$8,'{"display_name":"RG Author"}'),
       ($3,'rg-banned@test.local','13920000003',$9,'{"display_name":"RG Banned"}'),
       ($4,'rg-suspended@test.local','13920000004',$9,'{"display_name":"RG Suspended"}'),
       ($5,'rg-limited@test.local','13920000005',$8,'{"display_name":"RG Limited"}'),
       ($6,'rg-warned@test.local','13920000006',$8,'{"display_name":"RG Warned"}'),
       ($7,'rg-clean@test.local','13920000007',$8,'{"display_name":"RG Clean"}')
     on conflict (id) do update set email=excluded.email, phone=excluded.phone,
       password_hash=excluded.password_hash`,
    [ADMIN_ID, AUTHOR_ID, BANNED_ID, SUSPENDED_ID, LIMITED_ID, WARNED_ID, CLEAN_ID, PLACEHOLDER_HASH, realHash],
  )
  await admin.query(
    `insert into public.profiles (id,username,display_name,role) values
       ($1,'rg_admin','RG Admin','admin'),
       ($2,'rg_author','RG Author','user'),
       ($3,'rg_banned','RG Banned','user'),
       ($4,'rg_suspended','RG Suspended','user'),
       ($5,'rg_limited','RG Limited','user'),
       ($6,'rg_warned','RG Warned','user'),
       ($7,'rg_clean','RG Clean','user')
     on conflict (id) do update set username=excluded.username, display_name=excluded.display_name,
       role=excluded.role, deleted_at=null`,
    [ADMIN_ID, AUTHOR_ID, BANNED_ID, SUSPENDED_ID, LIMITED_ID, WARNED_ID, CLEAN_ID],
  )
  await admin.query(
    `insert into public.photos
       (id,author_id,title,description,category_slug,image_key,thumb_key,width,height,status,published_at,deleted_at)
     values ($1,$2,'可互动的作品','用于验证受限账号仍能浏览与点赞','landscape',$3,$4,1200,800,'published',now(),null),
            ($5,$6,'受限作者的作品','用于验证内容限制只能拦发布不能拦浏览','landscape',$7,$8,1200,800,'published',now(),null)
     on conflict (id) do update set status='published', published_at=now(), deleted_at=null`,
    [
      TARGET_PHOTO_ID,
      AUTHOR_ID,
      `photos/${AUTHOR_ID}/${TARGET_PHOTO_ID}/display.webp`,
      `photos/${AUTHOR_ID}/${TARGET_PHOTO_ID}/thumb.webp`,
      LIMITED_PHOTO_ID,
      LIMITED_ID,
      `photos/${LIMITED_ID}/${LIMITED_PHOTO_ID}/display.webp`,
      `photos/${LIMITED_ID}/${LIMITED_PHOTO_ID}/thumb.webp`,
    ],
  )

  // 直接插 user_sanctions（不经过 api_apply_sanction）：后者会吊销 suspension/ban
  // 账号的全部会话（0015 的设计），本套件要测"受限状态下仍在线的会话"，所以绕开它。
  await admin.query(
    `insert into public.user_sanctions (id,user_id,kind,reason_code,reason_detail,starts_at,ends_at,created_by)
     values ($1,$2,'ban','harassment','持续骚扰他人，永久封禁',now() - interval '1 hour',null,$5),
            ($3,$4,'suspension','spam','广告刷屏，暂停 30 天',now() - interval '1 hour',now() + interval '30 days',$5)
     on conflict (id) do update set status='active', ends_at=excluded.ends_at,
       revoked_at=null, revoked_by=null, revoke_reason=null`,
    [BAN_SANCTION_ID, BANNED_ID, SUSPEND_SANCTION_ID, SUSPENDED_ID, ADMIN_ID],
  )
  await admin.query(
    `insert into public.user_sanctions (id,user_id,kind,reason_code,reason_detail,starts_at,ends_at,created_by)
     values ($1,$2,'content_restriction','inappropriate','作品含不适宜内容，限制发布 7 天',now() - interval '1 hour',now() + interval '7 days',$3),
            ($4,$5,'warning','quality','首次违规，仅警告',now() - interval '1 hour',now() + interval '30 days',$3)
     on conflict (id) do update set status='active', ends_at=excluded.ends_at,
       revoked_at=null, revoked_by=null, revoke_reason=null`,
    [CONTENT_SANCTION_ID, LIMITED_ID, ADMIN_ID, WARN_SANCTION_ID, WARNED_ID],
  )

  adminSessionId = await seedSession(ADMIN_ID, ADMIN_SECRET)
  authorSessionId = await seedSession(AUTHOR_ID, AUTHOR_SECRET)
  limitedSessionId = await seedSession(LIMITED_ID, LIMITED_SECRET)
  warnedSessionId = await seedSession(WARNED_ID, WARNED_SECRET)
  cleanSessionId = await seedSession(CLEAN_ID, CLEAN_SECRET)

  const { buildApp } = await import('../index.js')
  app = await buildApp()
  restrictions = await import('../lib/restrictions.js')
})

after(async () => {
  await app?.close()
  await admin?.end()
})

// ---------------------------------------------------------------------------
// 纯函数：分级表本身
// ---------------------------------------------------------------------------

test('分级表实现与冻结契约一致：四类处罚 × 七类写操作', () => {
  const kinds = ['warning', 'content_restriction', 'suspension', 'ban'] as const
  const writes = ['auth', 'report', 'appeal', 'notification', 'content', 'interaction', 'generic'] as const
  // 契约表：true = 拦截
  const expected: Record<string, Record<string, boolean>> = {
    warning: { auth: false, report: false, appeal: false, notification: false, content: false, interaction: false, generic: false },
    content_restriction: { auth: false, report: false, appeal: false, notification: false, content: true, interaction: false, generic: false },
    suspension: { auth: false, report: false, appeal: false, notification: true, content: true, interaction: true, generic: true },
    ban: { auth: false, report: false, appeal: false, notification: true, content: true, interaction: true, generic: true },
  }
  for (const kind of kinds) {
    for (const write of writes) {
      assert.equal(
        restrictions.isBlocked(kind, write),
        expected[kind]![write],
        `${kind} × ${write} 与契约分级表不一致`,
      )
    }
  }
  // 无处罚时永不拦截
  assert.equal(restrictions.isBlocked(null, 'content'), false)
  assert.equal(restrictions.isBlocked(undefined, 'generic'), false)
})

test('classifyWrite：路由归类覆盖发布/互动/通知/访问控制/举报/申诉', () => {
  const cases: Array<[string, string, string]> = [
    ['POST', '/api/auth/login', 'auth'],
    ['POST', '/api/auth/logout', 'auth'],
    ['PATCH', '/api/me/password', 'auth'],
    ['DELETE', '/api/me/sessions/9f1c', 'auth'],
    ['DELETE', '/api/me/account', 'auth'],
    ['POST', '/api/reports', 'report'],
    ['POST', '/api/reports/8b2c/appeal', 'appeal'],
    ['POST', '/api/sanctions/8b2c/appeal', 'appeal'],
    ['POST', '/api/me/sanctions/8b2c/appeal?x=1', 'appeal'],
    ['POST', '/api/me/notifications/read', 'notification'],
    ['POST', '/api/photos', 'content'],
    ['PATCH', '/api/photos/8b2c', 'content'],
    ['DELETE', '/api/photos/8b2c', 'content'],
    ['POST', '/api/photos/8b2c/publish', 'content'],
    ['PUT', '/api/photos/8b2c/like', 'interaction'],
    ['PUT', '/api/photos/8b2c/favorite', 'interaction'],
    ['POST', '/api/photos/8b2c/comments', 'interaction'],
    ['DELETE', '/api/comments/8b2c', 'interaction'],
    ['PUT', '/api/profiles/li_hua/follow', 'interaction'],
    ['DELETE', '/api/profiles/li_hua/block', 'interaction'],
    ['PUT', '/api/me/profile', 'generic'],
    ['POST', '/api/admin/sanctions', 'generic'],
    ['PUT', '/api/storage/' + 'a'.repeat(8) + '/x.webp', 'content'],
  ]
  for (const [method, url, expected] of cases) {
    assert.equal(restrictions.classifyWrite(method, url), expected, `${method} ${url}`)
  }
})

test('blockMessage：三类拦截文案都说清"还能做什么"与申诉入口', () => {
  for (const kind of ['content_restriction', 'suspension', 'ban'] as const) {
    const message = restrictions.blockMessage(kind)
    assert.match(message, /申诉/)
    assert.match(message, /浏览/)
  }
  assert.match(restrictions.blockMessage('content_restriction'), /发布/)
  assert.match(restrictions.blockMessage('suspension'), /互动/)
  assert.match(restrictions.blockMessage('ban'), /封禁/)
})

// ---------------------------------------------------------------------------
// P0-18 前置：受限账号必须能登录（0026 去掉 api_create_session 的处罚拒绝）
// ---------------------------------------------------------------------------

test('被封禁/暂停的账号仍能登录，并在登录态里看到自己的限制', async () => {
  for (const [username, expectedKind] of [
    ['rg_banned', 'ban'],
    ['rg_suspended', 'suspension'],
  ] as const) {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN },
      payload: { username, password: PASSWORD },
    })
    assert.equal(login.statusCode, 200, login.body)
    const account = login.json() as { userId: string }
    const sessionCookie = pickCookie(login, 'gk_session')
    const csrf = pickCookie(login, 'gy_csrf')
    assert.ok(sessionCookie, '登录必须种下会话 Cookie')
    assert.ok(csrf, '登录必须种下 CSRF Cookie')

    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: cookieHeaders({ cookie: `gk_session=${sessionCookie}`, csrf }),
    })
    assert.equal(session.statusCode, 200, session.body)
    const body = session.json() as { userId: string; restriction: Record<string, unknown> | null }
    assert.equal(body.userId, account.userId)
    assert.ok(body.restriction, '受限账号的登录态必须带 restriction')
    assert.equal(body.restriction.kind, expectedKind)
    assert.ok(typeof body.restriction.reasonCode === 'string' && body.restriction.reasonCode.length > 0)
    assert.ok(typeof body.restriction.reasonDetail === 'string')

    if (expectedKind === 'ban') {
      assert.equal(body.restriction.endsAt, null, '永久封禁的 endsAt 必须是 null')
      bannedSession = { cookie: `gk_session=${sessionCookie}`, csrf }
    } else {
      assert.ok(typeof body.restriction.endsAt === 'string' && body.restriction.endsAt.length > 0)
      suspendedSession = { cookie: `gk_session=${sessionCookie}`, csrf }
    }
  }
})

test('GET /api/auth/session 的 restriction 分级：限制/警告/无处罚三种', async () => {
  const limited = await app.inject({ method: 'GET', url: '/api/auth/session', headers: headers(limitedSessionId, LIMITED_SECRET) })
  assert.equal(limited.statusCode, 200, limited.body)
  const limitedBody = limited.json() as { restriction: Record<string, unknown> | null }
  assert.equal(limitedBody.restriction?.kind, 'content_restriction')
  assert.match(String(limitedBody.restriction?.reasonDetail), /限制发布/)

  const warned = await app.inject({ method: 'GET', url: '/api/auth/session', headers: headers(warnedSessionId, WARNED_SECRET) })
  assert.equal(warned.statusCode, 200, warned.body)
  assert.equal((warned.json() as { restriction: Record<string, unknown> | null }).restriction?.kind, 'warning')

  const clean = await app.inject({ method: 'GET', url: '/api/auth/session', headers: headers(cleanSessionId, CLEAN_SECRET) })
  assert.equal(clean.statusCode, 200, clean.body)
  assert.equal((clean.json() as { restriction: Record<string, unknown> | null }).restriction, null, '无处罚必须是 null')

  const guest = await app.inject({ method: 'GET', url: '/api/auth/session' })
  assert.equal(guest.statusCode, 200, guest.body)
  assert.equal(guest.body, 'null', '游客仍然返回 null 字符串，不能变成对象')
})

// ---------------------------------------------------------------------------
// 受限账号的可读性：浏览、处罚列表、申诉、举报
// ---------------------------------------------------------------------------

test('受限账号只读请求全部放行（守卫只拦写方法）', async () => {
  const reads = [
    '/api/auth/session',
    '/api/feed',
    `/api/photos/${TARGET_PHOTO_ID}`,
    '/api/me/sanctions',
    '/api/me/appeals',
    '/api/me/notifications',
    '/api/me/notifications/unread-count',
    '/api/reports/mine',
    '/api/me/blocks',
  ]
  for (const url of reads) {
    const response = await app.inject({ method: 'GET', url, headers: cookieHeaders(bannedSession) })
    assert.equal(response.statusCode, 200, `${url} → ${response.statusCode} ${response.body}`)
  }
})

test('被封禁的账号能看到自己的处罚并提交申诉（P0-19 不再被登录墙挡住）', async () => {
  const listed = await app.inject({
    method: 'GET',
    url: '/api/me/sanctions',
    headers: cookieHeaders(bannedSession),
  })
  assert.equal(listed.statusCode, 200, listed.body)
  const items = (listed.json() as { items: Array<Record<string, unknown>> }).items
  const ban = items.find((item) => item.id === BAN_SANCTION_ID)
  assert.ok(ban, '处罚列表必须包含该封禁')
  assert.equal(ban.kind, 'ban')
  assert.equal(ban.status, 'active')
  assert.equal(ban.endsAt, null)
  assert.equal(ban.appealStatus, null)

  const appeal = await app.inject({
    method: 'POST',
    url: `/api/me/sanctions/${BAN_SANCTION_ID}/appeal`,
    headers: cookieHeaders(bannedSession),
    payload: { message: '本人在此申诉：该封禁认定的骚扰行为并不存在，请复核原始记录。' },
  })
  assert.equal(appeal.statusCode, 200, appeal.body)
  const appealBody = appeal.json() as { appealId: string; status: string }
  assert.match(appealBody.appealId, /^[0-9a-f-]{36}$/)
  assert.equal(appealBody.status, 'open')

  const mine = await app.inject({ method: 'GET', url: '/api/me/appeals', headers: cookieHeaders(bannedSession) })
  assert.equal(mine.statusCode, 200, mine.body)
  const appeals = (mine.json() as { items: Array<Record<string, unknown>> }).items
  assert.ok(appeals.some((item) => item.sanctionId === BAN_SANCTION_ID), '申诉列表应能看到刚提交的申诉')
})

test('被封禁的账号仍能举报他人（举报是公共责任，不受自身处罚影响）', async () => {
  const report = await app.inject({
    method: 'POST',
    url: '/api/reports',
    headers: cookieHeaders(bannedSession),
    payload: { targetType: 'photo', targetId: TARGET_PHOTO_ID, reason: 'spam', detail: '该作品疑似广告导流' },
  })
  assert.equal(report.statusCode, 200, report.body)
  const receipt = report.json() as { reportId: string; status: string }
  assert.match(receipt.reportId, /^[0-9a-f-]{36}$/)
  assert.equal(receipt.status, 'open')
})

// ---------------------------------------------------------------------------
// 分级拦截：suspension / ban 拦四类写，content_restriction 只拦发布
// ---------------------------------------------------------------------------

test('暂停账号：发布、互动、通知、通用写全部 403，且 403 早于参数校验', async () => {
  const expected = { sanctionKind: 'suspension', messageContains: '暂停' }
  // ends_at 由库内给出，取一次真实值参与比对
  const session = await app.inject({
    method: 'GET',
    url: '/api/auth/session',
    headers: cookieHeaders(suspendedSession),
  })
  const endsAt = (session.json() as { restriction: { endsAt: string } }).restriction.endsAt
  const base = { ...expected, endsAt }

  // content：故意用空 body —— 守卫应当先给出 403，而不是参数校验的 400
  assertForbidden(
    await app.inject({ method: 'POST', url: '/api/photos', headers: cookieHeaders(suspendedSession), payload: {} }),
    base,
  )
  assertForbidden(
    await app.inject({ method: 'PATCH', url: `/api/photos/${LIMITED_PHOTO_ID}`, headers: cookieHeaders(suspendedSession), payload: { title: '想改名' } }),
    base,
  )
  // interaction
  assertForbidden(
    await app.inject({ method: 'PUT', url: `/api/photos/${TARGET_PHOTO_ID}/like`, headers: cookieHeaders(suspendedSession), payload: { liked: true } }),
    base,
  )
  assertForbidden(
    await app.inject({ method: 'POST', url: `/api/photos/${TARGET_PHOTO_ID}/comments`, headers: cookieHeaders(suspendedSession), payload: { body: '想评论' } }),
    base,
  )
  assertForbidden(
    await app.inject({ method: 'PUT', url: '/api/profiles/rg_author/follow', headers: cookieHeaders(suspendedSession) }),
    base,
  )
  // notification
  assertForbidden(
    await app.inject({ method: 'POST', url: '/api/me/notifications/read', headers: cookieHeaders(suspendedSession), payload: { all: true } }),
    base,
  )
  // generic
  assertForbidden(
    await app.inject({ method: 'PUT', url: '/api/me/profile', headers: cookieHeaders(suspendedSession), payload: { displayName: '改个名' } }),
    base,
  )
})

test('封禁账号：写操作全部 403，details.endsAt 为 null（长期）', async () => {
  const base = { sanctionKind: 'ban', endsAt: null, messageContains: '封禁' }
  assertForbidden(
    await app.inject({ method: 'POST', url: '/api/photos', headers: cookieHeaders(bannedSession), payload: {} }),
    base,
  )
  assertForbidden(
    await app.inject({ method: 'PUT', url: `/api/photos/${TARGET_PHOTO_ID}/favorite`, headers: cookieHeaders(bannedSession), payload: { favorited: true } }),
    base,
  )
  assertForbidden(
    await app.inject({ method: 'POST', url: '/api/me/notifications/read', headers: cookieHeaders(bannedSession), payload: {} }),
    base,
  )
  assertForbidden(
    await app.inject({ method: 'DELETE', url: '/api/comments/9f1c0000-0000-4000-8000-000000000001', headers: cookieHeaders(bannedSession) }),
    base,
  )
})

test('内容限制：只拦发布类写，互动/通知/资料仍然可用', async () => {
  const base = { sanctionKind: 'content_restriction', messageContains: '限制发布内容' }
  const session = await app.inject({ method: 'GET', url: '/api/auth/session', headers: headers(limitedSessionId, LIMITED_SECRET) })
  const endsAt = (session.json() as { restriction: { endsAt: string } }).restriction.endsAt

  // 拦：发布、编辑、撤回自己的作品（upload/publish 同属 content）
  assertForbidden(
    await app.inject({ method: 'POST', url: '/api/photos', headers: headers(limitedSessionId, LIMITED_SECRET), payload: {} }),
    { ...base, endsAt },
  )
  assertForbidden(
    await app.inject({ method: 'PATCH', url: `/api/photos/${LIMITED_PHOTO_ID}`, headers: headers(limitedSessionId, LIMITED_SECRET), payload: { title: '受限期间改名' } }),
    { ...base, endsAt },
  )
  assertForbidden(
    await app.inject({ method: 'POST', url: `/api/photos/${LIMITED_PHOTO_ID}/publish`, headers: headers(limitedSessionId, LIMITED_SECRET) }),
    { ...base, endsAt },
  )
  assertForbidden(
    await app.inject({ method: 'PUT', url: '/api/storage/' + `${LIMITED_ID}/${LIMITED_PHOTO_ID}/display.webp`, headers: { ...headers(limitedSessionId, LIMITED_SECRET), 'content-type': 'image/webp' } }),
    { ...base, endsAt },
  )

  // 放行：点赞（interaction）、标记已读（notification）、改偏好（generic，写操作但非内容）
  const like = await app.inject({ method: 'PUT', url: `/api/photos/${TARGET_PHOTO_ID}/like`, headers: headers(limitedSessionId, LIMITED_SECRET), payload: { liked: true } })
  assert.equal(like.statusCode, 200, like.body)
  assert.equal((like.json() as { liked: boolean }).liked, true)

  const read = await app.inject({ method: 'POST', url: '/api/me/notifications/read', headers: headers(limitedSessionId, LIMITED_SECRET), payload: { all: true } })
  assert.equal(read.statusCode, 200, read.body)

  const preferences = await app.inject({
    method: 'PUT',
    url: '/api/me/preferences',
    headers: headers(limitedSessionId, LIMITED_SECRET),
    payload: {
      visibility: 'public',
      showLikes: true,
      showFavorites: true,
      discoverable: true,
      notificationPreferences: { accountSecurity: true, productUpdates: false },
    },
  })
  assert.equal(preferences.statusCode, 200, preferences.body)
})

test('警告不拦截任何写操作（只做提示）', async () => {
  // 空 body 的发布请求：警告档必须放行到参数校验（400），绝不能是 403
  const publish = await app.inject({ method: 'POST', url: '/api/photos', headers: headers(warnedSessionId, WARNED_SECRET), payload: {} })
  assert.equal(publish.statusCode, 400, publish.body)
  assert.equal((publish.json() as { code: string }).code, 'VALIDATION')

  const like = await app.inject({ method: 'PUT', url: `/api/photos/${TARGET_PHOTO_ID}/like`, headers: headers(warnedSessionId, WARNED_SECRET), payload: { liked: true } })
  assert.equal(like.statusCode, 200, like.body)

  const read = await app.inject({ method: 'POST', url: '/api/me/notifications/read', headers: headers(warnedSessionId, WARNED_SECRET), payload: { all: true } })
  assert.equal(read.statusCode, 200, read.body)
})

test('无处罚账号不受影响：发布与互动照常，游客写请求仍是 401', async () => {
  const like = await app.inject({ method: 'PUT', url: `/api/photos/${TARGET_PHOTO_ID}/like`, headers: headers(cleanSessionId, CLEAN_SECRET), payload: { liked: true } })
  assert.equal(like.statusCode, 200, like.body)

  const publish = await app.inject({ method: 'POST', url: '/api/photos', headers: headers(cleanSessionId, CLEAN_SECRET), payload: {} })
  assert.equal(publish.statusCode, 400, '无处罚账号的坏请求应由校验给 400')

  // 同样的 content 写操作，无处罚作者照常放行（证明守卫不是把一类路由整体封死）
  const authorPatch = await app.inject({
    method: 'PATCH',
    url: `/api/photos/${TARGET_PHOTO_ID}`,
    headers: headers(authorSessionId, AUTHOR_SECRET),
    payload: { title: '无处罚作者正常编辑' },
  })
  assert.equal(authorPatch.statusCode, 200, authorPatch.body)

  const guest = await app.inject({ method: 'PUT', url: `/api/photos/${TARGET_PHOTO_ID}/like`, headers: { origin: ORIGIN }, payload: { liked: true } })
  assert.equal(guest.statusCode, 401, guest.body)
  assert.equal((guest.json() as { code: string }).code, 'UNAUTHORIZED')
})

// ---------------------------------------------------------------------------
// 撤销即刻恢复（不能靠缓存过期）
// ---------------------------------------------------------------------------

test('撤销处罚后写操作立刻恢复，登录态 restriction 变 null', async () => {
  const revoke = await app.inject({
    method: 'POST',
    url: `/api/admin/sanctions/${CONTENT_SANCTION_ID}/revoke`,
    headers: headers(adminSessionId, ADMIN_SECRET),
    payload: { reason: '复核后确认误判，撤销内容限制' },
  })
  assert.equal(revoke.statusCode, 200, revoke.body)

  const patched = await app.inject({
    method: 'PATCH',
    url: `/api/photos/${LIMITED_PHOTO_ID}`,
    headers: headers(limitedSessionId, LIMITED_SECRET),
    payload: { title: '撤销限制后正常改名' },
  })
  assert.equal(patched.statusCode, 200, patched.body)
  assert.equal((patched.json() as { title: string }).title, '撤销限制后正常改名')

  const session = await app.inject({ method: 'GET', url: '/api/auth/session', headers: headers(limitedSessionId, LIMITED_SECRET) })
  assert.equal(session.statusCode, 200, session.body)
  assert.equal((session.json() as { restriction: unknown }).restriction, null)

  const stored = await admin.query<{ status: string }>('select status from public.user_sanctions where id=$1', [CONTENT_SANCTION_ID])
  assert.equal(stored.rows[0]!.status, 'revoked')
})
