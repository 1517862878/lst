/**
 * 分类与主题仓储（纯字典表，公开只读）。
 */
import type { PoolClient } from 'pg'
import { notFound } from '../lib/errors.js'
import { mapCategory, mapArticleTopic, type CategoryRow, type ArticleTopicRow } from '../lib/mappers.js'

export async function listCategories(client: PoolClient) {
  const res = await client.query<CategoryRow>(
    `select slug, name, description, sort_order, cover_photo_id, is_active
       from public.categories
      where is_active = true
      order by sort_order asc`,
  )
  return res.rows.map(mapCategory)
}

export async function getCategory(client: PoolClient, slug: string) {
  const res = await client.query<CategoryRow>(
    `select slug, name, description, sort_order, cover_photo_id, is_active
       from public.categories where slug = $1`,
    [slug],
  )
  const row = res.rows[0]
  if (!row) throw notFound(`分类不存在：${slug}`)
  return mapCategory(row)
}

export async function listArticleTopics(client: PoolClient) {
  const res = await client.query<ArticleTopicRow>(
    `select slug, name, description, sort_order
       from public.article_topics
      order by sort_order asc`,
  )
  return res.rows.map(mapArticleTopic)
}
