/**
 * 首页「本周主题」条（8.4d）。
 *
 * 契约要求首页导航**不加新项**（390px 下导航已经拥挤），所以主题的入口走这里：
 * 一条通往 /themes/<slug> 的横幅。没有进行中的主题时整条不渲染 —— 空横幅
 * 比没有横幅更像坏了。
 *
 * 取数用 useThemes('active')：同一时刻最多一期 active（数据库有部分唯一索引约束），
 * 所以数组里最多一条，取第一条即可，不需要再排序。
 */
import { Link } from 'react-router'
import { Badge } from '@/components/ui/Badge'
import { Section } from '@/components/layout/Section'
import { themeCountdown, themeWindowText } from '@/domain/themes'
import { useThemes } from '@/hooks/useThemes'

export function ThemeSpotlight() {
  const themesQuery = useThemes('active')
  // 加载中与「没有进行中的主题」都渲染成空：横幅忽隐忽现比晚半拍更烦
  if (themesQuery.isLoading || themesQuery.isError) return null

  const theme = (themesQuery.data ?? [])[0]
  if (!theme) return null

  return (
    <Section title="本周主题" action={{ label: '往期主题', to: '/themes' }}>
      <Link to={`/themes/${theme.slug}`} className="g-theme-spotlight">
        <span className="g-theme-spotlight-head">
          <Badge tone="warning" size="sm">
            征集中
          </Badge>
          <span className="g-theme-spotlight-countdown">{themeCountdown(theme.endsAt)}</span>
        </span>
        <span className="g-theme-spotlight-title">{theme.title}</span>
        {theme.description && <span className="g-theme-spotlight-desc">{theme.description}</span>}
        <span className="g-theme-spotlight-meta">
          {themeWindowText(theme.startsAt, theme.endsAt)} · 已投稿 {theme.entryCount} 件 · 精选{' '}
          {theme.selectedCount} 件
        </span>
        <span className="g-theme-spotlight-cta">去看看这个主题 →</span>
      </Link>
    </Section>
  )
}
