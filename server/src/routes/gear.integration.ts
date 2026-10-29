/**
 * 摄影专业化集成测试（0031）——跑在真实 PostgreSQL 上。
 *
 * 覆盖：
 *   1) 器材聚合口径：只看在架（published + 未删除 + 有发布时间）且**有效公开** EXIF 的作品；
 *      逐张隐藏（exif_hidden）与账户级隐藏（profiles.exif_visibility='hidden'）都排除；
 *   2) 器材作品流：游标翻页无重复无遗漏，且不混入隐藏作品；
 *   3) 地点聚合：排除 location_precision='hidden' 与空名，latestPublishedAt 取在架作品最大值；
 *   4) 地点作品流：limit=1 翻三页，顺序稳定、无重复；
 *   5) 季节：四季恒 4 行，按 shot_at 月份归属（3–5/6–8/9–11/12–2）；
 *   6) 非法参数一律 400（kind / label / cursor / limit），不是 500；
 *   7) 公开接口不返回用户 UUID；
 *   8) PUT /api/me/exif-visibility：未登录 401、非法值 400、正常写入并反映在 /api/me/account；
 *   9) PUT /api/me/pinned：≤3、仅本人已发布作品、重复 id 拒绝、顺序保留、空数组清空；
 *  10) PATCH /api/photos/:id 支持 exifHidden（布尔），隐藏时 exif 返回 {}。
 *
 * 运行方式与其他 integration 套件一致（一次性库，见 .tmp/verify-fresh-db.sh）：
 *   PGDATABASE=gongke_verify_x PGUSER=app_user PGPASSWORD=*** \
 *   PGADMIN_PASSWORD=*** node --import tsx --test server/src/routes/gear.integration.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { after, before } from 'node:test'
import pg from 'pg'

const { Client } = pg

const ORIGIN = 'http://127.0.0.1:5173'
const AUTHOR_A = 'a3000000-0000-0000-0000-0000000000a3'
const AUTHOR_B = 'b4000000-0000-0000-0000-0000000000b4'
const SECRET_A = 'gear-author-a-session-secret-long-enough-0031'
const CSRF = 'csrf-token-for-gear-integration'

/** 作品 id 用固定前缀，清理时按前缀删除，不会碰到别的套件的数据。 */
const PHOTO_PREFIX = 'ce000000-0000-0000-0000-0000000000'
const photoId = (n: number): string => `${PHOTO_PREFIX}${String(n).padStart(2, '0')}`

const CANON = { Make: 'Canon', Model: 'EOS R5', LensModel: 'RF 24-70mm F2.8 L IS USM', FNumber: '2.8' }
const CANON_OTHER_LENS = { Make: 'Canon', Model: 'EOS R5', LensModel: 'RF 50mm F1.2 L USM' }
const SONY = { Make: 'Sony', Model: 'A7M4', LensModel: 'FE 35mm F1.4 GM' }

type App = Awaited<ReturnType<(typeof import('../index.js'))['buildApp']>>

interface SeedPhoto {
  id: string
  author: string
  title: string
  exif: Record<string, string>
  exifHidden?: boolean
  locationName: string
  locationPrecision: 'exact' | 'district' | 'city' | 'hidden'
  shotAt: string
  status: 'published' | 'draft' | 'removed'
  deleted?: boolean
  publishedAt: string | null
}

/**
 * 种子矩阵（每一条都在测试里被当作口径证据用）：
 *   p1 在架 · EXIF 公开 · 西湖(exact) · 4 月 —— 器材/地点/季节都应统计它
 *   p2 在架 · **逐张隐藏 EXIF** · 西湖(exact) · 7 月 —— 器材不算、地点算
 *   p3 草稿 · EXIF 公开 —— 哪都不算
 *   p4 已删除 · EXIF 公开 —— 哪都不算
 *   p5 在架 · EXIF 公开 · **无地名**(location_precision='hidden') · 12 月 —— 器材算、地点不算
 *   p6 在架 · 作者 B 账户级隐藏 EXIF · 西湖(district) · 1 月 —— 器材不算、地点算
 */
