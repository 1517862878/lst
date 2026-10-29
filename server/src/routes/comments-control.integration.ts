/**
 * 8.4b 评论区治理与作者控制——真实 HTTP 集成测试。
 *
 * 覆盖契约（.tmp/phase84b-freeze.md §3/§4）里后端负责的全部判据：
 *   1. 写请求的安全前置（缺 Origin / 未登录 / 坏 CSRF）
 *   2. 作者锁定 → 作品投影 commentsLocked=true
 *   3. 非作者锁定 → 403（不是 404，也不是 500）
 *   4. 锁定后发评论 → 409 CONFLICT，且文案是中文业务原因
 *   5. 锁定后评论列表仍可读（已有评论不能跟着消失）
 *   6. 非法参数（locked 非布尔 / sort 不在白名单）→ 400
 *   7. 解锁后发评论恢复；评论作者自删 204 且重复删除幂等
 *   8. 作品作者能删他人评论，且不写 moderation_actions（作者管理≠站方治理）
 *   9. 路人删他人评论 → 403
 *  10. sort=oldest 与 latest 的首条相反
 *  11. 不存在的作品锁定 → 404
 *
 * 这些用例必须跑在一次性库上（npm run test:integration / .tmp/verify-fresh-db.sh），
 * 因为会话表 api_create_session 不做 upsert，持久库上二次运行会撞唯一键。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { after, before } from 'node:test'
import pg from 'pg'

const { Client } = pg
const ORIGIN = 'http://127.0.0.1:5173'
const OWNER_ID = 'e5000000-0000-0000-0000-000000000001'
const OTHER_ID = 'e5000000-0000-0000-0000-000000000002'
const STRANGER_ID = 'e5000000-0000-0000-0000-000000000003'
const PHOTO_ID = 'e6000000-0000-0000-0000-000000000004'
const MISSING_PHOTO_ID = 'e6000000-0000-0000-0000-0000000000ff'
const OWNER_SECRET = 'comment-owner-session-secret-long-enough-01'
const OTHER_SECRET = 'comment-other-session-secret-long-enough-02'
const STRANGER_SECRET = 'comment-stranger-session-secret-long-en-03'
const CSRF = 'csrf-token-for-comment-control-integration'

let app: Awaited<ReturnType<(typeof import('../index.js'))['buildApp']>>
let admin: pg.Client
let ownerSessionId = ''
let otherSessionId = ''
let strangerSessionId = ''

function tokenHash(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

function authHeaders(sessionId: string, secret: string, csrf = CSRF) {
  return {
    origin: ORIGIN,
    cookie: `gk_session=${sessionId}.${secret}; gy_csrf=${CSRF}`,
    'x-csrf-token': csrf,
  }
}

async function seedSession(userId: string, secret: string): Promise<string> {
  const result = await admin.query<{ session_id: string }>(
    `select session_id from public.api_create_session($1,$2,now() + interval '1 hour',$3,$4)`,
    [userId, tokenHash(secret), 'comment-control-integration', 'integration-ip'],
  )
  return result.rows[0]!.session_id
}

/** 直接读库，绕过投影，用于断言「数据库真的写进去了」而不只是接口回显。 */
async function photoRow() {
  const { rows } = await admin.query<{ comments_locked: boolean }>(
    'select comments_locked from public.photos where id=$1',
    [PHOTO_ID],
  )
  return rows[0]!
}

async function commentRows() {
  const { rows } = await admin.query<{ id: string; body: string; status: string; deleted_at: Date | null; author_id: string }>(
    'select id, body, status, deleted_at, author_id from public.comments where photo_id=$1 order by created_at asc, id asc',
    [PHOTO_ID],
  )
  return rows
}

