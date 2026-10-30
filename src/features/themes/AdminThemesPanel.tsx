/**
 * 审核台「主题」Tab（8.4d）。
 *
 * 编辑在这里完成三件事：建期（草稿 → 进行中 → 已结束）、改期改文案、精选投稿。
 * 精选是唯一会给作者写通知的动作（mock 与后端都会写 kind='system' 的通知），
 * 所以「设为精选」按钮的文案在成功后要明确说出「已通知作者」——
 * 否则编辑点完不知道自己刚触发了一次对外广播。
 *
 * 投稿列表复用详情页同一份 useThemeEntries：编辑看到的排序与访客一致
 * （精选在前 → 其余按投稿时间倒序），不需要另做一套后台排序。
 */
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/useToast'
import {
  THEME_ENTRY_NOTE_MAX,
  THEME_STATUS_LABEL,
  sortThemesByStartDesc,
  themeWindowText,
} from '@/domain/themes'
import type { ThemeEntry, ThemeSummary } from '@/domain/types'
import { useAdminThemes, useSelectThemeEntry, useThemeEntries, flattenThemeEntries } from '@/hooks/useThemes'
import { ThemeFormDialog } from './ThemeFormDialog'

const STATUS_TONE = {
  draft: 'neutral',
  active: 'success',
  closed: 'info',
} as const

function AdminEntryRow({ slug, entry }: { slug: string; entry: ThemeEntry }) {
  const toast = useToast()
  const selectEntry = useSelectThemeEntry()
  const [note, setNote] = useState(entry.note)
  const [error, setError] = useState('')

  async function run(selected: boolean) {
    setError('')
    try {
      await selectEntry.mutateAsync({
        slug,
        photoId: entry.photoId,
        selected,
        ...(selected ? { note } : {}),
      })
      toast.show(
        'success',
        selected ? `已把《${entry.title}》设为精选，作者会收到通知` : `已取消《${entry.title}》的精选`,
      )
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '操作失败，请稍后重试')
    }
  }

  return (
    <li className="g-theme-admin-entry">
      <div className="g-theme-admin-entry-head">
        <span className="g-theme-admin-entry-title">{entry.title}</span>
        <span className="g-theme-admin-entry-author">
          {entry.authorDisplayName || entry.authorUsername || '匿名作者'}
        </span>
        <Badge tone={entry.isSelected ? 'warning' : 'neutral'} size="sm">
          {entry.isSelected ? '编辑精选' : '未入选'}
        </Badge>
      </div>

      <Input
        label={`编辑点评（${entry.title}）`}
        value={note}
        maxLength={THEME_ENTRY_NOTE_MAX}
        hint="入选后显示在作品卡片上，最多 200 个字。"
        onChange={(event) => setNote(event.target.value)}
      />

      <div className="g-theme-admin-entry-actions">
        {entry.isSelected ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              loading={selectEntry.isPending}
              onClick={() => void run(false)}
              aria-label={`取消《${entry.title}》的精选`}
            >
              取消精选
            </Button>
            <Button
              size="sm"
              loading={selectEntry.isPending}
              disabled={note === entry.note}
              onClick={() => void run(true)}
              aria-label={`保存《${entry.title}》的点评`}
            >
              保存点评
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            loading={selectEntry.isPending}
            onClick={() => void run(true)}
            aria-label={`把《${entry.title}》设为精选`}
          >
            设为精选
          </Button>
        )}
      </div>

      {error && (
        <p className="g-theme-feedback" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}

function AdminThemeEntries({ slug }: { slug: string }) {
  const entriesQuery = useThemeEntries(slug)
  const entries = flattenThemeEntries(entriesQuery.data?.pages)

  if (entriesQuery.isLoading) {
    return (
      <div className="g-theme-admin-entries" aria-hidden="true">
        <Skeleton variant="rect" height={72} />
        <Skeleton variant="rect" height={72} />
      </div>
    )
  }

  if (entriesQuery.isError) {
    return (
      <div className="g-theme-admin-entries">
        <ErrorState
          title="投稿列表加载失败"
          error={entriesQuery.error}
          onRetry={() => void entriesQuery.refetch()}
        />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="g-theme-admin-entries">
        <p className="g-theme-hint">这一期还没有投稿。</p>
      </div>
    )
  }

  return (
    <div className="g-theme-admin-entries">
      <ul className="g-theme-admin-entry-list" aria-label="主题投稿">
        {entries.map((entry) => (
          <AdminEntryRow key={entry.photoId} slug={slug} entry={entry} />
        ))}
      </ul>
      {entriesQuery.hasNextPage && (
        <div className="g-theme-more">
          <Button
            size="sm"
            variant="secondary"
            loading={entriesQuery.isFetchingNextPage}
            onClick={() => void entriesQuery.fetchNextPage()}
          >
            加载更多投稿
          </Button>
        </div>
      )}
    </div>
  )
}

function AdminThemeRow({
  theme,
  onEdit,
}: {
  theme: ThemeSummary
  onEdit: (theme: ThemeSummary) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const windowText = themeWindowText(theme.startsAt, theme.endsAt)

  return (
    <li className="g-theme-admin-row">
      <div className="g-theme-admin-row-head">
        <div className="g-theme-admin-row-main">
          <h3 className="g-theme-admin-row-title">{theme.title}</h3>
          <p className="g-theme-admin-row-meta">
            <span className="g-theme-admin-slug">{theme.slug}</span>
            {windowText && <span>{windowText}</span>}
            <span>投稿 {theme.entryCount} 件</span>
            <span>精选 {theme.selectedCount} 件</span>
          </p>
        </div>
        <div className="g-theme-admin-row-actions">
          <Badge tone={STATUS_TONE[theme.status]} size="sm">
            {THEME_STATUS_LABEL[theme.status]}
          </Badge>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onEdit(theme)}
            aria-label={`编辑主题 ${theme.title}`}
          >
            编辑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            aria-label={`管理《${theme.title}》的投稿`}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? '收起投稿' : '管理投稿'}
          </Button>
        </div>
      </div>

      {expanded && <AdminThemeEntries slug={theme.slug} />}
    </li>
  )
}

