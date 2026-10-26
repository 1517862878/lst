/**
 * 搜索 hook（ROADMAP §7.1）。
 * 运行时用 MiniSearch 索引全量作品查询。
 */
import { useQuery } from '@tanstack/react-query'
import { createRepositories } from '@/data'
import { searchPhotos, invalidateIndex } from '@/lib/search'
import { queryKeys } from './queryKeys'
import type { Photo } from '@/domain/types'

export function useSearch(query: { text: string; categorySlug?: string }) {
  return useQuery<Photo[]>({
    queryKey: queryKeys.search({ ...query }),
    queryFn: async () => {
      const repos = createRepositories()
      const all = (await repos.photos.list({ sort: 'latest', limit: 1000 })).items
      let matched = searchPhotos(all, query.text)
      if (query.categorySlug) {
        matched = matched.filter((p) => p.categorySlug === query.categorySlug)
      }
      return matched
    },
    enabled: query.text.trim().length > 0,
  })
}

/** 数据写入后失效索引（发布/互动后调用） */
export function invalidateSearchIndex(): void {
  invalidateIndex()
}
