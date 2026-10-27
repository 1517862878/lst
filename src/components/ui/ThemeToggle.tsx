import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * 主题切换（夜间模式）：放在页头头像按钮左侧。
 * - 白天模式：浅色令牌 + lst 作者的网页背景（氛围光晕渐变，见 index.html / tokens.css）
 * - 夜晚模式：暗色令牌 + 全网页星空像素背景（PixelStarsBackground）
 * 实现方式与全站一致：切 <html data-theme="light|dark">，偏好写入 localStorage['gy:prefs']。
 * 无 framer-motion 依赖 —— 滑轨/光晕/波纹动效全部由 CSS 完成（与项目 §6.11 依赖纪律一致）。
 */

const PREFS_KEY = 'gy:prefs'
const THEME_ATTR = 'data-theme'

type Theme = 'light' | 'dark'

interface SitePrefs {
  state?: { theme?: Theme }
}

function readPrefs(): SitePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? (JSON.parse(raw) as SitePrefs) : {}
  } catch {
    return {}
  }
}

function persistTheme(theme: Theme): void {
  const prefs = readPrefs()
  const next: SitePrefs = { ...prefs, state: { ...prefs.state, theme } }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next))
  } catch {
    // 忽略：隐私模式等场景下 localStorage 可能不可用
  }
}

function readTheme(): Theme {
  const attr = document.documentElement.getAttribute(THEME_ATTR)
  return attr === 'light' ? 'light' : 'dark'
}

export interface ThemeToggleProps {
  className?: string
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(() => readTheme())
  // 点击瞬间的波纹（每次切换触发一次，动画结束后移除）
  const [rippling, setRippling] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute(THEME_ATTR, theme)
    persistTheme(theme)
  }, [theme])

  const isDark = theme === 'dark'

  function handleToggle() {
    setTheme(isDark ? 'light' : 'dark')
    setRippling(true)
    window.setTimeout(() => setRippling(false), 500)
  }

  const label = isDark ? '切换到白天模式' : '切换到夜晚模式'

  return (
    <button
      type="button"
      className={cn('g-theme-toggle', isDark && 'g-theme-toggle-dark', className)}
      aria-label={label}
      title={label}
      aria-pressed={isDark}
      data-rippling={rippling || undefined}
      onClick={handleToggle}
    >
      <span className="g-theme-toggle-track" aria-hidden="true">
        {/* 点击波纹：一个放大的像素点环，借鉴提示词「Dot Matrix Ripple」 */}
        <span className="g-theme-toggle-ripple" />
        <span className="g-theme-toggle-thumb">
          {isDark ? <Moon /> : <Sun />}
        </span>
      </span>
    </button>
  )
}
