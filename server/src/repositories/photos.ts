/**
 * 照片仓储（只读部分）。
 *
 * 与 src/data/mock/repositories/photos.ts 行为对齐：
 *   - 只返回 status='published' 且未删除
 *   - latest 按 published_at 降序；popular 按 (like + favorite*3) 降序
 *   - 游标分页：cursor 是 base64url 编码的「上一页末尾排序键」
 *
 * 为什么用 keyset 而不是 OFFSET：
 *   OFFSET 20 需要先扫描并丢弃前 20 行，翻到第 100 页代价很大。
 *   keyset 用「排序键比上一页末尾更小」做条件，直接走索引。
 *   迁移里已建 idx_photos_feed (published_at desc, id desc) 正是为此。
 *
 * 游标格式（JSON → base64url）：
 *   latest : { p: published_at, i: id }
 *   popular: { s: score, p: published_at, i: id }
 *   把排序键完整编进游标，才能正确处理「分数并列」的分页。
 */
import type { PoolClient } from 'pg'
import { notFound } from '../lib/errors.js'
import { mapPhoto, type PhotoRow } from '../lib/mappers.js'

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

interface LatestCursor {
  p: string
  i: string
}
interface PopularCursor {
  s: number
  p: string
  i: string
}
type Cursor = LatestCursor | PopularCursor

function encodeCursor(obj: Cursor): string {
  return Buffer.from(JSON.stringify(obj), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/')
    const json = Buffer.from(padded, 'base64').toString('utf8')
    const obj = JSON.parse(json) as Record<string, unknown>
    if (typeof obj.i !== 'string' || typeof obj.p !== 'string') return null
    if (typeof obj.s === 'number') return { s: obj.s, p: obj.p, i: obj.i }
    return { p: obj.p, i: obj.i }
  } catch {
    return null
  }
}

export interface PhotoListQuery {
  sort: 'latest' | 'popular'
  categorySlug?: string
  /**
   * 按作者 username 过滤（大小写不敏感）。
   *
   * 为什么是 username 而不是 authorId：0018 之后公开资料接口不再返回稳定 user UUID，
   * 前端个人主页手里只有 username，按 UUID 过滤等于没有入口。解析只发生在 SQL 的
   * where 子句内（0023 的 api_profile_id_by_username，SECURITY DEFINER），
   * 该函数自己从不返回 UUID，app_user 也没有拿到任何新的表权限。
   * （作品载荷里的 authorId 是 /api/photos 既有行为，本参数不改变它。）
   *
   * 用户名不存在时子查询返回 null ⇒ `p.author_id = null` ⇒ 空列表，而不是报错。
   */
  authorUsername?: string
  cursor?: string
  limit?: number
}

/** 带作者公开信息的作品行（列表/详情/相关作品共用） */
export interface PhotoWithAuthorRow extends PhotoRow {
  author_username: string | null
  author_display_name: string | null
  author_avatar_key: string | null
}

/**
 * 在作品载荷上补作者公开字段。
 *
 * 为什么不再让前端按 UUID 反查：0018 的安全整改移除了 `GET /api/profiles/:id`，
 * 公开载荷里也不含作者联系方式。列表里直接带 username，前端就能跳 `/u/:username`，
 * 既不泄露 UUID 也不需要 N+1 请求。
 */
export function mapPhotoWithAuthor(row: PhotoWithAuthorRow) {
  return {
    ...mapPhoto(row),
    authorUsername: row.author_username,
    authorDisplayName: row.author_display_name,
    authorAvatarKey: row.author_avatar_key,
  }
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
  total: number
}

