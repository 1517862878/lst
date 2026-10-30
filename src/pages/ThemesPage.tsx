/**
 * 每周主题列表页（/themes，8.4d）。
 *
 * 公开页面（无需登录）：三档「征集中 / 即将开始 / 往期」。
 * 档位来自仓储的 status 过滤，筛出哪一档由 domain/themes.ts 的 themeBucket 定义，
 * 页面不自己算时间段 —— 否则列表与详情页会出现「列表说征集中，详情说已结束」。
 *
 * 档位存在 ?tab= 上（与首页 HomeTabs 同一做法）：分享出去的链接落在同一档，
 * 浏览器前进/后退也不会把档位丢掉。active 是默认值，不写进 URL。
 */
import { Link, useSearchParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Tabs, TabsPrimitive } from '@/components/ui/Tabs'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  sortThemesByStartDesc,
  themeCountdown,
  themePhaseLabel,
  themeWindowText,
} from '@/domain/themes'
import type { ThemeListFilter } from '@/data/contracts'
import type { ThemeSummary } from '@/domain/types'
import { useThemes } from '@/hooks/useThemes'

interface TabSpec {
  value: ThemeListFilter
  label: string
  emptyTitle: string
  emptyDescription: string
}

const TABS: TabSpec[] = [
  {
    value: 'active',
    label: '征集中',
    emptyTitle: '这一周还没有开始征集',
    emptyDescription: '主题公布后，这里会出现本周的投稿入口。',
  },
  {
    value: 'upcoming',
    label: '即将开始',
    emptyTitle: '还没有排期中的主题',
    emptyDescription: '编辑定下下一期档期后，会先出现在这一档。',
  },
  {
    value: 'past',
    label: '往期',
    emptyTitle: '还没有结束的主题',
    emptyDescription: '往期主题与入选结果会一直留在这里。',
  },
]

function toneOf(bucket: ThemeListFilter): 'info' | 'success' | 'neutral' {
  if (bucket === 'active') return 'success'
  if (bucket === 'upcoming') return 'info'
  return 'neutral'
}

function ThemeCard({ theme, bucket }: { theme: ThemeSummary; bucket: ThemeListFilter }) {
  return (
    <li className="g-theme-card">
      <Link to={`/themes/${theme.slug}`} className="g-theme-card-link">
        <span className="g-theme-card-head">
          <Badge tone={toneOf(bucket)} size="sm">
            {themePhaseLabel(theme)}
          </Badge>
          {bucket === 'active' && (
            <span className="g-theme-card-countdown">{themeCountdown(theme.endsAt)}</span>
          )}
        </span>
        <h3 className="g-theme-card-title">{theme.title}</h3>
        {theme.description && <p className="g-theme-card-desc">{theme.description}</p>}
        <span className="g-theme-card-meta">
          <span>{themeWindowText(theme.startsAt, theme.endsAt)}</span>
          <span>投稿 {theme.entryCount} 件</span>
          <span>精选 {theme.selectedCount} 件</span>
        </span>
      </Link>
    </li>
  )
}

export function ThemesPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: ThemeListFilter = raw === 'upcoming' || raw === 'past' ? raw : 'active'
  const themesQuery = useThemes(tab)

  function changeTab(next: string) {
    const nextParams = new URLSearchParams(params)
    if (next === 'active') nextParams.delete('tab')
    else nextParams.set('tab', next)
    setParams(nextParams, { replace: true })
  }

  const spec = TABS.find((item) => item.value === tab) ?? TABS[0]!
  const themes = sortThemesByStartDesc(themesQuery.data ?? [])

  return (
    <Container size="lg">
      <PageHeader
        title="每周主题"
        description="每周一个拍摄主题：投稿、入选、回顾都在这里。"
        breadcrumbs={[{ label: '首页', to: '/' }, { label: '每周主题' }]}
      />

      <Tabs
        items={TABS.map((item) => ({ value: item.value, label: item.label }))}
        value={tab}
        onValueChange={changeTab}
      >
        <TabsPrimitive.Content value={tab} className="g-tabs-content">
          {themesQuery.isLoading ? (
            <ul className="g-theme-grid" aria-hidden="true">
              {Array.from({ length: 3 }, (_, index) => (
                <li key={index} className="g-theme-card">
                  <div className="g-theme-card-body-skeleton">
                    <Skeleton variant="text" width="60%" />
                    <Skeleton variant="rect" height={72} />
                    <Skeleton variant="text" width="40%" />
                  </div>
                </li>
              ))}
            </ul>
          ) : themesQuery.isError ? (
            <ErrorState
              title="主题列表加载失败"
              error={themesQuery.error}
              onRetry={() => void themesQuery.refetch()}
            />
          ) : themes.length === 0 ? (
            <EmptyState title={spec.emptyTitle} description={spec.emptyDescription} />
          ) : (
            <ul className="g-theme-grid" aria-label={`${spec.label}的主题`}>
              {themes.map((theme) => (
                <ThemeCard key={theme.id} theme={theme} bucket={tab} />
              ))}
            </ul>
          )}
        </TabsPrimitive.Content>
      </Tabs>
    </Container>
  )
}
