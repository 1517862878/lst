/**
 * 主题详情页（/themes/:slug，8.4d）。
 *
 * 一页承担四件事：档期与规则、编辑精选、全部投稿（游标翻页）、我的投稿（撤回）。
 *
 * 关键口径都来自 domain/themes.ts，页面不自己算时间：
 *   · 能不能投稿 = isThemeOpen(theme)（active 且 now ∈ [start, end)）；
 *   · 投满上限 = canSubmitMore / themeEntryLimitText；
 *   · 精选徽标 = themeEntryBadge。
 * 「已入选的作品撤不回」不只是按钮 disabled —— 仓储也会抛 FORBIDDEN，
 * 这里把 message 原样显示出来（两份规则永远会漂移，所以只留服务端那份）。
 */
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Section } from '@/components/layout/Section'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/useToast'
import {
  isThemeOpen,
  themeDetailPhase,
  themeEndsText,
  themeEntryLimitText,
  themeWindowText,
} from '@/domain/themes'
import { ThemeEntryCard } from '@/features/themes/ThemeEntryCard'
import { ThemeSubmitDialog } from '@/features/themes/ThemeSubmitDialog'
import { useSession } from '@/hooks/useSession'
import {
  flattenThemeEntries,
  useMyThemeEntries,
  useTheme,
  useThemeEntries,
  useWithdrawThemeEntry,
} from '@/hooks/useThemes'
import { relativeTime } from '@/lib/time'

const PHASE_TONE = {
  active: 'success',
  upcoming: 'info',
  past: 'neutral',
  draft: 'neutral',
} as const

function EntryGridSkeleton() {
  return (
    <ul className="g-theme-grid" aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => (
        <li key={index} className="g-theme-entry">
          <Skeleton variant="rect" height={140} />
          <Skeleton variant="text" width="70%" />
        </li>
      ))}
    </ul>
  )
}

