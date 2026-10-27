/**
 * API 教程仓储。
 */
import type { ArticleListQuery, ArticleRepository, Page } from '@/data/contracts'
import type { Article, ArticleTopic } from '@/domain/types'
import { request, qs } from './client'

export const apiArticleRepository: ArticleRepository = {
  async list(query: ArticleListQuery): Promise<Page<Article>> {
    return request<Page<Article>>(
      '/api/articles' +
        qs({
          topicSlug: query.topicSlug,
          difficulty: query.difficulty,
          cursor: query.cursor,
          limit: query.limit,
        }),
    )
  },

  async getBySlug(slug: string): Promise<Article> {
    return request<Article>(`/api/articles/${encodeURIComponent(slug)}`)
  },

  async listTopics(): Promise<ArticleTopic[]> {
    return request<ArticleTopic[]>('/api/article-topics')
  },
}
