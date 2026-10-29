/**
 * Mock 器材仓储（8.4a）。
 *
 * 与 mock 标签同一策略：读时算，没有第二份真相。
 * 顺序与 api 实现一致（机身在前、按作品数降序、同数按名称）。
 *
 * 口径细节：聚合前先按作者级拍摄参数隐私掩码（隐藏作者的 exif 变空），
 * 于是「隐藏了拍摄参数」的作品不会在器材页把机型又暴露一遍。
 */
import type {
  CursorListPage,
  GearPhotoQuery,
  GearKind,
  GearRepository,
  GearSummary,
} from '@/data/contracts'
import type { ExifVisibility, Photo, Profile } from '@/domain/types'
import { paginateByCursor } from '@/domain/social'
import {
  GEAR_LIMIT,
  PHOTOGRAPHY_PAGE_SIZE,
  PHOTOGRAPHY_PAGE_SIZE_MAX,
  buildGearSummary,
  exifVisibilityOf,
  gearPhotos,
  withExifPrivacyAll,
} from '@/domain/photography'
import { getDb } from '../db'

/**
 * 读全部作品，并按作者隐私口径掩码。
 *
 * profiles 读不到时（单测的极简 db 桩）不能整页失败：退化成「全部按 public」，
 * 聚合结果仍然可用，只是少了掩码这一个维度。
 */
export async function loadMaskedPhotos(): Promise<Photo[]> {
  const db = await getDb()
  const photos = await db.getAll('photos')
  let profiles: Profile[] = []
  try {
    const rows = await db.getAll('profiles')
    if (Array.isArray(rows)) profiles = rows
  } catch {
    profiles = []
  }
  const visibility = new Map<string, ExifVisibility>()
  for (const profile of profiles) visibility.set(profile.id, exifVisibilityOf(profile))
  return withExifPrivacyAll(photos, (authorId) => visibility.get(authorId))
}

export const mockGearRepository: GearRepository = {
  async list(limit = GEAR_LIMIT): Promise<GearSummary[]> {
    return buildGearSummary(await loadMaskedPhotos(), limit)
  },

  async photos(
    kind: GearKind,
    label: string,
    query: GearPhotoQuery = {},
  ): Promise<CursorListPage<Photo>> {
    const ordered = gearPhotos(await loadMaskedPhotos(), kind, label)
    const limit = clampPageSize(query.limit)
    // 游标键用 id：排序已是全序（publishedAt desc → id desc），翻页不重不漏
    return paginateByCursor(ordered, query.cursor ?? undefined, limit, (photo) => photo.id)
  },
}

function clampPageSize(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return PHOTOGRAPHY_PAGE_SIZE
  }
  return Math.min(Math.trunc(limit), PHOTOGRAPHY_PAGE_SIZE_MAX)
}
