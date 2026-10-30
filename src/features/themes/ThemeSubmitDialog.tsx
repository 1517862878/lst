/**
 * 「投稿到主题」弹层（8.4d）。
 *
 * 一次只投一件：选一件作品 → 立刻生效（不做「先勾选再保存」）。
 * 理由与「加入收藏夹」一致 —— 投稿是可撤回的低风险动作，多一步确认只会让人放弃；
 * 真正需要拦截的重复投稿与超上限由仓储判定（CONFLICT / LIMIT_EXCEEDED），
 * 前端只把 message 原样显示出来，不自己再写一套规则。
 *
 * 上限提示走 domain/themes.ts 的 themeEntryLimitText：文案只有一处，
 * 详情页与弹层不会出现「还能投 2 件」和「已投满」同时挂在屏幕上的情况。
 */
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/useToast'
import { canSubmitMore, themeEntryLimitText } from '@/domain/themes'
import { usePhotosByUser } from '@/hooks/usePhotos'
import { useSession } from '@/hooks/useSession'
import { useSubmitThemeEntry } from '@/hooks/useThemes'

export interface ThemeSubmitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  slug: string
  /** 主题标题，仅用于文案 */
  themeTitle: string
  /** 我已经投进这个主题的 photoId（重复的那件不再提供投稿按钮） */
  submittedPhotoIds?: string[]
  /** 我已投稿件数（不传按 0 算） */
  myEntryCount?: number
}

export function ThemeSubmitDialog({
  open,
  onOpenChange,
  slug,
  themeTitle,
  submittedPhotoIds,
  myEntryCount = 0,
}: ThemeSubmitDialogProps) {
  const toast = useToast()
  const { data: session } = useSession()
  const worksQuery = usePhotosByUser(session?.userId ?? '', 'works')
  const submitEntry = useSubmitThemeEntry()

  const [error, setError] = useState('')
  const [pendingId, setPendingId] = useState('')

  // 每次重新打开都清掉上一次的错误与 pending，否则会串到下一次投稿上
  useEffect(() => {
    if (open) {
      setError('')
      setPendingId('')
    }
  }, [open, slug])

  const submitted = new Set(submittedPhotoIds ?? [])
  const works = worksQuery.data ?? []
  const full = !canSubmitMore(myEntryCount)

  async function submit(photoId: string, title: string) {
    setError('')
    setPendingId(photoId)
    try {
      await submitEntry.mutateAsync({ slug, photoId })
      toast.show('success', `《${title}》已投稿到「${themeTitle}」`)
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '投稿失败，请稍后重试')
    } finally {
      setPendingId('')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitEntry.isPending) onOpenChange(next)
      }}
      title={`投稿到「${themeTitle}」`}
      description="从你的已发布作品里选一件。投稿后可自行撤回，入选的作品需要联系编辑才能撤回。"
      footer={
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitEntry.isPending}>
          关闭
        </Button>
      }
    >
      <p className="g-theme-submit-limit">{themeEntryLimitText(myEntryCount)}</p>
      {error && (
        <p className="g-theme-feedback" role="alert">
          {error}
        </p>
      )}

      {full ? (
        <p className="g-theme-feedback" role="status">
          你已经投满 {myEntryCount} 件，想换作品请先在主题页撤回一件。
        </p>
      ) : worksQuery.isLoading ? (
        <div className="g-theme-submit-list" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} variant="rect" height={44} />
          ))}
        </div>
      ) : worksQuery.isError ? (
        <ErrorState
          title="作品列表加载失败"
          error={worksQuery.error}
          onRetry={() => void worksQuery.refetch()}
        />
      ) : works.length === 0 ? (
        <EmptyState
          title="还没有可以投稿的作品"
          description="只有已发布的作品能投稿到主题。"
          actions={[{ label: '去发布作品', to: '/publish' }]}
        />
      ) : (
        <ul className="g-theme-submit-list" aria-label="选择要投稿的作品">
          {works.map((photo) => {
            const already = submitted.has(photo.id)
            return (
              <li key={photo.id} className="g-theme-submit-row">
                <span className="g-theme-submit-title">{photo.title}</span>
                {already ? (
                  <>
                    <Badge tone="success" size="sm">
                      已投稿
                    </Badge>
                    <Button size="sm" variant="ghost" disabled aria-label={`《${photo.title}》已投稿`}>
                      已投稿
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={pendingId === photo.id}
                    disabled={submitEntry.isPending}
                    onClick={() => void submit(photo.id, photo.title)}
                    aria-label={`投稿《${photo.title}》`}
                  >
                    投稿
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Dialog>
  )
}
