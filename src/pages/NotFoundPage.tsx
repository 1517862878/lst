import { Link } from 'react-router'
import { EmptyState } from '@/components/ui/EmptyState'

/** 404 兜底页：三个出口（回首页 / 去搜索 / 回作品墙）（FRONTEND-WORK §3.2 NotFoundPage） */
export function NotFoundPage() {
  return (
    <div className="g-page g-page-center">
      <h1 className="g-visually-hidden">页面未找到</h1>
      <EmptyState
        title="页面未找到"
        description="你访问的地址不存在或已被移动。"
        actions={[
          { label: '回首页', to: '/' },
          { label: '回作品墙', to: '/gallery' },
        ]}
      />
      <p className="g-page-center-hint">
        <Link to="/">了解工科影展</Link>
      </p>
    </div>
  )
}
