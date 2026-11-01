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
  /*
   * 已下架的分类对外一律 404。
   *
   * 背景（2026-11 分类换代，迁移 0038）：旧的题材分类（landscape 等）没有物理删除，
   * 而是 is_active = false 软下架，以便回滚与旧链接温和退场。
   * 若这里不过滤，/categories/landscape 会返回一个「有名字但查不到作品」的分类页，
   * 比直接 404 更让人困惑；列表接口早已过滤，两个接口的口径必须一致。
   */
  if (!row.is_active) throw notFound(`分类不存在：${slug}`)
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
