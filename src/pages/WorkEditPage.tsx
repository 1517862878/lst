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

function WorkEditForm({ photo }: { photo: NonNullable<ReturnType<typeof usePhoto>['data']> }) {
  const navigate = useNavigate()
  const toast = useToast()
  const updatePhoto = useUpdatePhoto(photo.id)
  const [values, setValues] = useState<PhotoEditValues>(() => photoToEditValues(photo))
  const [errors, setErrors] = useState<PhotoEditErrors>({})
  const [submitError, setSubmitError] = useState('')

  useEffect(() => setValues(photoToEditValues(photo)), [photo])

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
      toast.show('success', '作品信息已更新')
      navigate(`/works/${photo.id}`, { replace: true })
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '保存失败，请稍后重试')
    }
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
        {submitError && <p className="g-auth-error" role="alert">{submitError}</p>}
        <div className="g-work-edit-actions">
          <Button variant="secondary" onClick={() => navigate(`/works/${photo.id}`)} disabled={updatePhoto.isPending}>取消</Button>
          <Button type="submit" loading={updatePhoto.isPending}>保存修改</Button>
        </div>
      </form>
    </Container>
  )
}
