/**
 * 教程文章写入 hooks（0039：用户自行上传）。
 *
 * 失效策略：一次写操作会同时影响
 *   · ['articles', ...] 各种列表（学习首页、主题页）
 *   · ['article', slug] 详情
 *   · ['articles', 'mine'] 我的文章
 * 所以统一失效 ['articles'] 前缀 —— 逐个点名 key 迟早会漏（与 collections 同一教训）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ArticleUpdateInput, ArticleWriteInput } from '@/data/contracts'
import { createRepositories } from '@/data'
import { queryKeys } from './queryKeys'

const repos = () => createRepositories()

function invalidateArticles(client: ReturnType<typeof useQueryClient>): void {
  void client.invalidateQueries({ queryKey: ['articles'] })
}

/** 我发布的文章（含草稿）。未登录时不该调用。 */
export function useMyArticles(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.myArticles(),
    queryFn: () => repos().articles.listMine(),
    enabled: options?.enabled ?? true,
  })
}

export function useCreateArticle() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: ArticleWriteInput) => repos().articles.create(input),
    onSuccess: () => invalidateArticles(client),
  })
}

export function useUpdateArticle() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ArticleUpdateInput }) =>
      repos().articles.update(id, input),
    onSuccess: () => invalidateArticles(client),
  })
}

export function useDeleteArticle() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => repos().articles.remove(id),
    onSuccess: () => invalidateArticles(client),
  })
}

/** slug 占用预检（不缓存：用户每敲一个字都可能变） */
export function useArticleSlugCheck() {
  return async (slug: string): Promise<boolean> => repos().articles.slugTaken(slug)
}