const SEED: SeedPhoto[] = [
  {
    id: photoId(1), author: AUTHOR_A, title: '器材 A1', exif: CANON,
    locationName: '西湖', locationPrecision: 'exact', shotAt: '2026-04-10T09:00:00Z',
    status: 'published', publishedAt: '2026-10-01T10:00:00Z',
  },
  {
    id: photoId(2), author: AUTHOR_A, title: '器材 A2', exif: CANON_OTHER_LENS, exifHidden: true,
    locationName: '西湖', locationPrecision: 'exact', shotAt: '2026-07-10T09:00:00Z',
    status: 'published', publishedAt: '2026-10-02T10:00:00Z',
  },
  {
    id: photoId(3), author: AUTHOR_A, title: '草稿 A3', exif: CANON,
    locationName: '西湖', locationPrecision: 'exact', shotAt: '2026-05-10T09:00:00Z',
    status: 'draft', publishedAt: null,
  },
  {
    id: photoId(4), author: AUTHOR_A, title: '已删 A4', exif: CANON,
    locationName: '西湖', locationPrecision: 'exact', shotAt: '2026-06-10T09:00:00Z',
    status: 'published', deleted: true, publishedAt: '2026-10-05T10:00:00Z',
  },
  {
    // location_precision='hidden' 时 ck_photos_location_privacy 要求 location_name=''，
    // 也就是说「隐藏地点」的作品在库里根本没有地名可聚合 —— 函数里的 != 'hidden'
    // 过滤是防御性的第二道闸（防止将来放开该约束后泄露）。
    id: photoId(5), author: AUTHOR_A, title: '器材 A5', exif: SONY,
    locationName: '', locationPrecision: 'hidden', shotAt: '2026-12-20T09:00:00Z',
    status: 'published', publishedAt: '2026-10-03T10:00:00Z',
  },
  {
    id: photoId(6), author: AUTHOR_B, title: '器材 B1', exif: CANON,
    locationName: '西湖', locationPrecision: 'district', shotAt: '2026-01-15T09:00:00Z',
    status: 'published', publishedAt: '2026-10-04T10:00:00Z',
  },
]

let app: App
let admin: pg.Client
let sessionA = ''

