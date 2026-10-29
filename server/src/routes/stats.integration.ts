/**
 * 通知补全与创作者统计集成测试（0030）——跑在真实 PostgreSQL 上。
 *
 * 覆盖：
 *   1) 回复通知：回复别人的评论 → 被回复者收到（meta.reply = true）；
 *      顶楼评论只通知作品作者；自己回复自己、回复自己的作品 → 静默；
 *   2) 通知接口把 meta 一起返回（前端据此显示「回复了你」/榜单名次）；
 *   3) 创作者统计：作品数/在架数/草稿数/互动合计/粉丝数口径正确；
 *   4) 单件作品统计：只返回本人作品，limit 越界 400；
 *   5) 榜单通知：只给前 10 名作者发 system 通知、带 rank、可重复调用不刷屏、
 *      非 staff 403、非法 id 400、快照不存在 404。
 *
 * 运行：
 *   PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=gongke_verify_83d PGUSER=app_user \
 *   PGPASSWORD=*** PGADMIN_USER=postgres PGADMIN_PASSWORD=*** \
 *   node --import tsx --test server/src/routes/stats.integration.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { after, before } from 'node:test'
import pg from 'pg'

const { Client } = pg

const ORIGIN = 'http://127.0.0.1:5173'
const CSRF = 'csrf-token-for-stats-integration'

const OWNER_ID = 'e1000000-0000-0000-0000-000000000001'
const FAN_ID = 'e2000000-0000-0000-0000-000000000002'
const STAFF_ID = 'e3000000-0000-0000-0000-000000000003'

const OWNER_SECRET = 'stats-owner-session-secret-0000001'
const FAN_SECRET = 'stats-fan-session-secret-000000002'
const STAFF_SECRET = 'stats-staff-session-secret-0000003'

const PHOTO_ID = 'ea000000-0000-0000-0000-000000000001'
const PHOTO_2_ID = 'ea000000-0000-0000-0000-000000000002'
const DRAFT_ID = 'ea000000-0000-0000-0000-000000000003'

type App = Awaited<ReturnType<(typeof import('../index.js'))['buildApp']>>
type Who = 'owner' | 'fan' | 'staff'

let app: App
let admin: pg.Client
let snapshotId = ''
const session: Record<Who, string> = { owner: '', fan: '', staff: '' }
const SECRETS: Record<Who, string> = {
  owner: OWNER_SECRET,
  fan: FAN_SECRET,
  staff: STAFF_SECRET,
}

function tokenHash(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

function cookieOf(who: Who): string {
  return `gk_session=${session[who]}.${SECRETS[who]}; gy_csrf=${CSRF}`
}

function authHeaders(who: Who) {
  return { origin: ORIGIN, cookie: cookieOf(who), 'x-csrf-token': CSRF }
}

function readHeaders(who: Who) {
  return { cookie: cookieOf(who) }
}

async function seedSession(userId: string, secret: string, label: string): Promise<string> {
  const result = await admin.query<{ session_id: string }>(
    `select session_id from public.api_create_session($1,$2,now() + interval '1 hour',$3,$4)`,
    [userId, tokenHash(secret), label, 'integration-ip'],
  )
  return result.rows[0]!.session_id
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

  await admin.query('delete from public.notifications where user_id = any($1)', [
    [[OWNER_ID, FAN_ID, STAFF_ID]],
  ])
  await admin.query('delete from public.follows where follower_id = any($1) or followee_id = any($1)', [
    [[OWNER_ID, FAN_ID, STAFF_ID]],
  ])
  await admin.query('delete from public.photos where author_id = any($1)', [
    [[OWNER_ID, FAN_ID, STAFF_ID]],
  ])

  await admin.query(
    `insert into auth.users (id,email) values
       ($1,'stats-owner@test.local'),($2,'stats-fan@test.local'),($3,'stats-staff@test.local')
     on conflict (id) do nothing`,
    [OWNER_ID, FAN_ID, STAFF_ID],
  )
  await admin.query(
    `insert into public.profiles (id,username,display_name,visibility,discoverable,role) values
       ($1,'stats_owner','Stats Owner','public',true,'user'),
       ($2,'stats_fan','Stats Fan','public',true,'user'),
       ($3,'stats_staff','Stats Staff','public',true,'editor')
     on conflict (id) do update set username=excluded.username, role=excluded.role, deleted_at=null`,
    [OWNER_ID, FAN_ID, STAFF_ID],
  )

  const seedPhoto = (id: string, status: string, published: Date | null, likes: number) =>
    admin.query(
      `insert into public.photos
         (id,author_id,title,category_slug,image_key,thumb_key,width,height,status,published_at,
          like_count,favorite_count,comment_count,view_count,deleted_at)
       values ($1,$2,$3,'landscape',$4,$5,1200,800,$6,$7,$8,$9,$10,$11,null)
       on conflict (id) do update set
         status=excluded.status, published_at=excluded.published_at, like_count=excluded.like_count,
         favorite_count=excluded.favorite_count, comment_count=excluded.comment_count,
         view_count=excluded.view_count`,
      [
        id,
        OWNER_ID,
        `Stats Photo ${id.slice(-1)}`,
        `photos/${OWNER_ID}/${id}/display.webp`,
        `photos/${OWNER_ID}/${id}/thumb.webp`,
        status,
        published,
        likes,
        Math.floor(likes / 2),
        Math.floor(likes / 3),
        likes * 10,
      ],
    )

  const hourAgo = new Date(Date.now() - 3_600_000)
  await seedPhoto(PHOTO_ID, 'published', hourAgo, 7)
  await seedPhoto(PHOTO_2_ID, 'published', hourAgo, 3)
  await seedPhoto(DRAFT_ID, 'draft', null, 99)

  // 粉丝：fan 关注 owner（owner 也因此 following 0）
  await admin.query('insert into public.follows (follower_id, followee_id) values ($1,$2)', [
    FAN_ID,
    OWNER_ID,
  ])
  // 关注本身会走 notify_from_follow 产生一条通知；这里只是为了让
  // follower_count 有数据，通知清掉，免得后面的断言把它算进去。
  await admin.query('delete from public.notifications where user_id = any($1)', [
    [[OWNER_ID, FAN_ID, STAFF_ID]],
  ])

  // 周榜快照：前 10 名里 1 件属 owner，验证通知去重与排名
  const snap = await admin.query<{ id: string }>(
    `insert into public.weekly_rank_snapshots (iso_week, kind, week_start_utc, week_end_utc, captured_at, status)
     values ('2026-W44','final', now() - interval '7 days', now(), now(), 'ready')
     returning id`,
  )
  snapshotId = snap.rows[0]!.id
  await admin.query(
    `insert into public.weekly_rank_entries (snapshot_id, rank, photo_id, like_count, favorite_count, score, tie_break_key)
     values ($1, 3, $2, 7, 3, 17, 'test')`,
    [snapshotId, PHOTO_ID],
  )

  session.owner = await seedSession(OWNER_ID, OWNER_SECRET, 'stats-integration-owner')
  session.fan = await seedSession(FAN_ID, FAN_SECRET, 'stats-integration-fan')
  session.staff = await seedSession(STAFF_ID, STAFF_SECRET, 'stats-integration-staff')

  const { buildApp } = await import('../index.js')
  app = await buildApp()
  const who = await app.inject({ method: 'GET', url: '/api/auth/session', headers: readHeaders('owner') })
  assert.equal(who.statusCode, 200, who.body)
  assert.equal(who.json().userId, OWNER_ID)
})

after(async () => {
  // notifications / photos / follows 都可以清；有审计行的账号不删（审计表禁止修改）
  await admin.query('delete from public.notifications where user_id = any($1)', [
    [[OWNER_ID, FAN_ID, STAFF_ID]],
  ])
  await admin.query('delete from public.follows where follower_id = any($1) or followee_id = any($1)', [
    [[OWNER_ID, FAN_ID, STAFF_ID]],
  ])
  await admin.query('delete from public.photos where author_id = any($1)', [
    [[OWNER_ID, FAN_ID, STAFF_ID]],
  ])
  await app?.close()
  await admin?.end()
})

async function createComment(who: Who, body: string, parentId?: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/photos/${PHOTO_ID}/comments`,
    headers: authHeaders(who),
    payload: { body, ...(parentId ? { parentId } : {}) },
  })
  // 评论创建返回 200（不是 201）—— 项目里所有写接口统一用 200 + 资源体
  assert.equal(res.statusCode, 200, res.body)
  return res.json().id as string
}

// ============================================================================
// 1. 回复通知
// ============================================================================
test('reply: 回复别人的评论会通知被回复者，且带 reply 标记', async () => {
  // 场景：fan 在 owner 的作品下评论（0022 会通知作品作者 owner），
  // owner 再回复 fan 的评论 —— 这时「被回复者(fan) ≠ 作品作者(owner)」，
  // 0030 的回复触发器才会真正发通知。
  const fanComment = await createComment('fan', 'fan 的顶楼评论')

  const ownerAfterComment = await admin.query<{ n: string }>(
    `select count(*)::text as n from public.notifications where user_id = $1`,
    [OWNER_ID],
  )
  assert.equal(Number(ownerAfterComment.rows[0]!.n), 1, '作品作者应收到「评论了你的作品」')

  await createComment('owner', '作者回复 fan', fanComment)

  const fanNotif = await admin.query<{ meta: Record<string, unknown> | null; comment_id: string }>(
    `select meta, comment_id from public.notifications
      where user_id = $1 order by created_at desc limit 1`,
    [FAN_ID],
  )
  assert.equal(fanNotif.rows.length, 1, '被回复者应收到一条回复通知')
  const meta = fanNotif.rows[0]!.meta ?? {}
  assert.equal(meta.reply, true, `meta 应带 reply 标记：${JSON.stringify(meta)}`)
  assert.equal(meta.parentCommentId, fanComment)
})

test('reply: 回复自己、作者在自己的作品下回复都不重复发通知', async () => {
  await admin.query('delete from public.notifications where user_id = any($1)', [
    [[OWNER_ID, FAN_ID]],
  ])

  const topComment = await createComment('owner', 'owner 自己的顶楼评论')
  // fan 回复 owner 的评论：parent 作者是 owner，作品作者也是 owner
  // → 0022 已给 owner 发「评论了你的作品」，0030 不应再补一条
  await createComment('fan', '回复 owner 的顶楼', topComment)
  const ownerCount = await admin.query<{ n: string }>(
    `select count(*)::text as n from public.notifications where user_id = $1`,
    [OWNER_ID],
  )
  assert.equal(Number(ownerCount.rows[0]!.n), 1, '同一个人只应收到一条通知（不重复轰炸）')

  // 回复自己的评论 → 静默
  const fanComment = await createComment('fan', 'fan 自己的评论')
  await admin.query('delete from public.notifications where user_id = $1', [FAN_ID])
  await createComment('fan', 'fan 回自己', fanComment)
  const fanCount = await admin.query<{ n: string }>(
    `select count(*)::text as n from public.notifications where user_id = $1`,
    [FAN_ID],
  )
  assert.equal(Number(fanCount.rows[0]!.n), 0, '回复自己的评论不应产生通知')
})

test('notifications: 接口把 meta 一起返回', async () => {
  await admin.query('delete from public.notifications where user_id = any($1)', [
    [[OWNER_ID, FAN_ID]],
  ])
  const fanComment = await createComment('fan', '顶楼三')
  await createComment('owner', '作者回复顶楼三', fanComment)

  const res = await app.inject({
    method: 'GET',
    url: '/api/me/notifications?limit=10',
    headers: readHeaders('fan'),
  })
  assert.equal(res.statusCode, 200, res.body)
  const items = res.json().items as Array<{ meta: Record<string, unknown> | null; kind: string }>
  assert.ok(items.length >= 1)
  const reply = items.find((item) => item.meta && item.meta.reply === true)
  assert.ok(reply, `应能拿到带 reply 标记的通知：${JSON.stringify(items)}`)
})

// ============================================================================
// 2. 创作者统计
// ============================================================================
test('stats: 作品数/在架数/草稿数/互动合计/粉丝数口径正确', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/me/stats', headers: readHeaders('owner') })
  assert.equal(res.statusCode, 200, res.body)
  const stats = res.json()

  assert.equal(stats.photoCount, 3, '含草稿共 3 件')
  assert.equal(stats.publishedCount, 2)
  assert.equal(stats.draftCount, 1)
  // 草稿的互动数（99）不计入合计
  assert.equal(stats.likeTotal, 10)
  // 收藏数按种子 floor(likes/2)：floor(7/2)+floor(3/2) = 3+1 = 4
  assert.equal(stats.favoriteTotal, 4)
  assert.equal(stats.followerCount, 1)
  assert.equal(stats.followingCount, 0)
})

test('stats: 单件作品列表只含本人作品，limit 越界 400', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/me/stats/photos?limit=10',
    headers: readHeaders('owner'),
  })
  assert.equal(res.statusCode, 200, res.body)
  const items = res.json().items as Array<{ photoId: string; likeCount: number }>
  assert.equal(items.length, 3)
  assert.ok(items.every((item) => [PHOTO_ID, PHOTO_2_ID, DRAFT_ID].includes(item.photoId)))

  for (const url of ['/api/me/stats/photos?limit=0', '/api/me/stats/photos?limit=101', '/api/me/stats/photos?offset=-1']) {
    const bad = await app.inject({ method: 'GET', url, headers: readHeaders('owner') })
    assert.equal(bad.statusCode, 400, `${url} 应 400，实际 ${bad.statusCode} ${bad.body}`)
  }

  // 未登录
  const anonymous = await app.inject({ method: 'GET', url: '/api/me/stats' })
  assert.equal(anonymous.statusCode, 401, anonymous.body)
})

// ============================================================================
// 3. 榜单通知
// ============================================================================
test('rank notify: 上榜作者收到 system 通知并带名次，重复调用不刷屏', async () => {
  const first = await app.inject({
    method: 'POST',
    url: `/api/admin/rankings/${snapshotId}/notify`,
    headers: authHeaders('staff'),
  })
  assert.equal(first.statusCode, 200, first.body)
  assert.equal(first.json().created, 1, '本例只有一件作品进前 10')

  const row = await admin.query<{ kind: string; meta: Record<string, unknown> }>(
    `select kind, meta from public.notifications
      where user_id = $1 and kind = 'system' order by created_at desc limit 1`,
    [OWNER_ID],
  )
  assert.equal(row.rows.length, 1)
  assert.equal(row.rows[0]!.kind, 'system')
  assert.equal(row.rows[0]!.meta.rank, 3)
  assert.equal(row.rows[0]!.meta.isoWeek, '2026-W44')

  const second = await app.inject({
    method: 'POST',
    url: `/api/admin/rankings/${snapshotId}/notify`,
    headers: authHeaders('staff'),
  })
  assert.equal(second.statusCode, 200, second.body)
  assert.equal(second.json().created, 0, '同一快照重复调用不应重复发通知')
})

test('rank notify: 非 staff 403、非法 id 400、快照不存在 404', async () => {
  const byUser = await app.inject({
    method: 'POST',
    url: `/api/admin/rankings/${snapshotId}/notify`,
    headers: authHeaders('owner'),
  })
  assert.equal(byUser.statusCode, 403, byUser.body)

  const badId = await app.inject({
    method: 'POST',
    url: '/api/admin/rankings/not-a-uuid/notify',
    headers: authHeaders('staff'),
  })
  assert.equal(badId.statusCode, 400, badId.body)

  const missing = await app.inject({
    method: 'POST',
    url: '/api/admin/rankings/ea000000-0000-0000-0000-0000000000ff/notify',
    headers: authHeaders('staff'),
  })
  assert.equal(missing.statusCode, 404, missing.body)
})
