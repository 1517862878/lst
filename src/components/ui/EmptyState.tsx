import type { LucideIcon } from 'lucide-react'
import { ImageOff } from 'lucide-react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'
import { Button } from './Button'

export interface EmptyStateAction {
  label: string
  /** 二选一：路由跳转或点击行为 */
  to?: string
  onClick?: () => void
}

export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  actions?: EmptyStateAction[]
  className?: string
}

/** 空态统一组件（FRONTEND-WORK §6.8：图标 + 说明 + 至少一个下一步动作） */
export function EmptyState({
  icon: Icon = ImageOff,
  title,
  description,
  actions = [],
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('g-empty', className)} role="status">
      <Icon className="g-empty-icon" aria-hidden="true" />
      <h3 className="g-empty-title">{title}</h3>
      {description && <p className="g-empty-desc">{description}</p>}
      {actions.length > 0 && (
        <div className="g-empty-actions">
          {actions.map((a) =>
            // 跳转类动作必须是真链接：Button 渲染的是 <button>，data-to 不会产生任何导航，
            // 那正是 404 / 画廊 / 个人页 4 个死按钮的成因。用 <Link> 还能中键新开、被爬虫跟随。
            a.to ? (
              <Link key={a.label} to={a.to} className="g-btn g-btn-primary g-btn-sm g-empty-action">
                {a.label}
              </Link>
            ) : (
              <Button key={a.label} size="sm" variant="secondary" onClick={a.onClick}>
                {a.label}
              </Button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
