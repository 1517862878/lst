/**
 * Mock 文章仓储。契约：ArticleRepository。
 */
import { AppError, ErrorCodes, type ArticleListQuery, type ArticleRepository } from '@/data/contracts'
import type { Article, ArticleTopic } from '@/domain/types'
import { ARTICLE_TOPICS } from '@/domain/constants'
import { getDb } from '../db'

export const mockArticleRepository: ArticleRepository = {
  async list(query: ArticleListQuery): Promise<{ items: Article[]; nextCursor: string | null; total: number }> {
    const db = await getDb()
    let all = (await db.getAll('articles')).filter((a) => a.status === 'published')
    if (query.topicSlug) all = all.filter((a) => a.topicSlug === query.topicSlug)
    if (query.difficulty) all = all.filter((a) => a.difficulty === query.difficulty)
    all.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    const limit = query.limit ?? 20
    let startIndex = 0
    if (query.cursor) {
      startIndex = all.findIndex((a) => a.id === query.cursor)
      if (startIndex === -1) startIndex = 0
      else startIndex += 1
    }
    const items = all.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < all.length
    const nextCursor = hasMore ? items[items.length - 1]!.id : null
    return { items, nextCursor, total: all.length }
  },

  async getBySlug(slug: string): Promise<Article> {
    const db = await getDb()
    const all = await db.getAll('articles')
    const article = all.find((a) => a.slug === slug)
    if (!article) throw new AppError(ErrorCodes.NOT_FOUND, `文章不存在：${slug}`)
    return article
  },

  async listTopics(): Promise<ArticleTopic[]> {
    const db = await getDb()
    const rows = await db.getAll('topics')
    if (rows.length > 0) return rows.sort((a, b) => a.sortOrder - b.sortOrder)
    return [...ARTICLE_TOPICS].sort((a, b) => a.sortOrder - b.sortOrder)
  },
}
