/**
 * Mock 地点仓储（8.4a）。
 *
 * 读时按 location_name 聚合（口径见 domain/photography.ts）：
 * 排除空名与 location_precision='hidden'，只统计在架作品，精确坐标从不出现。
 */
import type {
  CursorListPage,
  PlacePhotoQuery,
  PlaceRepository,
  PlaceSummary,
} from '@/data/contracts'
import type { Photo } from '@/domain/types'
import { paginateByCursor } from '@/domain/social'
import {
  PHOTOGRAPHY_PAGE_SIZE,
  PHOTOGRAPHY_PAGE_SIZE_MAX,
  PLACE_LIMIT,
  buildPlaceSummary,
  placePhotos,
} from '@/domain/photography'
import { loadMaskedPhotos } from './gear'

export const mockPlaceRepository: PlaceRepository = {
  async list(limit = PLACE_LIMIT): Promise<PlaceSummary[]> {
    return buildPlaceSummary(await loadMaskedPhotos(), limit)
  },

  async photos(label: string, query: PlacePhotoQuery = {}): Promise<CursorListPage<Photo>> {
    const ordered = placePhotos(await loadMaskedPhotos(), label)
    const limit = clampPageSize(query.limit)
    return paginateByCursor(ordered, query.cursor ?? undefined, limit, (photo) => photo.id)
  },
}

function clampPageSize(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return PHOTOGRAPHY_PAGE_SIZE
  }
  return Math.min(Math.trunc(limit), PHOTOGRAPHY_PAGE_SIZE_MAX)
}
