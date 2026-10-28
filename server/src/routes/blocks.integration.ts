/**
 * 拉黑 + 用户搜索集成测试（0024）——跑在真实 PostgreSQL 上。
 *
 * 覆盖契约 §1–§3 里专家 B 负责的每一条：
 *   1) 写接口沿用 Cookie 会话 + Origin/CSRF 校验；/api/users/search 匿名可用；
 *   2) 拉黑幂等、删双向关注、计数一致、目标不存在 404、自拉黑 400；
 *   3) 拉黑后资料页两个方向的表现（拉黑方 isBlocked=true / 被拉黑方 404）；
 *   4) 关注被阻断且文案可操作（「你已拉黑对方」/「对方不可关注」）；
 *   5) 动态流两个方向都过滤；
 *   6) 点赞 / 收藏 / 评论被阻断，且不为对方产生通知；
 *   7) 既有互动保留在库里，但互相不可见（读取侧过滤，不是删数据）；
 *   8) 拉黑列表游标分页 + 解除后恢复；
 *   9) 用户搜索的过滤（discoverable / 拉黑）与排序（前缀命中 → 粉丝数 → username）。
 *
 * 运行（与其它 integration 测试一致）：
 *   PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=gongke_test PGUSER=app_user \
 *   PGPASSWORD=*** PGADMIN_USER=postgres PGADMIN_PASSWORD=*** \
 *   node --test --import tsx server/src/routes/blocks.integration.ts
 *
 * 注意：测试库必须已经按 supabase/migrations 全量迁移到 0024。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { after, before } from 'node:test'
import pg from 'pg'

const { Client } = pg

const ORIGIN = 'http://127.0.0.1:5173'
const CSRF = 'csrf-token-for-blocks-integration'

// UUID 用 b 段开头，与其它套件（social 用 f…、profile-interactions 用别的段）隔开，
// 这样同一个一次性库上跑全套时互不干扰。
const ANN_ID = 'b1000000-0000-0000-0000-000000000001' // 主角：拉黑别人、搜索的人
const BEN_ID = 'b2000000-0000-0000-0000-000000000002' // 被拉黑的人
const CATE_ID = 'b3000000-0000-0000-0000-000000000003' // 第三方（不受影响），也用于分页
const DEAN_ID = 'b4000000-0000-0000-0000-000000000004' // discoverable=false，搜索必须看不到
const EVE_ID = 'b5000000-0000-0000-0000-000000000005' // 分页第三人
const ZED_ID = 'b6000000-0000-0000-0000-000000000006' // 非前缀命中（zed_blk）

const ANN_PUB = 'bb000000-0000-0000-0000-000000000001'
const BEN_PUB1 = 'bb000000-0000-0000-0000-000000000002'
const BEN_PUB2 = 'bb000000-0000-0000-0000-000000000003'
const CATE_PUB = 'bb000000-0000-0000-0000-000000000004'

const ANN_SECRET = 'blocks-ann-session-secret-0000000000001'
const BEN_SECRET = 'blocks-ben-session-secret-0000000000002'
const CATE_SECRET = 'blocks-cate-session-secret-000000000003'
const EVE_SECRET = 'blocks-eve-session-secret-0000000000004'

const ALL_IDS = [ANN_ID, BEN_ID, CATE_ID, DEAN_ID, EVE_ID, ZED_ID]
const ALL_PHOTOS = [ANN_PUB, BEN_PUB1, BEN_PUB2, CATE_PUB]

type App = Awaited<ReturnType<(typeof import('../index.js'))['buildApp']>>
type Who = 'ann' | 'ben' | 'cate' | 'eve'

let app: App
let admin: pg.Client
const session: Record<Who, string> = { ann: '', ben: '', cate: '', eve: '' }
const SECRETS: Record<Who, string> = {
  ann: ANN_SECRET,
  ben: BEN_SECRET,
  cate: CATE_SECRET,
  eve: EVE_SECRET,
}

function tokenHash(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

function cookieOf(who: Who): string {
  // gy_csrf 是双提交 cookie：中间件要求它与 x-csrf-token 头一致。
  return `gk_session=${session[who]}.${SECRETS[who]}; gy_csrf=${CSRF}`
}

function authHeaders(who: Who, csrf = CSRF) {
  return { origin: ORIGIN, cookie: cookieOf(who), 'x-csrf-token': csrf }
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

async function seedPhoto(input: {
  id: string
  authorId: string
  title: string
  status: 'published' | 'draft'
  ageMinutes: number
}): Promise<void> {
  await admin.query(
    `insert into public.photos
       (id,author_id,title,category_slug,image_key,thumb_key,width,height,status,published_at,deleted_at)
     values ($1,$2,$3,'landscape',$4,$5,1200,800,$6,$7,null)
     on conflict (id) do update set
       author_id=excluded.author_id, title=excluded.title, status=excluded.status,
       published_at=excluded.published_at, deleted_at=null`,
    [
      input.id,
      input.authorId,
      input.title,
      `photos/${input.authorId}/${input.id}/display.webp`,
      `photos/${input.authorId}/${input.id}/thumb.webp`,
      input.status,
      input.status === 'published' ? new Date(Date.now() - input.ageMinutes * 60_000) : null,
    ],
  )
}

/**
 * 每个测试自己清场：拉黑 / 关注 / 通知 / 互动都清掉，计数归零。
 * 目的不是「卫生」，而是让断言只依赖本测试建立的因果 —— 一旦某个测试
 * 漏了清理，下一个测试会以「意外状态」失败，而不是被前一个测试的残留蒙混过关。
 */
