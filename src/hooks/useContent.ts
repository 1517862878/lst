/**
 * 分类 / 学习 / 榜单 hooks。
 */
import { useQuery } from '@tanstack/react-query'
import { createRepositories } from '@/data'
import { queryKeys } from './queryKeys'

const repos = () => createRepositories()

export function useCategories() {
  return useQuery({ queryKey: queryKeys.categories(), queryFn: () => repos().categories.list() })
}

export function useCategory(slug: string) {
  return useQuery({ queryKey: queryKeys.category(slug), queryFn: () => repos().categories.get(slug) })
}

export function useTopics() {
  return useQuery({ queryKey: queryKeys.topics(), queryFn: () => repos().articles.listTopics() })
}

export function useArticles(query: Parameters<ReturnType<typeof repos>['articles']['list']>[0]) {
  return useQuery({ queryKey: queryKeys.articles(query), queryFn: () => repos().articles.list(query) })
}

export function useArticle(slug: string) {
  return useQuery({
    queryKey: queryKeys.article(slug),
    queryFn: () => repos().articles.getBySlug(slug),
    retry: false,
  })
}

export function useWeeklyRanking(isoWeek: string, kind: 'live' | 'final') {
  return useQuery({
    queryKey: queryKeys.ranking(isoWeek, kind),
    queryFn: () => repos().rankings.getWeekly(isoWeek, kind),
    // live 60s；final 恒定（ROADMAP §6.5）
    staleTime: kind === 'final' ? Infinity : 60_000,
    gcTime: kind === 'final' ? Infinity : 5 * 60_000,
  })
}