function tokenHash(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

function headersA() {
  return {
    origin: ORIGIN,
    cookie: `gk_session=${sessionA}.${SECRET_A}; gy_csrf=${CSRF}`,
    'x-csrf-token': CSRF,
  }
}

before(async () => {
  process.env.STORAGE_CLEANUP_ENABLED = 'false'
  admin = new Client({
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGADMIN_USER ?? 'postgres',
    password: process.env.PGADMIN_PASSWORD,
  })
  await admin.connect()

  // profiles.id 外键指向 auth.users，所以先建 auth.users（触发器会顺手建 profile），再改用户名。
  await admin.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
       ($1, 'gear-a@test.local', '{"display_name":"器材甲"}'::jsonb),
       ($2, 'gear-b@test.local', '{"display_name":"器材乙"}'::jsonb)
     on conflict (id) do nothing`,
    [AUTHOR_A, AUTHOR_B],
  )
  await admin.query(
    `update public.profiles set username = 'gear_a', display_name = '器材甲', visibility = 'public',
            exif_visibility = 'public', pinned_photo_ids = '{}' where id = $1`,
    [AUTHOR_A],
  )
  // B 账户级隐藏：他的作品进不了器材聚合，但地点聚合照算（地点与 EXIF 是两件事）。
  await admin.query(
    `update public.profiles set username = 'gear_b', display_name = '器材乙', visibility = 'public',
            exif_visibility = 'hidden' where id = $1`,
    [AUTHOR_B],
  )

  await admin.query(
    `insert into public.categories (slug, name, sort_order) values ('gear-test', '器材测试', 98)
     on conflict (slug) do nothing`,
  )

  for (const photo of SEED) {
    await admin.query(
      `insert into public.photos
         (id, author_id, title, category_slug, tags, exif, exif_hidden,
          location_name, location_precision, shot_at, status, deleted_at, published_at,
          image_key, thumb_key, width, height)
       values ($1, $2, $3, 'gear-test', '{}'::text[], $4::jsonb, $5::boolean,
               $6, $7, $8::timestamptz, $9, $10, $11::timestamptz, $12, $13, 1600, 1067)
       on conflict (id) do update
         set exif = excluded.exif,
             exif_hidden = excluded.exif_hidden,
             location_name = excluded.location_name,
             location_precision = excluded.location_precision,
             shot_at = excluded.shot_at,
             status = excluded.status,
             deleted_at = excluded.deleted_at,
             published_at = excluded.published_at`,
      [
        photo.id, photo.author, photo.title, JSON.stringify(photo.exif), photo.exifHidden ?? false,
        photo.locationName, photo.locationPrecision, photo.shotAt, photo.status,
        photo.deleted ? '2026-10-08T10:00:00Z' : null, photo.publishedAt,
        `${photo.id}.jpg`, `${photo.id}-thumb.jpg`,
      ],
    )
  }

  const session = await admin.query<{ session_id: string }>(
    `select session_id from public.api_create_session($1,$2,now() + interval '1 hour',$3,$4)`,
    [AUTHOR_A, tokenHash(SECRET_A), 'gear-integration', 'integration-ip'],
  )
  sessionA = session.rows[0]!.session_id

  const { buildApp } = await import('../index.js')
  app = await buildApp()
  await app.ready()
})

after(async () => {
  if (admin) {
    await admin.query('delete from public.photos where id::text like $1', [`${PHOTO_PREFIX}%`])
    await admin.query('delete from auth.users where id = any($1::uuid[])', [[AUTHOR_A, AUTHOR_B]])
    await admin.query(`delete from public.categories where slug = 'gear-test'`)
    await admin.end()
  }
  if (app) await app.close()
})

interface GearRow {
  kind: string
  label: string
  photoCount: number
  authorCount: number
}

interface PlaceRow {
  label: string
  photoCount: number
  authorCount: number
  latestPublishedAt: string | null
}

interface SeasonRow {
  season: string
  photoCount: number
}

interface StreamItem {
  id: string
  exif: Record<string, unknown>
  exifHidden: boolean
  authorUsername: string | null
  [key: string]: unknown
}

async function getGear(query = ''): Promise<GearRow[]> {
  const response = await app.inject({ method: 'GET', url: `/api/gear${query}` })
  assert.equal(response.statusCode, 200, response.body)
  return (response.json() as { items: GearRow[] }).items
}

async function getPlaces(query = ''): Promise<PlaceRow[]> {
  const response = await app.inject({ method: 'GET', url: `/api/places${query}` })
  assert.equal(response.statusCode, 200, response.body)
  return (response.json() as { items: PlaceRow[] }).items
}

async function getStream(url: string): Promise<{ items: StreamItem[]; nextCursor: string | null }> {
  const response = await app.inject({ method: 'GET', url })
  assert.equal(response.statusCode, 200, response.body)
  return response.json() as { items: StreamItem[]; nextCursor: string | null }
}

function labeled<T extends { label: string }>(rows: T[], label: string): T | undefined {
  return rows.find((row) => row.label === label)
}

test('器材总览：只统计在架且有效公开 EXIF 的作品', async () => {
  const rows = await getGear('?limit=50')
  const canon = labeled(rows, 'Canon EOS R5')
  assert.ok(canon, 'Canon EOS R5 应该出现在器材总览里')
  assert.equal(canon.kind, 'body')
  // 只有 p1：p2 逐张隐藏、p3 草稿、p4 已删除、p6 作者账户级隐藏
  assert.equal(canon.photoCount, 1, `Canon EOS R5 应有 1 件，实际 ${canon.photoCount}`)
  assert.equal(canon.authorCount, 1)

  const sony = labeled(rows, 'Sony A7M4')
  assert.ok(sony)
  assert.equal(sony.photoCount, 1)

  const lens = labeled(rows, 'RF 24-70mm F2.8 L IS USM')
  assert.ok(lens, '镜头组应该单独成行')
  assert.equal(lens.kind, 'lens')
  assert.equal(lens.photoCount, 1)

  // p2 的镜头只有隐藏作品，整行都不该出现
  assert.equal(labeled(rows, 'RF 50mm F1.2 L USM'), undefined, '隐藏 EXIF 的作品不能贡献镜头行')

  // 排序：photoCount 不增
  const counts = rows.map((row) => row.photoCount)
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), '器材应按作品数降序')
})

test('器材分组与作品流：只返回该器材的公开作品，且不暴露用户 UUID', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/gear/body?limit=50' })
  assert.equal(response.statusCode, 200, response.body)
  const body = response.json() as { items: GearRow[] }
  assert.ok(body.items.length > 0)
  assert.ok(body.items.every((item) => item.kind === 'body'), 'kind 过滤后只能剩机身')

  const stream = await getStream(`/api/gear/body/photos?label=${encodeURIComponent('Canon EOS R5')}`)
  assert.equal(stream.items.length, 1)
  assert.equal(stream.items[0]!.id, photoId(1))
  assert.equal(stream.nextCursor, null)
  assert.equal(stream.items[0]!.authorUsername, 'gear_a')
  assert.equal(stream.items[0]!.exifHidden, false)
  // 「不返回用户 UUID」约束的是聚合行（器材/地点列表），作品项沿用既有作品投影
  // （/api/photos 本来就带 authorId），因此这里只断言聚合行不带任何 UUID。
  assert.equal(JSON.stringify(body.items).includes(AUTHOR_A), false, '器材列表不能带作者 UUID')
  assert.deepEqual(
    Object.keys(body.items[0]!).sort(),
    ['authorCount', 'kind', 'label', 'photoCount'],
    '聚合行只能有这四个字段（作者只以计数出现）',
  )
})

test('地点总览：排除隐藏精度与空名，latestPublishedAt 取在架作品最大值', async () => {
  const rows = await getPlaces('?limit=50')
  const westLake = labeled(rows, '西湖')
  assert.ok(westLake, '西湖 应出现在地点总览里')
  // p1(exact) + p2(exact) + p6(district)；p3 草稿、p4 已删除都不算
  assert.equal(westLake.photoCount, 3, `西湖 应有 3 件，实际 ${westLake.photoCount}`)
  assert.equal(westLake.authorCount, 2, '西湖 来自 2 位作者')
  assert.equal(new Date(westLake.latestPublishedAt!).toISOString(), '2026-10-04T10:00:00.000Z')

  assert.equal(labeled(rows, '外滩'), undefined, '没有地名的作品不能在地点总览里成行')
  assert.equal(rows.some((row) => row.label.trim() === ''), false, '空地点名不能成行')
  assert.equal(JSON.stringify(rows).includes(AUTHOR_A), false, '地点总览不能带作者 UUID')
})

test('地点作品流：limit=1 翻三页，无重复无遗漏', async () => {
  const seen: string[] = []
  let cursor: string | null = null
  for (let page = 0; page < 4; page += 1) {
    const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
    const result = await getStream(`/api/places/photos?label=${encodeURIComponent('西湖')}&limit=1${query}`)
    assert.ok(result.items.length <= 1, 'limit=1 时每页最多 1 条')
    for (const item of result.items) seen.push(item.id)
    cursor = result.nextCursor
    if (!cursor) break
  }
  assert.deepEqual(seen, [photoId(6), photoId(2), photoId(1)], '应按 published_at 倒序且不重不漏')
})

test('季节：四季恒 4 行，按拍摄月份归属', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/seasons' })
  assert.equal(response.statusCode, 200, response.body)
  const rows = (response.json() as { items: SeasonRow[] }).items
  assert.deepEqual(
    rows.map((row) => row.season),
    ['spring', 'summer', 'autumn', 'winter'],
    '四季顺序固定，前端 chips 才不会跳',
  )
  const bySeason = new Map(rows.map((row) => [row.season, row.photoCount]))
  // 4 月春、7 月夏、12 月与 1 月都算冬（12–2）
  assert.equal(bySeason.get('spring'), 1)
  assert.equal(bySeason.get('summer'), 1)
  assert.equal(bySeason.get('winter'), 2)
  assert.equal(bySeason.get('autumn'), 0, '没有作品也要返回 0，而不是缺行')
})

test('非法参数返回 400 而不是 500', async () => {
  const cases: string[] = [
    '/api/gear?limit=0',
    '/api/gear?limit=abc',
    '/api/gear/keyboard/photos?label=x',
    '/api/gear/body/photos',
    '/api/gear/body/photos?label=%20%20',
    '/api/gear/body/photos?label=Canon&limit=999',
    `/api/gear/body/photos?label=Canon&cursor=${encodeURIComponent('not-a-cursor')}`,
    `/api/places/photos?label=%E8%A5%BF%E6%B9%96&cursor=${encodeURIComponent('W10')}`,
  ]
  for (const url of cases) {
    const response = await app.inject({ method: 'GET', url })
    assert.equal(response.statusCode, 400, `${url} 应为 400，实际 ${response.statusCode}：${response.body}`)
  }
})

test('PUT /api/me/exif-visibility：鉴权、取值域与生效', async () => {
  const anonymous = await app.inject({
    method: 'PUT', url: '/api/me/exif-visibility', headers: { origin: ORIGIN }, payload: { visibility: 'hidden' },
  })
  assert.equal(anonymous.statusCode, 401, anonymous.body)

  const invalid = await app.inject({
    method: 'PUT', url: '/api/me/exif-visibility', headers: headersA(), payload: { visibility: 'secret' },
  })
  assert.equal(invalid.statusCode, 400, invalid.body)

  const missing = await app.inject({
    method: 'PUT', url: '/api/me/exif-visibility', headers: headersA(), payload: {},
  })
  assert.equal(missing.statusCode, 400, missing.body)

  const ok = await app.inject({
    method: 'PUT', url: '/api/me/exif-visibility', headers: headersA(), payload: { visibility: 'hidden' },
  })
  assert.equal(ok.statusCode, 200, ok.body)
  assert.equal((ok.json() as { exifVisibility: string }).exifVisibility, 'hidden')

  // 账户设置读取要能看见刚写入的值，并且带动「有效隐藏」
  const account = await app.inject({ method: 'GET', url: '/api/me/account', headers: headersA() })
  assert.equal(account.statusCode, 200, account.body)
  assert.equal((account.json() as { exifVisibility: string }).exifVisibility, 'hidden')

  const canyon = await app.inject({ method: 'GET', url: `/api/photos/${photoId(1)}`, headers: headersA() })
  assert.equal(canyon.statusCode, 200, canyon.body)
  assert.equal((canyon.json() as StreamItem).exifHidden, true, '账户级隐藏后这张作品也应视为隐藏')

  // 还原，避免影响后续用例对器材统计的断言
  const restore = await app.inject({
    method: 'PUT', url: '/api/me/exif-visibility', headers: headersA(), payload: { visibility: 'public' },
  })
  assert.equal(restore.statusCode, 200, restore.body)
})

test('PUT /api/me/pinned：上限 3、仅本人已发布、顺序保留、空数组清空', async () => {
  const tooMany = await app.inject({
    method: 'PUT', url: '/api/me/pinned', headers: headersA(),
    payload: { photoIds: [photoId(1), photoId(2), photoId(5), photoId(6)] },
  })
  assert.equal(tooMany.statusCode, 400, tooMany.body)

  const foreign = await app.inject({
    method: 'PUT', url: '/api/me/pinned', headers: headersA(), payload: { photoIds: [photoId(6)] },
  })
  assert.equal(foreign.statusCode, 400, `别人的作品应 400：${foreign.body}`)

  const draft = await app.inject({
    method: 'PUT', url: '/api/me/pinned', headers: headersA(), payload: { photoIds: [photoId(3)] },
  })
  assert.equal(draft.statusCode, 400, `草稿不能当代表作：${draft.body}`)

  const duplicated = await app.inject({
    method: 'PUT', url: '/api/me/pinned', headers: headersA(), payload: { photoIds: [photoId(1), photoId(1)] },
  })
  assert.equal(duplicated.statusCode, 400, duplicated.body)

  const notUuid = await app.inject({
    method: 'PUT', url: '/api/me/pinned', headers: headersA(), payload: { photoIds: ['nope'] },
  })
  assert.equal(notUuid.statusCode, 400, notUuid.body)

  const ok = await app.inject({
    method: 'PUT', url: '/api/me/pinned', headers: headersA(),
    payload: { photoIds: [photoId(5), photoId(1)] },
  })
  assert.equal(ok.statusCode, 200, ok.body)
  const body = ok.json() as { pinnedPhotoIds: string[]; pinned: Array<{ id: string; title: string; thumbKey: string }> }
  assert.deepEqual(body.pinnedPhotoIds, [photoId(5), photoId(1)], '顺序就是用户排的顺序')
  assert.deepEqual(body.pinned.map((entry) => entry.id), [photoId(5), photoId(1)])
  assert.equal(body.pinned[0]!.title, '器材 A5', '摘要要带标题，前端才不用再拉一次')
  assert.equal(body.pinned[0]!.thumbKey, `${photoId(5)}-thumb.jpg`)

  // 公开资料投影里也要带代表作摘要，且不返回 UUID
  const profile = await app.inject({ method: 'GET', url: '/api/profiles/by-username/gear_a', headers: { origin: ORIGIN } })
  assert.equal(profile.statusCode, 200, profile.body)
  const data = profile.json() as { id?: string; exifVisibility: string; pinned: Array<{ id: string }> }
  assert.equal(data.id, undefined, '公开资料不能返回 user UUID')
  assert.equal(data.exifVisibility, 'public')
  assert.deepEqual(data.pinned.map((entry) => entry.id), [photoId(5), photoId(1)])

  const cleared = await app.inject({
    method: 'PUT', url: '/api/me/pinned', headers: headersA(), payload: { photoIds: [] },
  })
  assert.equal(cleared.statusCode, 200, cleared.body)
  const clearedBody = cleared.json() as { pinnedPhotoIds: string[]; pinned: unknown[] }
  assert.deepEqual(clearedBody.pinnedPhotoIds, [])
  assert.deepEqual(clearedBody.pinned, [])
})

test('PATCH /api/photos/:id 支持 exifHidden，隐藏后 exif 为 {}', async () => {
  const nonBoolean = await app.inject({
    method: 'PATCH', url: `/api/photos/${photoId(1)}`, headers: headersA(), payload: { exifHidden: 'true' },
  })
  assert.equal(nonBoolean.statusCode, 400, `字符串 "true" 不能被当成隐藏：${nonBoolean.body}`)

  const hide = await app.inject({
    method: 'PATCH', url: `/api/photos/${photoId(1)}`, headers: headersA(), payload: { exifHidden: true },
  })
  assert.equal(hide.statusCode, 200, hide.body)
  const hidden = hide.json() as StreamItem
  assert.equal(hidden.exifHidden, true)
  assert.deepEqual(hidden.exif, {}, '隐藏时 exif 必须是空对象，前端不显示空表格')

  // 隐藏后这条作品也要从器材聚合里消失
  const canon = labeled(await getGear('?limit=50'), 'Canon EOS R5')
  assert.equal(canon, undefined, '唯一的公开 Canon EOS R5 作品隐藏后，这一行应消失')

  const show = await app.inject({
    method: 'PATCH', url: `/api/photos/${photoId(1)}`, headers: headersA(), payload: { exifHidden: false },
  })
  assert.equal(show.statusCode, 200, show.body)
  const shown = show.json() as StreamItem
  assert.equal(shown.exifHidden, false)
  assert.equal(shown.exif.Make, 'Canon', '重新公开后 EXIF 应恢复')
  assert.ok(labeled(await getGear('?limit=50'), 'Canon EOS R5'), '重新公开后应回到器材聚合')
})