async function setLocked(locked: boolean) {
  return app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ID}/comments-lock`,
    headers: authHeaders(ownerSessionId, OWNER_SECRET),
    payload: { locked },
  })
}

before(async () => {
  admin = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGADMIN_USER ?? 'postgres',
    password: process.env.PGADMIN_PASSWORD,
  })
  await admin.connect()
  await admin.query(
    `insert into auth.users (id,email,raw_user_meta_data) values
      ($1,'cc-owner@test.local','{"display_name":"CC Owner"}'),
      ($2,'cc-commenter@test.local','{"display_name":"CC Commenter"}'),
      ($3,'cc-stranger@test.local','{"display_name":"CC Stranger"}')
     on conflict (id) do nothing`,
    [OWNER_ID, OTHER_ID, STRANGER_ID],
  )
  await admin.query(
    `insert into public.profiles (id,username,display_name) values
      ($1,'cc_owner','CC Owner'),($2,'cc_commenter','CC Commenter'),($3,'cc_stranger','CC Stranger')
     on conflict (id) do nothing`,
    [OWNER_ID, OTHER_ID, STRANGER_ID],
  )
  await admin.query(
    `insert into public.photos
      (id,author_id,title,category_slug,image_key,thumb_key,width,height,status,published_at)
     values ($1,$2,'评论控制测试作品','landscape',$3,$4,1200,800,'published',clock_timestamp())
     on conflict (id) do update set author_id=excluded.author_id,title=excluded.title,
       status='published',published_at=excluded.published_at,deleted_at=null,comments_locked=false`,
    [PHOTO_ID, OWNER_ID, `photos/${OWNER_ID}/${PHOTO_ID}/display.webp`, `photos/${OWNER_ID}/${PHOTO_ID}/thumb.webp`],
  )
  // 上一轮遗留的评论会污染排序断言，这里清空本套件自己的数据。
  await admin.query('delete from public.comments where photo_id=$1', [PHOTO_ID])

  ownerSessionId = await seedSession(OWNER_ID, OWNER_SECRET)
  otherSessionId = await seedSession(OTHER_ID, OTHER_SECRET)
  strangerSessionId = await seedSession(STRANGER_ID, STRANGER_SECRET)

  const { buildApp } = await import('../index.js')
  app = await buildApp()
  const who = await app.inject({
    method: 'GET',
    url: '/api/auth/session',
    headers: { cookie: `gk_session=${ownerSessionId}.${OWNER_SECRET}` },
  })
  assert.equal(who.statusCode, 200, who.body)
  assert.equal(who.json().userId, OWNER_ID)
})

after(async () => {
  await app?.close()
  await admin?.end()
})

test('1. 写请求安全前置：缺 Origin / 未登录 / 坏 CSRF 都被挡在业务逻辑之前', async () => {
  const noOrigin = await app.inject({ method: 'PUT', url: `/api/photos/${PHOTO_ID}/comments-lock`, payload: { locked: true } })
  assert.equal(noOrigin.statusCode, 403, noOrigin.body)
  assert.equal(noOrigin.json().code, 'FORBIDDEN')

  const anonymous = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ID}/comments-lock`,
    headers: { origin: ORIGIN },
    payload: { locked: true },
  })
  assert.equal(anonymous.statusCode, 401, anonymous.body)
  assert.equal(anonymous.json().code, 'UNAUTHORIZED')

  const badCsrf = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ID}/comments-lock`,
    headers: authHeaders(ownerSessionId, OWNER_SECRET, 'wrong'),
    payload: { locked: true },
  })
  assert.equal(badCsrf.statusCode, 403, badCsrf.body)

  // 前置被挡住时数据库不能被改：锁定状态还是 false。
  assert.equal((await photoRow()).comments_locked, false)
})

test('2. 非法参数返回 400：locked 不是布尔、sort 不在白名单', async () => {
  for (const payload of [{ locked: 'true' }, { locked: 1 }, {}]) {
    const bad = await app.inject({
      method: 'PUT',
      url: `/api/photos/${PHOTO_ID}/comments-lock`,
      headers: authHeaders(ownerSessionId, OWNER_SECRET),
      payload,
    })
    assert.equal(bad.statusCode, 400, bad.body)
    assert.equal(bad.json().code, 'VALIDATION')
  }

  const badSort = await app.inject({ method: 'GET', url: `/api/photos/${PHOTO_ID}/comments?sort=newest` })
  assert.equal(badSort.statusCode, 400, badSort.body)
  assert.equal(badSort.json().code, 'VALIDATION')

  const badCursor = await app.inject({ method: 'GET', url: `/api/photos/${PHOTO_ID}/comments?cursor=not-a-cursor` })
  assert.equal(badCursor.statusCode, 400, badCursor.body)
})

test('3. 未锁定时可正常发评论，列表能读到', async () => {
  const created = await app.inject({
    method: 'POST',
    url: `/api/photos/${PHOTO_ID}/comments`,
    headers: authHeaders(otherSessionId, OTHER_SECRET),
    payload: { body: '第一条：锁定前就存在' },
  })
  assert.equal(created.statusCode, 200, created.body)
  assert.equal(created.json().body, '第一条：锁定前就存在')

  const list = await app.inject({ method: 'GET', url: `/api/photos/${PHOTO_ID}/comments` })
  assert.equal(list.statusCode, 200, list.body)
  assert.equal(list.json().items.length, 1)
  assert.equal(list.json().total, 1)
})

test('4. 作者锁定成功后作品投影 commentsLocked=true（详情与列表都要有）', async () => {
  const locked = await setLocked(true)
  assert.equal(locked.statusCode, 200, locked.body)
  assert.deepEqual(locked.json(), { photoId: PHOTO_ID, commentsLocked: true })
  assert.equal((await photoRow()).comments_locked, true)

  const detail = await app.inject({ method: 'GET', url: `/api/photos/${PHOTO_ID}` })
  assert.equal(detail.statusCode, 200, detail.body)
  assert.equal(detail.json().commentsLocked, true)
  // 计数器不受影响：锁定不隐藏评论
  assert.equal(detail.json().commentCount, 1)

  const feed = await app.inject({ method: 'GET', url: '/api/photos?categorySlug=landscape&limit=20' })
  assert.equal(feed.statusCode, 200, feed.body)
  const listed = feed.json().items.find((item: { id: string }) => item.id === PHOTO_ID)
  assert.ok(listed, '作品应出现在列表里')
  assert.equal(listed.commentsLocked, true)
})

test('5. 锁定后发评论 409 CONFLICT，文案是中文业务原因而不是 500/403', async () => {
  const blocked = await app.inject({
    method: 'POST',
    url: `/api/photos/${PHOTO_ID}/comments`,
    headers: authHeaders(otherSessionId, OTHER_SECRET),
    payload: { body: '锁定后不该写进去' },
  })
  assert.equal(blocked.statusCode, 409, blocked.body)
  assert.equal(blocked.json().code, 'CONFLICT')
  assert.match(blocked.json().message, /关闭.*评论/)

  // 真的没写进库：仍然只有锁定前那一条可见评论。
  assert.equal((await commentRows()).length, 1)
})

test('6. 锁定态下评论列表仍可读（已有评论不跟着消失）', async () => {
  const list = await app.inject({ method: 'GET', url: `/api/photos/${PHOTO_ID}/comments?sort=latest` })
  assert.equal(list.statusCode, 200, list.body)
  assert.equal(list.json().items.length, 1)
  assert.equal(list.json().items[0].body, '第一条：锁定前就存在')
})

test('7. 解锁后恢复发评论，sort=oldest 与 latest 首条相反', async () => {
  const unlocked = await setLocked(false)
  assert.equal(unlocked.statusCode, 200, unlocked.body)
  assert.equal(unlocked.json().commentsLocked, false)

  const second = await app.inject({
    method: 'POST',
    url: `/api/photos/${PHOTO_ID}/comments`,
    headers: authHeaders(otherSessionId, OTHER_SECRET),
    payload: { body: '第二条：解锁之后' },
  })
  assert.equal(second.statusCode, 200, second.body)

  const latest = await app.inject({ method: 'GET', url: `/api/photos/${PHOTO_ID}/comments?sort=latest` })
  const oldest = await app.inject({ method: 'GET', url: `/api/photos/${PHOTO_ID}/comments?sort=oldest` })
  assert.equal(latest.statusCode, 200, latest.body)
  assert.equal(oldest.statusCode, 200, oldest.body)
  assert.equal(latest.json().items[0].body, '第二条：解锁之后')
  assert.equal(oldest.json().items[0].body, '第一条：锁定前就存在')
  assert.equal(latest.json().total, 2)
})

test('8. 评论作者删自己的评论 204，重复删除幂等且不刷新时间戳', async () => {
  const rows = await commentRows()
  const first = rows.find((row) => row.body === '第一条：锁定前就存在')!
  const headers = authHeaders(otherSessionId, OTHER_SECRET)

  const removed = await app.inject({ method: 'DELETE', url: `/api/comments/${first.id}`, headers })
  assert.equal(removed.statusCode, 204, removed.body)
  const afterFirst = await admin.query('select status, deleted_at from public.comments where id=$1', [first.id])
  assert.equal(afterFirst.rows[0].status, 'removed')
  const deletedAt = afterFirst.rows[0].deleted_at as Date
  assert.ok(deletedAt)

  const again = await app.inject({ method: 'DELETE', url: `/api/comments/${first.id}`, headers })
  assert.equal(again.statusCode, 204, again.body)
  const afterSecond = await admin.query('select deleted_at from public.comments where id=$1', [first.id])
  assert.equal((afterSecond.rows[0].deleted_at as Date).getTime(), deletedAt.getTime())
})

test('9. 作品作者能删他人评论，且不写 moderation_actions', async () => {
  const rows = await commentRows()
  const others = rows.find((row) => row.body === '第二条：解锁之后')!
  assert.equal(others.author_id, OTHER_ID)

  const actionsBefore = await admin.query<{ count: string }>('select count(*)::text as count from public.moderation_actions')

  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/comments/${others.id}`,
    headers: authHeaders(ownerSessionId, OWNER_SECRET),
  })
  assert.equal(removed.statusCode, 204, removed.body)

  const row = await admin.query('select status, deleted_at from public.comments where id=$1', [others.id])
  assert.equal(row.rows[0].status, 'removed')
  assert.ok(row.rows[0].deleted_at)

  // 契约 §3：作者管理自己的作品不等于站方治理，审计表不能被个人操作灌满。
  const actionsAfter = await admin.query<{ count: string }>('select count(*)::text as count from public.moderation_actions')
  assert.equal(actionsAfter.rows[0]!.count, actionsBefore.rows[0]!.count)
})

test('10. 路人删他人评论 403，非作者锁定 403，不存在的作品锁定 404', async () => {
  const rows = await commentRows()
  const target = rows.find((row) => row.author_id === OTHER_ID)!

  const strangerDelete = await app.inject({
    method: 'DELETE',
    url: `/api/comments/${target.id}`,
    headers: authHeaders(strangerSessionId, STRANGER_SECRET),
  })
  assert.equal(strangerDelete.statusCode, 403, strangerDelete.body)
  assert.equal(strangerDelete.json().code, 'FORBIDDEN')

  const strangerLock = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ID}/comments-lock`,
    headers: authHeaders(otherSessionId, OTHER_SECRET),
    payload: { locked: true },
  })
  assert.equal(strangerLock.statusCode, 403, strangerLock.body)
  assert.equal(strangerLock.json().code, 'FORBIDDEN')

  const missing = await app.inject({
    method: 'PUT',
    url: `/api/photos/${MISSING_PHOTO_ID}/comments-lock`,
    headers: authHeaders(ownerSessionId, OWNER_SECRET),
    payload: { locked: true },
  })
  assert.equal(missing.statusCode, 404, missing.body)
  assert.equal(missing.json().code, 'NOT_FOUND')
})
