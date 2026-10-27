/** 已发布作品的服务端搜索。关键词按空白拆分；每个词都必须命中标题、心得、地点或标签之一。 */
import type { PoolClient } from 'pg'
import { validation } from '../lib/errors.js'
import { mapPhoto, type PhotoRow } from '../lib/mappers.js'

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

export interface SearchPhotosQuery {
  text: string
  categorySlug?: string
  sort: 'latest' | 'popular'
  limit?: number
}

export async function searchPhotos(client: PoolClient, query: SearchPhotosQuery) {
  const terms = query.text.trim().split(/\s+/u).filter(Boolean)
  if (terms.length === 0) throw validation('q 不能为空')
  if (terms.length > 8) throw validation('搜索关键词不能超过 8 个')

  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const params: unknown[] = []
  const where = ["p.status = 'published'", 'p.deleted_at is null']

  if (query.categorySlug) {
    params.push(query.categorySlug)
    where.push(`p.category_slug = $${params.length}`)
  }

  for (const term of terms) {
    params.push(`%${term}%`)
    const n = params.length
    where.push(`(
      p.title ilike $${n}
      or p.description ilike $${n}
      or p.location_name ilike $${n}
      or exists (select 1 from unnest(p.tags) tag where tag ilike $${n})
    )`)
  }

  const whereSql = where.join(' and ')
  const count = await client.query<{ n: string }>(
    `select count(*)::text as n from public.photos p where ${whereSql}`,
    params,
  )
  const total = Number(count.rows[0]?.n ?? 0)
  const orderBy = query.sort === 'popular'
    ? 'p.like_count + p.favorite_count * 3 desc, p.published_at desc, p.id desc'
    : 'p.published_at desc, p.id desc'

  params.push(limit)
  const rows = await client.query<PhotoRow>(
    `select p.* from public.photos p where ${whereSql} order by ${orderBy} limit $${params.length}`,
    params,
  )

  return { items: rows.rows.map(mapPhoto), nextCursor: null, total }
}
