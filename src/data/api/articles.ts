/**
 * API 教程仓储（读 + 写）。
 *
 * 写入对应后端的 0039 路由：
 *   POST   /api/articles        创建（草稿或直接发布）
 *   PATCH  /api/articles/:id    修改自己的文章
 *   DELETE /api/articles/:id    删除自己的文章
 *   GET    /api/me/articles     自己的文章（含草稿）
 */
import type {
  ArticleWriteInput,
  ArticleUpdateInput,
  ArticleListQuery,
  ArticleRepository,
  Page,
} from '@/data/contracts'
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

  async listMine(): Promise<Article[]> {
    return request<Article[]>('/api/me/articles')
  },

  async create(input: ArticleWriteInput): Promise<Article> {
    // id 由前端生成（与作品发布一致）：后端不接受客户端指定的任意字段，
    // 但要能提前生成本地目录/草稿标识，所以沿用这个约定。
    return request<Article>('/api/articles', {
      method: 'POST',
      body: { id: crypto.randomUUID(), ...input },
    })
  },

  async update(id: string, input: ArticleUpdateInput): Promise<Article> {
    return request<Article>(`/api/articles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    })
  },

  async remove(id: string): Promise<void> {
    await request<void>(`/api/articles/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  async slugTaken(slug: string): Promise<boolean> {
    // 后端在创建时已查重并返回 409；这里给表单做即时提示，
    // 用一个轻量接口：存在则 200 返回该文章，不存在 404 → 视为可用。
    try {
      await request<Article>(`/api/articles/${encodeURIComponent(slug)}`)
      return true
    } catch {
      return false
    }
  },
}
