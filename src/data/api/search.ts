import type { Page, SearchQuery, SearchRepository } from '@/data/contracts'
import type { Photo } from '@/domain/types'
import { qs, request } from './client'

export const apiSearchRepository: SearchRepository = {
  async search(query: SearchQuery): Promise<Page<Photo>> {
    return request<Page<Photo>>(
      '/api/search' + qs({
        q: query.text,
        categorySlug: query.categorySlug,
        sort: query.sort,
        limit: query.limit,
      }),
    )
  },
}
