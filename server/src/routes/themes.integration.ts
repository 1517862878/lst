/**
 * 每周主题与活动集成测试（0036 / 8.4d）——跑在真实 PostgreSQL 上。
 *
 * 覆盖冻结契约 §5 第 2 条要求的全部场景：
 *   1) 公开读取：三档列表、详情、投稿网格、草稿主题对非编辑 404、非法 slug 404；
 *   2) 投稿：成功 / 未登录 401 / 非本人作品 404 / 未发布 400 / 不存在 404 /
 *      重复 409 / 每人 3 件上限 422 LIMIT_EXCEEDED；
 *   3) 撤回：成功 204、非本人 404、已精选 403、投稿期已结束 409；
 *   4) 编辑：建主题（缺省 draft）、第二个 active 主题 409、字段校验 400、
 *      权限 403/401；PATCH 局部更新（未传字段必须保留原值）、slug 不可改 400；
 *   5) 精选：写入 isSelected/note、作者收到 kind='system' 通知（重复选中不重复发、
 *      取消精选不发）、selected=1 过滤与排序；
 *   6) 写接口的 Origin/CSRF 校验链（403）与限流拒绝必须是 429 + RATE_LIMIT。
 *
 * 运行（一次性库请用 .tmp/verify-84d.sh，它会先全量应用 supabase/migrations）：
 *   bash .tmp/verify-84d.sh src/routes/themes.integration.ts
 * 或手工：
 *   PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=gongke_84d PGUSER=app_user \
 *   PGPASSWORD=*** PGADMIN_USER=postgres PGADMIN_PASSWORD=*** STORAGE_CLEANUP_ENABLED=false \
 *   node --import tsx --test --test-concurrency=1 src/routes/themes.integration.ts
 *
 * 注意（踩过的坑）：本文件的用户/作品/主题 id 都带自己的前缀，且**不复用别的套件
 * 会改状态的同一件作品** —— photos/主题被别的套件改了状态，这里就会连带失败。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { after, before } from 'node:test'
import pg from 'pg'

const { Client } = pg

const ORIGIN = 'http://127.0.0.1:5173'
const CSRF = 'csrf-token-for-themes-integration'

const ALICE_ID = 'e1000000-0000-0000-0000-000000000001'
const BOB_ID = 'e2000000-0000-0000-0000-000000000002'
const STAFF_ID = 'e3000000-0000-0000-0000-000000000003'

/** alice 的 4 件已发布作品：A1..A3 用来撞「每人 3 件」上限，A4 是第 4 件。 */
const A1 = 'ea000000-0000-0000-0000-000000000001'
const A2 = 'ea000000-0000-0000-0000-000000000002'
const A3 = 'ea000000-0000-0000-0000-000000000003'
const A4 = 'ea000000-0000-0000-0000-000000000004'
/** 用来验证「只能投稿已发布的作品」。 */
const A5 = 'ea000000-0000-0000-0000-000000000005'
const A_DRAFT = 'ea000000-0000-0000-0000-000000000006'
const A_REMOVED = 'ea000000-0000-0000-0000-000000000007'
/** bob 的已发布作品：验证「非本人作品 = 404」。 */
const B1 = 'eb000000-0000-0000-0000-000000000001'

const ALL_PHOTOS = [A1, A2, A3, A4, A5, A_DRAFT, A_REMOVED, B1] as const

const OPEN_ID = 'f1000000-0000-0000-0000-000000000001'
const PAST_ID = 'f1000000-0000-0000-0000-000000000002'
const DRAFT_ID = 'f1000000-0000-0000-0000-000000000003'

const OPEN_SLUG = 'th-open-84d'
const PAST_SLUG = 'th-past-84d'
const DRAFT_SLUG = 'th-draft-84d'
const NEW_SLUG = 'th-new-84d'
const UNKNOWN_SLUG = 'th-nope-84d'

const ALICE_SECRET = 'themes-alice-session-secret-0000000001'
const BOB_SECRET = 'themes-bob-session-secret-000000000002'
const STAFF_SECRET = 'themes-staff-session-secret-0000000003'

const DAY = 86_400_000
const at = (days: number): Date => new Date(Date.now() + days * DAY)

type App = Awaited<ReturnType<(typeof import('../index.js'))['buildApp']>>
type Who = 'alice' | 'bob' | 'staff'
type ThemeStatus = 'draft' | 'active' | 'closed'

let app: App
let admin: pg.Client
const session: Record<Who, string> = { alice: '', bob: '', staff: '' }
const SECRETS: Record<Who, string> = { alice: ALICE_SECRET, bob: BOB_SECRET, staff: STAFF_SECRET }

/** 跨用例传递：POST /api/admin/themes 建出来的新主题 id（用例按声明顺序串行执行）。 */
let createdThemeId = ''

