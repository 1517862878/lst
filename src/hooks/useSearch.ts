/**
 * 搜索 hook（ROADMAP §7.1）。
 * 运行时用 MiniSearch 索引全量作品查询。
 */
import { useQuery } from '@tanstack/react-query'
import { createRepositories } from '@/data'
import { invalidateIndex } from '@/lib/search'
import { queryKeys } from './queryKeys'
import type { SearchQuery } from '@/data/contracts'
import type { Page, Photo, UserHit } from '@/domain/types'

export function useUserSearch(query: string) {
  const normalized = query.trim()
  return useQuery<UserHit[]>({
    queryKey: queryKeys.userSearch(normalized),
    queryFn: () => createRepositories().search.searchUsers(normalized, { limit: 50 }),
    enabled: Boolean(normalized),
  })
}

export function useSearch(query: SearchQuery) {
  const hasFilters = Boolean(
    query.text.trim() || query.categorySlug || query.tags?.length || query.locationName?.trim(),
  )
  return useQuery<Page<Photo>>({
    queryKey: queryKeys.search({ ...query }),
    queryFn: () => createRepositories().search.search({ ...query, limit: query.limit ?? 100 }),
    enabled: hasFilters,
  })
}

/** 数据写入后失效索引（发布/互动后调用） */
export function invalidateSearchIndex(): void {
  invalidateIndex()
}
