/**
 * API 地点仓储（8.4a）。
 *
 * 契约：PlaceRepository（src/data/contracts）。
 * 后端函数：public.api_list_places / public.api_place_photos（迁移 0031）。
 * 聚合结果不含作者 UUID，也不含任何坐标字段。
 */
import type {
  CursorListPage,
  PlacePhotoQuery,
  PlaceRepository,
  PlaceSummary,
} from '@/data/contracts'
import type { Photo } from '@/domain/types'
import { PLACE_LIMIT } from '@/domain/photography'
import { request, qs } from './client'

export const apiPlaceRepository: PlaceRepository = {
  async list(limit = PLACE_LIMIT): Promise<PlaceSummary[]> {
    const data = await request<{ items: PlaceSummary[] }>('/api/places' + qs({ limit }))
    return (data.items ?? []).filter((item) => item.label.trim() !== '')
  },

  async photos(label: string, query: PlacePhotoQuery = {}): Promise<CursorListPage<Photo>> {
    return request<CursorListPage<Photo>>(
      '/api/places/photos' +
        qs({ label, limit: query.limit, cursor: query.cursor ?? undefined }),
    )
  },
}
