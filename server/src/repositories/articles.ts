/**
 * 教程文章仓储（只读）。
 */
import type { PoolClient } from 'pg'
import { notFound } from '../lib/errors.js'
import { mapArticle, type ArticleRow } from '../lib/mappers.js'

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

export interface ArticleListQuery {
  topicSlug?: string
  difficulty?: string
  cursor?: string
  limit?: number
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
  total: number
}

export async function listArticles(
  client: PoolClient,
  query: ArticleListQuery,
): Promise<Page<ReturnType<typeof mapArticle>>> {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

  const baseParams: unknown[] = []
  const where: string[] = ["status = 'published'"]
  if (query.topicSlug) {
    baseParams.push(query.topicSlug)
    where.push(`topic_slug = $${baseParams.length}`)
  }
  if (query.difficulty) {
    baseParams.push(query.difficulty)
    where.push(`difficulty = $${baseParams.length}`)
  }
  const whereSql = where.join(' and ')

  const countRes = await client.query<{ n: string }>(
    `select count(*)::text as n from public.articles where ${whereSql}`,
    baseParams,
  )
  const total = Number(countRes.rows[0]?.n ?? 0)

  const params = [...baseParams]
  if (query.cursor) {
    // 游标就是上一页最后一条 id，按 published_at 定位
    const lastId = Buffer.from(
      query.cursor.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8')
    params.push(lastId)
    where.push(
      `(published_at, id) < (select published_at, id from public.articles where id = $${params.length})`,
    )
  }

  params.push(limit + 1)
  const limitIdx = params.length

  const res = await client.query<ArticleRow>(
    `select * from public.articles
      where ${where.join(' and ')}
      order by published_at desc, id desc
      limit $${limitIdx}`,
    params,
  )

  const rows = res.rows.slice(0, limit)
  const hasMore = res.rows.length > limit
  let nextCursor: string | null = null
  if (hasMore && rows.length > 0) {
    nextCursor = Buffer.from(rows[rows.length - 1]!.id, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }

  return { items: rows.map(mapArticle), nextCursor, total }
}

export async function getArticleBySlug(client: PoolClient, slug: string) {
  const res = await client.query<ArticleRow>('select * from public.articles where slug = $1', [slug])
  const row = res.rows[0]
  if (!row) throw notFound(`文章不存在：${slug}`)
  return mapArticle(row)
}
