import { QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/ToastProvider'
import { GlobalErrorBoundary } from './ErrorBoundary'
import { queryClient } from './queryClient'

/**
 * Provider 组合。顺序固定（FRONTEND-WORK §1.2）：
 * ErrorBoundary → QueryClientProvider → ToastProvider → 路由（main.tsx）
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </GlobalErrorBoundary>
  )
}
