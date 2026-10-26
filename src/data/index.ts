/**
 * 数据源工厂（ROADMAP D-01 / FRONTEND-WORK §0.2）。
 * 页面与 hooks 只通过 createRepositories() 取仓储；这里做 mock/supabase 切换。
 */
import type { Repositories } from './contracts'
import { mockAuthRepository } from './mock/repositories/auth'
import { mockArticleRepository } from './mock/repositories/articles'
import { mockCategoryRepository } from './mock/repositories/categories'
import { mockCommentRepository } from './mock/repositories/comments'
import { mockInteractionRepository } from './mock/repositories/interactions'
import { mockPhotoRepository } from './mock/repositories/photos'
import { mockRankingRepository } from './mock/repositories/rankings'
import { mockSearchRepository } from './mock/repositories/search'
import { mockStorageRepository } from './mock/repositories/storage'

let cached: Repositories | null = null

/** 获取仓储集合（惰性单例）。数据源切换只改这里（VITE_DATA_SOURCE 动态期启用） */
export function createRepositories(): Repositories {
  if (cached) return cached
  const source = import.meta.env.VITE_DATA_SOURCE ?? 'mock'

  if (source === 'mock') {
    cached = {
      photos: mockPhotoRepository,
      interactions: mockInteractionRepository,
      comments: mockCommentRepository,
      rankings: mockRankingRepository,
      articles: mockArticleRepository,
      categories: mockCategoryRepository,
      auth: mockAuthRepository,
      storage: mockStorageRepository,
      search: mockSearchRepository,
    }
    return cached
  }

  // 动态期：supabase 实现（S2 阶段尚未提供）
  throw new Error(`未知数据源：${source}（动态期 Supabase 适配器将在 D2 阶段实现）`)
}

export * from './contracts'
