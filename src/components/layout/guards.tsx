/**
 * 路由守卫（FRONTEND-WORK §3.2 RequireAuth / GuestOnly）。
 */
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useSession } from '@/hooks/useSession'
import { Skeleton } from '@/components/ui/Skeleton'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: session, isLoading } = useSession()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="g-page-center">
        <Skeleton variant="rect" height={200} />
      </div>
    )
  }

  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  return <>{children}</>
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { data: session, isLoading } = useSession()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="g-page-center">
        <Skeleton variant="rect" height={200} />
      </div>
    )
  }

  if (session) {
    // 已登录访问登录/注册页 → 回来源或首页
    const params = new URLSearchParams(location.search)
    const next = params.get('next') ?? '/'
    return <Navigate to={next} replace />
  }

  return <>{children}</>
}
