import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/useToast'
import { CATEGORIES } from '@/domain/constants'
import {
  PHOTO_LICENSE_OPTIONS,
  photoEditPatch,
  photoToEditValues,
  validatePhotoEdit,
  type PhotoEditErrors,
  type PhotoEditValues,
} from '@/features/photos/photoEdit'
import { usePhoto, useUpdatePhoto } from '@/hooks/usePhotos'
import { useQueryClient } from '@tanstack/react-query'
import { createRepositories } from '@/data'
import { queryKeys } from '@/hooks/queryKeys'
import { compressImage, validateImageFile } from '@/lib/image/compress'
import { PhotoItemList } from '@/features/photos/PhotoItemList'
import { MAX_PHOTO_ITEMS, moveTo, normalizeCaption, photoItemsOf } from '@/domain/photoItems'
import type { Photo } from '@/domain/types'
import type { PhotoItemInput } from '@/data/contracts'
import { useSetCommentsLocked } from '@/hooks/useInteractions'
import { useSession } from '@/hooks/useSession'

export function WorkEditPage() {
  const { id = '' } = useParams()
  const photoQuery = usePhoto(id)
  const sessionQuery = useSession()

  if (photoQuery.isLoading || sessionQuery.isLoading) {
    return (
      <Container size="md">
        <Skeleton variant="rect" height={360} />
      </Container>
    )
  }

  if (photoQuery.isError || !photoQuery.data) {
    return (
      <Container size="md">
        <ErrorState title="无法编辑此作品" error={photoQuery.error} />
      </Container>
    )
  }

  if (!sessionQuery.data) {
    return <Navigate to={`/login?next=${encodeURIComponent(`/works/${id}/edit`)}`} replace />
  }

  if (sessionQuery.data.userId !== photoQuery.data.authorId || photoQuery.data.status === 'removed') {
    return (
      <Container size="md">
        <ErrorState title="无权编辑此作品" error="只有作品作者可以编辑已发布的作品。" />
      </Container>
    )
  }

  return <WorkEditForm photo={photoQuery.data} />
}

/**
 * 编辑页里的可编辑条目。
 *
 * 与发布页的区别：这里既有「已经在对象存储里的图」（imageKey/thumbKey 已知），
 * 也有「刚选进来还没保存的图」（previewUrl 是本地 Blob）。保存时统一转成
 * replaceItems 的入参，图片本身不再重传——已经有 key 的直接复用。
 */
interface EditableItem {
  id: string
  imageKey: string
  thumbKey: string
  caption: string
  width: number
  height: number
  previewUrl: string | null
}

/** 已有条目（或单图封面）转成编辑态；单图作品先垫一条，作者可以直接往后加图。 */
function initialItems(photo: Photo): EditableItem[] {
  const existing = photoItemsOf(photo)
  if (existing.length > 0) {
    return existing.map((item) => ({
      id: item.id,
      imageKey: item.imageKey,
      thumbKey: item.thumbKey,
      caption: item.caption,
      width: item.width,
      height: item.height,
      previewUrl: null,
    }))
  }
  return [
    {
      id: `cover-${photo.id}`,
      imageKey: photo.imageKey,
      thumbKey: photo.thumbKey,
      caption: '',
      width: photo.width,
      height: photo.height,
      previewUrl: null,
    },
  ]
}

/**
 * 下一个空闲槽位号。
 *
 * 上传键必须落进 `items/<0..8>/`（服务端白名单只认这个形状），而顺序在编辑期
 * 可以反复调整，所以槽位号只表示「一个还没被占用的数字」，不表示位置。
 */
function nextFreeSlot(items: readonly EditableItem[], pending: readonly EditableItem[]): number {
  const used = new Set<number>()
  for (const item of [...items, ...pending]) {
    const match = /\/items\/(\d)\//.exec(item.imageKey)
    if (match) used.add(Number(match[1]))
  }
  for (let slot = 0; slot < MAX_PHOTO_ITEMS; slot += 1) {
    if (!used.has(slot)) return slot
  }
  return 0
}

