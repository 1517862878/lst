/**
 * 路由级错误页（FRONTEND-WORK §3.2 RouteErrorPage）。
 * 展示给用户的信息不含堆栈；错误 ID 供日志对照。
 */
import { Link, useRouteError } from 'react-router'
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

/**
 * 路由 errorElement 适配层（router.tsx 根路由挂载）。
 *
 * react-router 渲染 errorElement 时只接受「无必填 props 的组件」，而 RouteErrorPage
 * 暴露的是显式 props 接口，所以这里用 useRouteError() 把两者接上 —— 该页面此前无人 import。
 * 覆盖场景：懒加载 chunk 拉取失败、模块缺导出（lazyNamed 会 throw）、渲染期抛错；
 * 在此之前这些都会整站白屏（router.tsx 没有 errorElement）。
 */
export function RouteErrorBoundary() {
  const error = useRouteError()
  return <RouteErrorPage error={error} />
}