async function resetSocial(): Promise<void> {
  await admin.query(
    'delete from public.blocks where blocker_id = any($1) or blocked_id = any($1)',
    [ALL_IDS],
  )
  await admin.query(
    'delete from public.follows where follower_id = any($1) or followee_id = any($1)',
    [ALL_IDS],
  )
  await admin.query(
    'delete from public.notifications where user_id = any($1) or actor_id = any($1)',
    [ALL_IDS],
  )
  await admin.query('delete from public.likes where user_id = any($1) or photo_id = any($2)', [
    ALL_IDS,
    ALL_PHOTOS,
  ])
  await admin.query('delete from public.favorites where user_id = any($1) or photo_id = any($2)', [
    ALL_IDS,
    ALL_PHOTOS,
  ])
  await admin.query('delete from public.comments where author_id = any($1) or photo_id = any($2)', [
    ALL_IDS,
    ALL_PHOTOS,
  ])
  await admin.query(
    'update public.profiles set follower_count = 0, following_count = 0 where id = any($1)',
    [ALL_IDS],
  )
}

async function block(who: Who, username: string) {
  return app.inject({
    method: 'PUT',
    url: `/api/profiles/${username}/block`,
    headers: authHeaders(who),
  })
}

async function unblock(who: Who, username: string) {
  return app.inject({
    method: 'DELETE',
    url: `/api/profiles/${username}/block`,
    headers: authHeaders(who),
  })
}

async function follow(who: Who, username: string) {
  return app.inject({
    method: 'PUT',
    url: `/api/profiles/${username}/follow`,
    headers: authHeaders(who),
  })
}

async function insertFollow(followerId: string, followeeId: string): Promise<void> {
  // 直接写表（管理员连接，绕过 RLS / 接口）：用来构造「拉黑之前就存在的关注」
  // 这类状态 —— 拉黑接口会删双向关注，也只有这样才测得到动态流自己的过滤。
  await admin.query(
    `insert into public.follows (follower_id, followee_id) values ($1,$2)
     on conflict (follower_id, followee_id) do nothing`,
    [followerId, followeeId],
  )
}

async function feedIds(who: Who): Promise<string[]> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/feed?limit=50',
    headers: readHeaders(who),
  })
  assert.equal(res.statusCode, 200, res.body)
  return (res.json().items as { id: string }[]).map((item) => item.id)
}