function WorkEditForm({ photo }: { photo: NonNullable<ReturnType<typeof usePhoto>['data']> }) {
  const navigate = useNavigate()
  const toast = useToast()
  const updatePhoto = useUpdatePhoto(photo.id)
  const setCommentsLocked = useSetCommentsLocked(photo.id)
  const [values, setValues] = useState<PhotoEditValues>(() => photoToEditValues(photo))
  // 评论开关（8.4b）：与标题等信息一起提交，但写入走 comments-lock 这条专门的路径，
  // 保证「谁能改」只有一处判定（作者），不用改通用 PATCH 的授权口径。
  const [allowComments, setAllowComments] = useState(photo.commentsLocked !== true)
  const [errors, setErrors] = useState<PhotoEditErrors>({})
  const [submitError, setSubmitError] = useState('')

  /**
   * 组照条目（8.4c）。
   *
   * 编辑页不重新上传已有图：初始列表直接把已保存的条目（或单图封面）搬进来，
   * 新增的图才走上传。这样「只改标题」的作者不会因为编辑页而重写一遍对象存储。
   */
  const queryClient = useQueryClient()
  const [items, setItems] = useState<EditableItem[]>(() => initialItems(photo))
  const [itemsError, setItemsError] = useState('')
  const [itemsSaved, setItemsSaved] = useState(false)
  const [itemsPending, setItemsPending] = useState(false)

  useEffect(() => {
    setItems(initialItems(photo))
    setItemsSaved(false)
    setItemsError('')
  }, [photo])

  async function addItemFiles(picked: FileList | null) {
    if (!picked || picked.length === 0) return
    const room = MAX_PHOTO_ITEMS - items.length
    if (room <= 0) {
      setItemsError(`一件作品最多 ${MAX_PHOTO_ITEMS} 张图`)
      return
    }
    const session = await createRepositories().auth.getSession()
    if (!session) {
      setItemsError('登录状态已失效，请重新登录')
      return
    }
    setItemsPending(true)
    setItemsError('')
    setItemsSaved(false)
    try {
      const storage = createRepositories().storage
      const appended: EditableItem[] = []
      for (const file of Array.from(picked).slice(0, room)) {
        const check = validateImageFile(file)
        if (!check.ok) {
          setItemsError(check.reason)
          continue
        }
        const slot = nextFreeSlot(items, appended)
        const display = await compressImage(file, { maxEdge: 2400, quality: 0.82 })
        const thumb = await compressImage(file, { maxEdge: 640, quality: 0.75 })
        const imageKey = `photos/${session.userId}/${photo.id}/items/${slot}/display.webp`
        const thumbKey = `photos/${session.userId}/${photo.id}/items/${slot}/thumb.webp`
        await storage.put(imageKey, display.blob)
        await storage.put(thumbKey, thumb.blob)
        appended.push({
          id: crypto.randomUUID(),
          imageKey,
          thumbKey,
          caption: '',
          previewUrl: URL.createObjectURL(file),
          width: display.width,
          height: display.height,
        })
      }
      if (appended.length > 0) setItems((prev) => [...prev, ...appended])
      if (picked.length > room) setItemsError(`一件作品最多 ${MAX_PHOTO_ITEMS} 张图，多余的文件已忽略`)
    } catch (error) {
      setItemsError(error instanceof Error ? error.message : '上传失败，请稍后重试')
    } finally {
      setItemsPending(false)
    }
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id))
    setItemsSaved(false)
  }

  function moveItem(id: string, direction: -1 | 1) {
    setItems((prev) => {
      const from = prev.findIndex((item) => item.id === id)
      if (from < 0) return prev
      return moveTo(prev, from, from + direction)
    })
    setItemsSaved(false)
  }

  function changeCaption(id: string, caption: string) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, caption: normalizeCaption(caption) } : item)),
    )
    setItemsSaved(false)
  }

  /** 保存组照：独立端点、独立失败提示，不和作品信息混成一次「保存成功」。 */
  async function saveItems() {
    if (items.length === 0) {
      setItemsError('至少保留一张图片')
      return
    }
    const tooLong = items.find((item) => item.caption.length > 200)
    if (tooLong) {
      setItemsError('单张说明最多 200 字')
      return
    }
    setItemsPending(true)
    setItemsError('')
    try {
      const payload: PhotoItemInput[] = items.map((item, index) => ({
        imageKey: item.imageKey,
        thumbKey: item.thumbKey,
        caption: item.caption,
        width: item.width,
        height: item.height,
        blurhash: null,
        position: index,
      }))
      await createRepositories().photos.replaceItems(photo.id, payload)
      await queryClient.invalidateQueries({ queryKey: queryKeys.photo(photo.id) })
      setItemsSaved(true)
      toast.show('success', items.length > 1 ? '组照已更新' : '已保存为单图作品')
    } catch (error) {
      setItemsError(error instanceof Error ? error.message : '组照保存失败，请稍后重试')
    } finally {
      setItemsPending(false)
    }
  }

  useEffect(() => {
    setValues(photoToEditValues(photo))
    setAllowComments(photo.commentsLocked !== true)
  }, [photo])

  function setField<K extends keyof PhotoEditValues>(key: K, value: PhotoEditValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validatePhotoEdit(values)
    setErrors(nextErrors)
    setSubmitError('')
    if (Object.keys(nextErrors).length > 0) return

    try {
      await updatePhoto.mutateAsync(photoEditPatch(values))
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '保存失败，请稍后重试')
      return
    }

    // 评论锁是独立端点，单独提交；失败时不能谎称「保存成功」把作者带离页面
    if (!allowComments !== (photo.commentsLocked === true)) {
      try {
        await setCommentsLocked.mutateAsync(!allowComments)
      } catch (error) {
        const detail = error instanceof Error ? error.message : ''
        setSubmitError(detail ? `作品信息已保存，但评论设置未生效：${detail}` : '作品信息已保存，但评论设置未生效')
        return
      }
    }

    toast.show('success', '作品信息已更新')
    navigate(`/works/${photo.id}`, { replace: true })
  }

  return (
    <Container size="md">
      <PageHeader
        title="编辑作品"
        description="修改作品信息不会影响原图和互动数据"
        breadcrumbs={[
          { label: '作品墙', to: '/gallery' },
          { label: photo.title, to: `/works/${photo.id}` },
          { label: '编辑' },
        ]}
      />
      <form className="g-publish-form" onSubmit={handleSubmit} noValidate>
        <Input
          id="work-edit-title"
          label="标题"
          value={values.title}
          onChange={(event) => setField('title', event.target.value)}
          maxLength={60}
          {...(errors.title ? { error: errors.title } : {})}
          required
        />
        <Textarea
          id="work-edit-description"
          label="拍摄心得"
          value={values.description}
          onChange={(event) => setField('description', event.target.value)}
          maxLength={2000}
          showCount
          {...(errors.description ? { error: errors.description } : {})}
        />
        <div className="g-field">
          <label className="g-label" htmlFor="work-edit-category">分类</label>
          <select
            id="work-edit-category"
            className="g-input"
            value={values.categorySlug}
            onChange={(event) => setField('categorySlug', event.target.value)}
            aria-invalid={errors.categorySlug ? true : undefined}
            aria-describedby={errors.categorySlug ? 'work-edit-category-error' : undefined}
          >
            {CATEGORIES.map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}
          </select>
          {errors.categorySlug && <p id="work-edit-category-error" className="g-field-msg g-field-msg-error" role="alert">{errors.categorySlug}</p>}
        </div>
        <Input
          id="work-edit-tags"
          label="标签"
          value={values.tags}
          onChange={(event) => setField('tags', event.target.value)}
          hint="用空格或逗号分隔，最多 5 个"
          {...(errors.tags ? { error: errors.tags } : {})}
        />
        <Input
          id="work-edit-location"
          label="拍摄地点"
          value={values.locationName}
          onChange={(event) => setField('locationName', event.target.value)}
          maxLength={80}
          {...(errors.locationName ? { error: errors.locationName } : {})}
        />
        {/* 逐张开关：默认值来自作品当前状态（发布时按账户设置初始化），
            作者可以只对这张关掉拍摄参数，不影响其他作品 */}
        <div className="g-field">
          <span className="g-label" id="work-edit-exif-label">拍摄参数</span>
          <label className="g-exif-switch" htmlFor="work-edit-exif-hidden">
            <input
              id="work-edit-exif-hidden"
              type="checkbox"
              checked={!values.exifHidden}
              onChange={(event) => setField('exifHidden', !event.target.checked)}
              aria-describedby="work-edit-exif-hint"
            />
            <span>
              <strong>公开这张作品的拍摄参数</strong>
              <small id="work-edit-exif-hint">
                关闭后详情页显示「作者未公开拍摄参数」；账户设置为隐藏时，这里打开也不生效。
              </small>
            </span>
          </label>
        </div>
        {/* 允许评论（8.4b）：关闭后详情页不渲染输入框，已有评论照常可读 */}
        <div className="g-field">
          <span className="g-label" id="work-edit-comments-label">评论</span>
          <label className="g-switch-row" htmlFor="work-edit-comments-allowed">
            <input
              id="work-edit-comments-allowed"
              type="checkbox"
              checked={allowComments}
              onChange={(event) => setAllowComments(event.target.checked)}
              aria-describedby="work-edit-comments-hint"
            />
            <span>
              <strong>允许评论</strong>
              <small id="work-edit-comments-hint">
                关闭后访客仍能看到已有评论，但不能再发表。随「保存修改」一起生效。
              </small>
            </span>
          </label>
        </div>
        <div className="g-field">
          <label className="g-label" htmlFor="work-edit-license">作品许可</label>
          <select
            id="work-edit-license"
            className="g-input"
            value={values.license}
            onChange={(event) => setField('license', event.target.value as PhotoEditValues['license'])}
          >
            {PHOTO_LICENSE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className="g-field">
          <span className="g-label" id="work-edit-items-label">
            组照（最多 {MAX_PHOTO_ITEMS} 张，第 1 张为封面）
          </span>
          <small className="g-field-msg" id="work-edit-items-hint">
            调整顺序、补写单张说明或增删图片后，点下面的「保存组照」单独生效。
            只留一张时会退回单图作品。
          </small>
          <PhotoItemList
            items={items.map((item) => ({
              id: item.id,
              caption: item.caption,
              previewUrl: item.previewUrl,
              width: item.width,
              height: item.height,
            }))}
            idPrefix="work-edit-item"
            onChangeCaption={changeCaption}
            onRemove={removeItem}
            onMove={moveItem}
          />
          <div className="g-work-edit-items-actions">
            <label className="g-upload-label g-upload-label-inline">
              <span className="g-upload-empty">添加图片</span>
              <input
                type="file"
                accept="image/jpeg,.jpg,.jpeg"
                multiple
                className="g-visually-hidden"
                disabled={itemsPending || items.length >= MAX_PHOTO_ITEMS}
                onChange={(event) => {
                  void addItemFiles(event.target.files)
                  event.target.value = ''
                }}
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void saveItems()}
              loading={itemsPending}
            >
              保存组照
            </Button>
            {itemsSaved && <span className="g-field-msg" role="status">组照已保存</span>}
          </div>
          {itemsError && <p className="g-field-msg g-field-msg-error" role="alert">{itemsError}</p>}
        </div>
        {submitError && <p className="g-auth-error" role="alert">{submitError}</p>}
        <div className="g-work-edit-actions">
          <Button variant="secondary" onClick={() => navigate(`/works/${photo.id}`)} disabled={updatePhoto.isPending}>取消</Button>
          <Button type="submit" loading={updatePhoto.isPending || setCommentsLocked.isPending}>保存修改</Button>
        </div>
      </form>
    </Container>
  )
}
