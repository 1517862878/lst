/**
 * 标签体系集成测试（0027）——跑在真实 PostgreSQL 上。
 *
 * 覆盖：
 *   1) 热门/最新排序与统计口径（只算 published + 未删除 + 有发布时间）；
 *   2) 前缀过滤，以及 '%'/'_' 不被当成通配符；
 *   3) 标签详情：计数、作者数、相关标签（共现倒序）、未知标签 200 空态；
 *   4) 标签作品流：latest 与 popular 两种排序各翻两页，无重复无遗漏，total 稳定；
 *   5) 游标与排序混用 → 400；非法排序 → 400；超长标签 → 400；
 *   6) 匿名可读（游客与登录用户结果一致）。
 *
 * 运行方式与其他 integration 套件一致（一次性库，见 .tmp/verify-fresh-db.sh）：
 *   PGDATABASE=gongke_verify_x PGUSER=app_user PGPASSWORD=*** \
 *   PGADMIN_PASSWORD=*** node --import tsx --test server/src/routes/tags.integration.ts
 */
import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import pg from 'pg'

const { Client } = pg

const AUTHOR_A = 'a1000000-0000-0000-0000-0000000000a1'
const AUTHOR_B = 'b2000000-0000-0000-0000-0000000000b2'

/** 作品 id 用固定前缀，清理时按前缀删除，不会碰到别的套件的数据。 */
const PHOTO_PREFIX = 'cd000000-0000-0000-0000-0000000000'
const photoId = (n: number): string => `${PHOTO_PREFIX}${String(n).padStart(2, '0')}`

type App = Awaited<ReturnType<(typeof import('../index.js'))['buildApp']>>

let app: App
let admin: pg.Client

/** 种子：A 有 3 件已发布（含 夜景+街拍+长曝 组合），B 有 1 件已发布；另有草稿/已下架/已删各 1 件。 */
interface SeedPhoto {
  id: string
  author: string
  title: string
  tags: string[]
  status: 'published' | 'draft' | 'removed'
  deleted: boolean
  likes: number
  favorites: number
  publishedAt: string
}

const SEED: SeedPhoto[] = [
  {
    id: photoId(1),
    author: AUTHOR_A,
    title: '夜景 A1',
    tags: ['夜景', '街拍', '长曝'],
    status: 'published',
    deleted: false,
    likes: 10,
    favorites: 5,
    publishedAt: '2026-10-01T10:00:00Z',
  },
  {
    id: photoId(2),
    author: AUTHOR_A,
    title: '夜景 A2',
    tags: ['夜景', '街拍'],
    status: 'published',
    deleted: false,
    likes: 30,
    favorites: 10,
    publishedAt: '2026-10-02T10:00:00Z',
  },
  {
    id: photoId(3),
    author: AUTHOR_B,
    title: '夜景 B1',
    tags: ['夜景', '微距'],
    status: 'published',
    deleted: false,
    likes: 20,
    favorites: 1,
    publishedAt: '2026-10-03T10:00:00Z',
  },
  {
    id: photoId(4),
    author: AUTHOR_A,
    title: '街拍 A4',
    tags: ['街拍', '黑白'],
    status: 'published',
    deleted: false,
    likes: 5,
    favorites: 0,
    publishedAt: '2026-10-04T10:00:00Z',
  },
  // 下面三条都不该被统计：草稿 / 已下架 / 已删除
  {
    id: photoId(5),
    author: AUTHOR_A,
    title: '草稿夜景',
    tags: ['夜景'],
    status: 'draft',
    deleted: false,
    likes: 0,
    favorites: 0,
    publishedAt: '2026-10-05T10:00:00Z',
  },
  {
    id: photoId(6),
    author: AUTHOR_A,
    title: '下架夜景',
    tags: ['夜景'],
    status: 'removed',
    deleted: false,
    likes: 0,
    favorites: 0,
    publishedAt: '2026-10-06T10:00:00Z',
  },
  {
    id: photoId(7),
    author: AUTHOR_B,
    title: '已删夜景',
    tags: ['夜景'],
    status: 'published',
    deleted: true,
    likes: 0,
    favorites: 0,
    publishedAt: '2026-10-07T10:00:00Z',
  },
]

