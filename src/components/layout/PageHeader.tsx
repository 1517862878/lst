/**
 * 页头（FRONTEND-WORK §3.2 PageHeader）。
 * 语义：h1 + 描述 + 可选操作区（筛选/排序工具栏）。
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'

export interface BreadcrumbItem {
  label: string
  to?: string
}

export interface PageHeaderProps {
  title: string
  description?: string
  breadcrumbs?: BreadcrumbItem[]
  actions?: ReactNode
  /** 标题下的内容插槽（如筛选工具栏） */
  children?: ReactNode
  className?: string
}

export function PageHeader({ title, description, breadcrumbs, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cn('g-page-header', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="g-breadcrumb" aria-label="面包屑">
          {breadcrumbs.map((b, i) =>
            b.to ? (
              <span key={i}>
                <Link to={b.to}>{b.label}</Link>
                <span aria-hidden="true"> / </span>
              </span>
            ) : (
              <span key={i} aria-current="page">
                {b.label}
              </span>
            ),
          )}
        </nav>
      )}
      <h1 className="g-page-title">{title}</h1>
      {description && <p className="g-page-subtitle">{description}</p>}
      {actions && <div className="g-page-actions">{actions}</div>}
      {children}
    </header>
  )
}
