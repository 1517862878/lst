/**
 * 个人主页内容读取集成测试（0023）——跑在真实 PostgreSQL 上。
 *
 * 覆盖用户要求（两条新读取路径）：
 *   1) GET /api/photos?authorUsername=… —— 按用户名拉作品，只含已发布，
 *      与 categorySlug / cursor / limit / sort 同时使用行为不变，
 *      用户名不存在返回空 items 而不是 500；
 *   2) GET /api/profiles/:username/interactions?kind=likes|favorites —— 公开的
 *      喜欢/收藏，尊重 profile 可见性（private 仅本人）、show_likes/show_favorites
 *      开关与 discoverable 语义；游客可读公开数据，未登录读私密账号 404。
 *
 * 运行（与其它 integration 测试一致）：
 *   PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=gongke_test PGUSER=app_user \
 *   PGPASSWORD=*** PGADMIN_USER=postgres PGADMIN_PASSWORD=*** \
 *   node --test --import tsx server/src/routes/profile-interactions.integration.ts
 *
 * 注意：测试库必须已经按 supabase/migrations 全量迁移到 0023。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { after, before } from 'node:test'
import pg from 'pg'

const { Client } = pg

const CSRF = 'csrf-token-for-profile-interactions'

// 用户：alice 公开且两个开关都开；bob 公开但两个开关都关；priv 私密；
// ghost 公开但 discoverable=false（0018 语义：只影响发现，不阻止 username 直达）。
const ALICE_ID = 'c1000000-0000-0000-0000-000000000001'
const BOB_ID = 'c2000000-0000-0000-0000-000000000002'
const PRIV_ID = 'c3000000-0000-0000-0000-000000000003'
const GHOST_ID = 'c4000000-0000-0000-0000-000000000004'

const ALICE_PUB1 = 'cb000000-0000-0000-0000-000000000001'
const ALICE_PUB2 = 'cb000000-0000-0000-0000-000000000002'
const ALICE_PUB3 = 'cb000000-0000-0000-0000-000000000003'
const ALICE_DRAFT = 'cb000000-0000-0000-0000-000000000004'
const ALICE_REMOVED = 'cb000000-0000-0000-0000-000000000005'
const BOB_PUB1 = 'cb000000-0000-0000-0000-000000000006'
const BOB_PUB2 = 'cb000000-0000-0000-0000-000000000007'
const BOB_DRAFT = 'cb000000-0000-0000-0000-000000000008'
const BOB_REMOVED = 'cb000000-0000-0000-0000-000000000009'
const PRIV_PUB1 = 'cb000000-0000-0000-0000-000000000010'
const GHOST_PUB1 = 'cb000000-0000-0000-0000-000000000011'

const ALICE_SECRET = 'pi-alice-session-secret-0000000000001'
const BOB_SECRET = 'pi-bob-session-secret-000000000000002'
const PRIV_SECRET = 'pi-priv-session-secret-0000000000003'

/** 一定不存在的用户名（形状合法）。 */
const NOBODY = 'pi_nobody_zz'

type App = Awaited<ReturnType<(typeof import('../index.js'))['buildApp']>>

let app: App
let admin: pg.Client
const session: Record<'alice' | 'bob' | 'priv', string> = { alice: '', bob: '', priv: '' }

function tokenHash(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

function cookieOf(who: keyof typeof session): string {
  const secrets = { alice: ALICE_SECRET, bob: BOB_SECRET, priv: PRIV_SECRET }
  return `gk_session=${session[who]}.${secrets[who]}; gy_csrf=${CSRF}`
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
  categorySlug: string
  status: 'published' | 'draft' | 'removed'
  ageMinutes: number
}): Promise<void> {
  await admin.query(
    `insert into public.photos
       (id,author_id,title,category_slug,image_key,thumb_key,width,height,status,published_at,deleted_at)
     values ($1,$2,$3,$4,$5,$6,1200,800,$7,$8,$9)
     on conflict (id) do update set
       author_id=excluded.author_id, title=excluded.title, category_slug=excluded.category_slug,
       status=excluded.status, published_at=excluded.published_at, deleted_at=excluded.deleted_at`,
    [
      input.id,
      input.authorId,
      input.title,
      input.categorySlug,
      `photos/${input.authorId}/${input.id}/display.webp`,
      `photos/${input.authorId}/${input.id}/thumb.webp`,
      input.status,
      input.status === 'published' ? new Date(Date.now() - input.ageMinutes * 60_000) : null,
      input.status === 'removed' ? new Date() : null,
    ],
  )
}

