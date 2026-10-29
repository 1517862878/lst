/**
 * Mock 标签仓储（8.3a）。
 *
 * 行为必须与 api 实现一致（同一份契约、同一套纯函数 domain/tags.ts），
 * 差异只在数据落地位置：这里落在 IndexedDB，api 那边落在 PostgreSQL 标签视图。
 *
 * 聚合是「读时算」而不是维护标签表：mock 库里标签只是 photos.tags 的文本数组，
 * 没有第二份真相可同步，也就不会出现「标签计数与作品不一致」的状态。
 */
import {
  AppError,
  ErrorCodes,
  type CursorListPage,
  type TagDetail,
  type TagListQuery,
  type TagPhotoQuery,
  type TagRepository,
  type TagSuggestion,
  type TagSummary,
} from '@/data/contracts'
import type { Photo } from '@/domain/types'
import type { TagStat } from '@/domain/tags'
import { paginateByCursor } from '@/domain/social'
import {
  TAG_PAGE_SIZE,
  TAG_SUGGEST_LIMIT,
  filterTagStats,
  limitTagStats,
  normalizeTagValue,
  photosWithTag,
  sortTagPhotos,
  sortTagStats,
  tagDetail,
  tagStats,
  isValidTag,
  TAG_MAX_LENGTH,
} from '@/domain/tags'
import { getDb } from '../db'

/** 读全库作品（聚合只看已发布/未删除，过滤在纯函数里做） */
async function loadPhotos(): Promise<Photo[]> {
  const db = await getDb()
  return db.getAll('photos')
}

function requireValidTag(tag: string): string {
  const value = normalizeTagValue(tag)
  if (!value) throw new AppError(ErrorCodes.VALIDATION, '标签不能为空')
  if (!isValidTag(value)) {
    throw new AppError(ErrorCodes.VALIDATION, `标签长度不能超过 ${TAG_MAX_LENGTH} 个字符`)
  }
  return value
}

function toSummary(stat: TagStat): TagSummary {
  return {
    tag: stat.tag,
    photoCount: stat.photoCount,
    authorCount: stat.authorCount,
    latestPublishedAt: stat.latestPublishedAt,
  }
}

export const mockTagRepository: TagRepository = {
  async list(query: TagListQuery): Promise<TagSummary[]> {
    const photos = await loadPhotos()
    const stats = filterTagStats(tagStats(photos), query.prefix)
    return limitTagStats(sortTagStats(stats, query.sort), query.limit).map(toSummary)
  },

  async get(tag: string): Promise<TagDetail> {
    const value = requireValidTag(tag)
    const photos = await loadPhotos()
    const detail = tagDetail(photos, value)
    return {
      ...detail,
      relatedTags: detail.relatedTags.map((item) => ({ tag: item.tag, count: item.count })),
    }
  },

  async photos(tag: string, query: TagPhotoQuery): Promise<CursorListPage<Photo>> {
    const value = requireValidTag(tag)
    const photos = await loadPhotos()
    const ordered = sortTagPhotos(photosWithTag(photos, value), query.sort)
    const limit =
      typeof query.limit === 'number' && query.limit > 0 ? Math.min(query.limit, 50) : TAG_PAGE_SIZE
    // 游标键用 id：排序里已经保证「排序键 → id」是全序，翻页不会重复或漏项
    return paginateByCursor(ordered, query.cursor, limit, (photo) => photo.id)
  },

  async suggest(prefix: string, options?: { limit?: number }): Promise<TagSuggestion[]> {
    const key = normalizeTagValue(prefix)
    if (!key) return []
    const photos = await loadPhotos()
    const stats = filterTagStats(tagStats(photos), key)
    const limit = Math.max(1, Math.min(options?.limit ?? TAG_SUGGEST_LIMIT, 50))
    return sortTagStats(stats, 'hot')
      .slice(0, limit)
      .map((stat) => ({ tag: stat.tag, photoCount: stat.photoCount }))
  },
}
