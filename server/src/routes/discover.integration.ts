/**
 * 发现增强集成测试（0029）——跑在真实 PostgreSQL 上。
 *
 * 覆盖冻结契约 §5 要求的用例：
 *   1) 热门搜索：≥3 次才上榜、窗口外不计、同一词合并大小写、返回最近一次写法；
 *   2) 搜索日志去噪：同一用户同一词 10 分钟内只记一条；
 *   3) 匿名可读三个 GET；非法参数 400 而不是 500；
 *   4) 新作者：窗口内注册 + 有在架作品 + 排除 staff，且**不返回 UUID**；
 *   5) 精选打标/取消：staff 200、写审计、featuredAt 往返正确；
 *   6) 精选流只含精选在架作品，游标分页不重不漏；
 *   7) 越权 403 / 匿名 401 / 非法 uuid 400 / 不存在作品 404；
 *   8) /api/search 正常返回（写日志是异步副产品，不阻塞响应）。
 *
 * 运行（库必须已迁移到 0029）：
 *   PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=gongke_verify_83c PGUSER=app_user \
 *   PGPASSWORD=*** PGADMIN_USER=postgres PGADMIN_PASSWORD=*** \
 *   node --import tsx --test server/src/routes/discover.integration.ts
 *
 * 一次性库请用 .tmp/verify-83c.sh（会先全量应用 supabase/migrations）。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { after, before } from 'node:test'
import pg from 'pg'

const { Client } = pg

const ORIGIN = 'http://127.0.0.1:5173'
const CSRF = 'csrf-token-for-discover-integration'

const AUTHOR_ID = 'd1000000-0000-0000-0000-000000000001'
const NEWBIE_ID = 'd2000000-0000-0000-0000-000000000002'
const OLD_ID = 'd3000000-0000-0000-0000-000000000003'
const STAFF_ID = 'd4000000-0000-0000-0000-000000000004'

const AUTHOR_SECRET = 'discover-author-session-secret-000001'
const NEWBIE_SECRET = 'discover-newbie-session-secret-000002'
const STAFF_SECRET = 'discover-staff-session-secret-0000003'

const PHOTO_IDS = [
  'da000000-0000-0000-0000-000000000001',
  'da000000-0000-0000-0000-000000000002',
  'da000000-0000-0000-0000-000000000003',
  'da000000-0000-0000-0000-000000000004',
  'da000000-0000-0000-0000-000000000005',
] as const
const DRAFT_ONLY_ID = 'da000000-0000-0000-0000-000000000006'

type App = Awaited<ReturnType<(typeof import('../index.js'))['buildApp']>>
type Who = 'author' | 'newbie' | 'staff'

let app: App
let admin: pg.Client
const session: Record<Who, string> = { author: '', newbie: '', staff: '' }
const SECRETS: Record<Who, string> = {
  author: AUTHOR_SECRET,
  newbie: NEWBIE_SECRET,
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

async function seedPhoto(
  id: string,
  authorId: string,
  status: 'published' | 'draft',
  likes: number,
): Promise<void> {
  await admin.query(
    `insert into public.photos
       (id,author_id,title,category_slug,image_key,thumb_key,width,height,status,published_at,like_count,deleted_at)
     values ($1,$2,$3,'landscape',$4,$5,1200,800,$6,$7,$8,null)
     on conflict (id) do update set
       status=excluded.status, published_at=excluded.published_at,
       like_count=excluded.like_count, featured_at=null`,
    [
      id,
      authorId,
      `Discover Photo ${id.slice(-1)}`,
      `photos/${authorId}/${id}/display.webp`,
      `photos/${authorId}/${id}/thumb.webp`,
      status,
      status === 'published' ? new Date(Date.now() - 3_600_000) : null,
      likes,
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

  await admin.query('delete from public.search_logs')
  await admin.query('delete from public.photos where author_id = any($1)', [
    [[AUTHOR_ID, NEWBIE_ID, OLD_ID]],
  ])

  await admin.query(
    `insert into auth.users (id,email) values
       ($1,'discover-author@test.local'),
       ($2,'discover-newbie@test.local'),
       ($3,'discover-old@test.local'),
       ($4,'discover-staff@test.local')
     on conflict (id) do nothing`,
    [AUTHOR_ID, NEWBIE_ID, OLD_ID, STAFF_ID],
  )
  await admin.query(
    `insert into public.profiles (id,username,display_name,visibility,discoverable,role) values
       ($1,'discover_author','Discover Author','public',true,'user'),
       ($2,'discover_newbie','Discover Newbie','public',true,'user'),
       ($3,'discover_old','Discover Old','public',true,'user'),
       ($4,'discover_staff','Discover Staff','public',true,'editor')
     on conflict (id) do update set
       username=excluded.username, display_name=excluded.display_name,
       visibility=excluded.visibility, discoverable=excluded.discoverable,
       role=excluded.role, deleted_at=null`,
    [AUTHOR_ID, NEWBIE_ID, OLD_ID, STAFF_ID],
  )

  // 新作者窗口判定靠 created_at：newbie 在窗口内，old 是很久以前注册的
  await admin.query(`update public.profiles set created_at = now() - interval '1 day' where id = $1`, [
    NEWBIE_ID,
  ])
  await admin.query(`update public.profiles set created_at = now() - interval '800 days' where id = $1`, [
    OLD_ID,
  ])
  await admin.query(`update public.profiles set created_at = now() - interval '2 days' where id = $1`, [
    AUTHOR_ID,
  ])

  let index = 0
  for (const id of PHOTO_IDS) {
    index += 1
    // 前 4 件属于 author、最后 1 件属于 newbie；获赞数递减，便于校验排序
    const owner = index === PHOTO_IDS.length ? NEWBIE_ID : AUTHOR_ID
    await seedPhoto(id, owner, 'published', 10 - index)
  }
  await seedPhoto(DRAFT_ONLY_ID, AUTHOR_ID, 'draft', 0)

  session.author = await seedSession(AUTHOR_ID, AUTHOR_SECRET, 'discover-integration-author')
  session.newbie = await seedSession(NEWBIE_ID, NEWBIE_SECRET, 'discover-integration-newbie')
  session.staff = await seedSession(STAFF_ID, STAFF_SECRET, 'discover-integration-staff')

  const { buildApp } = await import('../index.js')
  app = await buildApp()
  const who = await app.inject({
    method: 'GET',
    url: '/api/auth/session',
    headers: readHeaders('staff'),
  })
  assert.equal(who.statusCode, 200, who.body)
  assert.equal(who.json().userId, STAFF_ID)
})

after(async () => {
  await admin.query('delete from public.search_logs')
  // moderation_actions 是只追加审计表（触发器拒绝 UPDATE/DELETE），不能清理；
  // 一次性库用完即丢，审计行随库一起回收。
  await admin.query('delete from public.photos where author_id = any($1)', [
    [[AUTHOR_ID, NEWBIE_ID, OLD_ID]],
  ])
  // 不能删 STAFF_ID 这个账号：moderation_actions.actor_id 是 on delete set null，
  // 删除会触发一次 UPDATE，而审计表被触发器禁止修改（42501）。
  // 这几个账号只在一次性库里存在，随库回收即可。
  await app?.close()
  await admin?.end()
})

// ============================================================================
// 1. 搜索日志与热门搜索
// ============================================================================
test('hot searches: 只统计 >=3 次的词，窗口外不计，大小写合并并保留最近写法', async () => {
  const insert = (term: string, key: string, minutesAgo: number) =>
    admin.query(
      `insert into public.search_logs (term, term_key, ip_hash, created_at)
       values ($1,$2,'test-ip', now() - make_interval(mins => $3))`,
      [term, key, minutesAgo],
    )

  await admin.query('delete from public.search_logs')
  // Nikon 出现 3 次（大小写不同），其中一次在 30 天前（窗口 7 天外）
  await insert('Nikon', 'nikon', 60)
  await insert('nikon', 'nikon', 30)
  await insert('NIKON', 'nikon', 5)
  await insert('nikon', 'nikon', 30 * 24 * 60)
  // 只出现 2 次，不该上榜
  await insert('fuji', 'fuji', 10)
  await insert('fuji', 'fuji', 20)

  const res = await app.inject({ method: 'GET', url: '/api/discover/hot-searches?days=7&limit=10' })
  assert.equal(res.statusCode, 200, res.body)
  const items = res.json().items as Array<{ term: string; searchCount: number }>

  const nikon = items.find((item) => item.term.toLowerCase() === 'nikon')
  assert.ok(nikon, `Nikon 应上榜，实际：${JSON.stringify(items)}`)
  // 窗口内 3 条（60 分钟前、30 分钟前、5 分钟前）；30 天前那条被窗口排除
  assert.equal(nikon.searchCount, 3)
  // 展示的是最近一次的原始写法（NIKON）
  assert.equal(nikon.term, 'NIKON')
  assert.equal(
    items.some((item) => item.term.toLowerCase() === 'fuji'),
    false,
    '只出现 2 次的词不应上榜',
  )
})

test('log search: 同一用户同一词 10 分钟内只记一条，且空词不落库', async () => {
  await admin.query('delete from public.search_logs')

  for (let i = 0; i < 3; i += 1) {
    await admin.query(`select public.api_log_search('山', $1, 'ip-a')`, [AUTHOR_ID])
  }
  await admin.query(`select public.api_log_search('山', $1, 'ip-a')`, [NEWBIE_ID])
  await admin.query(`select public.api_log_search('   ', $1, 'ip-a')`, [AUTHOR_ID])

  const count = await admin.query<{ n: string }>('select count(*)::text as n from public.search_logs')
  assert.equal(Number(count.rows[0]!.n), 2, '同一用户 3 次只记 1 条，另一个用户再记 1 条，空词不记')
})

// ============================================================================
// 2. 匿名可读 + 参数校验
// ============================================================================
test('public reads: 三个 GET 匿名可读，非法参数返回 400 而不是 500', async () => {
  for (const url of [
    '/api/discover/hot-searches',
    '/api/discover/new-authors',
    '/api/discover/featured',
  ]) {
    const res = await app.inject({ method: 'GET', url })
    assert.equal(res.statusCode, 200, `${url} → ${res.statusCode} ${res.body}`)
  }

  for (const url of [
    '/api/discover/hot-searches?days=abc',
    '/api/discover/hot-searches?limit=1.5',
    '/api/discover/new-authors?days=abc',
    '/api/discover/featured?limit=abc',
    '/api/discover/featured?cursor=not-a-cursor',
  ]) {
    const res = await app.inject({ method: 'GET', url })
    assert.equal(res.statusCode, 400, `${url} 应 400，实际 ${res.statusCode} ${res.body}`)
  }
})

// ============================================================================
// 3. 新作者
// ============================================================================
test('new authors: 只含窗口内注册且有在架作品的非 staff 用户，且不返回 UUID', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/discover/new-authors?days=90&limit=10' })
  assert.equal(res.statusCode, 200, res.body)
  const items = res.json().items as Array<Record<string, unknown>>
  const usernames = items.map((item) => item.username)

  assert.ok(usernames.includes('discover_author'), `应包含 discover_author：${usernames.join(',')}`)
  assert.ok(usernames.includes('discover_newbie'), `应包含 discover_newbie：${usernames.join(',')}`)
  assert.equal(usernames.includes('discover_old'), false, '800 天前注册的不算新作者')
  assert.equal(usernames.includes('discover_staff'), false, 'staff 不进新作者列表')

  // 契约：不含任何 UUID
  for (const item of items) {
    for (const [key, value] of Object.entries(item)) {
      assert.equal(
        typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(value),
        false,
        `字段 ${key} 不应返回 UUID：${String(value)}`,
      )
    }
  }

  // 直接校验：newbie 只有 1 件作品、获赞 5；author 有 4 件、获赞 9+8+7+6 = 30
  const newbie = items.find((item) => item.username === 'discover_newbie')
  const author = items.find((item) => item.username === 'discover_author')
  assert.equal(newbie?.photoCount, 1)
  assert.equal(newbie?.likeTotal, 5)
  assert.equal(author?.photoCount, 4)
  assert.equal(author?.likeTotal, 30)
  assert.ok(
    items.indexOf(author!) <= items.indexOf(newbie!),
    '获赞多的作者应排在新手之前',
  )
})

// ============================================================================
// 4. 编辑精选
// ============================================================================
test('editor choice: staff 打标成功并写审计，取消后回到 null', async () => {
  const photoId = PHOTO_IDS[0]

  const before = await admin.query<{ n: string }>(
    'select count(*)::text as n from public.moderation_actions where target_id = $1',
    [photoId],
  )
  assert.equal(Number(before.rows[0]!.n), 0)

  const featured = await app.inject({
    method: 'POST',
    url: `/api/admin/photos/${photoId}/feature`,
    headers: authHeaders('staff'),
  })
  assert.equal(featured.statusCode, 200, featured.body)
  assert.equal(featured.json().photoId, photoId)
  assert.ok(featured.json().featuredAt)

  const audit1 = await admin.query<{ action_type: string; reason: string }>(
    'select action_type, reason from public.moderation_actions where target_id = $1 order by created_at',
    [photoId],
  )
  assert.equal(audit1.rows.length, 1)
  assert.equal(audit1.rows[0]!.action_type, 'feature')
  assert.equal(audit1.rows[0]!.reason, 'editor_choice')

  const dropped = await app.inject({
    method: 'DELETE',
    url: `/api/admin/photos/${photoId}/feature`,
    headers: authHeaders('staff'),
  })
  assert.equal(dropped.statusCode, 200, dropped.body)
  assert.equal(dropped.json().featuredAt, null)

  const audit2 = await admin.query<{ action_type: string }>(
    'select action_type from public.moderation_actions where target_id = $1 order by created_at',
    [photoId],
  )
  assert.deepEqual(
    audit2.rows.map((row) => row.action_type),
    ['feature', 'unfeature'],
  )
})

test('editor choice: 越权 403、匿名 401、非法 uuid 400、不存在作品 404', async () => {
  const photoId = PHOTO_IDS[1]

  const byUser = await app.inject({
    method: 'POST',
    url: `/api/admin/photos/${photoId}/feature`,
    headers: authHeaders('author'),
  })
  assert.equal(byUser.statusCode, 403, byUser.body)

  // 匿名写请求先被 CSRF/Origin 中间件挡下（403），还没走到 requireUser；
  // 这里断言「一定被拒」，不把中间件顺序写死成某一个状态码。
  const anonymous = await app.inject({
    method: 'POST',
    url: `/api/admin/photos/${photoId}/feature`,
  })
  assert.ok(
    [401, 403].includes(anonymous.statusCode),
    `匿名写应被拒，实际 ${anonymous.statusCode} ${anonymous.body}`,
  )

  const badId = await app.inject({
    method: 'POST',
    url: '/api/admin/photos/not-a-uuid/feature',
    headers: authHeaders('staff'),
  })
  assert.equal(badId.statusCode, 400, badId.body)

  const missing = await app.inject({
    method: 'POST',
    url: '/api/admin/photos/da000000-0000-0000-0000-0000000000ff/feature',
    headers: authHeaders('staff'),
  })
  assert.equal(missing.statusCode, 404, missing.body)

  // 草稿作品不能被精选
  const draft = await app.inject({
    method: 'POST',
    url: `/api/admin/photos/${DRAFT_ONLY_ID}/feature`,
    headers: authHeaders('staff'),
  })
  assert.equal(draft.statusCode, 404, draft.body)
})

test('featured feed: 只含精选在架作品，游标分页不重不漏', async () => {
  // 精选 3 件（第 0 件在上个用例已被取消，这里重新打上）
  for (const id of [PHOTO_IDS[0], PHOTO_IDS[1], PHOTO_IDS[2]]) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/photos/${id}/feature`,
      headers: authHeaders('staff'),
    })
    assert.equal(res.statusCode, 200, res.body)
  }

  // 草稿作品即使被后台直接改 featured_at 也不能出现在公开流里
  await admin.query('update public.photos set featured_at = now() where id = $1', [DRAFT_ONLY_ID])

  const first = await app.inject({ method: 'GET', url: '/api/discover/featured?limit=2' })
  assert.equal(first.statusCode, 200, first.body)
  const firstBody = first.json() as { items: Array<{ id: string }>; nextCursor: string | null }
  assert.equal(firstBody.items.length, 2)
  assert.ok(firstBody.nextCursor, '两页时应给出游标')

  const second = await app.inject({
    method: 'GET',
    url: `/api/discover/featured?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor!)}`,
  })
  assert.equal(second.statusCode, 200, second.body)
  const secondBody = second.json() as { items: Array<{ id: string }>; nextCursor: string | null }
  assert.equal(secondBody.items.length, 1)
  assert.equal(secondBody.nextCursor, null)

  const all = [...firstBody.items, ...secondBody.items].map((item) => item.id)
  assert.deepEqual(new Set(all).size, all.length, '两页之间不应重复')
  assert.deepEqual([...all].sort(), [...PHOTO_IDS.slice(0, 3)].sort(), '应恰好是那 3 件精选作品')
  assert.equal(all.includes(DRAFT_ONLY_ID), false, '草稿作品不得进入精选流')

  // 清理：取消精选，避免影响其它用例
  for (const id of PHOTO_IDS.slice(0, 3)) {
    await app.inject({
      method: 'DELETE',
      url: `/api/admin/photos/${id}/feature`,
      headers: authHeaders('staff'),
    })
  }
})

// ============================================================================
// 5. 搜索接口仍然正常（写日志是异步副产品）
// ============================================================================
test('search: 正常返回结果，并把词写入搜索日志', async () => {
  await admin.query('delete from public.search_logs')

  const res = await app.inject({ method: 'GET', url: '/api/search?q=Discover&limit=5' })
  assert.equal(res.statusCode, 200, res.body)

  // 日志是异步写入，给事件循环一点时间
  let rows = 0
  for (let attempt = 0; attempt < 20 && rows === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25))
    const logged = await admin.query<{ n: string }>(
      `select count(*)::text as n from public.search_logs where term_key = 'discover'`,
    )
    rows = Number(logged.rows[0]!.n)
  }
  assert.equal(rows, 1, '搜索词应被记录一次（异步，不阻塞响应）')
})
