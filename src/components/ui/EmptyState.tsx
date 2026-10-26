import type { LucideIcon } from 'lucide-react'
import { ImageOff } from 'lucide-react'
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
            a.to ? (
              <Button key={a.label} size="sm" onClick={a.onClick} data-to={a.to} className="g-empty-action">
                {a.label}
              </Button>
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