export function ThemeDetailPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: session } = useSession()

  const themeQuery = useTheme(slug)
  const entriesQuery = useThemeEntries(slug)
  const selectedQuery = useThemeEntries(slug, { selectedOnly: true })
  const myEntriesQuery = useMyThemeEntries(slug, { enabled: Boolean(session) })
  const withdrawEntry = useWithdrawThemeEntry()

  const [submitOpen, setSubmitOpen] = useState(false)
  const [pendingId, setPendingId] = useState('')
  const [withdrawError, setWithdrawError] = useState('')

  const entries = flattenThemeEntries(entriesQuery.data?.pages)
  const selected = flattenThemeEntries(selectedQuery.data?.pages)
  const myEntries = myEntriesQuery.data ?? []
  const theme = themeQuery.data
  const open = theme ? isThemeOpen(theme) : false

  async function handleWithdraw(photoId: string, title: string) {
    setWithdrawError('')
    setPendingId(photoId)
    try {
      await withdrawEntry.mutateAsync({ slug, photoId })
      toast.show('success', `已撤回《${title}》`)
    } catch (error) {
      setWithdrawError(error instanceof Error ? error.message : '撤回失败，请稍后重试')
    } finally {
      setPendingId('')
    }
  }

  function startSubmit() {
    if (!session) {
      navigate(`/login?next=${encodeURIComponent(`/themes/${slug}`)}`)
      return
    }
    setSubmitOpen(true)
  }

  if (themeQuery.isLoading) {
    return (
      <Container size="lg">
        <div className="g-theme-detail-skeleton">
          <Skeleton variant="text" width="40%" />
          <Skeleton variant="rect" height={88} />
          <Skeleton variant="rect" height={220} />
        </div>
      </Container>
    )
  }

  if (themeQuery.isError || !theme) {
    return (
      <Container size="lg">
        <ErrorState
          title="主题不存在或还没公开"
          error={themeQuery.error}
          onRetry={() => void themeQuery.refetch()}
        />
      </Container>
    )
  }

  const phase = themeDetailPhase(theme)
  const windowText = themeWindowText(theme.startsAt, theme.endsAt)
  const mine = myEntries.length

  return (
    <Container size="lg">
      <PageHeader
        title={theme.title}
        description={theme.description}
        breadcrumbs={[
          { label: '首页', to: '/' },
          { label: '每周主题', to: '/themes' },
          { label: theme.title },
        ]}
        actions={
          open ? (
            <Button onClick={startSubmit} aria-label="投稿到主题">
              投稿到主题
            </Button>
          ) : undefined
        }
      />

      <div className="g-theme-hero">
        <p className="g-theme-hero-line">
          <Badge tone={PHASE_TONE[phase.kind]} size="md">
            {phase.label}
          </Badge>
          {windowText && <span className="g-theme-hero-window">{windowText}</span>}
        </p>
        <ul className="g-theme-hero-stats">
          <li>投稿 {theme.entryCount} 件</li>
          <li>精选 {theme.selectedCount} 件</li>
          {session && <li>我的投稿 {mine} 件</li>}
        </ul>
        {theme.status === 'active' && (
          <p className="g-theme-hero-deadline">{themeEndsText(theme.endsAt)}</p>
        )}
      </div>

      {theme.description && (
        <Section title="主题简介">
          <p className="g-theme-prose">{theme.description}</p>
        </Section>
      )}

      {theme.rules && (
        <Section title="投稿规则">
          <p className="g-theme-rules">{theme.rules}</p>
        </Section>
      )}

      {(theme.selectedCount > 0 || selected.length > 0) && (
        <Section title={`编辑精选（${theme.selectedCount}）`} id="selected">
          {selectedQuery.isLoading ? (
            <EntryGridSkeleton />
          ) : selectedQuery.isError ? (
            <ErrorState
              title="精选作品加载失败"
              error={selectedQuery.error}
              onRetry={() => void selectedQuery.refetch()}
            />
          ) : selected.length === 0 ? (
            <p className="g-theme-hint">编辑还在挑选中，先看看全部投稿。</p>
          ) : (
            <ul className="g-theme-grid" aria-label="编辑精选">
              {selected.map((entry) => (
                <li key={entry.photoId}>
                  <ThemeEntryCard entry={entry} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section title={`全部投稿（${theme.entryCount}）`} id="entries">
        {entriesQuery.isLoading ? (
          <EntryGridSkeleton />
        ) : entriesQuery.isError ? (
          <ErrorState
            title="投稿列表加载失败"
            error={entriesQuery.error}
            onRetry={() => void entriesQuery.refetch()}
          />
        ) : entries.length === 0 ? (
          <EmptyState
            title="还没有人投稿"
            description={open ? '成为第一个投稿的人。' : '这一期没有收到投稿。'}
          />
        ) : (
          <>
            <ul className="g-theme-grid" aria-label="全部投稿">
              {entries.map((entry) => (
                <li key={entry.photoId}>
                  <ThemeEntryCard entry={entry} />
                </li>
              ))}
            </ul>
            {entriesQuery.hasNextPage && (
              <div className="g-theme-more">
                <Button
                  variant="secondary"
                  loading={entriesQuery.isFetchingNextPage}
                  onClick={() => void entriesQuery.fetchNextPage()}
                >
                  加载更多投稿
                </Button>
              </div>
            )}
          </>
        )}
      </Section>

      {theme.resultNote && (
        <Section title="本期结果">
          <p className="g-theme-prose">{theme.resultNote}</p>
        </Section>
      )}

      {session && (
        <Section title="我的投稿" id="mine">
          {withdrawError && (
            <p className="g-theme-feedback" role="alert">
              {withdrawError}
            </p>
          )}
          {myEntriesQuery.isLoading ? (
            <Skeleton variant="rect" height={64} />
          ) : myEntriesQuery.isError ? (
            <ErrorState
              title="我的投稿加载失败"
              error={myEntriesQuery.error}
              onRetry={() => void myEntriesQuery.refetch()}
            />
          ) : myEntries.length === 0 ? (
            <EmptyState
              title="你还没有投稿"
              description={
                open ? themeEntryLimitText(0) : '这一期已经结束，可以看看往期主题的入选作品。'
              }
              {...(open ? { actions: [{ label: '投稿到主题', onClick: startSubmit }] } : {})}
            />
          ) : (
            <>
              <p className="g-theme-hint">{themeEntryLimitText(mine)}</p>
              <ul className="g-theme-mine" aria-label="我的投稿">
                {myEntries.map((entry) => (
                  <li key={entry.photoId} className="g-theme-mine-row">
                    <span className="g-theme-mine-title">
                      <Link to={`/works/${entry.photoId}`}>{entry.title}</Link>
                    </span>
                    <span className="g-theme-mine-meta">投稿于 {relativeTime(entry.submittedAt)}</span>
                    {entry.isSelected && (
                      <Badge tone="warning" size="sm">
                        编辑精选
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={pendingId === entry.photoId}
                      disabled={entry.isSelected || !open || withdrawEntry.isPending}
                      title={
                        entry.isSelected
                          ? '已入选的作品需要联系编辑撤回'
                          : !open
                            ? '主题已结束，不能撤回投稿'
                            : undefined
                      }
                      onClick={() => void handleWithdraw(entry.photoId, entry.title)}
                      aria-label={`撤回《${entry.title}》投稿`}
                    >
                      撤回投稿
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}

      {session && (
        <ThemeSubmitDialog
          open={submitOpen}
          onOpenChange={setSubmitOpen}
          slug={slug}
          themeTitle={theme.title}
          submittedPhotoIds={myEntries.map((entry) => entry.photoId)}
          myEntryCount={mine}
        />
      )}
    </Container>
  )
}