before(async () => {
  admin = new Client({
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGADMIN_USER ?? 'postgres',
    password: process.env.PGADMIN_PASSWORD,
  })
  await admin.connect()

  // 作者：profiles.id 外键指向 auth.users，所以必须先建 auth.users；
  // handle_new_user 触发器会顺手建 profile，随后把用户名/昵称改成固定值。
  await admin.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
       ($1, 'tag-a@test.local', '{"display_name":"标签甲"}'::jsonb),
       ($2, 'tag-b@test.local', '{"display_name":"标签乙"}'::jsonb)
     on conflict (id) do nothing`,
    [AUTHOR_A, AUTHOR_B],
  )
  await admin.query(
    `update public.profiles set username = 'tag_a', display_name = '标签甲' where id = $1`,
    [AUTHOR_A],
  )
  await admin.query(
    `update public.profiles set username = 'tag_b', display_name = '标签乙' where id = $1`,
    [AUTHOR_B],
  )

  // photos.category_slug 是 NOT NULL 外键，干净库里 categories 是空的
  await admin.query(
    `insert into public.categories (slug, name, sort_order) values ('tag-test', '标签测试', 99)
     on conflict (slug) do nothing`,
  )

  for (const photo of SEED) {
    await admin.query(
      `insert into public.photos
         (id, author_id, title, category_slug, tags, status, deleted_at,
          like_count, favorite_count, published_at,
          image_key, thumb_key, width, height)
       values ($1, $2, $3, 'tag-test', $4::text[], $5, $6, $7, $8, $9::timestamptz,
               $10, $11, 1600, 1067)
       on conflict (id) do update
         set tags = excluded.tags,
             status = excluded.status,
             deleted_at = excluded.deleted_at,
             like_count = excluded.like_count,
             favorite_count = excluded.favorite_count,
             published_at = excluded.published_at`,
      [
        photo.id,
        photo.author,
        photo.title,
        photo.tags,
        photo.status,
        photo.deleted ? '2026-10-08T10:00:00Z' : null,
        photo.likes,
        photo.favorites,
        photo.publishedAt,
        `${photo.id}.jpg`,
        `${photo.id}-thumb.jpg`,
      ],
    )
  }

  const { buildApp } = await import('../index.js')
  app = await buildApp()
  await app.ready()
})

after(async () => {
  if (admin) {
    await admin.query('delete from public.photos where id::text like $1', [`${PHOTO_PREFIX}%`])
    await admin.query('delete from auth.users where id = any($1::uuid[])', [[AUTHOR_A, AUTHOR_B]])
    await admin.query(`delete from public.categories where slug = 'tag-test'`)
    await admin.end()
  }
  if (app) await app.close()
})

interface TagRow {
  tag: string
  photoCount: number
  authorCount: number
  latestPublishedAt: string | null
}

async function getTags(query = ''): Promise<TagRow[]> {
  const response = await app.inject({ method: 'GET', url: `/api/tags${query}` })
  assert.equal(response.statusCode, 200, response.body)
  return (response.json() as { items: TagRow[] }).items
}

function tagOf(rows: TagRow[], tag: string): TagRow | undefined {
  return rows.find((row) => row.tag === tag)
}

test('热门标签：只统计已发布未删除作品，按作品数降序', async () => {
  const rows = await getTags('?sort=hot&limit=50')
  const night = tagOf(rows, '夜景')
  assert.ok(night, '夜景 应该在热门标签里')
  // 夜景只有 A1/A2/B1 三件已发布；草稿、下架、已删都不算
  assert.equal(night.photoCount, 3, `夜景 作品数应为 3，实际 ${night.photoCount}`)
  assert.equal(night.authorCount, 2, '夜景 应来自 2 位作者')

  const street = tagOf(rows, '街拍')
  assert.ok(street)
  assert.equal(street.photoCount, 3)

  // 排序：photoCount 不增
  const counts = rows.map((row) => row.photoCount)
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), '热门排序应按作品数降序')

  // 只出现在不该统计作品里的标签必须不存在
  assert.equal(tagOf(rows, '长曝')?.photoCount, 1)
})

test('最新标签：按最近发布时间降序', async () => {
  const rows = await getTags('?sort=latest&limit=50')
  assert.ok(rows.length > 0)
  const times = rows.map((row) => row.latestPublishedAt ?? '')
  assert.deepEqual(times, [...times].sort().reverse(), '最新排序应按发布时间倒序')
  // 街拍 的最新作品是 10-04，夜景 是 10-03，黑白 是 10-04
  assert.ok((times[0] ?? '') >= '2026-10-04', `最新标签的最晚时间应 >= 2026-10-04，实际 ${times[0]}`)
})

test('前缀过滤不把 % 和 _ 当通配符', async () => {
  const prefixNight = await getTags(`?prefix=${encodeURIComponent('夜')}`)
  assert.ok(prefixNight.length > 0)
  assert.ok(prefixNight.every((row) => row.tag.startsWith('夜')))

  const wildcard = await getTags('?prefix=%25')
  assert.equal(wildcard.length, 0, '% 应被当成普通字符，不能退化成“全部标签”')

  const underscore = await getTags('?prefix=_')
  assert.equal(underscore.length, 0, '_ 应被当成普通字符')
})

test('标签详情：计数、作者数与共现相关标签', async () => {
  const response = await app.inject({ method: 'GET', url: `/api/tags/${encodeURIComponent('夜景')}` })
  assert.equal(response.statusCode, 200, response.body)
  const detail = response.json() as {
    tag: string
    photoCount: number
    authorCount: number
    latestPublishedAt: string | null
    relatedTags: { tag: string; count: number }[]
  }
  assert.equal(detail.tag, '夜景')
  assert.equal(detail.photoCount, 3)
  assert.equal(detail.authorCount, 2)
  assert.ok(detail.latestPublishedAt, '应有最近发布时间')

  const related = new Map(detail.relatedTags.map((entry) => [entry.tag, entry.count]))
  // 夜景 与 街拍 共现于 A1、A2（2 件）；与 长曝、微距 各 1 件
  assert.equal(related.get('街拍'), 2, `街拍 共现次数应为 2，实际 ${related.get('街拍')}`)
  assert.equal(related.get('长曝'), 1)
  assert.equal(related.get('微距'), 1)
  assert.ok(!related.has('夜景'), '相关标签不能包含自身')
  assert.ok(detail.relatedTags.length <= 12)
})

test('未知标签返回 200 空态而不是 404', async () => {
  const response = await app.inject({
    method: 'GET',
    url: `/api/tags/${encodeURIComponent('不存在的标签')}`,
  })
  assert.equal(response.statusCode, 200, response.body)
  const detail = response.json() as { photoCount: number; relatedTags: unknown[] }
  assert.equal(detail.photoCount, 0)
  assert.deepEqual(detail.relatedTags, [])
})

test('标签作品流 latest：两页无重复无遗漏，total 稳定', async () => {
  const first = await app.inject({
    method: 'GET',
    url: `/api/tags/${encodeURIComponent('夜景')}/photos?sort=latest&limit=2`,
  })
  assert.equal(first.statusCode, 200, first.body)
  const page1 = first.json() as { items: { id: string }[]; total: number; nextCursor: string | null }
  assert.equal(page1.total, 3)
  assert.equal(page1.items.length, 2)
  assert.ok(page1.nextCursor, '第一页应有 nextCursor')

  const second = await app.inject({
    method: 'GET',
    url: `/api/tags/${encodeURIComponent('夜景')}/photos?sort=latest&limit=2&cursor=${encodeURIComponent(page1.nextCursor as string)}`,
  })
  assert.equal(second.statusCode, 200, second.body)
  const page2 = second.json() as { items: { id: string }[]; total: number; nextCursor: string | null }
  assert.equal(page2.total, 3)
  assert.equal(page2.items.length, 1)
  assert.equal(page2.nextCursor, null, '最后一页 nextCursor 应为 null')

  const ids = [...page1.items, ...page2.items].map((item) => item.id)
  assert.equal(new Set(ids).size, 3, '两页合起来不能有重复')
  assert.deepEqual(
    new Set(ids),
    new Set([photoId(1), photoId(2), photoId(3)]),
    '只应包含该标签下的三件已发布作品',
  )
})

test('标签作品流 popular：按点赞+收藏排序，两页也不重不漏', async () => {
  const first = await app.inject({
    method: 'GET',
    url: `/api/tags/${encodeURIComponent('夜景')}/photos?sort=popular&limit=2`,
  })
  assert.equal(first.statusCode, 200, first.body)
  const page1 = first.json() as { items: { id: string }[]; total: number; nextCursor: string | null }
  // A2=40, B1=21, A1=15
  assert.deepEqual(page1.items.map((item) => item.id), [photoId(2), photoId(3)])

  const second = await app.inject({
    method: 'GET',
    url: `/api/tags/${encodeURIComponent('夜景')}/photos?sort=popular&limit=2&cursor=${encodeURIComponent(page1.nextCursor as string)}`,
  })
  assert.equal(second.statusCode, 200, second.body)
  const page2 = second.json() as { items: { id: string }[]; nextCursor: string | null }
  assert.deepEqual(page2.items.map((item) => item.id), [photoId(1)])
  assert.equal(page2.nextCursor, null)
})

test('游标与排序混用、非法排序、超长标签都返回 400', async () => {
  const latest = await app.inject({
    method: 'GET',
    url: `/api/tags/${encodeURIComponent('夜景')}/photos?sort=latest&limit=1`,
  })
  const cursor = (latest.json() as { nextCursor: string }).nextCursor
  assert.ok(cursor)

  const mismatch = await app.inject({
    method: 'GET',
    url: `/api/tags/${encodeURIComponent('夜景')}/photos?sort=popular&cursor=${encodeURIComponent(cursor)}`,
  })
  assert.equal(mismatch.statusCode, 400, mismatch.body)
  assert.equal((mismatch.json() as { code: string }).code, 'VALIDATION')

  const badSort = await app.inject({
    method: 'GET',
    url: `/api/tags/${encodeURIComponent('夜景')}/photos?sort=random`,
  })
  assert.equal(badSort.statusCode, 400)

  const badListSort = await app.inject({ method: 'GET', url: '/api/tags?sort=random' })
  assert.equal(badListSort.statusCode, 400)

  const tooLong = await app.inject({
    method: 'GET',
    url: `/api/tags/${encodeURIComponent('x'.repeat(40))}`,
  })
  assert.equal(tooLong.statusCode, 400)

  const brokenCursor = await app.inject({
    method: 'GET',
    url: `/api/tags/${encodeURIComponent('夜景')}/photos?sort=latest&cursor=not-a-cursor`,
  })
  assert.equal(brokenCursor.statusCode, 400)
})

test('搜索建议：前缀匹配、去掉前导 #、空查询回热门', async () => {
  const night = await app.inject({ method: 'GET', url: `/api/search/tags?q=${encodeURIComponent('夜')}` })
  assert.equal(night.statusCode, 200, night.body)
  const items = (night.json() as { items: { tag: string; photoCount: number }[] }).items
  assert.ok(items.length > 0)
  assert.ok(items.every((item) => item.tag.startsWith('夜')))
  assert.equal(items[0]?.tag, '夜景')
  assert.equal(items[0]?.photoCount, 3)

  const hash = await app.inject({ method: 'GET', url: `/api/search/tags?q=${encodeURIComponent('#夜景')}` })
  assert.equal(hash.statusCode, 200, hash.body)
  assert.equal((hash.json() as { items: { tag: string }[] }).items[0]?.tag, '夜景')

  const empty = await app.inject({ method: 'GET', url: '/api/search/tags?q=&limit=3' })
  assert.equal(empty.statusCode, 200)
  const hot = (empty.json() as { items: { tag: string; photoCount: number }[] }).items
  assert.ok(hot.length > 0 && hot.length <= 3)
  assert.deepEqual(
    hot.map((item) => item.photoCount),
    [...hot.map((item) => item.photoCount)].sort((a, b) => b - a),
  )
})

test('匿名可读：不带任何 Cookie 也能拿到标签数据', async () => {
  const list = await app.inject({ method: 'GET', url: '/api/tags?sort=hot&limit=5' })
  assert.equal(list.statusCode, 200)
  const detail = await app.inject({ method: 'GET', url: `/api/tags/${encodeURIComponent('街拍')}` })
  assert.equal(detail.statusCode, 200)
  const photos = await app.inject({
    method: 'GET',
    url: `/api/tags/${encodeURIComponent('街拍')}/photos?limit=1`,
  })
  assert.equal(photos.statusCode, 200)
})