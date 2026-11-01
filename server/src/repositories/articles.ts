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

/**
 * 作者本人：自己的全部文章（草稿 + 已发布），按更新时间倒序。
 *
 * 走 withRls(作者自己)：p_articles_select 允许 author_id = auth.uid() 读到自己的草稿，
 * 所以这里不需要额外过滤状态 —— RLS 已经把可见范围限死，再加 where 反而重复。
 */
export async function listMyArticles(client: PoolClient) {
  const res = await client.query<ArticleRow>(
    `select * from public.articles
      where author_id = auth.uid()
      order by updated_at desc, id desc`,
  )
  return res.rows.map(mapArticle)
}

export async function getArticleBySlug(client: PoolClient, slug: string) {
  const res = await client.query<ArticleRow>('select * from public.articles where slug = $1', [slug])
  const row = res.rows[0]
  if (!row) throw notFound(`文章不存在：${slug}`)
  return mapArticle(row)
}

// ============================================================================
// 写入（0039）：用户自行上传教程文章
//
// 三件事都交给 0039 的 SECURITY DEFINER 函数做，应用层不直写表：
//   · 表级写权限已从 app_user 收回（0039 的自检会守住这条）；
//   · 作者身份恒由函数里的 auth.uid() 决定，请求体传不了 authorId。
// ============================================================================

export interface CreateArticleInput {
  id: string
  slug: string
  topicSlug: string
  title: string
  summary: string
  bodyMd: string
  difficulty: string
  readingMinutes: number
  tags: string[]
  equipment: string[]
  relatedPhotoIds: string[]
  publish: boolean
}

export interface UpdateArticleInput {
  title: string
  summary: string
  bodyMd: string
  topicSlug: string
  difficulty: string
  readingMinutes: number
  tags: string[]
  equipment: string[]
  relatedPhotoIds: string[]
  publish: boolean
}

export async function createArticle(client: PoolClient, input: CreateArticleInput) {
  const { rows } = await client.query<ArticleRow>(
    `select a.* from public.api_create_article(
       $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,
       $8::integer,$9::text[],$10::text[],$11::text[],$12::boolean
     ) as a`,
    [
      input.id, input.slug, input.topicSlug, input.title, input.summary, input.bodyMd,
      input.difficulty, input.readingMinutes, input.tags, input.equipment,
      input.relatedPhotoIds, input.publish,
    ],
  )
  return mapArticle(rows[0]!)
}

export async function updateArticle(
  client: PoolClient,
  id: string,
  input: UpdateArticleInput,
) {
  const { rows } = await client.query<ArticleRow>(
    `select a.* from public.api_update_article(
       $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::integer,
       $8::text[],$9::text[],$10::text[],$11::boolean
     ) as a`,
    [
      id, input.title, input.summary, input.bodyMd, input.topicSlug, input.difficulty,
      input.readingMinutes, input.tags, input.equipment, input.relatedPhotoIds, input.publish,
    ],
  )
  return mapArticle(rows[0]!)
}

export async function deleteArticle(client: PoolClient, id: string): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>(
    'select public.api_delete_article($1::uuid) as ok',
    [id],
  )
  return rows[0]?.ok === true
}

/**
 * slug 可用性（创建前查重）。
 *
 * 为什么单独查一次而不是靠 23505：slug 冲突要给用户「换个标题/地址」的可操作提示，
 * 而 23505 经 translateDbError 会变成泛化的 409 —— 用户不知道该改什么。
 * 真正的唯一性仍由数据库唯一索引兜底（并发下这一次查询可能过时）。
 */
export async function articleSlugTaken(
  client: PoolClient,
  slug: string,
): Promise<boolean> {
  const { rows } = await client.query<{ n: string }>(
    "select count(*)::text as n from public.articles where slug = $1",
    [slug],
  )
  return Number(rows[0]?.n ?? 0) > 0
}