function tokenHash(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

function cookieOf(who: Who): string {
  // gy_csrf 是双提交 cookie：请求安全中间件要求它与 x-csrf-token 头一致。
  return `gk_session=${session[who]}.${SECRETS[who]}; gy_csrf=${CSRF}`
}

function authHeaders(who: Who) {
  return { origin: ORIGIN, cookie: cookieOf(who), 'x-csrf-token': CSRF }
}

function readHeaders(who: Who) {
  return { cookie: cookieOf(who) }
}

/** 匿名写请求：必须带可信 Origin（否则先被 403），但没有会话 cookie。 */
function anonWriteHeaders() {
  return { origin: ORIGIN }
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
  status: 'published' | 'draft' | 'removed',
): Promise<void> {
  await admin.query(
    `insert into public.photos
       (id,author_id,title,category_slug,image_key,thumb_key,width,height,status,published_at,deleted_at)
     values ($1,$2,$3,'landscape',$4,$5,1200,800,$6,$7,$8)
     on conflict (id) do update set
       author_id=excluded.author_id, status=excluded.status,
       published_at=excluded.published_at, deleted_at=excluded.deleted_at`,
    [
      id,
      authorId,
      `Theme Photo ${id.slice(-1)}`,
      `photos/${authorId}/${id}/display.webp`,
      `photos/${authorId}/${id}/thumb.webp`,
      status,
      status === 'published' ? new Date(Date.now() - 3_600_000) : null,
      status === 'removed' ? new Date() : null,
    ],
  )
}

interface ThemeSeed {
  id: string
  slug: string
  title: string
  status: ThemeStatus
  startsAt: Date
  endsAt: Date
  description?: string
  rules?: string
  resultNote?: string
}

/** 主题一律用 SQL 直插：POST /api/admin/themes 的新建路径另有专门用例。 */
async function seedTheme(seed: ThemeSeed): Promise<void> {
  await admin.query(
    `insert into public.photo_themes
       (id,slug,title,description,rules,status,starts_at,ends_at,result_note,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (id) do update set
       slug=excluded.slug, title=excluded.title, description=excluded.description,
       rules=excluded.rules, status=excluded.status, starts_at=excluded.starts_at,
       ends_at=excluded.ends_at, result_note=excluded.result_note, cover_photo_id=null`,
    [
      seed.id,
      seed.slug,
      seed.title,
      seed.description ?? '本周主题说明',
      seed.rules ?? '投稿规则原文',
      seed.status,
      seed.startsAt,
      seed.endsAt,
      seed.resultNote ?? '',
      STAFF_ID,
    ],
  )
}

/** 主题窗口（重启一个确定的起点）。 */
async function setWindow(id: string, startsAt: Date, endsAt: Date): Promise<void> {
  await admin.query(`update public.photo_themes set starts_at=$2, ends_at=$3 where id=$1`, [
    id,
    startsAt,
    endsAt,
  ])
}

async function countNotifications(userId: string, photoId: string): Promise<number> {
  const result = await admin.query<{ n: string }>(
    `select count(*)::text as n from public.notifications
      where user_id=$1 and kind='system' and photo_id=$2`,
    [userId, photoId],
  )
  return Number(result.rows[0]!.n)
}

/** 让每个用例从确定状态出发：本套件自己的投稿、主题、通知全部清掉。 */
async function resetOwnData(): Promise<void> {
  await admin.query(
    `delete from public.theme_entries where submitted_by = any($1) or photo_id = any($2)`,
    [[ALICE_ID, BOB_ID, STAFF_ID], [...ALL_PHOTOS]],
  )
  await admin.query(`delete from public.photo_themes where created_by = $1`, [STAFF_ID])
  await admin.query(
    `delete from public.notifications where user_id = any($1) or actor_id = any($1)`,
    [[ALICE_ID, BOB_ID, STAFF_ID]],
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

  await admin.query(
    `insert into auth.users (id,email,raw_user_meta_data) values
       ($1,'theme-alice@test.local','{"display_name":"Theme Alice"}'),
       ($2,'theme-bob@test.local','{"display_name":"Theme Bob"}'),
       ($3,'theme-staff@test.local','{"display_name":"Theme Staff"}')
     on conflict (id) do nothing`,
    [ALICE_ID, BOB_ID, STAFF_ID],
  )
  await admin.query(
    `insert into public.profiles (id,username,display_name,visibility,discoverable,role) values
       ($1,'theme_alice','Theme Alice','public',true,'user'),
       ($2,'theme_bob','Theme Bob','public',true,'user'),
       ($3,'theme_staff','Theme Staff','public',true,'editor')
     on conflict (id) do update set
       username=excluded.username, display_name=excluded.display_name,
       visibility=excluded.visibility, discoverable=excluded.discoverable,
       role=excluded.role, deleted_at=null`,
    [ALICE_ID, BOB_ID, STAFF_ID],
  )

  for (const id of [A1, A2, A3, A4, A5]) await seedPhoto(id, ALICE_ID, 'published')
  await seedPhoto(A_DRAFT, ALICE_ID, 'draft')
  await seedPhoto(A_REMOVED, ALICE_ID, 'removed')
  await seedPhoto(B1, BOB_ID, 'published')

  await resetOwnData()

  // 进行中的主题（唯一一个 status='active'：部分唯一索引不允许第二个）。
  await seedTheme({
    id: OPEN_ID,
    slug: OPEN_SLUG,
    title: '本周主题：夜行',
    status: 'active',
    startsAt: at(-2),
    endsAt: at(5),
  })
  // 已结束的主题（closed ⇒ 落在 past 桶）。
  await seedTheme({
    id: PAST_ID,
    slug: PAST_SLUG,
    title: '上周主题：静物',
    status: 'closed',
    startsAt: at(-30),
    endsAt: at(-23),
    resultNote: '入选理由：光比干净',
  })
  // 草稿：公开读不到，编辑/后台看得见。
  await seedTheme({
    id: DRAFT_ID,
    slug: DRAFT_SLUG,
    title: '下周主题：雨',
    status: 'draft',
    startsAt: at(9),
    endsAt: at(16),
  })

  session.alice = await seedSession(ALICE_ID, ALICE_SECRET, 'themes-integration-alice')
  session.bob = await seedSession(BOB_ID, BOB_SECRET, 'themes-integration-bob')
  session.staff = await seedSession(STAFF_ID, STAFF_SECRET, 'themes-integration-staff')

  const { buildApp } = await import('../index.js')
  app = await buildApp()
  const who = await app.inject({
    method: 'GET',
    url: '/api/auth/session',
    headers: readHeaders('alice'),
  })
  assert.equal(who.statusCode, 200, who.body)
  assert.equal(who.json().userId, ALICE_ID)
})

after(async () => {
  await resetOwnData()
  await admin.query('delete from public.photos where id = any($1)', [[...ALL_PHOTOS]])
  await admin.query('delete from auth.users where id = any($1)', [[ALICE_ID, BOB_ID, STAFF_ID]])
  await app?.close()
  await admin?.end()
})

// ============================================================================
// 1. 公开读取：列表三档
// ============================================================================

interface ThemeSummaryShape {
  id: string
  slug: string
  title: string
  description: string
  status: ThemeStatus
  startsAt: string | null
  endsAt: string | null
  coverPhotoId: string | null
  entryCount: number
  selectedCount: number
}

test('themes: 默认列表含进行中与往期，不含草稿；三档过滤各自生效', async () => {
  const all = await app.inject({ method: 'GET', url: '/api/themes' })
  assert.equal(all.statusCode, 200, all.body)
  const allSlugs = (all.json() as { items: ThemeSummaryShape[] }).items.map((item) => item.slug)
  assert.ok(allSlugs.includes(OPEN_SLUG), all.body)
  assert.ok(allSlugs.includes(PAST_SLUG), all.body)
  assert.ok(!allSlugs.includes(DRAFT_SLUG), '草稿不能出现在公开列表里')

  const open = (
    await app.inject({ method: 'GET', url: '/api/themes?status=active' })
  ).json() as { items: ThemeSummaryShape[] }
  assert.equal(open.items.length, 1, JSON.stringify(open))
  const theme = open.items[0]!
  assert.equal(theme.slug, OPEN_SLUG)
  assert.equal(theme.status, 'active')
  assert.equal(theme.title, '本周主题：夜行')
  assert.equal(theme.description, '本周主题说明')
  assert.equal(theme.entryCount, 0)
  assert.equal(theme.selectedCount, 0)
  assert.equal(theme.coverPhotoId, null)
  assert.ok(theme.startsAt && Date.parse(theme.startsAt) > 0)
  assert.ok(theme.endsAt && Date.parse(theme.endsAt) > 0)
  // 列表 DTO 不带 rules/resultNote（那是详情的事）
  assert.equal((theme as unknown as { rules?: string }).rules, undefined)

  const past = (
    await app.inject({ method: 'GET', url: '/api/themes?status=past' })
  ).json() as { items: ThemeSummaryShape[] }
  assert.deepEqual(
    past.items.map((item) => item.slug),
    [PAST_SLUG],
  )

  const upcoming = (
    await app.inject({ method: 'GET', url: '/api/themes?status=upcoming' })
  ).json() as { items: ThemeSummaryShape[] }
  // 此刻唯一一个 active 主题正在窗口内 ⇒ upcoming 桶是空的（见下一个用例的翻转）
  assert.deepEqual(upcoming.items, [])

  const bad = await app.inject({ method: 'GET', url: '/api/themes?status=whatever' })
  assert.equal(bad.statusCode, 400, bad.body)
  assert.equal(bad.json().code, 'VALIDATION')
  assert.match(bad.json().message, /active \/ upcoming \/ past/)
})

test('themes: upcoming 桶 = status active 但还没开始（临时改窗口再改回）', async () => {
  await setWindow(OPEN_ID, at(3), at(10))
  try {
    const upcoming = (
      await app.inject({ method: 'GET', url: '/api/themes?status=upcoming' })
    ).json() as { items: ThemeSummaryShape[] }
    assert.deepEqual(
      upcoming.items.map((item) => item.slug),
      [OPEN_SLUG],
    )

    const active = (
      await app.inject({ method: 'GET', url: '/api/themes?status=active' })
    ).json() as { items: ThemeSummaryShape[] }
    assert.deepEqual(active.items, [])
  } finally {
    await setWindow(OPEN_ID, at(-2), at(5))
  }
})

// ============================================================================
// 2. 公开读取：详情 / 草稿可见性 / 404 / 非法 slug
// ============================================================================

test('themes: 详情返回 rules/resultNote/isOpen；草稿对非编辑 404、对编辑可见', async () => {
  const open = await app.inject({ method: 'GET', url: `/api/themes/${OPEN_SLUG}` })
  assert.equal(open.statusCode, 200, open.body)
  const detail = (open.json() as { theme: Record<string, unknown> }).theme
  assert.equal(detail.slug, OPEN_SLUG)
  assert.equal(detail.rules, '投稿规则原文')
  assert.equal(detail.resultNote, '')
  assert.equal(detail.isOpen, true)

  const past = (
    await app.inject({ method: 'GET', url: `/api/themes/${PAST_SLUG}` })
  ).json() as { theme: Record<string, unknown> }
  assert.equal(past.theme.isOpen, false)
  assert.equal(past.theme.resultNote, '入选理由：光比干净')
  assert.equal(past.theme.status, 'closed')

  // 草稿：匿名与普通用户都 404（不泄露存在性），编辑看得见
  for (const [label, headers] of [
    ['匿名', undefined],
    ['普通用户', readHeaders('alice')],
  ] as const) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/themes/${DRAFT_SLUG}`,
      ...(headers ? { headers } : {}),
    })
    assert.equal(res.statusCode, 404, `${label}: ${res.body}`)
    assert.equal(res.json().code, 'NOT_FOUND')
  }

  const staffView = await app.inject({
    method: 'GET',
    url: `/api/themes/${DRAFT_SLUG}`,
    headers: readHeaders('staff'),
  })
  assert.equal(staffView.statusCode, 200, staffView.body)
  const draft = (staffView.json() as { theme: Record<string, unknown> }).theme
  assert.equal(draft.status, 'draft')
  assert.equal(draft.isOpen, false)

  // 不存在的 slug 与形态不合法的 slug 都是 404（不是 500、也不是 400）
  for (const slug of [UNKNOWN_SLUG, 'ABC', 'x', '没有这个主题', 'a'.repeat(41)]) {
    const res = await app.inject({ method: 'GET', url: `/api/themes/${encodeURIComponent(slug)}` })
    assert.equal(res.statusCode, 404, `${slug}: ${res.body}`)
    assert.equal(res.json().code, 'NOT_FOUND')
  }
})

// ============================================================================
// 3. 公开读取：投稿网格 + 参数校验
// ============================================================================

test('themes: 投稿网格空集形状正确；参数非法 400；草稿/未知 slug 404', async () => {
  const empty = await app.inject({ method: 'GET', url: `/api/themes/${OPEN_SLUG}/entries` })
  assert.equal(empty.statusCode, 200, empty.body)
  assert.deepEqual(empty.json(), { items: [], total: 0, nextOffset: null })

  const selectedEmpty = await app.inject({
    method: 'GET',
    url: `/api/themes/${OPEN_SLUG}/entries?selected=1&limit=10&offset=0`,
  })
  assert.equal(selectedEmpty.statusCode, 200, selectedEmpty.body)
  assert.deepEqual(selectedEmpty.json(), { items: [], total: 0, nextOffset: null })

  const draftAnonymous = await app.inject({ method: 'GET', url: `/api/themes/${DRAFT_SLUG}/entries` })
  assert.equal(draftAnonymous.statusCode, 404, draftAnonymous.body)
  assert.equal(draftAnonymous.json().code, 'NOT_FOUND')

  const draftAsUser = await app.inject({
    method: 'GET',
    url: `/api/themes/${DRAFT_SLUG}/entries`,
    headers: readHeaders('alice'),
  })
  assert.equal(draftAsUser.statusCode, 404, draftAsUser.body)

  const draftAsStaff = await app.inject({
    method: 'GET',
    url: `/api/themes/${DRAFT_SLUG}/entries`,
    headers: readHeaders('staff'),
  })
  assert.equal(draftAsStaff.statusCode, 200, draftAsStaff.body)

  const unknown = await app.inject({ method: 'GET', url: `/api/themes/${UNKNOWN_SLUG}/entries` })
  assert.equal(unknown.statusCode, 404, unknown.body)
  assert.equal(unknown.json().code, 'NOT_FOUND')

  for (const query of ['limit=0', 'limit=-3', 'limit=abc', 'offset=-1', 'offset=x', 'selected=maybe']) {
    const res = await app.inject({ method: 'GET', url: `/api/themes/${OPEN_SLUG}/entries?${query}` })
    assert.equal(res.statusCode, 400, `${query}: ${res.body}`)
    assert.equal(res.json().code, 'VALIDATION')
  }
})

// ============================================================================
// 4. 投稿
// ============================================================================

test('themes: 投稿成功、我的投稿可读、entryCount 递增', async () => {
  const anonymous = await app.inject({
    method: 'POST',
    url: `/api/themes/${OPEN_SLUG}/entries`,
    headers: anonWriteHeaders(),
    payload: { photoId: A1 },
  })
  assert.equal(anonymous.statusCode, 401, anonymous.body)
  assert.equal(anonymous.json().code, 'UNAUTHORIZED')

  const emptyMine = await app.inject({
    method: 'GET',
    url: `/api/me/theme-entries?slug=${OPEN_SLUG}`,
    headers: readHeaders('alice'),
  })
  assert.equal(emptyMine.statusCode, 200, emptyMine.body)
  assert.deepEqual(emptyMine.json(), { items: [] })

  const first = await app.inject({
    method: 'POST',
    url: `/api/themes/${OPEN_SLUG}/entries`,
    headers: authHeaders('alice'),
    payload: { photoId: A1 },
  })
  assert.equal(first.statusCode, 200, first.body)
  const submitted = first.json() as { photoId: string; submittedAt: string; entryCount: number }
  assert.equal(submitted.photoId, A1)
  assert.equal(submitted.entryCount, 1)
  assert.ok(submitted.submittedAt && Date.parse(submitted.submittedAt) > 0)

  const mine = await app.inject({
    method: 'GET',
    url: `/api/me/theme-entries?slug=${OPEN_SLUG}`,
    headers: readHeaders('alice'),
  })
  assert.equal(mine.statusCode, 200, mine.body)
  const mineItems = (mine.json() as { items: Array<Record<string, unknown>> }).items
  assert.equal(mineItems.length, 1)
  assert.equal(mineItems[0]!.photoId, A1)
  assert.equal(mineItems[0]!.isSelected, false)
  assert.equal(mineItems[0]!.note, '')
  assert.equal(typeof mineItems[0]!.title, 'string')

  for (const [photoId, count] of [
    [A2, 2],
    [A3, 3],
  ] as const) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/themes/${OPEN_SLUG}/entries`,
      headers: authHeaders('alice'),
      payload: { photoId },
    })
    assert.equal(res.statusCode, 200, res.body)
    assert.equal((res.json() as { entryCount: number }).entryCount, count)
  }

  // 匿名读「我的投稿」401；缺 slug 400
  const anonMine = await app.inject({ method: 'GET', url: `/api/me/theme-entries?slug=${OPEN_SLUG}` })
  assert.equal(anonMine.statusCode, 401, anonMine.body)
  assert.equal(anonMine.json().code, 'UNAUTHORIZED')

  const noSlug = await app.inject({
    method: 'GET',
    url: '/api/me/theme-entries',
    headers: readHeaders('alice'),
  })
  assert.equal(noSlug.statusCode, 400, noSlug.body)
  assert.equal(noSlug.json().code, 'VALIDATION')
  assert.match(noSlug.json().message, /slug 必填/)
})

