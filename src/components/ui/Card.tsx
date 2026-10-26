import type { ElementType, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface CardProps {
  as?: 'div' | 'article' | 'a'
  interactive?: boolean
  href?: string
  className?: string
  children: ReactNode
}

/** 卡片基元：语义标签可选，interactive 提供 hover 抬升（FRONTEND-WORK §3.1 Card） */
export function Card({ as = 'div', interactive = false, href, className, children }: CardProps) {
  const Tag = as as ElementType
  return (
    <Tag
      href={as === 'a' ? href : undefined}
      className={cn('g-card', interactive && 'g-card-interactive', className)}
    >
      {children}
    </Tag>
  )
}
