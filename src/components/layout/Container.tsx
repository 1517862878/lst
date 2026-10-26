import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type ContainerSize = 'sm' | 'md' | 'lg' | 'full'

export interface ContainerProps {
  size?: ContainerSize
  className?: string
  children: ReactNode
}

const sizeClass: Record<ContainerSize, string> = {
  sm: 'g-container-sm',
  md: 'g-container-md',
  lg: 'g-container-lg',
  full: 'g-container-full',
}

/** 宽度容器（FRONTEND-WORK §3.2 Container） */
export function Container({ size = 'lg', className, children }: ContainerProps) {
  return <div className={cn('g-container', sizeClass[size], className)}>{children}</div>
}
