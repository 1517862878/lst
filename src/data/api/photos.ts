/**
 * API 照片仓储。
 *
 * 契约：PhotoRepository（src/data/contracts）
 * 行为与 mock 实现一致 —— 页面切换数据源时无需改动。
 */
import type {
  Page,
  PhotoCreateInput,
  PhotoItemInput,
  PhotoItemsResult,
  PhotoListQuery,
  PhotoPatch,
  PhotoRepository,
} from '@/data/contracts'
import type { Photo } from '@/domain/types'
import { request, qs } from './client'

export const apiPhotoRepository: PhotoRepository = {
  async list(query: PhotoListQuery): Promise<Page<Photo>> {
    return request<Page<Photo>>(
      '/api/photos' +
        qs({
          sort: query.sort,
          categorySlug: query.categorySlug,
          authorUsername: query.authorUsername,
          cursor: query.cursor,
          limit: query.limit,
        }),
    )
  },

  async get(id: string): Promise<Photo> {
    return request<Photo>(`/api/photos/${encodeURIComponent(id)}`)
  },

  async create(input: PhotoCreateInput, id = crypto.randomUUID()): Promise<Photo> {
    return request<Photo>('/api/photos', { method: 'POST', body: { id, ...input } })
  },

  async publish(id: string): Promise<Photo> {
    return request<Photo>(`/api/photos/${encodeURIComponent(id)}/publish`, { method: 'POST' })
  },

  async update(id: string, patch: PhotoPatch): Promise<Photo> {
    return request<Photo>(`/api/photos/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
    })
  },

  async remove(id: string): Promise<void> {
    await request<void>(`/api/photos/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  async related(id: string, limit = 6): Promise<Photo[]> {
    return request<Photo[]>(
      `/api/photos/${encodeURIComponent(id)}/related` + qs({ limit }),
    )
  },

  /**
   * 整组替换组照条目（8.4c）。后端在同一事务里清空重建、把 position = 0
   * 的图同步回 photos.image_key/thumb_key/width/height/blurhash，并重算 item_count。
   * 空数组 = 退回单图（封面保持原样）。
   */
  async replaceItems(id: string, items: PhotoItemInput[]): Promise<PhotoItemsResult> {
    return request<PhotoItemsResult>(`/api/photos/${encodeURIComponent(id)}/items`, {
      method: 'PUT',
      body: { items },
    })
  },
}
