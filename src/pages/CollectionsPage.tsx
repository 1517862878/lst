/**
 * 我的收藏夹（/me/collections）。
 *
 * 一个页面同时承担「看」「建」「改」三件事：列表在上、新建表单在顶部展开、
 * 重命名与改可见性就地完成、删除走二次确认。这样用户整理收藏时不用在路由之间跳。
 *
 * ---- 数据层契约（另一任务实现中，见 .tmp/phase83b-freeze.md §3.1）----
 * Query  hook：useMyCollections() → React Query 结果，data: CollectionSummary[]
 * Mutation hook：都返回 useMutation 结果，入参为**一个对象**（集成时若签名不同，改这几处即可）：
 *   useCreateCollection().mutateAsync({ title, description, visibility })
 *   useUpdateCollection().mutateAsync({ id, patch: { title?, visibility? } })
 *   useDeleteCollection().mutateAsync({ id })
 * 摘要字段与 src/domain/types.ts 的 CollectionSummary 一致：
 *   { id, title, description, visibility, itemCount, coverThumbKey?, hasPhoto? }
 */
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { FolderHeart, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/useToast'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireAuth } from '@/components/layout/guards'
import {
  useCreateCollection,
  useDeleteCollection,
  useMyCollections,
  useUpdateCollection,
} from '@/hooks/useCollections'
import { usePhotoImage } from '@/hooks/usePhotoImage'
import type { CollectionSummary, CollectionVisibility } from '@/domain/types'
import { cn } from '@/lib/cn'

const TITLE_MAX = 40
const DESCRIPTION_MAX = 200

interface VisibilityOption {
  value: CollectionVisibility
  label: string
  short: string
  hint: string
  tone: 'success' | 'info' | 'neutral'
}

const VISIBILITY_OPTIONS: VisibilityOption[] = [
  {
    value: 'public',
    label: '公开',
    short: '公开',
    hint: '出现在你的个人主页「相册」里，任何人都能浏览。',
    tone: 'success',
  },
  {
    value: 'unlisted',
    label: '仅链接可见',
    short: '链接',
    hint: '不出现在主页和列表里，拿到链接的人仍然可以打开。',
    tone: 'info',
  },
  {
    value: 'private',
    label: '仅自己可见',
    short: '私密',
    hint: '只有你自己能打开，适合收纳还没整理好的收藏。',
    tone: 'neutral',
  },
]

function visibilityOption(value: CollectionVisibility): VisibilityOption {
  return VISIBILITY_OPTIONS.find((option) => option.value === value) ?? VISIBILITY_OPTIONS[2]!
}

/** 与 PhotoThumb 一致的取色范围（180–280），相邻卡片颜色不撞。 */
function hueOf(seed: string): number {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360
  }
  return 180 + (hash % 100)
}