/** 直接写互动表（绕开写接口）：只关心读取路径的可见性判定。 */
async function seedInteraction(
  table: 'likes' | 'favorites',
  userId: string,
  photoId: string,
  ageMinutes: number,
): Promise<void> {
  await admin.query(
    `insert into public.${table} (user_id, photo_id, created_at) values ($1,$2,$3)
       on conflict (user_id, photo_id) do update set created_at = excluded.created_at`,
    [userId, photoId, new Date(Date.now() - ageMinutes * 60_000)],
  )
}

/** 读取一个列表接口的全部页，返回拼接后的 id 序列。 */
async function readAllPages(url: string, headers?: Record<string, string>) {
  const ids: string[] = []
  let cursor: string | null = null
  for (let guard = 0; guard < 10; guard += 1) {
    const pageUrl: string = cursor ? `${url}&cursor=${encodeURIComponent(cursor)}` : url
    const res = await app.inject({ method: 'GET', url: pageUrl, ...(headers ? { headers } : {}) })
    assert.equal(res.statusCode, 200, res.body)
    const body = res.json() as { items: { id: string }[]; nextCursor: string | null }
    ids.push(...body.items.map((item) => item.id))
    cursor = body.nextCursor
    if (!cursor) return ids
  }
  throw new Error('翻页没有终止，可能是游标实现有环')
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
      ($1,'pi-alice@test.local',null,'{"display_name":"Pi Alice"}'),
      ($2,'pi-bob@test.local',null,'{"display_name":"Pi Bob"}'),
      ($3,'pi-priv@test.local',null,'{"display_name":"Pi Priv"}'),
      ($4,'pi-ghost@test.local',null,'{"display_name":"Pi Ghost"}')
     on conflict (id) do update set email=excluded.email`,
    [ALICE_ID, BOB_ID, PRIV_ID, GHOST_ID],
  )

  await admin.query(
    `insert into public.profiles
       (id,username,display_name,visibility,show_likes,show_favorites,discoverable) values
      ($1,'pi_alice','Pi Alice','public', true,  true,  true),
      ($2,'pi_bob',  'Pi Bob',  'public', false, false, true),
      ($3,'pi_priv', 'Pi Priv', 'private',true,  true,  false),
      ($4,'pi_ghost','Pi Ghost','public', true,  true,  false)
     on conflict (id) do update set
       username=excluded.username, display_name=excluded.display_name,
       visibility=excluded.visibility, show_likes=excluded.show_likes,
       show_favorites=excluded.show_favorites, discoverable=excluded.discoverable,
       deleted_at=null`,
    [ALICE_ID, BOB_ID, PRIV_ID, GHOST_ID],
  )

  // Alice：3 已发布（2 个 landscape / 1 个 people）+ 草稿 + 已撤回
  await seedPhoto({ id: ALICE_PUB1, authorId: ALICE_ID, title: 'Alice Pub 1', categorySlug: 'landscape', status: 'published', ageMinutes: 10 })
  await seedPhoto({ id: ALICE_PUB2, authorId: ALICE_ID, title: 'Alice Pub 2', categorySlug: 'people', status: 'published', ageMinutes: 20 })
  await seedPhoto({ id: ALICE_PUB3, authorId: ALICE_ID, title: 'Alice Pub 3', categorySlug: 'landscape', status: 'published', ageMinutes: 30 })
  await seedPhoto({ id: ALICE_DRAFT, authorId: ALICE_ID, title: 'Alice Draft', categorySlug: 'landscape', status: 'draft', ageMinutes: 5 })
  await seedPhoto({ id: ALICE_REMOVED, authorId: ALICE_ID, title: 'Alice Removed', categorySlug: 'landscape', status: 'removed', ageMinutes: 6 })
  // Bob：2 已发布 + 草稿 + 已撤回；私密账号与 discoverable=false 账号各 1 张
  await seedPhoto({ id: BOB_PUB1, authorId: BOB_ID, title: 'Bob Pub 1', categorySlug: 'night', status: 'published', ageMinutes: 60 })
  await seedPhoto({ id: BOB_PUB2, authorId: BOB_ID, title: 'Bob Pub 2', categorySlug: 'macro', status: 'published', ageMinutes: 70 })
  await seedPhoto({ id: BOB_DRAFT, authorId: BOB_ID, title: 'Bob Draft', categorySlug: 'night', status: 'draft', ageMinutes: 15 })
  await seedPhoto({ id: BOB_REMOVED, authorId: BOB_ID, title: 'Bob Removed', categorySlug: 'night', status: 'removed', ageMinutes: 16 })
  await seedPhoto({ id: PRIV_PUB1, authorId: PRIV_ID, title: 'Priv Pub 1', categorySlug: 'night', status: 'published', ageMinutes: 40 })
  await seedPhoto({ id: GHOST_PUB1, authorId: GHOST_ID, title: 'Ghost Pub 1', categorySlug: 'architecture', status: 'published', ageMinutes: 50 })

  // 互动残留清干净，保证断言从确定状态出发（照片 id 是本文件独有的，按用户删即可）
  const all = [ALICE_ID, BOB_ID, PRIV_ID, GHOST_ID]
  await admin.query(`delete from public.likes where user_id = any($1)`, [all])
  await admin.query(`delete from public.favorites where user_id = any($1)`, [all])

  // Alice 的点赞：3 条可见（bob1 最早 → priv1 最新）+ 1 条草稿（必须被过滤）
  await seedInteraction('likes', ALICE_ID, BOB_PUB1, 180)
  await seedInteraction('likes', ALICE_ID, BOB_PUB2, 120)
  await seedInteraction('likes', ALICE_ID, PRIV_PUB1, 60)
  await seedInteraction('likes', ALICE_ID, BOB_DRAFT, 30)
  // Alice 的收藏：1 条可见 + 1 条已撤回（必须被过滤）
  await seedInteraction('favorites', ALICE_ID, BOB_PUB1, 120)
  await seedInteraction('favorites', ALICE_ID, BOB_REMOVED, 60)
  // Bob（开关全关）：本人可见，他人空集
  await seedInteraction('likes', BOB_ID, ALICE_PUB1, 60)
  await seedInteraction('favorites', BOB_ID, ALICE_PUB2, 60)
  // 私密账号：本人可见，他人 404
  await seedInteraction('likes', PRIV_ID, ALICE_PUB1, 30)
  // discoverable=false 的公开账号：按 username 仍应可达（0018 语义）
  await seedInteraction('likes', GHOST_ID, ALICE_PUB1, 45)

  // 测试可重复执行：refresh_token_hash 上有唯一约束，而 api_create_session 不做 upsert，
  // 所以先把本文件上一轮留下的会话清掉（否则第二次跑就 23505）。
  await admin.query(`delete from public.security_sessions where refresh_token_hash = any($1::text[])`, [
    [ALICE_SECRET, BOB_SECRET, PRIV_SECRET].map(tokenHash),
  ])

  session.alice = await seedSession(ALICE_ID, ALICE_SECRET, 'pi-integration-alice')
  session.bob = await seedSession(BOB_ID, BOB_SECRET, 'pi-integration-bob')
  session.priv = await seedSession(PRIV_ID, PRIV_SECRET, 'pi-integration-priv')

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
// 1. GET /api/photos?authorUsername=…：只含已发布
// ============================================================================
test('photos by authorUsername contain only published photos of that author', async () => {
  const res = await app.inject({ method: 'GET', url: `/api/photos?authorUsername=pi_alice&limit=50` })
  assert.equal(res.statusCode, 200, res.body)
  const body = res.json() as {
    items: { id: string; authorId: string; status: string }[]
    total: number
    nextCursor: string | null
  }

  assert.deepEqual(
    body.items.map((item) => item.id).sort(),
    [ALICE_PUB1, ALICE_PUB2, ALICE_PUB3].sort(),
  )
  assert.equal(body.total, 3)
  assert.equal(body.nextCursor, null)
  for (const item of body.items) {
    assert.equal(item.status, 'published')
    assert.equal(item.authorId, ALICE_ID)
  }
  // 草稿与已撤回不能出现
  assert.ok(!body.items.some((item) => item.id === ALICE_DRAFT || item.id === ALICE_REMOVED))

  // 响应形状沿用现有分页惯例
  assert.deepEqual(Object.keys(res.json()).sort(), ['items', 'nextCursor', 'total'])
})

test('authorUsername is case-insensitive and composes with existing filters', async () => {
  // citext：大小写不敏感
  const upper = await app.inject({ method: 'GET', url: '/api/photos?authorUsername=PI_ALICE&limit=50' })
  assert.equal(upper.statusCode, 200, upper.body)
  assert.equal(upper.json().total, 3)

  const mixed = await app.inject({ method: 'GET', url: '/api/photos?authorUsername=Pi_AlIcE&limit=50' })
  assert.equal(mixed.statusCode, 200, mixed.body)
  assert.equal(mixed.json().total, 3)

  // 与 categorySlug 叠加
  const landscape = await app.inject({
    method: 'GET',
    url: '/api/photos?authorUsername=pi_alice&categorySlug=landscape&limit=50',
  })
  assert.equal(landscape.statusCode, 200, landscape.body)
  assert.deepEqual(
    landscape.json().items.map((item: { id: string }) => item.id).sort(),
    [ALICE_PUB1, ALICE_PUB3].sort(),
  )
  assert.equal(landscape.json().total, 2)

  // 与 sort 叠加：行为与不带 authorUsername 时一致（仍是 latest/popular 语义）
  const popular = await app.inject({
    method: 'GET',
    url: '/api/photos?authorUsername=pi_alice&sort=popular&limit=50',
  })
  assert.equal(popular.statusCode, 200, popular.body)
  assert.equal(popular.json().total, 3)

  // 与 cursor/limit 叠加：翻页拿到的并集恰好是全部 3 张，且不重复
  const paged = await readAllPages('/api/photos?authorUsername=pi_alice&limit=1')
  assert.deepEqual(paged.sort(), [ALICE_PUB1, ALICE_PUB2, ALICE_PUB3].sort())
})

test('unknown authorUsername yields an empty page, never a 500', async () => {
  const missing = await app.inject({ method: 'GET', url: `/api/photos?authorUsername=${NOBODY}` })
  assert.equal(missing.statusCode, 200, missing.body)
  assert.deepEqual(missing.json().items, [])
  assert.equal(missing.json().total, 0)
  assert.equal(missing.json().nextCursor, null)

  // 形状不合法的用户名同样只是「查不到」→ 空列表（不制造 400 分支）
  const weird = await app.inject({ method: 'GET', url: '/api/photos?authorUsername=%40%40%40' })
  assert.equal(weird.statusCode, 200, weird.body)
  assert.deepEqual(weird.json().items, [])

  // 病态超长输入走校验（护栏，不是 500）
  const tooLong = await app.inject({
    method: 'GET',
    url: `/api/photos?authorUsername=${'a'.repeat(80)}`,
  })
  assert.equal(tooLong.statusCode, 400)
  assert.equal(tooLong.json().code, 'VALIDATION')
})

test('photos by username keep the existing anonymous-visibility semantics', async () => {
  // 私密账号的「已发布作品」在现有 RLS 语义下对匿名可见：按作者列作品不额外做资料可见性过滤
  const priv = await app.inject({ method: 'GET', url: '/api/photos?authorUsername=pi_priv&limit=50' })
  assert.equal(priv.statusCode, 200, priv.body)
  assert.deepEqual(priv.json().items.map((item: { id: string }) => item.id), [PRIV_PUB1])

  // discoverable=false 只影响发现/搜索，不阻止按 username 直达（0018 语义）
  const ghost = await app.inject({ method: 'GET', url: '/api/photos?authorUsername=pi_ghost&limit=50' })
  assert.equal(ghost.statusCode, 200, ghost.body)
  assert.deepEqual(ghost.json().items.map((item: { id: string }) => item.id), [GHOST_PUB1])

  // 关闭互动开关不影响作品列表：bob 的已发布作品照样能按用户名拉到
  const bob = await app.inject({ method: 'GET', url: '/api/photos?authorUsername=pi_bob&limit=50' })
  assert.equal(bob.statusCode, 200, bob.body)
  assert.deepEqual(
    bob.json().items.map((item: { id: string }) => item.id).sort(),
    [BOB_PUB1, BOB_PUB2].sort(),
  )
})

// ============================================================================
// 2. GET /api/profiles/:username/interactions：公开的喜欢 / 收藏
// ============================================================================
test('guest can read a public profile likes/favorites, published photos only', async () => {
  const likes = await app.inject({ method: 'GET', url: '/api/profiles/pi_alice/interactions?kind=likes' })
  assert.equal(likes.statusCode, 200, likes.body)
  const likesBody = likes.json() as { items: { id: string; status: string }[]; nextCursor: string | null }

  // 按互动时间倒序；草稿那张（点赞时间最新）必须被过滤掉
  assert.deepEqual(likesBody.items.map((item) => item.id), [PRIV_PUB1, BOB_PUB2, BOB_PUB1])
  assert.ok(!likesBody.items.some((item) => item.id === BOB_DRAFT))
  for (const item of likesBody.items) assert.equal(item.status, 'published')
  assert.equal(likesBody.nextCursor, null)
  assert.deepEqual(Object.keys(likes.json()).sort(), ['items', 'nextCursor'])

  // 收藏：已撤回的那张必须被过滤掉
  const favorites = await app.inject({
    method: 'GET',
    url: '/api/profiles/pi_alice/interactions?kind=favorites',
  })
  assert.equal(favorites.statusCode, 200, favorites.body)
  assert.deepEqual(favorites.json().items.map((item: { id: string }) => item.id), [BOB_PUB1])
  assert.equal(favorites.json().nextCursor, null)

  // 用户名大小写不敏感（citext）
  const upper = await app.inject({
    method: 'GET',
    url: '/api/profiles/PI_ALICE/interactions?kind=likes',
  })
  assert.equal(upper.statusCode, 200, upper.body)
  assert.deepEqual(upper.json().items.map((item: { id: string }) => item.id), [PRIV_PUB1, BOB_PUB2, BOB_PUB1])

  // 资料可见但没有公开的这类互动 → 200 + 空 items（不是 404）
  const empty = await app.inject({
    method: 'GET',
    url: '/api/profiles/pi_ghost/interactions?kind=favorites',
  })
  assert.equal(empty.statusCode, 200, empty.body)
  assert.deepEqual(empty.json().items, [])
})

test('private profile interactions are invisible to guests and other users, visible to the owner', async () => {
  const guest = await app.inject({ method: 'GET', url: '/api/profiles/pi_priv/interactions?kind=likes' })
  assert.equal(guest.statusCode, 404)
  assert.equal(guest.json().code, 'NOT_FOUND')

  const other = await app.inject({
    method: 'GET',
    url: '/api/profiles/pi_priv/interactions?kind=likes',
    headers: readHeaders('alice'),
  })
  assert.equal(other.statusCode, 404)

  const owner = await app.inject({
    method: 'GET',
    url: '/api/profiles/pi_priv/interactions?kind=likes',
    headers: readHeaders('priv'),
  })
  assert.equal(owner.statusCode, 200, owner.body)
  assert.deepEqual(owner.json().items.map((item: { id: string }) => item.id), [ALICE_PUB1])

  // 「不存在」与「不可见」必须无法区分（否则可以拿它探测私密账号是否存在）
  const nobody = await app.inject({ method: 'GET', url: `/api/profiles/${NOBODY}/interactions?kind=likes` })
  assert.equal(nobody.statusCode, 404)
  assert.deepEqual(nobody.json(), guest.json())
})

test('show_likes/show_favorites off hides interactions from others but not from the owner', async () => {
  const url = (kind: string) => `/api/profiles/pi_bob/interactions?kind=${kind}`

  const guestLikes = await app.inject({ method: 'GET', url: url('likes') })
  assert.equal(guestLikes.statusCode, 200, guestLikes.body)
  assert.deepEqual(guestLikes.json().items, [])

  const otherLikes = await app.inject({ method: 'GET', url: url('likes'), headers: readHeaders('alice') })
  assert.equal(otherLikes.statusCode, 200, otherLikes.body)
  assert.deepEqual(otherLikes.json().items, [])

  const guestFavorites = await app.inject({ method: 'GET', url: url('favorites') })
  assert.equal(guestFavorites.statusCode, 200, guestFavorites.body)
  assert.deepEqual(guestFavorites.json().items, [])

  // 本人看得到（开关只影响他人）
  const ownerLikes = await app.inject({ method: 'GET', url: url('likes'), headers: readHeaders('bob') })
  assert.equal(ownerLikes.statusCode, 200, ownerLikes.body)
  assert.deepEqual(ownerLikes.json().items.map((item: { id: string }) => item.id), [ALICE_PUB1])

  const ownerFavorites = await app.inject({
    method: 'GET',
    url: url('favorites'),
    headers: readHeaders('bob'),
  })
  assert.equal(ownerFavorites.statusCode, 200, ownerFavorites.body)
  assert.deepEqual(ownerFavorites.json().items.map((item: { id: string }) => item.id), [ALICE_PUB2])
})

test('discoverable=false public account stays reachable by exact username', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/profiles/pi_ghost/interactions?kind=likes' })
  assert.equal(res.statusCode, 200, res.body)
  assert.deepEqual(res.json().items.map((item: { id: string }) => item.id), [ALICE_PUB1])
})

test('interactions list paginates with the shared {items,nextCursor} cursor', async () => {
  const first = await app.inject({
    method: 'GET',
    url: '/api/profiles/pi_alice/interactions?kind=likes&limit=2',
  })
  assert.equal(first.statusCode, 200, first.body)
  const firstBody = first.json() as { items: { id: string }[]; nextCursor: string | null }
  assert.equal(firstBody.items.length, 2)
  assert.ok(firstBody.nextCursor, 'limit 小于总数时必须给出 nextCursor')

  const second = await app.inject({
    method: 'GET',
    url: `/api/profiles/pi_alice/interactions?kind=likes&limit=2&cursor=${encodeURIComponent(String(firstBody.nextCursor))}`,
  })
  assert.equal(second.statusCode, 200, second.body)
  const secondBody = second.json() as { items: { id: string }[]; nextCursor: string | null }
  assert.equal(secondBody.nextCursor, null)

  const all = [...firstBody.items, ...secondBody.items].map((item) => item.id)
  assert.deepEqual(all, [PRIV_PUB1, BOB_PUB2, BOB_PUB1])

  // 非法游标报 400，而不是静默从头开始（会导致重复数据）
  const badCursor = await app.inject({
    method: 'GET',
    url: '/api/profiles/pi_alice/interactions?kind=likes&cursor=not-a-cursor',
  })
  assert.equal(badCursor.statusCode, 400)
  assert.equal(badCursor.json().code, 'VALIDATION')
})

test('interactions list validates kind, limit and username', async () => {
  const missing = await app.inject({ method: 'GET', url: '/api/profiles/pi_alice/interactions' })
  assert.equal(missing.statusCode, 400)
  assert.equal(missing.json().code, 'VALIDATION')

  const badKind = await app.inject({
    method: 'GET',
    url: '/api/profiles/pi_alice/interactions?kind=bookmarks',
  })
  assert.equal(badKind.statusCode, 400)
  assert.equal(badKind.json().code, 'VALIDATION')

  const badLimit = await app.inject({
    method: 'GET',
    url: '/api/profiles/pi_alice/interactions?kind=likes&limit=0',
  })
  assert.equal(badLimit.statusCode, 400)

  // 只做长度护栏（与 /api/profiles/by-username/:username 完全一致）：
  // 长度合法但库里没有这个名字 → 走「查不到」分支 = 404，而不是 400。
  const shortName = await app.inject({ method: 'GET', url: '/api/profiles/pi/interactions?kind=likes' })
  assert.equal(shortName.statusCode, 404)
  assert.equal(shortName.json().code, 'NOT_FOUND')

  const tooLongName = await app.inject({
    method: 'GET',
    url: `/api/profiles/${'a'.repeat(30)}/interactions?kind=likes`,
  })
  assert.equal(tooLongName.statusCode, 400)
  assert.equal(tooLongName.json().code, 'VALIDATION')
})
