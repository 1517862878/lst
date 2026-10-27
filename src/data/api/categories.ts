/**
 * API 分类仓储。
 */
import type { CategoryRepository } from '@/data/contracts'
import type { Category, ArticleTopic } from '@/domain/types'
import { request } from './client'

export const apiCategoryRepository: CategoryRepository = {
  async list(): Promise<Category[]> {
    return request<Category[]>('/api/categories')
  },

  async get(slug: string): Promise<Category> {
    return request<Category>(`/api/categories/${encodeURIComponent(slug)}`)
  },
}

/** 教程主题（不属于 CategoryRepository，单独暴露） */
export async function listArticleTopics(): Promise<ArticleTopic[]> {
  return request<ArticleTopic[]>('/api/article-topics')
}