/** 封面缩略图：有图取 Blob URL，无图用标题首字 + 稳定色块，尺寸由 CSS 的 aspect-ratio 决定。 */
function CollectionCover({
  collection,
  className,
}: {
  collection: CollectionSummary
  className?: string
}) {
  const { url } = usePhotoImage(collection.coverThumbKey ?? '')
  const hue = hueOf(String(collection.id ?? collection.title ?? ''))

  return (
    <div
      className={cn('g-collection-cover', className)}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 46% 88%), hsl(${(hue + 26) % 360} 44% 76%))` }}
      aria-hidden="true"
    >
      {url ? (
        <img className="g-collection-cover-img" src={url} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="g-collection-cover-letter">{(collection.title || '收').slice(0, 1)}</span>
      )}
    </div>
  )
}

export function CollectionsPage() {
  return (
    <RequireAuth>
      <CollectionsPageInner />
    </RequireAuth>
  )
}

function CollectionsPageInner() {
  const toast = useToast()
  const collectionsQuery = useMyCollections()
  const createCollection = useCreateCollection()
  const updateCollection = useUpdateCollection()
  const deleteCollection = useDeleteCollection()

  const collections = collectionsQuery.data ?? []

  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // 默认私密：收藏夹常混着私人整理，默认公开属于隐私事故。
  const [visibility, setVisibility] = useState<CollectionVisibility>('private')
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; description?: string }>({})
  const [formError, setFormError] = useState('')

  const [renamingId, setRenamingId] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState('')

  const [pendingDelete, setPendingDelete] = useState<CollectionSummary | null>(null)
  const [deleteError, setDeleteError] = useState('')

  const [busyId, setBusyId] = useState('')
  const [mutationError, setMutationError] = useState('')

  function resetForm() {
    setTitle('')
    setDescription('')
    setVisibility('private')
    setFieldErrors({})
    setFormError('')
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextTitle = title.trim()
    const nextDescription = description.trim()
    const errors: { title?: string; description?: string } = {}
    if (nextTitle.length < 1 || nextTitle.length > TITLE_MAX) {
      errors.title = `标题需要 1–${TITLE_MAX} 个字`
    }
    if (nextDescription.length > DESCRIPTION_MAX) {
      errors.description = `简介最多 ${DESCRIPTION_MAX} 个字`
    }
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setFormError('')
    try {
      await createCollection.mutateAsync({
        title: nextTitle,
        description: nextDescription,
        visibility,
      })
      resetForm()
      setFormOpen(false)
      toast.show('success', '收藏夹已创建')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '创建失败，请稍后重试')
    }
  }

  async function applyPatch(
    id: string,
    patch: { title?: string; visibility?: CollectionVisibility },
    message: string,
  ) {
    setMutationError('')
    setBusyId(id)
    try {
      await updateCollection.mutateAsync({
        id,
        patch,
      })
      toast.show('success', message)
      return true
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : '保存失败，请稍后重试')
      return false
    } finally {
      setBusyId('')
    }
  }

  function startRename(collection: CollectionSummary) {
    setRenamingId(String(collection.id))
    setRenameValue(collection.title)
    setRenameError('')
  }

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextTitle = renameValue.trim()
    if (nextTitle.length < 1 || nextTitle.length > TITLE_MAX) {
      setRenameError(`标题需要 1–${TITLE_MAX} 个字`)
      return
    }
    const saved = await applyPatch(renamingId, { title: nextTitle }, '名称已更新')
    if (saved) setRenamingId('')
  }

  async function handleDelete() {
    if (!pendingDelete) return
    setDeleteError('')
    try {
      await deleteCollection.mutateAsync({ id: String(pendingDelete.id) })
      toast.show('success', `已删除「${pendingDelete.title}」`)
      setPendingDelete(null)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '删除失败，请稍后重试')
    }
  }

  const showList = !collectionsQuery.isLoading && !collectionsQuery.isError

  return (
    <Container>
      <PageHeader
        title="我的收藏夹"
        description="把喜欢的作品按主题收进来：一个收藏夹就是一组可以分享的作品集。"
        breadcrumbs={[{ label: '我的工作台', to: '/me' }, { label: '我的收藏夹' }]}
        actions={
          <Button
            size="sm"
            icon={<Plus aria-hidden="true" />}
            aria-expanded={formOpen}
            onClick={() => {
              if (formOpen) resetForm()
              setFormOpen(!formOpen)
            }}
          >
            {formOpen ? '收起新建表单' : '新建收藏夹'}
          </Button>
        }
      />

      <p className="g-collection-note">
        公开收藏夹会出现在个人主页的「相册」里；「仅自己可见」的收藏夹只有你自己能打开。
      </p>

      {formOpen && (
        <form className="g-collection-form" aria-label="新建收藏夹" noValidate onSubmit={(event) => void handleCreate(event)}>
          <h2 className="g-collection-form-title">新建收藏夹</h2>
          <Input
            label="标题"
            autoFocus
            maxLength={TITLE_MAX}
            value={title}
            error={fieldErrors.title}
            hint={`还会显示在个人主页的相册里（1–${TITLE_MAX} 个字）`}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Textarea
            label="简介"
            rows={3}
            maxLength={DESCRIPTION_MAX}
            showCount
            value={description}
            error={fieldErrors.description}
            hint="写清楚这个收藏夹的主题，以后回看时更容易找到。"
            onChange={(event) => setDescription(event.target.value)}
          />
          <fieldset className="g-collection-visibility">
            <legend className="g-collection-visibility-legend">可见性</legend>
            {VISIBILITY_OPTIONS.map((option) => (
              <label key={option.value} className="g-collection-visibility-option">
                <input
                  type="radio"
                  name="collection-visibility"
                  value={option.value}
                  checked={visibility === option.value}
                  onChange={() => setVisibility(option.value)}
                />
                <span className="g-collection-visibility-text">
                  <span className="g-collection-visibility-label">{option.label}</span>
                  <span className="g-collection-visibility-hint">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {formError && (
            <p className="g-collection-feedback" role="alert">
              {formError}
            </p>
          )}
          <div className="g-collection-form-actions">
            <Button type="submit" size="sm" loading={createCollection.isPending}>
              创建收藏夹
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                resetForm()
                setFormOpen(false)
              }}
            >
              取消
            </Button>
          </div>
        </form>
      )}

      {mutationError && (
        <p className="g-collection-feedback" role="alert">
          {mutationError}
        </p>
      )}

      {showList && collections.length > 0 && (
        <h2 className="g-collection-list-title">
          全部收藏夹 <span className="g-collection-list-count">（{collections.length}）</span>
        </h2>
      )}

      {collectionsQuery.isLoading ? (
        <div className="g-collection-grid" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} variant="rect" className="g-collection-skeleton" height={248} />
          ))}
        </div>
      ) : collectionsQuery.isError ? (
        <ErrorState
          title="收藏夹加载失败"
          error={collectionsQuery.error}
          onRetry={() => void collectionsQuery.refetch()}
        />
      ) : collections.length === 0 ? (
        <EmptyState
          icon={FolderHeart}
          title="还没有收藏夹"
          description="收藏夹可以按主题整理作品，比如「城市夜景」「人像练习」，还能一键分享给朋友。"
          actions={[
            { label: '新建第一个收藏夹', onClick: () => setFormOpen(true) },
            { label: '去作品墙逛逛', to: '/gallery' },
          ]}
        />
      ) : (
        <ul className="g-collection-grid g-collection-grid-manage" aria-label="我的收藏夹">
          {collections.map((collection) => {
            const id = String(collection.id)
            const current = collection.visibility
            const option = visibilityOption(current)
            const isBusy = busyId === id

            return (
              <li key={id} className="g-collection-card">
                <Link className="g-collection-card-link" to={`/c/${id}`}>
                  <CollectionCover collection={collection} />
                  <div className="g-collection-card-body">
                    <h3 className="g-collection-card-title">{collection.title}</h3>
                    <p className="g-collection-card-desc">{collection.description || '还没有简介'}</p>
                    <div className="g-collection-meta">
                      <span>{collection.itemCount} 件作品</span>
                      <Badge tone={option.tone} size="sm">
                        {option.label}
                      </Badge>
                    </div>
                  </div>
                </Link>

                <div className="g-collection-card-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => (renamingId === id ? setRenamingId('') : startRename(collection))}
                  >
                    {renamingId === id ? '取消重命名' : '重命名'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDeleteError('')
                      setPendingDelete(collection)
                    }}
                  >
                    删除
                  </Button>
                  <div
                    className="g-collection-visibility-switch"
                    role="group"
                    aria-label={`「${collection.title}」的可见性`}
                  >
                    {VISIBILITY_OPTIONS.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className="g-collection-visibility-btn"
                        aria-pressed={current === item.value}
                        title={item.hint}
                        disabled={isBusy || current === item.value}
                        onClick={() => void applyPatch(id, { visibility: item.value }, `已改为「${item.label}」`)}
                      >
                        {item.short}
                      </button>
                    ))}
                  </div>
                </div>

                {renamingId === id && (
                  <form
                    className="g-collection-rename"
                    aria-label={`重命名「${collection.title}」`}
                    onSubmit={(event) => void handleRename(event)}
                  >
                    <Input
                      label="新的标题"
                      required
                      autoFocus
                      maxLength={TITLE_MAX}
                      value={renameValue}
                      error={renameError}
                      onChange={(event) => setRenameValue(event.target.value)}
                    />
                    <div className="g-collection-rename-actions">
                      <Button type="submit" size="sm" loading={isBusy}>
                        保存
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setRenamingId('')
                          setRenameError('')
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  </form>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null)
            setDeleteError('')
          }
        }}
        title="删除收藏夹"
        description="删除后无法恢复。"
        footer={
          <>
            <Button size="sm" variant="secondary" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={deleteCollection.isPending}
              onClick={() => void handleDelete()}
            >
              删除
            </Button>
          </>
        }
      >
        <p className="g-collection-dialog-text">
          确定删除「{pendingDelete?.title}」吗？夹子里的作品不会被删除，只是不再属于这个收藏夹。
        </p>
        {deleteError && (
          <p className="g-collection-feedback" role="alert">
            {deleteError}
          </p>
        )}
      </Dialog>
    </Container>
  )
}