export function AdminThemesPanel() {
  const themesQuery = useAdminThemes()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ThemeSummary | null>(null)
  const themes = sortThemesByStartDesc(themesQuery.data ?? [])

  return (
    <div className="g-theme-admin">
      <div className="g-theme-admin-bar">
        <p className="g-theme-hint">
          同一时刻只能有一期「进行中」。新主题默认存为草稿，确认档期后再切到「进行中」。
        </p>
        <Button onClick={() => setCreateOpen(true)} aria-label="新建主题">
          新建主题
        </Button>
      </div>

      {themesQuery.isLoading ? (
        <div className="g-mod-skeletons" aria-hidden="true">
          <Skeleton variant="rect" height={72} />
          <Skeleton variant="rect" height={72} />
        </div>
      ) : themesQuery.isError ? (
        <ErrorState
          title="主题列表加载失败"
          error={themesQuery.error}
          onRetry={() => void themesQuery.refetch()}
        />
      ) : themes.length === 0 ? (
        <EmptyState
          title="还没有任何主题"
          description="建一期主题，作者就能把作品投稿进来了。"
          actions={[{ label: '新建主题', onClick: () => setCreateOpen(true) }]}
        />
      ) : (
        <ul className="g-theme-admin-list" aria-label="全部主题">
          {themes.map((theme) => (
            <AdminThemeRow key={theme.id} theme={theme} onEdit={setEditing} />
          ))}
        </ul>
      )}

      <ThemeFormDialog open={createOpen} onOpenChange={setCreateOpen} theme={null} />
      <ThemeFormDialog
        open={Boolean(editing)}
        onOpenChange={(next) => {
          if (!next) setEditing(null)
        }}
        theme={editing}
      />
    </div>
  )
}