export async function listPhotos(
  client: PoolClient,
  query: PhotoListQuery,
): Promise<Page<ReturnType<typeof mapPhoto>>> {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

  // ---- 基础过滤（所有查询共享）----
  const baseParams: unknown[] = []
  const baseWhere: string[] = ["p.status = 'published'", 'p.deleted_at is null']
  if (query.categorySlug) {
    baseParams.push(query.categorySlug)
    baseWhere.push(`p.category_slug = $${baseParams.length}`)
  }
  if (query.authorUsername) {
    // 走标量子查询：Postgres 把它当 InitPlan 只求值一次，不随行重复调用。
    // 解析失败（用户名不存在/已注销）得到 null，比较结果恒为 null ⇒ 零行。
    baseParams.push(query.authorUsername)
    baseWhere.push(
      `p.author_id = (select public.api_profile_id_by_username($${baseParams.length}::text))`,
    )
  }
  const baseWhereSql = baseWhere.join(' and ')

  // ---- total（不受游标影响，只用基础过滤）----
  const countRes = await client.query<{ n: string }>(
    `select count(*)::text as n from public.photos p where ${baseWhereSql}`,
    baseParams,
  )
  const total = Number(countRes.rows[0]?.n ?? 0)

  // ---- 构造分页查询（基础参数之后追加游标参数，索引从 baseParams.length+1 开始）----
  const params = [...baseParams]
  const cursorWhere: string[] = []

  const cursor = query.cursor ? decodeCursor(query.cursor) : null

  if (cursor) {
    if (query.sort === 'popular' && 's' in cursor) {
      // 排序键：(score desc, published_at desc, id desc)
      // 继续条件：分数更低，或分数相同但 (published_at, id) 更小
      params.push(cursor.s)
      const sIdx = params.length
      params.push(cursor.p)
      const pIdx = params.length
      params.push(cursor.i)
      const iIdx = params.length
      cursorWhere.push(
        `((p.like_count + p.favorite_count * 3) < $${sIdx}
          or ((p.like_count + p.favorite_count * 3) = $${sIdx}
              and (p.published_at, p.id) < ($${pIdx}::timestamptz, $${iIdx}::uuid)))`,
      )
    } else if ('p' in cursor) {
      // latest：(published_at desc, id desc)
      params.push(cursor.p)
      const pIdx = params.length
      params.push(cursor.i)
      const iIdx = params.length
      cursorWhere.push(`(p.published_at, p.id) < ($${pIdx}::timestamptz, $${iIdx}::uuid)`)
    }
  }

  const orderBy =
    query.sort === 'popular'
      ? 'p.like_count + p.favorite_count * 3 desc, p.published_at desc, p.id desc'
      : 'p.published_at desc, p.id desc'

  params.push(limit + 1) // 多取一条用于判断 hasMore
  const limitIdx = params.length

  const sql = `
    select p.*,
             a.username as author_username,
             a.display_name as author_display_name,
             a.avatar_key as author_avatar_key,
            a.exif_visibility as author_exif_visibility
      from public.photos p
      left join public.profiles a on a.id = p.author_id
     where ${baseWhereSql}
       ${cursorWhere.length ? 'and ' + cursorWhere.join(' and ') : ''}
     order by ${orderBy}
     limit $${limitIdx}
  `

  const res = await client.query<PhotoWithAuthorRow>(sql, params)
  const rows = res.rows.slice(0, limit)
  const hasMore = res.rows.length > limit

  // 生成下一页游标：把最后一条的完整排序键编进去
  //
  // 注意：published_at 从 pg 驱动拿到的可能是 Date 对象，
  // 直接 String(Date) 得到 "Tue Oct 27 2026 10:48:23 GMT+0800 (中国标准时间)"，
  // PostgreSQL 无法解析这种格式，下一页会报 22P02。
  // 必须显式转 ISO 字符串。
  let nextCursor: string | null = null
  if (hasMore && rows.length > 0) {
    const last = rows[rows.length - 1]!
    const publishedIso =
      last.published_at instanceof Date ? last.published_at.toISOString() : String(last.published_at)

    if (query.sort === 'popular') {
      nextCursor = encodeCursor({
        s: last.like_count + last.favorite_count * 3,
        p: publishedIso,
        i: last.id,
      })
    } else {
      nextCursor = encodeCursor({ p: publishedIso, i: last.id })
    }
  }

  return { items: rows.map(mapPhotoWithAuthor), nextCursor, total }
}

export async function getPhoto(client: PoolClient, id: string) {
  const res = await client.query<PhotoWithAuthorRow>(
    `select p.*,
            a.username as author_username,
            a.display_name as author_display_name,
            a.avatar_key as author_avatar_key,
            a.exif_visibility as author_exif_visibility
       from public.photos p
       left join public.profiles a on a.id = p.author_id
      where p.id = $1`,
    [id],
  )
  const row = res.rows[0]
  if (!row) throw notFound(`作品不存在：${id}`)
  return mapPhotoWithAuthor(row)
}

/** 相关作品：同分类、排除自身、按点赞排序 */
export async function relatedPhotos(client: PoolClient, id: string, limit = 6) {
  const res = await client.query<PhotoWithAuthorRow>(
    `select p.*,
            a.username as author_username,
            a.display_name as author_display_name,
            a.avatar_key as author_avatar_key,
            a.exif_visibility as author_exif_visibility
       from public.photos p
       left join public.profiles a on a.id = p.author_id
      where p.category_slug = (select category_slug from public.photos where id = $1)
        and p.id <> $1
        and p.status = 'published'
        and p.deleted_at is null
      order by p.like_count desc, p.published_at desc
      limit $2`,
    [id, limit],
  )
  return res.rows.map(mapPhoto)
}