async function likeIdsIn(username: string, who: Who): Promise<string[]> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/profiles/${username}/interactions?kind=likes&limit=50`,
    headers: readHeaders(who),
  })
  assert.equal(res.statusCode, 200, res.body)
  return (res.json().items as { id: string }[]).map((item) => item.id)
}

async function search(
  query: string,
  options: { who?: Who; limit?: number } = {},
): Promise<{ items: { username: string; followerCount: number; isFollowing: boolean }[]; total: number; status: number }> {
  const params = new URLSearchParams({ q: query })
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  const res = await app.inject({
    method: 'GET',
    url: `/api/users/search?${params.toString()}`,
    ...(options.who ? { headers: readHeaders(options.who) } : {}),
  })
  if (res.statusCode !== 200) return { items: [], total: 0, status: res.statusCode }
  const body = res.json() as { items: { username: string; followerCount: number; isFollowing: boolean }[]; total: number }
  return { items: body.items, total: body.total, status: 200 }
}

/** 搜索是全局的（别的套件的用户也可能命中），断言只看本文件自己的账号。 */
const KNOWN_USERNAMES = new Set(['blk_ann', 'blk_ben', 'blk_cate', 'blk_dean', 'blk_eve', 'zed_blk'])
function ownUsernames(items: { username: string }[]): string[] {
  return items.map((item) => item.username).filter((name) => KNOWN_USERNAMES.has(name))
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
    `insert into auth.users (id,email,password_hash,raw_user_meta_data) values
      ($1,'blk-ann@test.local',null,'{"display_name":"Blk Ann"}'),
      ($2,'blk-ben@test.local',null,'{"display_name":"Blk Ben"}'),
      ($3,'blk-cate@test.local',null,'{"display_name":"Blk Cate"}'),
      ($4,'blk-dean@test.local',null,'{"display_name":"Blk Dean"}'),
      ($5,'blk-eve@test.local',null,'{"display_name":"Blk Eve"}'),
      ($6,'blk-zed@test.local',null,'{"display_name":"Zed Blk"}')
     on conflict (id) do update set email=excluded.email`,
    [ANN_ID, BEN_ID, CATE_ID, DEAN_ID, EVE_ID, ZED_ID],
  )

  // show_likes / show_favorites 显式写 true：默认值将来若变化，
  // 「互动列表互相不可见」那组断言必须测的是拉黑过滤，而不是开关恰好关着。
  await admin.query(
    `insert into public.profiles
       (id,username,display_name,visibility,discoverable,show_likes,show_favorites)
     values
      ($1,'blk_ann','Blk Ann','public',true,true,true),
      ($2,'blk_ben','Blk Ben','public',true,true,true),
      ($3,'blk_cate','Blk Cate','public',true,true,true),
      ($4,'blk_dean','Blk Dean','public',false,true,true),
      ($5,'blk_eve','Blk Eve','public',true,true,true),
      ($6,'zed_blk','Zed Blk','public',true,true,true)
     on conflict (id) do update set
       username=excluded.username, display_name=excluded.display_name,
       visibility=excluded.visibility, discoverable=excluded.discoverable,
       show_likes=excluded.show_likes, show_favorites=excluded.show_favorites,
       deleted_at=null, follower_count=0, following_count=0`,
    [ANN_ID, BEN_ID, CATE_ID, DEAN_ID, EVE_ID, ZED_ID],
  )

  await seedPhoto({ id: ANN_PUB, authorId: ANN_ID, title: 'Ann Pub', status: 'published', ageMinutes: 10 })
  await seedPhoto({ id: BEN_PUB1, authorId: BEN_ID, title: 'Ben Pub 1', status: 'published', ageMinutes: 20 })
  await seedPhoto({ id: BEN_PUB2, authorId: BEN_ID, title: 'Ben Pub 2', status: 'published', ageMinutes: 15 })
  await seedPhoto({ id: CATE_PUB, authorId: CATE_ID, title: 'Cate Pub', status: 'published', ageMinutes: 5 })

  await resetSocial()

  // 会话也清掉：本文件用固定 secret，api_create_session 不做 upsert，
  // 不清就会在**持久库**上的第二次运行撞 security_sessions 的唯一约束
  // （这正是 .tmp/verify-fresh-db.sh 存在的原因）。顺手清掉，套件就能重复跑。
  await admin.query('delete from public.security_sessions where user_id = any($1)', [ALL_IDS])

  session.ann = await seedSession(ANN_ID, ANN_SECRET, 'blocks-integration-ann')
  session.ben = await seedSession(BEN_ID, BEN_SECRET, 'blocks-integration-ben')
  session.cate = await seedSession(CATE_ID, CATE_SECRET, 'blocks-integration-cate')
  session.eve = await seedSession(EVE_ID, EVE_SECRET, 'blocks-integration-eve')

  const { buildApp } = await import('../index.js')
  app = await buildApp()
  const who = await app.inject({ method: 'GET', url: '/api/auth/session', headers: readHeaders('ann') })
  assert.equal(who.statusCode, 200, who.body)
  assert.equal(who.json().userId, ANN_ID)
})

after(async () => {
  await app?.close()
  await admin?.end()
})

// ============================================================================
// 1. 写接口安全：Origin / Cookie 会话 / CSRF
// ============================================================================
test('block writes enforce origin, session and csrf', async () => {
  await resetSocial()

  const noOrigin = await app.inject({ method: 'PUT', url: '/api/profiles/blk_ben/block' })
  assert.equal(noOrigin.statusCode, 403)
  assert.equal(noOrigin.json().code, 'FORBIDDEN')

  const badCsrf = await app.inject({
    method: 'PUT',
    url: '/api/profiles/blk_ben/block',
    headers: authHeaders('ann', 'wrong-token'),
  })
  assert.equal(badCsrf.statusCode, 403)
  assert.equal(badCsrf.json().code, 'FORBIDDEN')

  // 有 Origin + CSRF 但没有会话 cookie：中间件放行（它只管 CSRF），
  // 由 requireUser 判 401 —— 两种失败必须能区分开。
  const anonymous = await app.inject({
    method: 'PUT',
    url: '/api/profiles/blk_ben/block',
    headers: { origin: ORIGIN, 'x-csrf-token': CSRF },
  })
  assert.equal(anonymous.statusCode, 401)
  assert.equal(anonymous.json().code, 'UNAUTHORIZED')

  const noOriginUnblock = await app.inject({
    method: 'DELETE',
    url: '/api/profiles/blk_ben/block',
  })
  assert.equal(noOriginUnblock.statusCode, 403)

  // 拉黑列表只对自己有意义：游客没有「我」。
  const listAnonymous = await app.inject({ method: 'GET', url: '/api/me/blocks' })
  assert.equal(listAnonymous.statusCode, 401)

  // 但搜索是公开发现功能，匿名必须能用（契约 §3）。
  const searchAnonymous = await app.inject({ method: 'GET', url: '/api/users/search?q=blk' })
  assert.equal(searchAnonymous.statusCode, 200, searchAnonymous.body)
})

// ============================================================================
// 2. 拉黑：幂等、删双向关注、计数一致、错误分支
// ============================================================================
test('blocking is idempotent, deletes follows both ways and keeps counts consistent', async () => {
  await resetSocial()

  const annFollows = await follow('ann', 'blk_ben')
  assert.equal(annFollows.statusCode, 200, annFollows.body)
  const benFollows = await follow('ben', 'blk_ann')
  assert.equal(benFollows.statusCode, 200, benFollows.body)

  const before = await admin.query<{ id: string; follower_count: number; following_count: number }>(
    'select id, follower_count, following_count from public.profiles where id = any($1) order by id',
    [[ANN_ID, BEN_ID]],
  )
  assert.deepEqual(
    before.rows.map((row) => [row.follower_count, row.following_count]),
    [
      [1, 1],
      [1, 1],
    ],
  )

  const first = await block('ann', 'blk_ben')
  assert.equal(first.statusCode, 200, first.body)
  assert.deepEqual(first.json(), { blocked: true, removedFollows: 2 })

  const rows = await admin.query<{ n: number }>(
    `select count(*)::int as n from public.follows
      where (follower_id = $1 and followee_id = $2) or (follower_id = $2 and followee_id = $1)`,
    [ANN_ID, BEN_ID],
  )
  assert.equal(rows.rows[0]!.n, 0)

  // 计数由 0022 的 after delete 触发器维护：这里断言「触发器确实跟上了」，
  // 而不只是断言行没了（行没了而计数没减才是真正会伤到用户的那种 bug）。
  const after = await admin.query<{ follower_count: number; following_count: number }>(
    'select follower_count, following_count from public.profiles where id = any($1)',
    [[ANN_ID, BEN_ID]],
  )
  for (const row of after.rows) {
    assert.equal(row.follower_count, 0)
    assert.equal(row.following_count, 0)
  }

  const again = await block('ann', 'blk_ben')
  assert.equal(again.statusCode, 200, again.body)
  assert.deepEqual(again.json(), { blocked: true, removedFollows: 0 })

  const missing = await block('ann', 'no_such_user_x')
  assert.equal(missing.statusCode, 404, missing.body)
  assert.equal(missing.json().code, 'NOT_FOUND')

  const self = await block('ann', 'blk_ann')
  assert.equal(self.statusCode, 400, self.body)
  assert.equal(self.json().code, 'VALIDATION')

  const badName = await block('ann', 'a')
  assert.equal(badName.statusCode, 400)
})

// ============================================================================
// 3. 资料页：被拉黑方向 404，拉黑方 isBlocked=true
// ============================================================================
test('block hides the profile in the blocked direction and flags isBlocked for the blocker', async () => {
  await resetSocial()
  assert.equal((await block('ann', 'blk_ben')).statusCode, 200)

  const asBlocker = await app.inject({
    method: 'GET',
    url: '/api/profiles/by-username/blk_ben',
    headers: readHeaders('ann'),
  })
  assert.equal(asBlocker.statusCode, 200, asBlocker.body)
  const blockerView = asBlocker.json()
  assert.equal(blockerView.isBlocked, true)
  assert.equal(blockerView.username, 'blk_ben')
  // 公开资料投影里不许出现稳定 user UUID（0018 的硬约束，0024 不能破）。
  assert.equal('id' in blockerView, false)
  assert.equal(JSON.stringify(blockerView).includes(BEN_ID), false)

  // 被拉黑方看到的必须是「用户不存在」——不泄露「存在但被拉黑」。
  const asBlocked = await app.inject({
    method: 'GET',
    url: '/api/profiles/by-username/blk_ann',
    headers: readHeaders('ben'),
  })
  assert.equal(asBlocked.statusCode, 404, asBlocked.body)
  assert.equal(asBlocked.json().code, 'NOT_FOUND')
  assert.equal(asBlocked.json().message.includes('拉黑'), false)

  // 第三方与游客完全不受影响。
  const asThird = await app.inject({
    method: 'GET',
    url: '/api/profiles/by-username/blk_ben',
    headers: readHeaders('cate'),
  })
  assert.equal(asThird.statusCode, 200, asThird.body)
  assert.equal(asThird.json().isBlocked, false)

  const asGuest = await app.inject({ method: 'GET', url: '/api/profiles/by-username/blk_ben' })
  assert.equal(asGuest.statusCode, 200, asGuest.body)
  assert.equal(asGuest.json().isBlocked, false)
})

// ============================================================================
// 4. 关注被阻断：文案必须可操作
// ============================================================================
test('block stops follows in both directions with actionable messages', async () => {
  await resetSocial()
  assert.equal((await block('ann', 'blk_ben')).statusCode, 200)

  const annFollows = await follow('ann', 'blk_ben')
  assert.equal(annFollows.statusCode, 403, annFollows.body)
  assert.equal(annFollows.json().code, 'FORBIDDEN')
  assert.equal(annFollows.json().message, '你已拉黑对方')

  const benFollows = await follow('ben', 'blk_ann')
  assert.equal(benFollows.statusCode, 403, benFollows.body)
  assert.equal(benFollows.json().code, 'FORBIDDEN')
  assert.equal(benFollows.json().message, '对方不可关注')

  // 拉黑不影响对第三方的操作。
  assert.equal((await follow('ann', 'blk_cate')).statusCode, 200)

  // 解除后恢复：这是「解除拉黑」对用户唯一有意义的承诺。
  const removed = await unblock('ann', 'blk_ben')
  assert.equal(removed.statusCode, 200, removed.body)
  assert.deepEqual(removed.json(), { blocked: false })
  assert.equal((await follow('ann', 'blk_ben')).statusCode, 200)
})

// ============================================================================
// 5. 动态流：两个方向都过滤
// ============================================================================
test('feed excludes blocked authors in both directions', async () => {
  await resetSocial()

  await insertFollow(ANN_ID, BEN_ID)
  await insertFollow(ANN_ID, CATE_ID)
  await insertFollow(BEN_ID, ANN_ID)

  assert.deepEqual((await feedIds('ann')).sort(), [BEN_PUB1, BEN_PUB2, CATE_PUB].sort())
  assert.deepEqual(await feedIds('ben'), [ANN_PUB])

  assert.equal((await block('ann', 'blk_ben')).statusCode, 200)

  // 拉黑接口会删掉双向关注；这里把关注重新插回去，测的是动态流**自己**的过滤
  // （否则「流里没有他」只是因为关注没了，过滤条件写错也发现不了）。
  await insertFollow(ANN_ID, BEN_ID)
  await insertFollow(BEN_ID, ANN_ID)

  assert.deepEqual(await feedIds('ann'), [CATE_PUB])
  assert.deepEqual(await feedIds('ben'), [])
})

// ============================================================================
// 5b. 关注列表 / 粉丝列表：两个方向都过滤
// ============================================================================
async function listUsernames(
  path: string,
  who: Who,
): Promise<{ status: number; usernames: string[] }> {
  const res = await app.inject({
    method: 'GET',
    url: `${path}?limit=50`,
    headers: readHeaders(who),
  })
  if (res.statusCode !== 200) return { status: res.statusCode, usernames: [] }
  return {
    status: 200,
    usernames: (res.json().items as { username: string }[]).map((item) => item.username),
  }
}

test('followers and following lists hide blocked users in both directions', async () => {
  await resetSocial()

  await insertFollow(ANN_ID, BEN_ID)
  await insertFollow(BEN_ID, ANN_ID)
  await insertFollow(ANN_ID, CATE_ID)

  assert.deepEqual(
    (await listUsernames('/api/profiles/blk_ann/following', 'ann')).usernames.sort(),
    ['blk_ben', 'blk_cate'],
  )
  assert.deepEqual((await listUsernames('/api/profiles/blk_ann/followers', 'ann')).usernames, [
    'blk_ben',
  ])
  assert.deepEqual((await listUsernames('/api/profiles/blk_ben/following', 'ben')).usernames, [
    'blk_ann',
  ])

  assert.equal((await block('ann', 'blk_ben')).statusCode, 200)
  // 拉黑删掉了双向关注，这里重新插回去：测的是列表**自己**的过滤，
  // 而不是「行没了所以看不到」。
  await insertFollow(ANN_ID, BEN_ID)
  await insertFollow(BEN_ID, ANN_ID)

  assert.deepEqual((await listUsernames('/api/profiles/blk_ann/following', 'ann')).usernames, [
    'blk_cate',
  ])
  assert.deepEqual((await listUsernames('/api/profiles/blk_ann/followers', 'ann')).usernames, [])

  // 被拉黑方看自己的列表：资料是自己的，所以不是 404 —— 只是里面没有拉黑者。
  assert.deepEqual((await listUsernames('/api/profiles/blk_ben/following', 'ben')).usernames, [])
  // 被拉黑方看拉黑者的列表：整个社交图谱都不给（404，与「用户不存在」不可区分）。
  assert.equal((await listUsernames('/api/profiles/blk_ann/followers', 'ben')).status, 404)
  assert.equal((await listUsernames('/api/profiles/blk_ann/following', 'ben')).status, 404)

  // 第三方照旧看得到（拉黑是两人之间的事）。
  assert.deepEqual(
    (await listUsernames('/api/profiles/blk_ann/followers', 'cate')).usernames,
    ['blk_ben'],
  )
})

// ============================================================================
// 6. 互动被阻断 + 不产生通知
// ============================================================================
test('block stops likes, favorites and comments and creates no notification', async () => {
  await resetSocial()
  assert.equal((await block('ann', 'blk_ben')).statusCode, 200)

  const like = await app.inject({
    method: 'PUT',
    url: `/api/photos/${ANN_PUB}/like`,
    headers: authHeaders('ben'),
    payload: { liked: true },
  })
  assert.equal(like.statusCode, 403, like.body)
  assert.equal(like.json().code, 'FORBIDDEN')
  assert.equal(like.json().message, '对方已拉黑你或你已拉黑对方，无法互动')

  const favorite = await app.inject({
    method: 'PUT',
    url: `/api/photos/${ANN_PUB}/favorite`,
    headers: authHeaders('ben'),
    payload: { favorited: true },
  })
  assert.equal(favorite.statusCode, 403, favorite.body)
  assert.equal(favorite.json().message, '对方已拉黑你或你已拉黑对方，无法互动')

  const comment = await app.inject({
    method: 'POST',
    url: `/api/photos/${ANN_PUB}/comments`,
    headers: authHeaders('ben'),
    payload: { body: '拉黑之后还能评论吗' },
  })
  assert.equal(comment.statusCode, 403, comment.body)
  assert.equal(comment.json().message, '对方已拉黑你或你已拉黑对方，无法互动')

  // 三次尝试都不该落库、也不该产生通知。
  const leftovers = await admin.query<{ likes: number; favorites: number; comments: number; notes: number }>(
    `select
       (select count(*)::int from public.likes where user_id = $1 and photo_id = $3) as likes,
       (select count(*)::int from public.favorites where user_id = $1 and photo_id = $3) as favorites,
       (select count(*)::int from public.comments where author_id = $1 and photo_id = $3) as comments,
       (select count(*)::int from public.notifications where user_id = $2 and actor_id = $1) as notes`,
    [BEN_ID, ANN_ID, ANN_PUB],
  )
  assert.deepEqual(leftovers.rows[0], { likes: 0, favorites: 0, comments: 0, notes: 0 })

  // 反方向同理（被拉黑的一方也不能点赞拉黑者）。
  assert.equal((await unblock('ann', 'blk_ben')).statusCode, 200)
  assert.equal((await block('ben', 'blk_ann')).statusCode, 200)
  const reverse = await app.inject({
    method: 'PUT',
    url: `/api/photos/${BEN_PUB1}/like`,
    headers: authHeaders('ann'),
    payload: { liked: true },
  })
  assert.equal(reverse.statusCode, 403, reverse.body)

  // 解除后恢复正常，并且通知链路也恢复（说明上面拦的是写入路径，不是通知坏了）。
  assert.equal((await unblock('ben', 'blk_ann')).statusCode, 200)
  const ok = await app.inject({
    method: 'PUT',
    url: `/api/photos/${BEN_PUB1}/like`,
    headers: authHeaders('ann'),
    payload: { liked: true },
  })
  assert.equal(ok.statusCode, 200, ok.body)
  const notes = await admin.query<{ n: number }>(
    'select count(*)::int as n from public.notifications where user_id = $1 and actor_id = $2',
    [BEN_ID, ANN_ID],
  )
  assert.equal(notes.rows[0]!.n, 1)
})

// ============================================================================
// 7. 既有互动保留但互相不可见
// ============================================================================
test('pre-existing interactions stay stored but become mutually invisible', async () => {
  await resetSocial()

  // 拉黑之前：Ben 喜欢了 Ann 的作品，Ann 的主页喜欢列表里能看到。
  const liked = await app.inject({
    method: 'PUT',
    url: `/api/photos/${ANN_PUB}/like`,
    headers: authHeaders('ben'),
    payload: { liked: true },
  })
  assert.equal(liked.statusCode, 200, liked.body)
  assert.deepEqual(await likeIdsIn('blk_ben', 'cate'), [ANN_PUB])

  assert.equal((await block('ann', 'blk_ben')).statusCode, 200)

  // 拉黑方看被拉黑方的列表：空集（资料还在，这类内容不给）。
  assert.deepEqual(await likeIdsIn('blk_ben', 'ann'), [])
  // 被拉黑方看拉黑方的列表：404，与「用户不存在」不可区分。
  const blockedDirection = await app.inject({
    method: 'GET',
    url: '/api/profiles/blk_ann/interactions?kind=likes',
    headers: readHeaders('ben'),
  })
  assert.equal(blockedDirection.statusCode, 404, blockedDirection.body)
  // 第三方不受影响。
  assert.deepEqual(await likeIdsIn('blk_ben', 'cate'), [ANN_PUB])

  // 关键：数据没被删 —— 「互相不可见」是读取侧过滤（契约 §1.6）。
  const kept = await admin.query<{ n: number }>(
    'select count(*)::int as n from public.likes where user_id = $1 and photo_id = $2',
    [BEN_ID, ANN_PUB],
  )
  assert.equal(kept.rows[0]!.n, 1)

  // 解除后原样回来（如果当初是删数据，这里会是空集）。
  assert.equal((await unblock('ann', 'blk_ben')).statusCode, 200)
  assert.deepEqual(await likeIdsIn('blk_ben', 'ann'), [ANN_PUB])
})

// ============================================================================
// 8. 拉黑列表：游标分页 + 解除
// ============================================================================
test('block list paginates newest-first and unblock removes the row', async () => {
  await resetSocial()

  assert.equal((await block('ann', 'blk_ben')).statusCode, 200)
  assert.equal((await block('ann', 'blk_cate')).statusCode, 200)
  assert.equal((await block('ann', 'blk_eve')).statusCode, 200)

  const page1 = await app.inject({
    method: 'GET',
    url: '/api/me/blocks?limit=2',
    headers: readHeaders('ann'),
  })
  assert.equal(page1.statusCode, 200, page1.body)
  const first = page1.json() as { items: Record<string, unknown>[]; total: number; nextCursor: string | null }
  assert.equal(first.total, 3)
  assert.deepEqual(
    first.items.map((item) => item.username),
    ['blk_eve', 'blk_cate'],
  )
  assert.equal(typeof first.nextCursor, 'string')

  for (const item of first.items) {
    // 契约 §3 的 BlockedUser 只有这五个字段，不能夹带 blocked_id。
    assert.deepEqual(Object.keys(item).sort(), ['avatarKey', 'bio', 'blockedAt', 'displayName', 'username'])
    assert.equal(typeof item.blockedAt, 'string')
    assert.equal(Number.isNaN(Date.parse(item.blockedAt as string)), false)
    assert.equal(JSON.stringify(item).includes(EVE_ID), false)
  }

  const page2 = await app.inject({
    method: 'GET',
    url: `/api/me/blocks?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
    headers: readHeaders('ann'),
  })
  assert.equal(page2.statusCode, 200, page2.body)
  const second = page2.json() as { items: { username: string }[]; total: number; nextCursor: string | null }
  assert.deepEqual(
    second.items.map((item) => item.username),
    ['blk_ben'],
  )
  assert.equal(second.total, 3)
  assert.equal(second.nextCursor, null)

  const badCursor = await app.inject({
    method: 'GET',
    url: '/api/me/blocks?cursor=not-a-cursor',
    headers: readHeaders('ann'),
  })
  assert.equal(badCursor.statusCode, 400, badCursor.body)
  assert.equal(badCursor.json().code, 'VALIDATION')

  // 解除：行消失、total 跟着变；重复解除仍然成功（契约 §2）。
  const removed = await unblock('ann', 'blk_cate')
  assert.equal(removed.statusCode, 200, removed.body)
  assert.deepEqual(removed.json(), { blocked: false })

  const afterRemoval = await app.inject({
    method: 'GET',
    url: '/api/me/blocks?limit=50',
    headers: readHeaders('ann'),
  })
  const listed = afterRemoval.json() as { items: { username: string }[]; total: number }
  assert.deepEqual(
    listed.items.map((item) => item.username).sort(),
    ['blk_ben', 'blk_eve'],
  )
  assert.equal(listed.total, 2)

  const again = await unblock('ann', 'blk_cate')
  assert.equal(again.statusCode, 200, again.body)
  assert.deepEqual(again.json(), { blocked: false })

  // 解除后可以重新关注（契约 §1：解除恢复互动）。
  assert.equal((await follow('ann', 'blk_cate')).statusCode, 200)

  const missing = await unblock('ann', 'no_such_user_x')
  assert.equal(missing.statusCode, 404, missing.body)
})

