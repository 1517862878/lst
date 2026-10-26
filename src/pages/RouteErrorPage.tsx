/**
 * 路由级错误页（FRONTEND-WORK §3.2 RouteErrorPage）。
 * 展示给用户的信息不含堆栈；错误 ID 供日志对照。
 */
import { Link } from 'react-router'
import { Container } from '@/components/layout/Container'
import { ErrorState } from '@/components/ui/ErrorState'

export interface RouteErrorPageProps {
  error: unknown
  errorId?: string
  onReset?: () => void
}

export function RouteErrorPage({ error, errorId, onReset }: RouteErrorPageProps) {
  return (
    <Container>
      <h1 className="g-visually-hidden">页面错误</h1>
      <ErrorState
        title="页面出错了"
        error={error}
        {...(errorId ? { errorId } : {})}
        onRetry={onReset ?? (() => window.location.reload())}
      />
      <p className="g-page-center-hint">
        <Link to="/">回首页</Link> 或 <Link to="/gallery">去作品墙</Link>
      </p>
    </Container>
  )
}
