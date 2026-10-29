/**
 * 「加入收藏夹」弹层（作品详情页用）。
 *
 * 交互取舍：不做「先勾选再保存」，而是**点一下就生效**（加入/移出），
 * 因为收藏是低风险、可逆的小动作，多一步确认只会让人放弃整理。
 * 已经属于某个收藏夹的作品用 aria-pressed + 「已加入」双重表达，不只靠颜色。
 *
 * 键盘可达性：Radix Dialog 提供 Esc 关闭、焦点陷阱与 aria-modal；
 * 列表项是真按钮（Tab 可逐个聚焦，Enter/Space 触发），焦点圈由 CSS 的 :focus-visible 保证。
 *
 * ---- 数据层契约（另一任务实现中）----
 * useMyCollections(photoId)       → data: CollectionSummary[]；摘要上的 hasPhoto 标出成员关系
 * useAddCollectionItem()          → mutateAsync({ collectionId, photoId })
 * useRemoveCollectionItem()       → mutateAsync({ collectionId, photoId })
 * （以上签名已按 src/hooks/useCollections.ts 实际实现核对）
 * 若上层已经知道成员关系（比如详情页刚查过），可从 memberCollectionIds 传入，
 * 它优先于摘要上的 hasPhoto —— api 模式暂不返回 hasPhoto，只靠摘要会显示成「未加入」。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Check, FolderHeart, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/useToast'
import {
  useAddCollectionItem,
  useMyCollections,
  useRemoveCollectionItem,
} from '@/hooks/useCollections'
import type { CollectionSummary } from '@/domain/types'
import { cn } from '@/lib/cn'

export interface AddToCollectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  photoId: string
  /** 作品标题，仅用于文案（把《山间晨雾》加入…） */
  photoTitle?: string
  /** 已知的成员关系（详情页可传入）；缺省时读摘要上的 hasPhoto */
  memberCollectionIds?: string[]
}

function hueOf(seed: string): number {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360
  }
  return 180 + (hash % 100)
}

export function AddToCollectionDialog({
  open,
  onOpenChange,
  photoId,
  photoTitle,
  memberCollectionIds,
}: AddToCollectionDialogProps) {
  const toast = useToast()
  // 带上 photoId：仓储据此在摘要上标 hasPhoto（mock 已实现，api 待后端补）。
  const collectionsQuery = useMyCollections()
  const addItem = useAddCollectionItem()
  const removeItem = useRemoveCollectionItem()

  const collections = collectionsQuery.data ?? []
  const [localMembership, setLocalMembership] = useState<Record<string, boolean>>({})
  const [pendingId, setPendingId] = useState('')
  const [error, setError] = useState('')

  // 每次重新打开都丢掉上一件作品留下的本地状态，否则会串到别的作品上。
  useEffect(() => {
    if (open) {
      setLocalMembership({})
      setPendingId('')
      setError('')
    }
  }, [open, photoId])

  function isMember(collection: CollectionSummary): boolean {
    const id = String(collection.id)
    if (Object.prototype.hasOwnProperty.call(localMembership, id)) {
      return localMembership[id] === true
    }
    if (memberCollectionIds?.includes(id)) return true
    return collection.hasPhoto === true
  }

  async function toggle(collection: CollectionSummary) {
    const id = String(collection.id)
    const next = !isMember(collection)
    setError('')
    setPendingId(id)
    setLocalMembership((previous) => ({ ...previous, [id]: next }))
    try {
      if (next) {
        await addItem.mutateAsync({ collectionId: id, photoId })
        toast.show('success', `已加入「${collection.title}」`)
      } else {
        await removeItem.mutateAsync({ collectionId: id, photoId })
        toast.show('success', `已从「${collection.title}」移出`)
      }
    } catch (cause) {
      setLocalMembership((previous) => ({ ...previous, [id]: !next }))
      setError(cause instanceof Error ? cause.message : '操作失败，请稍后重试')
    } finally {
      setPendingId('')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="加入收藏夹"
      // 不传 description：g-dialog-header 是「标题 + 描述 + 关闭」的横向 flex，
      // 描述一长就会把标题挤成一字一行（390px 尤其明显）。说明文字放进 body 更稳。
      footer={
        <div className="g-collection-dialog-footer">
          <Link className="g-btn g-btn-secondary g-btn-sm" to="/me/collections" onClick={() => onOpenChange(false)}>
            <Plus aria-hidden="true" /> 新建收藏夹
          </Link>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </div>
      }
    >
      {collectionsQuery.isLoading ? (
        <div className="g-collection-pick-list" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} variant="rect" height={56} />
          ))}
        </div>
      ) : collectionsQuery.isError ? (
        <ErrorState
          title="收藏夹加载失败"
          error={collectionsQuery.error}
          onRetry={() => void collectionsQuery.refetch()}
        />
      ) : collections.length === 0 ? (
        <div className="g-collection-pick-empty">
          <FolderHeart aria-hidden="true" />
          <p>还没有收藏夹。先建一个，再把这件作品收进去。</p>
          <Link className="g-btn g-btn-primary g-btn-sm" to="/me/collections" onClick={() => onOpenChange(false)}>
            去新建收藏夹
          </Link>
        </div>
      ) : (
        <>
          <p className="g-collection-dialog-hint">
            {photoTitle ? `选择《${photoTitle}》要收进哪个收藏夹：再点一次即可移出。` : '选择要收进哪个收藏夹：再点一次即可移出。'}
          </p>
          <ul className="g-collection-pick-list" aria-label="我的收藏夹">
            {collections.map((collection) => {
              const id = String(collection.id)
              const member = isMember(collection)
              const hue = hueOf(id)
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={cn('g-collection-pick', member && 'g-collection-pick-on')}
                    aria-pressed={member}
                    disabled={pendingId === id}
                    onClick={() => void toggle(collection)}
                  >
                    <span
                      className="g-collection-pick-swatch"
                      aria-hidden="true"
                      style={{ background: `linear-gradient(135deg, hsl(${hue} 46% 86%), hsl(${(hue + 26) % 360} 44% 72%))` }}
                    />
                    <span className="g-collection-pick-main">
                      <span className="g-collection-pick-title">{collection.title}</span>
                      <span className="g-collection-pick-meta">
                        {collection.itemCount} 件作品
                        {collection.visibility === 'private' && (
                          <Badge tone="neutral" size="sm">
                            仅自己可见
                          </Badge>
                        )}
                      </span>
                    </span>
                    <span className="g-collection-pick-state">
                      {member ? (
                        <>
                          <Check aria-hidden="true" /> 已加入
                        </>
                      ) : (
                        '加入'
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {error && (
        <p className="g-collection-feedback" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
