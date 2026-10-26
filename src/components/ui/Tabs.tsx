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
  className?: string
}

/** 选项卡基元：Radix Tabs 封装（FRONTEND-WORK §3.1 Tabs） */
export function Tabs({ items, value, onValueChange, className }: TabsProps) {
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
    </TabsPrimitive.Root>
  )
}

export { TabsPrimitive }