test('themes: 投稿的拒绝口径（非本人 404 / 未发布 400 / 不存在 404 / 重复 409 / 超 3 件 422）', async () => {
  const notMine = await app.inject({
    method: 'POST',
    url: `/api/themes/${OPEN_SLUG}/entries`,
    headers: authHeaders('alice'),
    payload: { photoId: B1 },
  })
  assert.equal(notMine.statusCode, 404, notMine.body)
  assert.equal(notMine.json().code, 'NOT_FOUND')

  const bobSteals = await app.inject({
    method: 'POST',
    url: `/api/themes/${OPEN_SLUG}/entries`,
    headers: authHeaders('bob'),
    payload: { photoId: A1 },
  })
  assert.equal(bobSteals.statusCode, 404, bobSteals.body)

  const draft = await app.inject({
    method: 'POST',
    url: `/api/themes/${OPEN_SLUG}/entries`,
    headers: authHeaders('alice'),
    payload: { photoId: A_DRAFT },
  })
  assert.equal(draft.statusCode, 400, draft.body)
  assert.equal(draft.json().code, 'VALIDATION')
  assert.match(draft.json().message, /只能投稿已发布的作品/)

  const removed = await app.inject({
    method: 'POST',
    url: `/api/themes/${OPEN_SLUG}/entries`,
    headers: authHeaders('alice'),
    payload: { photoId: A_REMOVED },
  })
  assert.equal(removed.statusCode, 404, removed.body)
  assert.equal(removed.json().code, 'NOT_FOUND')

  const missing = await app.inject({
    method: 'POST',
    url: `/api/themes/${OPEN_SLUG}/entries`,
    headers: authHeaders('alice'),
    payload: { photoId: 'ea000000-0000-0000-0000-00000000ffff' },
  })
  assert.equal(missing.statusCode, 404, missing.body)

  const duplicate = await app.inject({
    method: 'POST',
    url: `/api/themes/${OPEN_SLUG}/entries`,
    headers: authHeaders('alice'),
    payload: { photoId: A1 },
  })
  assert.equal(duplicate.statusCode, 409, duplicate.body)
  assert.equal(duplicate.json().code, 'CONFLICT')
  assert.match(duplicate.json().message, /这件作品已经在主题里了/)

  const overflow = await app.inject({
    method: 'POST',
    url: `/api/themes/${OPEN_SLUG}/entries`,
    headers: authHeaders('alice'),
    payload: { photoId: A4 },
  })
  assert.equal(overflow.statusCode, 422, overflow.body)
  assert.equal(overflow.json().code, 'LIMIT_EXCEEDED')
  assert.match(overflow.json().message, /每个主题最多投稿 3 件作品/)

  // 参数形态：非 UUID 400、未知字段 400、缺 photoId 400
  const badUuid = await app.inject({
    method: 'POST',
    url: `/api/themes/${OPEN_SLUG}/entries`,
    headers: authHeaders('alice'),
    payload: { photoId: 'not-a-uuid' },
  })
  assert.equal(badUuid.statusCode, 400, badUuid.body)

  const unknownField = await app.inject({
    method: 'POST',
    url: `/api/themes/${OPEN_SLUG}/entries`,
    headers: authHeaders('alice'),
    payload: { photoId: A4, themeId: OPEN_ID },
  })
  assert.equal(unknownField.statusCode, 400, unknownField.body)
  assert.match(unknownField.json().message, /包含未知字段/)

  const noPhoto = await app.inject({
    method: 'POST',
    url: `/api/themes/${OPEN_SLUG}/entries`,
    headers: authHeaders('alice'),
    payload: {},
  })
  assert.equal(noPhoto.statusCode, 400, noPhoto.body)
})

