/**
 * 社交关系闭环集成测试（0022）——跑在真实 PostgreSQL 上。
 *
 * 覆盖用户要求：
 *   1) 关注幂等 / 取关幂等 / 计数一致 / 自关注拒绝 / 目标不存在 404；
 *   2) 通知生成（like / favorite / comment / follow）与自操作不发通知；
 *   3) 已读标记（指定 id / all）与未读计数；
 *   4) /api/feed 只含“我关注的人”的已发布作品；
 *   5) 注销清理（follows 与本人相关通知）；
 *   6) 写接口沿用 Cookie 会话 + Origin/CSRF 校验。
 *
 * 运行（与其它 integration 测试一致）：
 *   PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=gongke_test PGUSER=app_user \
 *   PGPASSWORD=*** PGADMIN_USER=postgres PGADMIN_PASSWORD=*** \
 *   node --test --import tsx server/src/routes/social.integration.ts
 *
 * 注意：测试库必须已经按 supabase/migrations 全量迁移到 0022。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { after, before } from 'node:test'
import pg from 'pg'
import { hashPassword } from '../lib/password.js'

const { Client } = pg

const ORIGIN = 'http://127.0.0.1:5173'
const CSRF = 'csrf-token-for-social-integration'
const BOB_PASSWORD = 'SocBob!123456'

const ALICE_ID = 'f1000000-0000-0000-0000-000000000001'
const BOB_ID = 'f2000000-0000-0000-0000-000000000002'
const CAROL_ID = 'f3000000-0000-0000-0000-000000000003'
const PRIV_ID = 'f4000000-0000-0000-0000-000000000004'

const ALICE_PUB = 'fa000000-0000-0000-0000-000000000001'
const BOB_PUB1 = 'fa000000-0000-0000-0000-000000000002'
const BOB_PUB2 = 'fa000000-0000-0000-0000-000000000003'
const BOB_PUB3 = 'fa000000-0000-0000-0000-000000000004'
const BOB_DRAFT = 'fa000000-0000-0000-0000-000000000005'
const BOB_REMOVED = 'fa000000-0000-0000-0000-000000000006'
const CAROL_PUB = 'fa000000-0000-0000-0000-000000000007'
const PRIV_PUB = 'fa000000-0000-0000-0000-000000000008'

const ALICE_SECRET = 'social-alice-session-secret-000000000001'
const BOB_SECRET = 'social-bob-session-secret-0000000000002'
const CAROL_SECRET = 'social-carol-session-secret-000000003'
const PRIV_SECRET = 'social-priv-session-secret-0000000004'

type App = Awaited<ReturnType<(typeof import('../index.js'))['buildApp']>>

let app: App
let admin: pg.Client
const session: Record<'alice' | 'bob' | 'carol' | 'priv', string> = {
  alice: '',
  bob: '',
  carol: '',
  priv: '',
}

function tokenHash(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

function cookieOf(who: keyof typeof session): string {
  // gy_csrf 是双提交 cookie：中间件要求它与 x-csrf-token 头一致。
  const secrets = { alice: ALICE_SECRET, bob: BOB_SECRET, carol: CAROL_SECRET, priv: PRIV_SECRET }
  return `gk_session=${session[who]}.${secrets[who]}; gy_csrf=${CSRF}`
}

function authHeaders(who: keyof typeof session, csrf = CSRF) {
  return { origin: ORIGIN, cookie: cookieOf(who), 'x-csrf-token': csrf }
}

function readHeaders(who: keyof typeof session) {
  return { cookie: cookieOf(who) }
}

async function seedSession(userId: string, secret: string, label: string): Promise<string> {
  const result = await admin.query<{ session_id: string }>(
    `select session_id from public.api_create_session($1,$2,now() + interval '1 hour',$3,$4)`,
    [userId, tokenHash(secret), label, 'integration-ip'],
  )
  return result.rows[0]!.session_id
}

async function seedPhoto(input: {
  id: string
  authorId: string
  title: string
  status: 'published' | 'draft' | 'removed'
  ageMinutes: number
}): Promise<void> {
  await admin.query(
    `insert into public.photos
       (id,author_id,title,category_slug,image_key,thumb_key,width,height,status,published_at,deleted_at)
     values ($1,$2,$3,'landscape',$4,$5,1200,800,$6,$7,$8)
     on conflict (id) do update set
       author_id=excluded.author_id, title=excluded.title, status=excluded.status,
       published_at=excluded.published_at, deleted_at=excluded.deleted_at`,
    [
      input.id,
      input.authorId,
      input.title,
      `photos/${input.authorId}/${input.id}/display.webp`,
      `photos/${input.authorId}/${input.id}/thumb.webp`,
      input.status,
      input.status === 'published' ? new Date(Date.now() - input.ageMinutes * 60_000) : null,
      input.status === 'removed' ? new Date() : null,
    ],
  )
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

  // Bob 需要真实密码：注销接口要求二次验证密码（argon2）。
  const bobHash = await hashPassword(BOB_PASSWORD)
  await admin.query(
    `insert into auth.users (id,email,password_hash,raw_user_meta_data) values
      ($1,'soc-alice@test.local',null,'{"display_name":"Soc Alice"}'),
      ($2,'soc-bob@test.local',$5,'{"display_name":"Soc Bob"}'),
      ($3,'soc-carol@test.local',null,'{"display_name":"Soc Carol"}'),
      ($4,'soc-priv@test.local',null,'{"display_name":"Soc Priv"}')
     on conflict (id) do update set password_hash=excluded.password_hash`,
    [ALICE_ID, BOB_ID, CAROL_ID, PRIV_ID, bobHash],
  )
  await admin.query(
    `insert into public.profiles (id,username,display_name,visibility,discoverable) values
      ($1,'soc_alice','Soc Alice','public',true),
      ($2,'soc_bob','Soc Bob','public',true),
      ($3,'soc_carol','Soc Carol','public',true),
      ($4,'soc_priv','Soc Priv','private',false)
     on conflict (id) do update set
       username=excluded.username, display_name=excluded.display_name,
       visibility=excluded.visibility, discoverable=excluded.discoverable,
       deleted_at=null, follower_count=0, following_count=0`,
    [ALICE_ID, BOB_ID, CAROL_ID, PRIV_ID],
  )

  await seedPhoto({ id: ALICE_PUB, authorId: ALICE_ID, title: 'Alice Pub', status: 'published', ageMinutes: 10 })
  await seedPhoto({ id: BOB_PUB1, authorId: BOB_ID, title: 'Bob Pub 1', status: 'published', ageMinutes: 180 })
  await seedPhoto({ id: BOB_PUB2, authorId: BOB_ID, title: 'Bob Pub 2', status: 'published', ageMinutes: 120 })
  await seedPhoto({ id: BOB_PUB3, authorId: BOB_ID, title: 'Bob Pub 3', status: 'published', ageMinutes: 60 })
  await seedPhoto({ id: BOB_DRAFT, authorId: BOB_ID, title: 'Bob Draft', status: 'draft', ageMinutes: 30 })
  await seedPhoto({ id: BOB_REMOVED, authorId: BOB_ID, title: 'Bob Removed', status: 'removed', ageMinutes: 20 })
  await seedPhoto({ id: CAROL_PUB, authorId: CAROL_ID, title: 'Carol Pub', status: 'published', ageMinutes: 30 })
  await seedPhoto({ id: PRIV_PUB, authorId: PRIV_ID, title: 'Priv Pub', status: 'published', ageMinutes: 5 })

  // 清掉本文件涉及用户的社交残留，保证断言从确定状态出发。
  await admin.query(
    `delete from public.follows where follower_id = any($1) or followee_id = any($1)`,
    [[ALICE_ID, BOB_ID, CAROL_ID, PRIV_ID]],
  )
  await admin.query(
    `delete from public.notifications where user_id = any($1) or actor_id = any($1)`,
    [[ALICE_ID, BOB_ID, CAROL_ID, PRIV_ID]],
  )

  session.alice = await seedSession(ALICE_ID, ALICE_SECRET, 'social-integration-alice')
  session.bob = await seedSession(BOB_ID, BOB_SECRET, 'social-integration-bob')
  session.carol = await seedSession(CAROL_ID, CAROL_SECRET, 'social-integration-carol')
  session.priv = await seedSession(PRIV_ID, PRIV_SECRET, 'social-integration-priv')

  const { buildApp } = await import('../index.js')
  app = await buildApp()
  const who = await app.inject({ method: 'GET', url: '/api/auth/session', headers: readHeaders('alice') })
  assert.equal(who.statusCode, 200, who.body)
  assert.equal(who.json().userId, ALICE_ID)
})

after(async () => {
  await app?.close()
  await admin?.end()
})

// ============================================================================
// 1. 写接口安全：Origin / Cookie 会话 / CSRF
// ============================================================================
test('follow and notification writes enforce origin, session and csrf', async () => {
  const noOrigin = await app.inject({ method: 'PUT', url: '/api/profiles/soc_bob/follow' })
  assert.equal(noOrigin.statusCode, 403)
  assert.equal(noOrigin.json().code, 'FORBIDDEN')

  const anonymous = await app.inject({
    method: 'PUT',
    url: '/api/profiles/soc_bob/follow',
    headers: { origin: ORIGIN },
  })
  assert.equal(anonymous.statusCode, 401)
  assert.equal(anonymous.json().code, 'UNAUTHORIZED')

  const badCsrf = await app.inject({
    method: 'PUT',
    url: '/api/profiles/soc_bob/follow',
    headers: authHeaders('alice', 'not-the-csrf-token'),
  })
  assert.equal(badCsrf.statusCode, 403)
  assert.equal(badCsrf.json().code, 'FORBIDDEN')

  const readNoOrigin = await app.inject({
    method: 'POST',
    url: '/api/me/notifications/read',
    payload: { all: true },
  })
  assert.equal(readNoOrigin.statusCode, 403)

  const readAnonymous = await app.inject({
    method: 'POST',
    url: '/api/me/notifications/read',
    headers: { origin: ORIGIN },
    payload: { all: true },
  })
  assert.equal(readAnonymous.statusCode, 401)

  // 只读接口不需要 Origin/CSRF，但需要会话。
  const feedAnonymous = await app.inject({ method: 'GET', url: '/api/feed' })
  assert.equal(feedAnonymous.statusCode, 401)
  assert.equal(feedAnonymous.json().code, 'UNAUTHORIZED')

  // 以上被拒绝的请求不应留下任何关注关系。
  const rows = await admin.query('select count(*)::int as n from public.follows where follower_id=$1', [ALICE_ID])
  assert.equal(rows.rows[0].n, 0)
})

// ============================================================================
// 2. 关注：幂等、计数、列表、自关注、目标不存在
// ============================================================================
test('follow is idempotent and keeps counts consistent with the table', async () => {
  const first = await app.inject({
    method: 'PUT',
    url: '/api/profiles/soc_bob/follow',
    headers: authHeaders('alice'),
  })
  assert.equal(first.statusCode, 200, first.body)
  assert.deepEqual(first.json(), { isFollowing: true, followerCount: 1, followingCount: 1 })

  const twice = await app.inject({
    method: 'PUT',
    url: '/api/profiles/soc_bob/follow',
    headers: authHeaders('alice'),
  })
  assert.equal(twice.statusCode, 200, twice.body)
  assert.deepEqual(twice.json(), { isFollowing: true, followerCount: 1, followingCount: 1 })

  const rows = await admin.query<{ n: number }>(
    'select count(*)::int as n from public.follows where follower_id=$1 and followee_id=$2',
    [ALICE_ID, BOB_ID],
  )
  assert.equal(rows.rows[0]!.n, 1, '重复关注只能有一行')

  const counters = await admin.query<{ follower_count: number; following_count: number }>(
    'select follower_count, following_count from public.profiles where id=$1',
    [BOB_ID],
  )
  assert.equal(counters.rows[0]!.follower_count, 1)
  // 触发器维护的计数必须与真实行数一致。
  const truth = await admin.query<{ followers: number; following: number }>(
    `select
       (select count(*)::int from public.follows where followee_id=$1) as followers,
       (select count(*)::int from public.follows where follower_id=$1) as following`,
    [BOB_ID],
  )
  assert.equal(counters.rows[0]!.follower_count, truth.rows[0]!.followers)
  assert.equal(counters.rows[0]!.following_count, truth.rows[0]!.following)
})

test('follow list endpoints page by cursor and report the right totals', async () => {
  const followers = await app.inject({
    method: 'GET',
    url: '/api/profiles/soc_bob/followers?limit=10',
    headers: readHeaders('alice'),
  })
  assert.equal(followers.statusCode, 200, followers.body)
  const page = followers.json()
  assert.equal(page.total, 1)
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].username, 'soc_alice')
  assert.equal(page.items[0].displayName, 'Soc Alice')
  assert.equal(page.items[0].isFollowing, false, '自己关注自己没有意义 → false')
  assert.equal(page.nextCursor, null)
  assert.ok(Date.parse(page.items[0].followedAt) > 0)

  // 列表项 = 完整公开资料 + 关系元数据，前端直接拿它渲染 Profile 卡片，
  // 不需要再逐个去查 /api/profiles/:username。
  assert.equal(page.items[0].id, ALICE_ID)
  assert.equal(page.items[0].role, 'user')
  assert.equal(typeof page.items[0].licensePreference, 'string')
  assert.ok(Array.isArray(page.items[0].links))
  assert.equal(page.items[0].avatarKey, null)
  assert.equal(page.items[0].phone, undefined, '公开资料白名单里没有 phone')

  // 游客也能看公开资料的粉丝列表，但没有会话时 isFollowing 恒为 false。
  const anonymous = await app.inject({ method: 'GET', url: '/api/profiles/soc_bob/followers' })
  assert.equal(anonymous.statusCode, 200, anonymous.body)
  assert.equal(anonymous.json().total, 1)

  const following = await app.inject({
    method: 'GET',
    url: '/api/profiles/soc_alice/following',
    headers: readHeaders('alice'),
  })
  assert.equal(following.statusCode, 200, following.body)
  assert.equal(following.json().total, 1)
  assert.equal(following.json().items[0].username, 'soc_bob')
  assert.equal(following.json().items[0].isFollowing, true, '列表里的关注按钮要能回填')
})

test('follow writes reject self-follow, unknown users and malformed usernames', async () => {
  const self = await app.inject({
    method: 'PUT',
    url: '/api/profiles/soc_alice/follow',
    headers: authHeaders('alice'),
  })
  assert.equal(self.statusCode, 400, self.body)
  assert.equal(self.json().code, 'VALIDATION')

  const unknown = await app.inject({
    method: 'PUT',
    url: '/api/profiles/soc_does_not_exist/follow',
    headers: authHeaders('alice'),
  })
  assert.equal(unknown.statusCode, 404, unknown.body)
  assert.equal(unknown.json().code, 'NOT_FOUND')

  const malformed = await app.inject({
    method: 'PUT',
    url: '/api/profiles/a/follow',
    headers: authHeaders('alice'),
  })
  assert.equal(malformed.statusCode, 400, malformed.body)
  assert.equal(malformed.json().code, 'VALIDATION')

  // 自关注与不存在的用户都不能写入任何行。
  const rows = await admin.query<{ n: number }>(
    'select count(*)::int as n from public.follows where follower_id = any($1) or followee_id = any($1)',
    [[ALICE_ID, BOB_ID, CAROL_ID, PRIV_ID]],
  )
  assert.equal(rows.rows[0]!.n, 1)
})

test('follow notifies the followee and unfollow is idempotent', async () => {
  const unread = await app.inject({
    method: 'GET',
    url: '/api/me/notifications/unread-count',
    headers: readHeaders('bob'),
  })
  assert.equal(unread.statusCode, 200, unread.body)
  assert.deepEqual(unread.json(), { count: 1 }, '被关注者应收到一条 follow 通知')

  const notifications = await app.inject({
    method: 'GET',
    url: '/api/me/notifications',
    headers: readHeaders('bob'),
  })
  assert.equal(notifications.statusCode, 200, notifications.body)
  const item = notifications.json().items[0]
  assert.equal(item.kind, 'follow')
  assert.equal(item.actor.username, 'soc_alice')
  assert.equal(item.actor.displayName, 'Soc Alice', 'actor 是内联的公开资料，前端不必再回查')
  assert.equal(item.actor.id, ALICE_ID)
  assert.equal(item.actor.phone, undefined, '公开资料白名单里没有 phone')
  assert.equal(item.photoId, null)
  assert.equal(item.readAt, null)
  assert.equal(notifications.json().unreadCount, 1)

  const off = await app.inject({
    method: 'DELETE',
    url: '/api/profiles/soc_bob/follow',
    headers: authHeaders('alice'),
  })
  assert.equal(off.statusCode, 200, off.body)
  assert.deepEqual(off.json(), { isFollowing: false, followerCount: 0, followingCount: 0 })

  const offAgain = await app.inject({
    method: 'DELETE',
    url: '/api/profiles/soc_bob/follow',
    headers: authHeaders('alice'),
  })
  assert.equal(offAgain.statusCode, 200, offAgain.body)
  assert.deepEqual(offAgain.json(), { isFollowing: false, followerCount: 0, followingCount: 0 })

  const rows = await admin.query<{ n: number }>(
    'select count(*)::int as n from public.follows where follower_id = any($1) or followee_id = any($1)',
    [[ALICE_ID, BOB_ID, CAROL_ID, PRIV_ID]],
  )
  assert.equal(rows.rows[0]!.n, 0)

  // 取关不回收已发出的通知（通知是历史事件，不是订阅状态）。
  const after = await app.inject({
    method: 'GET',
    url: '/api/me/notifications/unread-count',
    headers: readHeaders('bob'),
  })
  assert.deepEqual(after.json(), { count: 1 })

  // 恢复关注关系，供后续用例使用。
  const reFollow = await app.inject({
    method: 'PUT',
    url: '/api/profiles/soc_bob/follow',
    headers: authHeaders('alice'),
  })
  assert.equal(reFollow.json().isFollowing, true)
})

// ============================================================================
// 3. 通知生成：like / favorite / comment / follow，自操作不发
// ============================================================================
test('likes, favorites and comments notify the author while self-actions stay silent', async () => {
  await admin.query(`delete from public.notifications where user_id = any($1) or actor_id = any($1)`, [
    [ALICE_ID, BOB_ID, CAROL_ID, PRIV_ID],
  ])

  const like = await app.inject({
    method: 'PUT',
    url: `/api/photos/${BOB_PUB1}/like`,
    headers: authHeaders('alice'),
    payload: { liked: true },
  })
  assert.equal(like.statusCode, 200, like.body)

  const favorite = await app.inject({
    method: 'PUT',
    url: `/api/photos/${BOB_PUB1}/favorite`,
    headers: authHeaders('alice'),
    payload: { favorited: true },
  })
  assert.equal(favorite.statusCode, 200, favorite.body)

  const comment = await app.inject({
    method: 'POST',
    url: `/api/photos/${BOB_PUB1}/comments`,
    headers: authHeaders('alice'),
    payload: { body: 'integration comment' },
  })
  assert.equal(comment.statusCode, 200, comment.body)
  const commentId: string = comment.json().id

  // 自己给自己的作品点赞 / 评论 → 不产生通知
  await app.inject({
    method: 'PUT',
    url: `/api/photos/${BOB_PUB2}/like`,
    headers: authHeaders('bob'),
    payload: { liked: true },
  })
  await app.inject({
    method: 'POST',
    url: `/api/photos/${BOB_PUB2}/comments`,
    headers: authHeaders('bob'),
    payload: { body: 'self comment' },
  })

  const list = await app.inject({ method: 'GET', url: '/api/me/notifications', headers: readHeaders('bob') })
  assert.equal(list.statusCode, 200, list.body)
  const body = list.json()
  assert.equal(body.unreadCount, 3, '只应有 alice 的 1 点赞 + 1 收藏 + 1 评论')
  assert.equal(body.items.length, 3)

  const tally: Record<string, number> = {}
  for (const item of body.items as { kind: string }[]) {
    tally[item.kind] = (tally[item.kind] ?? 0) + 1
  }
  assert.deepEqual(tally, { like: 2, comment: 1 })

  const commentItem = body.items.find((item: { kind: string }) => item.kind === 'comment')
  assert.equal(commentItem.actor.username, 'soc_alice')
  assert.equal(commentItem.photoId, BOB_PUB1)
  assert.equal(commentItem.photoTitle, 'Bob Pub 1')
  assert.equal(commentItem.commentId, commentId)
  assert.equal(commentItem.commentExcerpt, 'integration comment')
  assert.ok(commentItem.photoThumbKey)

  const likeItem = body.items.find((item: { kind: string }) => item.kind === 'like')
  assert.equal(likeItem.actor.username, 'soc_alice')
  assert.equal(likeItem.actor.displayName, 'Soc Alice')

  // 通知只对作品作者生效：alice 自己没有未读。
  const aliceUnread = await app.inject({
    method: 'GET',
    url: '/api/me/notifications/unread-count',
    headers: readHeaders('alice'),
  })
  assert.deepEqual(aliceUnread.json(), { count: 0 })

  // 游客 / 未登录不能读通知。
  const anonymous = await app.inject({ method: 'GET', url: '/api/me/notifications' })
  assert.equal(anonymous.statusCode, 401)
  const anonymousCount = await app.inject({ method: 'GET', url: '/api/me/notifications/unread-count' })
  assert.equal(anonymousCount.statusCode, 401)
})

// ============================================================================
// 4. 已读标记与未读计数
// ============================================================================
test('marking notifications read is scoped, idempotent and validates input', async () => {
  const bobList = await app.inject({ method: 'GET', url: '/api/me/notifications', headers: readHeaders('bob') })
  const items: Array<{ id: string }> = bobList.json().items
  const targetId = items[0]!.id

  // 别人的通知 id 不能被我标记（返回 0，且不影响 bob 的未读数）。
  const crossUser = await app.inject({
    method: 'POST',
    url: '/api/me/notifications/read',
    headers: authHeaders('carol'),
    payload: { ids: [targetId] },
  })
  assert.equal(crossUser.statusCode, 200, crossUser.body)
  assert.deepEqual(crossUser.json(), { markedCount: 0, unreadCount: 0 })

  const stillUnread = await app.inject({
    method: 'GET',
    url: '/api/me/notifications/unread-count',
    headers: readHeaders('bob'),
  })
  assert.deepEqual(stillUnread.json(), { count: 3 })

  // 指定 id 标记：只影响自己的行。
  const one = await app.inject({
    method: 'POST',
    url: '/api/me/notifications/read',
    headers: authHeaders('bob'),
    payload: { ids: [targetId] },
  })
  assert.equal(one.statusCode, 200, one.body)
  assert.deepEqual(one.json(), { markedCount: 1, unreadCount: 2 })

  // 重复标记同一条 → 0（幂等，不会重复计数）。
  const again = await app.inject({
    method: 'POST',
    url: '/api/me/notifications/read',
    headers: authHeaders('bob'),
    payload: { ids: [targetId] },
  })
  assert.deepEqual(again.json(), { markedCount: 0, unreadCount: 2 })

  // 全部标记为已读：前端 src/data/api/social.ts 的“全部已读”就是发一个空对象，
  // 所以 {} 必须等价于 all: true（省略 ids = 全部），这里按前端真实调用测。
  const all = await app.inject({
    method: 'POST',
    url: '/api/me/notifications/read',
    headers: authHeaders('bob'),
    payload: {},
  })
  assert.deepEqual(all.json(), { markedCount: 2, unreadCount: 0 })

  const allAgain = await app.inject({
    method: 'POST',
    url: '/api/me/notifications/read',
    headers: authHeaders('bob'),
    payload: { all: true },
  })
  assert.deepEqual(allAgain.json(), { markedCount: 0, unreadCount: 0 })

  const readList = await app.inject({ method: 'GET', url: '/api/me/notifications', headers: readHeaders('bob') })
  assert.equal(readList.json().unreadCount, 0)
  assert.ok(readList.json().items.every((item: { readAt: string | null }) => item.readAt !== null))

  // 参数校验（注意 {} 是合法的“全部已读”，不在这一串里）。
  for (const payload of [{ ids: [] }, { ids: ['not-a-uuid'] }, { ids: [targetId], all: true }, { all: 'yes' }, { nope: 1 }]) {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/me/notifications/read',
      headers: authHeaders('bob'),
      payload,
    })
    assert.equal(bad.statusCode, 400, `${JSON.stringify(payload)} → ${bad.body}`)
    assert.equal(bad.json().code, 'VALIDATION')
  }

  // 新一轮通知：carol 评论 bob 的作品 → 未读数回到 1，并可用 id 精确标记。
  const comment = await app.inject({
    method: 'POST',
    url: `/api/photos/${BOB_PUB1}/comments`,
    headers: authHeaders('carol'),
    payload: { body: 'carol comment' },
  })
  assert.equal(comment.statusCode, 200, comment.body)
  const unread = await app.inject({
    method: 'GET',
    url: '/api/me/notifications/unread-count',
    headers: readHeaders('bob'),
  })
  assert.deepEqual(unread.json(), { count: 1 })
})

// ============================================================================
// 5. 关注动态流
// ============================================================================
test('feed only contains published works of followed authors', async () => {
  // 阶段一：alice 只关注 bob。
  const page = await app.inject({ method: 'GET', url: '/api/feed?limit=50', headers: readHeaders('alice') })
  assert.equal(page.statusCode, 200, page.body)
  const first = page.json()
  const titles = first.items.map((item: { title: string }) => item.title)
  assert.deepEqual(titles, ['Bob Pub 3', 'Bob Pub 2', 'Bob Pub 1'])
  assert.ok(!titles.includes('Bob Draft'), '草稿不能进动态流')
  assert.ok(!titles.includes('Bob Removed'), '已删除作品不能进动态流')
  assert.ok(!titles.includes('Alice Pub'), '自己的作品不进自己的关注动态流')
  assert.ok(!titles.includes('Carol Pub'), '未关注的人不进动态流')

  const item = first.items[0]
  assert.equal(item.authorUsername, 'soc_bob')
  assert.equal(item.authorDisplayName, 'Soc Bob')
  assert.equal(typeof item.likeCount, 'number')
  assert.equal(item.status, 'published')

  // 阶段二：翻页。cursor 为 base64url 的 [publishedAt, id]。
  const p1 = await app.inject({ method: 'GET', url: '/api/feed?limit=2', headers: readHeaders('alice') })
  assert.deepEqual(
    p1.json().items.map((i: { title: string }) => i.title),
    ['Bob Pub 3', 'Bob Pub 2'],
  )
  const cursor = p1.json().nextCursor
  assert.equal(typeof cursor, 'string')

  const p2 = await app.inject({
    method: 'GET',
    url: `/api/feed?limit=2&cursor=${encodeURIComponent(cursor)}`,
    headers: readHeaders('alice'),
  })
  assert.deepEqual(
    p2.json().items.map((i: { title: string }) => i.title),
    ['Bob Pub 1'],
  )
  assert.equal(p2.json().nextCursor, null)

  // 阶段三：关注 carol 后动态流合并两个作者，仍按发布时间倒序。
  await app.inject({ method: 'PUT', url: '/api/profiles/soc_carol/follow', headers: authHeaders('alice') })
  const merged = await app.inject({ method: 'GET', url: '/api/feed?limit=50', headers: readHeaders('alice') })
  assert.deepEqual(
    merged.json().items.map((i: { title: string }) => i.title),
    ['Carol Pub', 'Bob Pub 3', 'Bob Pub 2', 'Bob Pub 1'],
  )
  assert.ok(merged.json().items.some((i: { authorUsername: string }) => i.authorUsername === 'soc_carol'))

  // 没有关注任何人的用户看到空流。
  const empty = await app.inject({ method: 'GET', url: '/api/feed', headers: readHeaders('carol') })
  assert.equal(empty.statusCode, 200, empty.body)
  assert.deepEqual(empty.json(), { items: [], nextCursor: null })

  // 分页参数：limit 超上限被钳住（不报错），非法值报 400。
  const clamped = await app.inject({ method: 'GET', url: '/api/feed?limit=999', headers: readHeaders('alice') })
  assert.equal(clamped.statusCode, 200, clamped.body)
  const zero = await app.inject({ method: 'GET', url: '/api/feed?limit=0', headers: readHeaders('alice') })
  assert.equal(zero.statusCode, 400)
  assert.equal(zero.json().code, 'VALIDATION')
  const badCursor = await app.inject({ method: 'GET', url: '/api/feed?cursor=@@@', headers: readHeaders('alice') })
  assert.equal(badCursor.statusCode, 400)
  assert.equal(badCursor.json().code, 'VALIDATION')
})

// ============================================================================
// 6. 私密资料：关注不改变可见性
// ============================================================================
test('following a private profile does not unlock its social graph', async () => {
  const before = await app.inject({
    method: 'GET',
    url: '/api/profiles/soc_priv/followers',
    headers: readHeaders('alice'),
  })
  assert.equal(before.statusCode, 404, before.body)
  assert.equal(before.json().code, 'NOT_FOUND')

  // 关注私密资料本身是允许的（订阅关系不受 visibility 限制）。
  const followed = await app.inject({
    method: 'PUT',
    url: '/api/profiles/soc_priv/follow',
    headers: authHeaders('alice'),
  })
  assert.equal(followed.statusCode, 200, followed.body)
  assert.equal(followed.json().isFollowing, true)

  // 关注之后仍然看不到私密资料的粉丝列表。
  const after = await app.inject({
    method: 'GET',
    url: '/api/profiles/soc_priv/followers',
    headers: readHeaders('alice'),
  })
  assert.equal(after.statusCode, 404, after.body)

  // 本人可以看自己的粉丝列表。
  const owner = await app.inject({
    method: 'GET',
    url: '/api/profiles/soc_priv/followers',
    headers: readHeaders('priv'),
  })
  assert.equal(owner.statusCode, 200, owner.body)
  assert.equal(owner.json().total, 1)
  assert.equal(owner.json().items[0].username, 'soc_alice')
})

// ============================================================================
// 7. 注销清理
// ============================================================================
test('account deletion removes follows and related notifications', async () => {
  const beforeFollows = await admin.query<{ n: number }>(
    'select count(*)::int as n from public.follows where follower_id=$1 or followee_id=$1',
    [BOB_ID],
  )
  assert.ok(beforeFollows.rows[0]!.n > 0)
  const beforeNotifications = await admin.query<{ n: number }>(
    'select count(*)::int as n from public.notifications where user_id=$1 or actor_id=$1',
    [BOB_ID],
  )
  assert.ok(beforeNotifications.rows[0]!.n > 0)

  const deleted = await app.inject({
    method: 'DELETE',
    url: '/api/me/account',
    headers: authHeaders('bob'),
    payload: { password: BOB_PASSWORD, confirm: '注销账号', reason: 'integration' },
  })
  assert.equal(deleted.statusCode, 204, deleted.body)

  const follows = await admin.query<{ n: number }>(
    'select count(*)::int as n from public.follows where follower_id=$1 or followee_id=$1',
    [BOB_ID],
  )
  assert.equal(follows.rows[0]!.n, 0, '注销必须清掉两个方向的关注关系')

  const notifications = await admin.query<{ n: number }>(
    'select count(*)::int as n from public.notifications where user_id=$1 or actor_id=$1',
    [BOB_ID],
  )
  assert.equal(notifications.rows[0]!.n, 0, '注销必须清掉本人收到的与本人发出的通知')

  // 别人的计数要跟着回落，且与真实行数一致。
  const counts = await admin.query<{ username: string; follower_count: number; following_count: number }>(
    `select username, follower_count, following_count from public.profiles where id = any($1)`,
    [[ALICE_ID, CAROL_ID, PRIV_ID]],
  )
  for (const row of counts.rows) {
    const truth = await admin.query<{ followers: number; following: number }>(
      `select
         (select count(*)::int from public.follows f join public.profiles p on p.id=f.followee_id where p.username=$1) as followers,
         (select count(*)::int from public.follows f join public.profiles p on p.id=f.follower_id where p.username=$1) as following`,
      [row.username],
    )
    assert.equal(row.follower_count, truth.rows[0]!.followers, `${row.username} follower_count 不一致`)
    assert.equal(row.following_count, truth.rows[0]!.following, `${row.username} following_count 不一致`)
  }

  // alice 的关注列表里不再有 bob。
  const following = await app.inject({
    method: 'GET',
    url: '/api/profiles/soc_alice/following',
    headers: readHeaders('alice'),
  })
  assert.equal(following.statusCode, 200, following.body)
  const names = following.json().items.map((i: { username: string }) => i.username)
  assert.ok(!names.includes('soc_bob'))
  assert.deepEqual([...names].sort(), ['soc_carol', 'soc_priv'])

  // 注销后的资料对外不可见。
  const profile = await app.inject({ method: 'GET', url: '/api/profiles/by-username/soc_bob' })
  assert.equal(profile.statusCode, 404, profile.body)

  // 会话已撤销：旧 cookie 不再可用。
  const stale = await app.inject({ method: 'GET', url: '/api/me/notifications', headers: readHeaders('bob') })
  assert.equal(stale.statusCode, 401, stale.body)

  // 动态流里 bob 的作品全部消失（作者已注销）。
  const feed = await app.inject({ method: 'GET', url: '/api/feed?limit=50', headers: readHeaders('alice') })
  assert.deepEqual(
    feed.json().items.map((i: { title: string }) => i.title),
    ['Priv Pub', 'Carol Pub'],
  )
})
