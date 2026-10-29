/**
 * Mock 发现仓储（8.3c）。
 *
 * 行为与 api 实现一致（同一份契约、同一套纯函数 domain/discover.ts），
 * 差异只在数据落地位置：这里读 IndexedDB，api 那边读 Postgres 聚合视图。
 *
 * 「编辑精选」是唯一会写库的发现动作：photos.featuredAt 直接落在作品行上，
 * 没有第二张表可同步，也就没有「精选表与作品不一致」的状态。
 */
import {
  AppError,
  ErrorCodes,
  type CursorListPage,
  type DiscoverRepository,
  type EditorChoiceResult,
  type HotSearch,
  type HotSearchQuery,
  type NewAuthor,
  type NewAuthorQuery,
} from '@/data/contracts'
import type { Photo, Profile } from '@/domain/types'
import {
  FEATURED_LIMIT,
  FEATURED_LIMIT_MAX,
  HOT_SEARCH_DAYS,
  HOT_SEARCH_LIMIT,
  NEW_AUTHOR_DAYS,
  buildHotSearches,
  buildNewAuthors,
  clampInt,
  sortFeaturedPhotos,
} from '@/domain/discover'
import { paginateByCursor } from '@/domain/social'
import { getDb } from '../db'
import { mockAuthRepository } from './auth'

async function loadPhotos(): Promise<Photo[]> {
  const db = await getDb()
  return db.getAll('photos')
}

async function loadProfiles(): Promise<Profile[]> {
  const db = await getDb()
  return db.getAll('profiles')
}

/** 当前会话必须是 staff：与后端 api_set_editor_choice 的授权口径一致 */
async function requireStaff(photoId: string): Promise<{ userId: string }> {
  const session = await mockAuthRepository.getSession()
  if (!session) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, '请先登录')
  }
  if (session.role !== 'editor' && session.role !== 'admin') {
    throw new AppError(ErrorCodes.FORBIDDEN, '只有编辑或管理员可以设置编辑精选')
  }
  const db = await getDb()
  const photo = await db.get('photos', photoId)
  if (!photo || photo.deletedAt) {
    throw new AppError(ErrorCodes.NOT_FOUND, '作品不存在或已删除')
  }
  return { userId: session.userId }
}

export const mockDiscoverRepository: DiscoverRepository = {
  async hotSearches(query?: HotSearchQuery): Promise<HotSearch[]> {
    const photos = await loadPhotos()
    const days = clampInt(query?.days, HOT_SEARCH_DAYS, 1, 30)
    const limit = clampInt(query?.limit, HOT_SEARCH_LIMIT, 1, 20)
    return buildHotSearches(photos, days, limit)
  },

  async newAuthors(query?: NewAuthorQuery): Promise<NewAuthor[]> {
    const [profiles, photos] = await Promise.all([loadProfiles(), loadPhotos()])
    const days = clampInt(query?.days, NEW_AUTHOR_DAYS, 7, 365)
    return buildNewAuthors(profiles, photos, days, query?.limit)
  },

  async featured(cursor?: string, limit?: number): Promise<CursorListPage<Photo>> {
    const photos = await loadPhotos()
    return paginateByCursor(
      sortFeaturedPhotos(photos),
      cursor,
      clampInt(limit, FEATURED_LIMIT, 1, FEATURED_LIMIT_MAX),
      (photo) => photo.id,
    )
  },

  async setEditorChoice(photoId: string, featured: boolean): Promise<EditorChoiceResult> {
    await requireStaff(photoId)
    const db = await getDb()
    const photo = await db.get('photos', photoId)
    if (!photo) throw new AppError(ErrorCodes.NOT_FOUND, '作品不存在或已删除')
    const featuredAt = featured ? new Date().toISOString() : null
    await db.put('photos', { ...photo, featuredAt, updatedAt: new Date().toISOString() })
    return { photoId, featuredAt }
  },
}
