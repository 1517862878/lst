/**
 * 标签数据 hooks（8.3a）。
 *
 * 前三个走 TanStack Query（与其它列表一致）；useTagSuggestions 是手写的
 * 300ms 防抖 + 取消：输入建议的每一次按键都不该在缓存里留下一条 key，
 * 也不该在测试里强制要求 QueryClientProvider（搜索页单测不包 Provider）。
 */
import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { TagListQuery, TagPhotoSort, TagSuggestion, TagSummary } from '@/data/contracts'
import { createRepositories } from '@/data'
import { TAG_SUGGEST_LIMIT } from '@/domain/tags'
import { queryKeys } from './queryKeys'

const repos = () => createRepositories()

/** 标签列表：热门 / 最新 / 前缀过滤（搜索建议与搜索页「标签」Tab 共用） */
export function useTags(query: TagListQuery) {
  return useQuery({
    queryKey: queryKeys.tags(query),
    queryFn: () => repos().tags.list(query),
    // 标签计数是聚合值，30s 内复用即可：太短会让总览页每切一次 Tab 都重新聚合
    staleTime: 30_000,
  })
}

/** 标签详情（未知标签返回空详情，不重试） */
export function useTagDetail(tag: string) {
  return useQuery({
    queryKey: queryKeys.tag(tag),
    queryFn: () => repos().tags.get(tag),
    enabled: Boolean(tag),
    retry: false,
    staleTime: 30_000,
  })
}

/** 标签作品流：游标无限加载；切换排序即切换 queryKey，天然回到第一页 */
export function useTagPhotos(tag: string, sort: TagPhotoSort) {
  return useInfiniteQuery({
    queryKey: queryKeys.tagPhotos(tag, sort),
    queryFn: async ({ pageParam }) =>
      repos().tags.photos(tag, pageParam ? { sort, cursor: pageParam } : { sort }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(tag),
    staleTime: 15_000,
  })
}

export interface UseTagSuggestionsOptions {
  /** 防抖间隔，默认 300ms（契约要求） */
  delay?: number
  /** 建议条数，默认 10 */
  limit?: number
  /** 关闭时清空结果（未聚焦 / 空输入） */
  enabled?: boolean
}

/**
 * 标签输入建议（300ms 防抖）。
 *
 * 不依赖 Provider：搜索页可能在没有 QueryClient 的测试里渲染，
 * 这里直接用仓储取数，失败时安静降级成空建议（下拉不出现，不阻塞搜索）。
 */
export function useTagSuggestions(prefix: string, options: UseTagSuggestionsOptions = {}) {
  const { delay = 300, limit = TAG_SUGGEST_LIMIT, enabled = true } = options
  const key = prefix.trim()
  const [items, setItems] = useState<TagSuggestion[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled || !key) {
      setItems([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      repos()
        .tags.suggest(key, { limit })
        .then((next) => {
          if (cancelled) return
          setItems(next)
          setLoading(false)
        })
        .catch(() => {
          if (cancelled) return
          setItems([])
          setLoading(false)
        })
    }, delay)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key, delay, limit, enabled])

  return { items, loading }
}

/**
 * 标签列表的「无 Provider」版本（搜索页标签 Tab 用）。
 *
 * 为什么不直接用 useTags：搜索页单测历来不包 QueryClientProvider（见
 * tests/unit/search-page-tabs.test.tsx），而为一次前缀过滤把整页改成必须有
 * Provider 会连带改掉既有测试的渲染方式。这里与 useTagSuggestions 同一取舍：
 * 直接调仓储，失败时把错误交给调用方渲染重试入口。
 */
export function useTagSearchList(prefix: string, limit = 50) {
  const key = prefix.trim()
  const [data, setData] = useState<TagSummary[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    repos()
      .tags.list({ sort: 'hot', limit, ...(key ? { prefix: key } : {}) })
      .then((next) => {
        if (cancelled) return
        setData(next)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [key, limit, nonce])

  return { data, error, isLoading: loading, refetch: () => setNonce((n) => n + 1) }
}
