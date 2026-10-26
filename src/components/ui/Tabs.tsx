import type { ReactNode } from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/cn'

export interface TabItem {
  value: string
  label: string
  /** 徽标计数（如"作品 24"） */
  count?: number
}

export interface TabsProps {
  items: TabItem[]
  value: string
  onValueChange: (value: string) => void
  /**
   * 内容区（TabsContent）。
   *
   * 必须通过 children 传入，不能在外面另写 <TabsPrimitive.Content>：
   * TabsContent 依赖 Radix Root 的 Context，脱离 Root 会直接抛
   * "`TabsContent` must be used within `Tabs`" 导致整页崩溃（真实缺陷，由 E2E 发现）。
   */
  children?: ReactNode
  className?: string
}

/** 选项卡基元：Radix Tabs 封装（FRONTEND-WORK §3.1 Tabs） */
export function Tabs({ items, value, onValueChange, children, className }: TabsProps) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={cn('g-tabs', className)}>
      <TabsPrimitive.List className="g-tabs-list">
        {items.map((item) => (
          <TabsPrimitive.Trigger key={item.value} value={item.value} className="g-tabs-trigger">
            {item.label}
            {item.count !== undefined && (
              <span className="g-tabs-count" aria-hidden="true">
                {item.count}
              </span>
            )}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  )
}

export { TabsPrimitive }