test('themes: 投稿期外 409、草稿主题 409（不是 404）、未知 slug 404', async () => {
  const closed = await app.inject({
    method: 'POST',
    url: `/api/themes/${PAST_SLUG}/entries`,
    headers: authHeaders('alice'),
    payload: { photoId: A4 },
  })
  assert.equal(closed.statusCode, 409, closed.body)
  assert.equal(closed.json().code, 'CONFLICT')
  assert.match(closed.json().message, /主题不在投稿期/)

  /*
   * 草稿主题的投稿是 409 而不是 404：api_submit_theme_entry 先认 slug 再判窗口，
   * 草稿主题「存在但不可投稿」，与「已结束」共用同一句文案。契约 §2 只对
   * GET /api/themes/:slug 写明「草稿 → 404」，所以这里按函数的行为断言。
   */
  const draftTheme = await app.inject({
    method: 'POST',
    url: `/api/themes/${DRAFT_SLUG}/entries`,
    headers: authHeaders('alice'),
    payload: { photoId: A4 },
  })
  assert.equal(draftTheme.statusCode, 409, draftTheme.body)
  assert.equal(draftTheme.json().code, 'CONFLICT')
  assert.match(draftTheme.json().message, /主题不在投稿期/)

  // 真正不存在的 slug 才是 404（也不泄露「谁存在」）
  const unknown = await app.inject({
    method: 'POST',
    url: `/api/themes/${UNKNOWN_SLUG}/entries`,
    headers: authHeaders('alice'),
    payload: { photoId: A4 },
  })
  assert.equal(unknown.statusCode, 404, unknown.body)
  assert.equal(unknown.json().code, 'NOT_FOUND')
})

