/**
 * 首页「发现 / 关注」双 Tab（8.3c）。
 *
 * 为什么是 Tab 而不是两个页面：两者是同一份「首页」的两种视图，用户的心智是
 * 「我在首页切了一下」，不是一个新页面；URL 用 ?tab=following 表达，收藏与
 * 浏览器回退都能还原。
 *
 * 无障碍：用真正的 tablist/tab/tabpanel 语义 + roving tabindex，左右方向键切换
 * 并激活（自动激活是 Tab 模式的推荐行为），Home/End 跳到首尾。链接本身可直接
 * 中键/右键打开，键盘与鼠标都不吃亏。
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'

export type HomeTab = 'discover' | 'following'

const TABS: Array<{ value: HomeTab; label: string; to: string }> = [
  { value: 'discover', label: '发现', to: '/' },
  { value: 'following', label: '关注', to: '/?tab=following' },
]

export interface HomeTabsProps {
  mode: HomeTab
  children: ReactNode
}

export function HomeTabs({ mode, children }: HomeTabsProps) {
  const refs = useRef<Array<HTMLAnchorElement | null>>([])

  const focusTab = (index: number) => {
    const target = TABS[index]
    if (!target) return
    refs.current[index]?.focus()
    // 自动激活：焦点到哪个 Tab 就切到哪个（与 ARIA APG 的 automatic activation 一致）
    refs.current[index]?.click()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
    const index = TABS.findIndex((tab) => tab.value === mode)
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusTab((index + 1) % TABS.length)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusTab((index - 1 + TABS.length) % TABS.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusTab(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusTab(TABS.length - 1)
    }
  }

  return (
    <>
      <div className="g-home-tabs g-feed-switch" role="tablist" aria-label="首页内容">
        {TABS.map((tab, index) => {
          const selected = tab.value === mode
          return (
            <Link
              key={tab.value}
              ref={(node) => {
                refs.current[index] = node
              }}
              to={tab.to}
              role="tab"
              id={`home-tab-${tab.value}`}
              aria-selected={selected}
              aria-controls="home-panel"
              tabIndex={selected ? 0 : -1}
              className={cn('g-feed-switch-link', 'g-home-tab', selected && 'g-home-tab-active')}
              onKeyDown={onKeyDown}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
      <div
        id="home-panel"
        role="tabpanel"
        aria-labelledby={`home-tab-${mode}`}
        tabIndex={0}
        className="g-home-panel"
      >
        {children}
      </div>
    </>
  )
}
