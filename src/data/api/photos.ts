/**
 * API 照片仓储。
 *
 * 契约：PhotoRepository（src/data/contracts）
 * 行为与 mock 实现一致 —— 页面切换数据源时无需改动。
 */
import type {
  Page,
  PhotoCreateInput,
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
}