// ============================================================================
// 5. 撤回
// ============================================================================

test('themes: 撤回成功 204（计数与列表同步），非本人 404、匿名 401', async () => {
  const anonymous = await app.inject({
    method: 'DELETE',
    url: `/api/themes/${OPEN_SLUG}/entries/${A3}`,
    headers: anonWriteHeaders(),
  })
  assert.equal(anonymous.statusCode, 401, anonymous.body)

  const notMine = await app.inject({
    method: 'DELETE',
    url: `/api/themes/${OPEN_SLUG}/entries/${A1}`,
    headers: authHeaders('bob'),
  })
  assert.equal(notMine.statusCode, 404, notMine.body)
  assert.equal(notMine.json().code, 'NOT_FOUND')

  const withdrawn = await app.inject({
    method: 'DELETE',
    url: `/api/themes/${OPEN_SLUG}/entries/${A3}`,
    headers: authHeaders('alice'),
  })
  assert.equal(withdrawn.statusCode, 204, withdrawn.body)
  assert.equal(withdrawn.body, '')

  // 幂等：再撤一次 → 404（投稿已经不在了）
  const again = await app.inject({
    method: 'DELETE',
    url: `/api/themes/${OPEN_SLUG}/entries/${A3}`,
    headers: authHeaders('alice'),
  })
  assert.equal(again.statusCode, 404, again.body)

  const mine = await app.inject({
    method: 'GET',
    url: `/api/me/theme-entries?slug=${OPEN_SLUG}`,
    headers: readHeaders('alice'),
  })
  assert.equal((mine.json() as { items: unknown[] }).items.length, 2)

  const grid = await app.inject({ method: 'GET', url: `/api/themes/${OPEN_SLUG}/entries` })
  const page = grid.json() as { items: Array<{ photoId: string }>; total: number; nextOffset: number | null }
  assert.equal(page.total, 2)
  assert.deepEqual(
    page.items.map((item) => item.photoId).sort(),
    [A1, A2].sort(),
  )
  assert.equal(page.nextOffset, null)

  // 撤回之后又能投第 4 件（上限按「当前投稿数」计）
  const resubmit = await app.inject({
    method: 'POST',
    url: `/api/themes/${OPEN_SLUG}/entries`,
    headers: authHeaders('alice'),
    payload: { photoId: A3 },
  })
  assert.equal(resubmit.statusCode, 200, resubmit.body)
  assert.equal((resubmit.json() as { entryCount: number }).entryCount, 3)

  const withdrawAgain = await app.inject({
    method: 'DELETE',
    url: `/api/themes/${OPEN_SLUG}/entries/${A3}`,
    headers: authHeaders('alice'),
  })
  assert.equal(withdrawAgain.statusCode, 204, withdrawAgain.body)
})

test('themes: 已入选的作品不能撤回（403）', async () => {
  const selected = await app.inject({
    method: 'POST',
    url: `/api/admin/themes/${OPEN_SLUG}/entries/${A1}/select`,
    headers: authHeaders('staff'),
    payload: { selected: true, note: '先选上，等下要撤' },
  })
  assert.equal(selected.statusCode, 200, selected.body)

  const blocked = await app.inject({
    method: 'DELETE',
    url: `/api/themes/${OPEN_SLUG}/entries/${A1}`,
    headers: authHeaders('alice'),
  })
  assert.equal(blocked.statusCode, 403, blocked.body)
  assert.equal(blocked.json().code, 'FORBIDDEN')
  assert.match(blocked.json().message, /已入选的作品不能撤回/)

  // 撤回失败 ⇒ 投稿还在
  const mine = await app.inject({
    method: 'GET',
    url: `/api/me/theme-entries?slug=${OPEN_SLUG}`,
    headers: readHeaders('alice'),
  })
  assert.equal((mine.json() as { items: unknown[] }).items.length, 2)

  // 取消精选后又可以撤回
  const unselect = await app.inject({
    method: 'POST',
    url: `/api/admin/themes/${OPEN_SLUG}/entries/${A1}/select`,
    headers: authHeaders('staff'),
    payload: { selected: false },
  })
  assert.equal(unselect.statusCode, 200, unselect.body)
  assert.deepEqual(unselect.json(), { isSelected: false, selectedCount: 0 })
})

test('themes: 投稿期已结束不能撤回（409）', async () => {
  // 已结束/已关闭的主题投不进去，只能在库里直接造一条历史投稿。
  await admin.query(
    `insert into public.theme_entries (theme_id,photo_id,submitted_by)
     values ($1,$2,$3)
     on conflict (theme_id,photo_id) do update set submitted_by=excluded.submitted_by`,
    [PAST_ID, A5, ALICE_ID],
  )

  const res = await app.inject({
    method: 'DELETE',
    url: `/api/themes/${PAST_SLUG}/entries/${A5}`,
    headers: authHeaders('alice'),
  })
  assert.equal(res.statusCode, 409, res.body)
  assert.equal(res.json().code, 'CONFLICT')
  assert.match(res.json().message, /投稿期已结束，不能撤回/)

  // 未知主题撤别人的投稿 → 404
  const unknown = await app.inject({
    method: 'DELETE',
    url: `/api/themes/${UNKNOWN_SLUG}/entries/${A5}`,
    headers: authHeaders('alice'),
  })
  assert.equal(unknown.statusCode, 404, unknown.body)
})

// ============================================================================
// 6. 编辑：写接口的 Origin / CSRF / 会话链 + 权限
// ============================================================================

