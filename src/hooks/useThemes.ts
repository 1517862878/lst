/**
 * 每周主题与活动 hooks（8.4d）。
 *
 * 约定与 useCollections / useTags 一致：页面只在这里取数据，仓储由
 * createRepositories() 按 VITE_DATA_SOURCE 决定（mock 或 api），页面零改动。
 *
 * 失效口径：主题相关的一切都挂在 ['themes'] 前缀下（见 hooks/queryKeys.ts），
 * 投稿、撤回、精选、编辑改期后一次 invalidate ['themes'] 全刷。
 * 精选是唯一的例外 —— 它同时会给作者写一条通知，所以额外失效 ['social']。
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import { createRepositories } from '@/data'
import type {
  ThemeEntryPage,
  ThemeInput,
  ThemeListFilter,
} from '@/data/contracts'
import type { ThemeEntry } from '@/domain/types'
import { queryKeys } from './queryKeys'

const repos = () => createRepositories()

function invalidateThemes(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ['themes'] })
}

/** 进行中 / 即将开始 / 往期三档列表；status 变了就是另一份缓存 */
export function useThemes(status: ThemeListFilter) {
  return useQuery({
    queryKey: queryKeys.themesList(status),
    queryFn: () => repos().themes.list(status),
    staleTime: 30_000,
    retry: false,
  })
}

/** 主题详情（含规则与结果说明）；slug 为空时不发请求 */
export function useTheme(slug: string) {
  return useQuery({
    queryKey: queryKeys.theme(slug),
    queryFn: () => repos().themes.get(slug),
    enabled: Boolean(slug),
    staleTime: 30_000,
    retry: false,
  })
}

/**
 * 投稿作品分页（精选区传 selectedOnly）。
 *
 * 用 useInfiniteQuery 而不是 useQuery：一期主题可能有几百件投稿，
 * 一次拉完既慢又浪费；页面用 fetchNextPage 做「加载更多」。
 */
export function useThemeEntries(slug: string, options?: { selectedOnly?: boolean }) {
  const selectedOnly = options?.selectedOnly ?? false
  return useInfiniteQuery({
    queryKey: queryKeys.themeEntries(slug, selectedOnly),
    queryFn: ({ pageParam }) =>
      repos().themes.listEntries(slug, {
        offset: pageParam,
        selectedOnly,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage: ThemeEntryPage) => lastPage.nextOffset ?? undefined,
    enabled: Boolean(slug),
    staleTime: 30_000,
    retry: false,
  })
}

/** 把 useThemeEntries 的分页结果摊平成一条列表（顺带去掉跨页重复项） */
export function flattenThemeEntries(pages: ThemeEntryPage[] | undefined): ThemeEntry[] {
  if (!pages) return []
  const seen = new Set<string>()
  const items: ThemeEntry[] = []
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.photoId)) continue
      seen.add(item.photoId)
      items.push(item)
    }
  }
  return items
}

/** 我在这个主题里的投稿（未登录时仓储抛 UNAUTHORIZED，页面据此提示登录） */
export function useMyThemeEntries(slug: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.myThemeEntries(slug),
    queryFn: () => repos().themes.myEntries(slug),
    enabled: Boolean(slug) && (options?.enabled ?? true),
    staleTime: 15_000,
    retry: false,
  })
}

/** 投稿：成功后主题详情、投稿网格与我的投稿一起刷新 */
export function useSubmitThemeEntry() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { slug: string; photoId: string }) =>
      repos().themes.submitEntry(input.slug, input.photoId),
    onSuccess: () => {
      invalidateThemes(client)
    },
  })
}

/** 撤回投稿（已入选的作品会被仓储拒绝，页面把 message 原样展示） */
export function useWithdrawThemeEntry() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { slug: string; photoId: string }) =>
      repos().themes.withdrawEntry(input.slug, input.photoId),
    onSuccess: () => {
      invalidateThemes(client)
    },
  })
}

/** 后台：全部主题（含草稿）。只有编辑/管理员能调用，真实后端无此公开端点 */
export function useAdminThemes(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.adminThemes(),
    queryFn: () => repos().themes.adminList(),
    enabled: options?.enabled ?? true,
    staleTime: 15_000,
    retry: false,
  })
}

/** 后台：新建主题（新建后是 draft，需要显式「开始」才进入 active） */
export function useCreateTheme() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: ThemeInput) => repos().themes.createTheme(input),
    onSuccess: () => {
      invalidateThemes(client)
    },
  })
}

/** 后台：编辑主题（改期 / 改文案 / 开始 / 结束 / 填结果说明） */
export function useUpdateTheme() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; patch: Partial<ThemeInput> }) =>
      repos().themes.updateTheme(input.id, input.patch),
    onSuccess: () => {
      invalidateThemes(client)
    },
  })
}

/**
 * 后台：精选 / 取消精选（可带评语）。
 *
 * 额外失效 ['social']：精选会给作者写一条系统通知，不刷的话编辑在同一个
 * 浏览器里切到通知中心还是旧列表（通知列表走 social 前缀）。
 */
export function useSelectThemeEntry() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { slug: string; photoId: string; selected: boolean; note?: string }) =>
      repos().themes.selectEntry(input.slug, input.photoId, {
        selected: input.selected,
        ...(input.note === undefined ? {} : { note: input.note }),
      }),
    onSuccess: () => {
      invalidateThemes(client)
      void client.invalidateQueries({ queryKey: ['social'] })
    },
  })
}
