import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SectionProps {
  title: string
  /** 右侧"更多"链接 */
  action?: { label: string; to: string }
  dense?: boolean
  id?: string
  className?: string
  children: ReactNode
}

/** 语义化区块：<section> + <h2>（FRONTEND-WORK §3.2 Section） */
export function Section({ title, action, dense = false, id, className, children }: SectionProps) {
  return (
    <section id={id} className={cn('g-section', dense && 'g-section-dense', className)}>
      <div className="g-section-head">
        <h2 className="g-section-title">{title}</h2>
        {action && (
          <Link to={action.to} className="g-section-more">
            {action.label}
            <ChevronRight aria-hidden="true" />
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}