test('themes: 写接口复用全局 Origin/CSRF 校验链', async () => {
  const noOrigin = await app.inject({
    method: 'POST',
    url: `/api/themes/${OPEN_SLUG}/entries`,
    headers: { cookie: cookieOf('alice'), 'x-csrf-token': CSRF },
    payload: { photoId: A4 },
  })
  assert.equal(noOrigin.statusCode, 403, noOrigin.body)
  assert.match(noOrigin.json().message, /请求来源不受信任/)

  const badCsrf = await app.inject({
    method: 'POST',
    url: `/api/themes/${OPEN_SLUG}/entries`,
    headers: { origin: ORIGIN, cookie: cookieOf('alice'), 'x-csrf-token': 'wrong-token' },
    payload: { photoId: A4 },
  })
  assert.equal(badCsrf.statusCode, 403, badCsrf.body)
  assert.match(badCsrf.json().message, /CSRF/)
})

test('themes: 建主题 —— 缺省 draft、第二个 active 409、权限与字段校验', async () => {
  const anonymous = await app.inject({
    method: 'POST',
    url: '/api/admin/themes',
    headers: anonWriteHeaders(),
    payload: { slug: NEW_SLUG, title: '新建主题', startsAt: at(20).toISOString(), endsAt: at(27).toISOString() },
  })
  assert.equal(anonymous.statusCode, 401, anonymous.body)
  assert.equal(anonymous.json().code, 'UNAUTHORIZED')

  const asUser = await app.inject({
    method: 'POST',
    url: '/api/admin/themes',
    headers: authHeaders('alice'),
    payload: { slug: NEW_SLUG, title: '新建主题', startsAt: at(20).toISOString(), endsAt: at(27).toISOString() },
  })
  assert.equal(asUser.statusCode, 403, asUser.body)
  assert.equal(asUser.json().code, 'FORBIDDEN')
  assert.match(asUser.json().message, /需要编辑权限/)

  const missingTitle = await app.inject({
    method: 'POST',
    url: '/api/admin/themes',
    headers: authHeaders('staff'),
    payload: { slug: NEW_SLUG, startsAt: at(20).toISOString(), endsAt: at(27).toISOString() },
  })
  assert.equal(missingTitle.statusCode, 400, missingTitle.body)
  assert.match(missingTitle.json().message, /title 必填/)

  const badSlug = await app.inject({
    method: 'POST',
    url: '/api/admin/themes',
    headers: authHeaders('staff'),
    payload: {
      slug: 'Bad Slug',
      title: '新建主题',
      startsAt: at(20).toISOString(),
      endsAt: at(27).toISOString(),
    },
  })
  assert.equal(badSlug.statusCode, 400, badSlug.body)
  assert.equal(badSlug.json().code, 'VALIDATION')
  assert.match(badSlug.json().message, /slug 只能包含/)

  const badWindow = await app.inject({
    method: 'POST',
    url: '/api/admin/themes',
    headers: authHeaders('staff'),
    payload: {
      slug: NEW_SLUG,
      title: '新建主题',
      startsAt: at(27).toISOString(),
      endsAt: at(20).toISOString(),
    },
  })
  assert.equal(badWindow.statusCode, 400, badWindow.body)
  assert.match(badWindow.json().message, /投稿结束时间必须晚于开始时间/)

  const unknownField = await app.inject({
    method: 'POST',
    url: '/api/admin/themes',
    headers: authHeaders('staff'),
    payload: {
      slug: NEW_SLUG,
      title: '新建主题',
      startsAt: at(20).toISOString(),
      endsAt: at(27).toISOString(),
      id: DRAFT_ID,
    },
  })
  assert.equal(unknownField.statusCode, 400, unknownField.body)

  const created = await app.inject({
    method: 'POST',
    url: '/api/admin/themes',
    headers: authHeaders('staff'),
    payload: {
      slug: NEW_SLUG,
      title: '新建主题',
      description: '说明',
      rules: '规则',
      startsAt: at(20).toISOString(),
      endsAt: at(27).toISOString(),
    },
  })
  assert.equal(created.statusCode, 200, created.body)
  const identity = created.json() as { id: string; slug: string; status: string }
  assert.equal(identity.slug, NEW_SLUG)
  assert.equal(identity.status, 'draft', '新建缺省是草稿')
  assert.match(identity.id, /^[0-9a-f-]{36}$/i)
  createdThemeId = identity.id

  const secondActive = await app.inject({
    method: 'POST',
    url: '/api/admin/themes',
    headers: authHeaders('staff'),
    payload: {
      slug: 'th-second-84d',
      title: '第二个进行中',
      status: 'active',
      startsAt: at(1).toISOString(),
      endsAt: at(8).toISOString(),
    },
  })
  assert.equal(secondActive.statusCode, 409, secondActive.body)
  assert.equal(secondActive.json().code, 'CONFLICT')
  assert.match(secondActive.json().message, /已有一个进行中的主题/)
})

test('themes: PATCH 是局部更新（未传字段保留原值）、slug 不可改、未知 id 404', async () => {
  const asUser = await app.inject({
    method: 'PATCH',
    url: `/api/admin/themes/${createdThemeId}`,
    headers: authHeaders('alice'),
    payload: { title: '越权改名' },
  })
  assert.equal(asUser.statusCode, 403, asUser.body)

  const emptyBody = await app.inject({
    method: 'PATCH',
    url: `/api/admin/themes/${createdThemeId}`,
    headers: authHeaders('staff'),
    payload: {},
  })
  assert.equal(emptyBody.statusCode, 400, emptyBody.body)
  assert.match(emptyBody.json().message, /没有需要更新的字段/)

  const patched = await app.inject({
    method: 'PATCH',
    url: `/api/admin/themes/${createdThemeId}`,
    headers: authHeaders('staff'),
    payload: { title: '改名后的主题' },
  })
  assert.equal(patched.statusCode, 200, patched.body)
  assert.deepEqual(patched.json(), { id: createdThemeId, slug: NEW_SLUG, status: 'draft' })

  // 关键：只改标题，其余字段（说明/规则/窗口/状态）必须原样保留 ——
  // api_admin_upsert_theme 的 update 分支是整体覆盖，路由层忘了合并就会清空。
  const list = await app.inject({
    method: 'GET',
    url: '/api/admin/themes',
    headers: readHeaders('staff'),
  })
  assert.equal(list.statusCode, 200, list.body)
  const after = (list.json() as { items: Array<Record<string, unknown>> }).items.find(
    (item) => item.id === createdThemeId,
  )
  assert.ok(after, list.body)
  assert.equal(after.title, '改名后的主题')
  assert.equal(after.description, '说明')
  assert.equal(after.rules, '规则')
  assert.equal(after.status, 'draft')
  assert.equal(after.resultNote, '')
  assert.equal(after.entryCount, 0)
  assert.equal(after.selectedCount, 0)
  assert.equal(after.isOpen, false)
  assert.ok(typeof after.startsAt === 'string' && Date.parse(after.startsAt as string) > Date.now())

  const slugChange = await app.inject({
    method: 'PATCH',
    url: `/api/admin/themes/${createdThemeId}`,
    headers: authHeaders('staff'),
    payload: { slug: 'th-renamed-84d' },
  })
  assert.equal(slugChange.statusCode, 400, slugChange.body)
  assert.equal(slugChange.json().code, 'VALIDATION')
  assert.match(slugChange.json().message, /主题 slug 创建后不可修改/)

  const unknownId = await app.inject({
    method: 'PATCH',
    url: `/api/admin/themes/f1000000-0000-0000-0000-00000000ffff`,
    headers: authHeaders('staff'),
    payload: { title: '不存在' },
  })
  assert.equal(unknownId.statusCode, 404, unknownId.body)
  assert.equal(unknownId.json().code, 'NOT_FOUND')

  // 置成草稿以外的状态：closed 可以，active 会被「已有一个进行中的主题」挡住
  const toClosed = await app.inject({
    method: 'PATCH',
    url: `/api/admin/themes/${createdThemeId}`,
    headers: authHeaders('staff'),
    payload: { status: 'closed' },
  })
  assert.equal(toClosed.statusCode, 200, toClosed.body)
  assert.equal((toClosed.json() as { status: string }).status, 'closed')

  const toActive = await app.inject({
    method: 'PATCH',
    url: `/api/admin/themes/${createdThemeId}`,
    headers: authHeaders('staff'),
    payload: { status: 'active' },
  })
  assert.equal(toActive.statusCode, 409, toActive.body)
  assert.match(toActive.json().message, /已有一个进行中的主题/)
})

