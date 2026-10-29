/**
 * 发现页 hooks（8.3c）：热门搜索 / 新作者 / 编辑精选 / 编辑精选写操作。
 *
 * 全部走 DiscoverRepository（data/index 决定 mock 还是 api），页面不直接碰仓储。
 * 三个读接口都按「空即隐藏」设计：`data` 为空数组时区块整块消失，所以这里
 * 不给 placeholdData，让 isLoading 与「真的没有数据」在调用方分得清。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createRepositories } from '@/data'
import type { EditorChoiceResult } from '@/data/contracts'
import type { Photo } from '@/domain/types'
import { queryKeys } from './queryKeys'

const repos = () => createRepositories()

/** 热门搜索词（搜索页空态 chips）。缓存 5 分钟：词频是慢变量，别每次敲键盘都重算 */
export function useHotSearches(limit = 10) {
  return useQuery({
    queryKey: queryKeys.hotSearches(limit),
    queryFn: () => repos().discover.hotSearches({ limit }),
    staleTime: 5 * 60_000,
  })
}

/** 新作者推荐（首页区块） */
export function useNewAuthors(limit = 6) {
  return useQuery({
    queryKey: queryKeys.newAuthors(limit),
    queryFn: () => repos().discover.newAuthors({ limit }),
    staleTime: 5 * 60_000,
  })
}

/** 编辑精选作品流（首页横条） */
export function useFeaturedPhotos() {
  return useQuery({
    queryKey: queryKeys.featured(),
    queryFn: () => repos().discover.featured(),
    staleTime: 60_000,
  })
}

/**
 * 设为 / 取消编辑精选。
 *
 * 乐观更新：菜单点下去必须立刻变（staff 在后台连续调整精选时，等一个往返
 * 才看到结果会让人怀疑点漏了）；失败时把缓存的 featuredAt 还原成旧值，
 * 并把错误抛给调用方提示。成功后失效 ['photo', id] 与 ['discover']：
 * 精选区块要增删条目，热门搜索的词频也可能因为 featured 影响排序口径。
 */
export function useSetEditorChoice(photoId: string) {
  const queryClient = useQueryClient()
  return useMutation<EditorChoiceResult, unknown, boolean, { previous?: Photo }>({
    mutationFn: (featured: boolean) => repos().discover.setEditorChoice(photoId, featured),
    async onMutate(featured) {
      await queryClient.cancelQueries({ queryKey: queryKeys.photo(photoId) })
      const previous = queryClient.getQueryData<Photo>(queryKeys.photo(photoId))
      if (previous) {
        queryClient.setQueryData<Photo>(queryKeys.photo(photoId), {
          ...previous,
          featuredAt: featured ? new Date().toISOString() : null,
        })
      }
      return previous ? { previous } : {}
    },
    onError(_error, _featured, context) {
      // 回滚：只还原我们改过的那一个字段，避免把用户在别处的编辑一起冲掉
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.photo(photoId), context.previous)
      }
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: queryKeys.photo(photoId) })
      void queryClient.invalidateQueries({ queryKey: ['discover'] })
    },
  })
}
