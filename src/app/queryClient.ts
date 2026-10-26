import { QueryClient } from '@tanstack/react-query'

/**
 * QueryClient 单例（FRONTEND-WORK §6.3：禁止在组件内 new）。
 * 静态期统一 staleTime 30s；session/final 榜单由各自 hook 覆盖为 Infinity。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