test('themes: 后台列表看得见草稿（含 status 过滤与权限）', async () => {
  const anonymous = await app.inject({ method: 'GET', url: '/api/admin/themes' })
  assert.equal(anonymous.statusCode, 401, anonymous.body)

  const asUser = await app.inject({
    method: 'GET',
    url: '/api/admin/themes',
    headers: readHeaders('alice'),
  })
  assert.equal(asUser.statusCode, 403, asUser.body)

  const staff = await app.inject({
    method: 'GET',
    url: '/api/admin/themes',
    headers: readHeaders('staff'),
  })
  assert.equal(staff.statusCode, 200, staff.body)
  const items = (staff.json() as { items: Array<Record<string, unknown>> }).items
  const slugs = items.map((item) => item.slug)
  assert.ok(slugs.includes(DRAFT_SLUG), '草稿主题必须出现在后台列表里')
  assert.ok(slugs.includes(OPEN_SLUG), staff.body)
  assert.ok(slugs.includes(NEW_SLUG), staff.body)
  const openRow = items.find((item) => item.slug === OPEN_SLUG)!
  assert.equal(openRow.isOpen, true)
  assert.equal(openRow.rules, '投稿规则原文')

  const drafts = (
    await app.inject({
      method: 'GET',
      url: '/api/admin/themes?status=draft',
      headers: readHeaders('staff'),
    })
  ).json() as { items: Array<{ status: string }> }
  assert.ok(drafts.items.length >= 1, JSON.stringify(drafts))
  assert.ok(drafts.items.every((item) => item.status === 'draft'))

  const bad = await app.inject({
    method: 'GET',
    url: '/api/admin/themes?status=bogus',
    headers: readHeaders('staff'),
  })
  assert.equal(bad.statusCode, 400, bad.body)
  assert.equal(bad.json().code, 'VALIDATION')
})

// ============================================================================
// 7. 精选
// ============================================================================

test('themes: 精选写入状态与评语、作者收到 system 通知；重复选中不重复发、取消不发', async () => {
  /*
   * 用 A2 而不是 A1：上一个用例（已入选不能撤回）已经精选过一次 A1，
   * 那条通知还在库里。这里要断言「从 0 到 1」，所以挑一件没被精选过的作品。
   */
  const TARGET = A2

  const asUser = await app.inject({
    method: 'POST',
    url: `/api/admin/themes/${OPEN_SLUG}/entries/${TARGET}/select`,
    headers: authHeaders('alice'),
    payload: { selected: true },
  })
  assert.equal(asUser.statusCode, 403, asUser.body)
  assert.match(asUser.json().message, /需要编辑权限/)

  const before = await countNotifications(ALICE_ID, TARGET)
  assert.equal(before, 0)

  const selected = await app.inject({
    method: 'POST',
    url: `/api/admin/themes/${OPEN_SLUG}/entries/${TARGET}/select`,
    headers: authHeaders('staff'),
    payload: { selected: true, note: '构图很稳' },
  })
  assert.equal(selected.statusCode, 200, selected.body)
  assert.deepEqual(selected.json(), { isSelected: true, selectedCount: 1 })

  const notifications = await admin.query<{
    kind: string
    actor_id: string
    meta: Record<string, unknown>
    slug: string
    title: string
  }>(
    `select kind, actor_id, meta, meta->>'themeSlug' as slug,
            meta->>'themeTitle' as title
       from public.notifications
      where user_id=$1 and photo_id=$2 and kind='system'`,
    [ALICE_ID, TARGET],
  )
  assert.equal(notifications.rowCount, 1, JSON.stringify(notifications.rows))
  const notification = notifications.rows[0]!
  assert.equal(notification.actor_id, STAFF_ID)
  // 通知的分类标记必须与 0030 周榜通知同一口径（meta.kind），前端 notificationCopy
  // 与 themeSelectionOf 都按这个 key 读；0036 初版误写成 meta.type，已对齐为 kind。
  assert.equal(notification.meta.kind, 'theme_selected')
  assert.equal(notification.slug, OPEN_SLUG)
  assert.equal(notification.title, '本周主题：夜行')

  // 重复选中（改评语）不重复发通知
  const again = await app.inject({
    method: 'POST',
    url: `/api/admin/themes/${OPEN_SLUG}/entries/${TARGET}/select`,
    headers: authHeaders('staff'),
    payload: { selected: true, note: '换一句评语' },
  })
  assert.equal(again.statusCode, 200, again.body)
  assert.equal(await countNotifications(ALICE_ID, TARGET), 1)

  const mine = (
    await app.inject({
      method: 'GET',
      url: `/api/me/theme-entries?slug=${OPEN_SLUG}`,
      headers: readHeaders('alice'),
    })
  ).json() as { items: Array<{ photoId: string; isSelected: boolean; note: string }> }
  const mineSelected = mine.items.find((item) => item.photoId === TARGET)!
  assert.equal(mineSelected.isSelected, true)
  assert.equal(mineSelected.note, '换一句评语')

  // 精选排在最前 + DTO 形状（作者名、作品键、点赞数）
  const grid = (
    await app.inject({ method: 'GET', url: `/api/themes/${OPEN_SLUG}/entries` })
  ).json() as { items: Array<Record<string, unknown>>; total: number; nextOffset: number | null }
  assert.equal(grid.total, 2)
  assert.equal(grid.items[0]!.photoId, TARGET)
  assert.equal(grid.items[0]!.isSelected, true)
  assert.equal(grid.items[0]!.note, '换一句评语')
  assert.equal(grid.items[0]!.authorId, ALICE_ID)
  assert.equal(grid.items[0]!.authorUsername, 'theme_alice')
  assert.equal(grid.items[0]!.authorDisplayName, 'Theme Alice')
  assert.equal(grid.items[0]!.imageKey, `photos/${ALICE_ID}/${TARGET}/display.webp`)
  assert.equal(grid.items[0]!.thumbKey, `photos/${ALICE_ID}/${TARGET}/thumb.webp`)
  assert.equal(grid.items[0]!.likeCount, 0)
  assert.equal(grid.items[0]!.favoriteCount, 0)
  assert.ok(typeof grid.items[0]!.selectedAt === 'string')

  const selectedOnly = (
    await app.inject({ method: 'GET', url: `/api/themes/${OPEN_SLUG}/entries?selected=1` })
  ).json() as { items: Array<{ photoId: string }>; total: number }
  // total 是**过滤后**的总数（SQL 里 total_count = count(*) from base，base 已带过滤）
  assert.equal(selectedOnly.total, 1)
  assert.deepEqual(
    selectedOnly.items.map((item) => item.photoId),
    [TARGET],
  )

  // 取消精选：不发通知、评语清空
  const unselected = await app.inject({
    method: 'POST',
    url: `/api/admin/themes/${OPEN_SLUG}/entries/${TARGET}/select`,
    headers: authHeaders('staff'),
    payload: { selected: false },
  })
  assert.equal(unselected.statusCode, 200, unselected.body)
  assert.deepEqual(unselected.json(), { isSelected: false, selectedCount: 0 })
  assert.equal(await countNotifications(ALICE_ID, TARGET), 1)

  const cleared = (
    await app.inject({
      method: 'GET',
      url: `/api/me/theme-entries?slug=${OPEN_SLUG}`,
      headers: readHeaders('alice'),
    })
  ).json() as { items: Array<{ photoId: string; isSelected: boolean; note: string }> }
  assert.equal(cleared.items.find((item) => item.photoId === TARGET)!.note, '')
})