// ============================================================================
// 9. 用户搜索：过滤 + 排序 + 匿名
// ============================================================================
test('user search filters, ranks and works for anonymous visitors', async () => {
  await resetSocial()

  const base = await search('blk', { who: 'ann', limit: 50 })
  assert.equal(base.status, 200)
  // blk_dean 是 discoverable=false：能直达资料页，但不该出现在发现/搜索里。
  assert.deepEqual(ownUsernames(base.items), ['blk_ann', 'blk_ben', 'blk_cate', 'blk_eve', 'zed_blk'])
  // zed_blk 只是「包含」blk（display_name 命中）⇒ 必须排在所有前缀命中之后。
  assert.equal(base.items[base.items.length - 1]!.username, 'zed_blk')
  // 单页返回：total 必须与列表同源（limit 足够大时两者相等）。
  assert.equal(base.total, base.items.length)

  // 前缀命中优先 → 粉丝数倒序 → username 升序。
  assert.equal((await follow('ben', 'blk_cate')).statusCode, 200)
  const ranked = await search('blk', { who: 'ann', limit: 50 })
  assert.deepEqual(ownUsernames(ranked.items), ['blk_cate', 'blk_ann', 'blk_ben', 'blk_eve', 'zed_blk'])
  assert.equal(ranked.items[0]!.followerCount, 1)

  // isFollowing 只对登录用户有意义。
  assert.equal((await follow('ann', 'blk_eve')).statusCode, 200)
  const loggedIn = await search('blk', { who: 'ann', limit: 50 })
  assert.equal(loggedIn.items.find((item) => item.username === 'blk_eve')!.isFollowing, true)
  assert.equal(loggedIn.items.find((item) => item.username === 'blk_cate')!.isFollowing, false)

  // 拉黑过滤：两个方向都搜不到。
  assert.equal((await block('ann', 'blk_ben')).statusCode, 200)
  const blockedSearch = await search('blk', { who: 'ann', limit: 50 })
  // Ann 仍然关注着 Eve（上一步建的），所以 cate / eve 都是 1 个粉丝：
  // 前缀命中 → 粉丝数倒序 → username 升序，eve 排在 ann（0 粉丝）前面。
  assert.deepEqual(ownUsernames(blockedSearch.items), ['blk_cate', 'blk_eve', 'blk_ann', 'zed_blk'])
  assert.deepEqual(
    blockedSearch.items
      .filter((item) => ['blk_cate', 'blk_eve', 'blk_ann'].includes(item.username))
      .map((item) => [item.username, item.followerCount]),
    [
      ['blk_cate', 1],
      ['blk_eve', 1],
      ['blk_ann', 0],
    ],
  )
  assert.equal(blockedSearch.total, blockedSearch.items.length)
  // 第三方照旧能搜到 Ben。
  assert.equal(ownUsernames((await search('blk', { who: 'cate', limit: 50 })).items).includes('blk_ben'), true)
  // 拉黑方自己仍然能被别人搜到（拉黑是单向可见性，不是把自己藏起来）。
  assert.equal(ownUsernames((await search('blk', { who: 'cate', limit: 50 })).items).includes('blk_ann'), true)

  // 匿名：能搜、拿不到 isFollowing，且没有「我」就没有拉黑过滤。
  const anonymous = await search('blk', { limit: 50 })
  assert.equal(anonymous.status, 200)
  assert.equal(ownUsernames(anonymous.items).includes('blk_ben'), true)
  assert.equal(anonymous.items.every((item) => item.isFollowing === false), true)

  // 空关键词 / 超长关键词是「没有结果」，不是错误输入（SQL 侧返回空集）。
  const empty = await search('', { who: 'ann' })
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.items, [])
  assert.equal(empty.total, 0)

  const tooLong = await search('x'.repeat(31), { who: 'ann' })
  assert.equal(tooLong.status, 200)
  assert.deepEqual(tooLong.items, [])

  // 但超过路由的防滥用上限（200）直接 400，不白跑一次 ilike。
  const abusive = await search('x'.repeat(201), { who: 'ann' })
  assert.equal(abusive.status, 400)

  const zero = await search('blk', { who: 'ann', limit: 0 })
  assert.equal(zero.status, 400)

  const clamped = await search('blk', { who: 'ann', limit: 1 })
  assert.equal(clamped.items.length, 1)

  // 转义：% 与 _ 当字面量，不放大成通配符（否则「搜 %」会返回全站用户）。
  const percent = await search('%', { who: 'ann', limit: 50 })
  assert.deepEqual(ownUsernames(percent.items), [])
})
