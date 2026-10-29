/**
 * 数据源工厂（ROADMAP D-01 / FRONTEND-WORK §0.2）。
 *
 * 页面与 hooks 只通过 createRepositories() 取仓储，
 * 具体用哪个实现由此处决定，页面代码零改动。
 *
 * 切换方式（.env.local）：
 *   VITE_DATA_SOURCE=mock   ← 默认，数据在浏览器 IndexedDB
 *   VITE_DATA_SOURCE=api    ← 连后端，数据在 PostgreSQL
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
import { mockSocialRepository } from './mock/repositories/social'
import { mockStorageRepository } from './mock/repositories/storage'
import { mockModerationRepository } from './mock/repositories/moderation'
import { mockTagRepository } from './mock/repositories/tags'
import { mockCollectionRepository } from './mock/repositories/collections'
import { mockDiscoverRepository } from './mock/repositories/discover'
import { mockStatsRepository } from './mock/repositories/stats'

import { apiPhotoRepository } from './api/photos'
import { apiCategoryRepository } from './api/categories'
import { apiArticleRepository } from './api/articles'
import { apiRankingRepository } from './api/rankings'
import { apiAuthRepository } from './api/auth'
import { apiSearchRepository } from './api/search'
import { apiStorageRepository } from './api/storage'
import { apiCommentRepository } from './api/comments'
import { apiInteractionRepository } from './api/interactions'
import { apiSocialRepository } from './api/social'
import { apiModerationRepository } from './api/moderation'
import { apiTagRepository } from './api/tags'
import { apiCollectionRepository } from './api/collections'
import { apiDiscoverRepository } from './api/discover'
import { apiStatsRepository } from './api/stats'

let cached: Repositories | null = null

/** 当前数据源（供界面显示"演示模式 / 在线模式"） */
export function dataSource(): 'mock' | 'api' {
  return import.meta.env.VITE_DATA_SOURCE === 'api' ? 'api' : 'mock'
}

/** 获取仓储集合（惰性单例） */
export function createRepositories(): Repositories {
  if (cached) return cached

  if (dataSource() === 'api') {
    cached = {
      photos: apiPhotoRepository,
      interactions: apiInteractionRepository,
      comments: apiCommentRepository,
      rankings: apiRankingRepository,
      articles: apiArticleRepository,
      categories: apiCategoryRepository,
      auth: apiAuthRepository,
      storage: apiStorageRepository,
      search: apiSearchRepository,
      social: apiSocialRepository,
      moderation: apiModerationRepository,
      tags: apiTagRepository,
      collections: apiCollectionRepository,
      discover: apiDiscoverRepository,
      stats: apiStatsRepository,
    }
  } else {
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
      social: mockSocialRepository,
      moderation: mockModerationRepository,
      tags: mockTagRepository,
      collections: mockCollectionRepository,
      discover: mockDiscoverRepository,
      stats: mockStatsRepository,
    }
  }

  return cached
}

/** 测试或切换数据源后重置单例 */
export function resetRepositories(): void {
  cached = null
}

export * from './contracts'