test('themes: 精选的参数与目标校验（400/404）', async () => {
  const notBoolean = await app.inject({
    method: 'POST',
    url: `/api/admin/themes/${OPEN_SLUG}/entries/${A1}/select`,
    headers: authHeaders('staff'),
    payload: { selected: 'yes' },
  })
  assert.equal(notBoolean.statusCode, 400, notBoolean.body)
  assert.match(notBoolean.json().message, /selected 必须是布尔值/)

  const longNote = await app.inject({
    method: 'POST',
    url: `/api/admin/themes/${OPEN_SLUG}/entries/${A1}/select`,
    headers: authHeaders('staff'),
    payload: { selected: true, note: '好'.repeat(201) },
  })
  assert.equal(longNote.statusCode, 400, longNote.body)
  assert.equal(longNote.json().code, 'VALIDATION')
  assert.match(longNote.json().message, /精选评语最多 200 个字/)

  const unknownField = await app.inject({
    method: 'POST',
    url: `/api/admin/themes/${OPEN_SLUG}/entries/${A1}/select`,
    headers: authHeaders('staff'),
    payload: { selected: true, isSelected: true },
  })
  assert.equal(unknownField.statusCode, 400, unknownField.body)

  const notSubmitted = await app.inject({
    method: 'POST',
    url: `/api/admin/themes/${OPEN_SLUG}/entries/${A4}/select`,
    headers: authHeaders('staff'),
    payload: { selected: true },
  })
  assert.equal(notSubmitted.statusCode, 404, notSubmitted.body)
  assert.equal(notSubmitted.json().code, 'NOT_FOUND')

  const unknownTheme = await app.inject({
    method: 'POST',
    url: `/api/admin/themes/${UNKNOWN_SLUG}/entries/${A1}/select`,
    headers: authHeaders('staff'),
    payload: { selected: true },
  })
  assert.equal(unknownTheme.statusCode, 404, unknownTheme.body)
})

// ============================================================================
// 8. 分页（投稿网格）
// ============================================================================

test('themes: 投稿网格分页不重不漏', async () => {
  const first = (
    await app.inject({ method: 'GET', url: `/api/themes/${OPEN_SLUG}/entries?limit=1&offset=0` })
  ).json() as { items: Array<{ photoId: string }>; total: number; nextOffset: number | null }
  assert.equal(first.total, 2)
  assert.equal(first.items.length, 1)
  assert.equal(first.nextOffset, 1)

  const second = (
    await app.inject({ method: 'GET', url: `/api/themes/${OPEN_SLUG}/entries?limit=1&offset=1` })
  ).json() as { items: Array<{ photoId: string }>; total: number; nextOffset: number | null }
  assert.equal(second.items.length, 1)
  assert.equal(second.nextOffset, null)
  assert.notEqual(second.items[0]!.photoId, first.items[0]!.photoId)

  // limit 超上限按 48 钳制（不是 400）
  const clamped = await app.inject({
    method: 'GET',
    url: `/api/themes/${OPEN_SLUG}/entries?limit=999`,
  })
  assert.equal(clamped.statusCode, 200, clamped.body)
  assert.equal((clamped.json() as { items: unknown[] }).items.length, 2)
})

// ============================================================================
// 9. 限流（放最后：会把投稿接口的配额耗光）
// ============================================================================

test('themes: 投稿接口超过限流必须是 429 + RATE_LIMIT（不能漏成 500）', async () => {
  let limited: { code: string; message: string; details: { retryAfterSeconds: number } } | null = null
  for (let i = 0; i < 40; i += 1) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/themes/${OPEN_SLUG}/entries`,
      headers: authHeaders('bob'),
      payload: { photoId: A4 },
    })
    if (res.statusCode === 429) {
      limited = res.json() as { code: string; message: string; details: { retryAfterSeconds: number } }
      break
    }
    assert.equal(res.statusCode, 404, res.body) // bob 不是 A4 的作者
  }

  assert.ok(limited, '连续投稿请求里必须出现 429')
  assert.equal(limited.code, 'RATE_LIMIT')
  assert.match(limited.message, /操作过于频繁/)
  assert.ok(limited.details.retryAfterSeconds > 0)
})
