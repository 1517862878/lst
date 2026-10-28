import type { Page, SearchQuery, SearchRepository } from '@/data/contracts'
import type { Photo, UserHit } from '@/domain/types'
import { qs, request } from './client'

export const apiSearchRepository: SearchRepository = {
  async searchUsers(query: string, options?: { limit?: number }): Promise<UserHit[]> {
    const data = await request<{ items: UserHit[]; total: number }>(
      '/api/users/search' + qs({ q: query.trim(), limit: options?.limit }),
    )
    return data.items
  },

  async search(query: SearchQuery): Promise<Page<Photo>> {
    return request<Page<Photo>>(
      '/api/search' + qs({
        q: query.text,
        categorySlug: query.categorySlug,
        tags: query.tags?.join(','),
        locationName: query.locationName,
        sort: query.sort,
        cursor: query.cursor,
        limit: query.limit,
      }),
    )
  },
}
