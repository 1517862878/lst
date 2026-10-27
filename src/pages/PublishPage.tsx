/**
 * 发布页 /publish（FRONTEND-WORK §2.17）。
 * 上传（仅 JPG、压缩、EXIF 白名单）+ 表单 + 草稿自动保存。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/useToast'
import { RequireAuth } from '@/components/layout/guards'
import { useSession } from '@/hooks/useSession'
import { createRepositories, dataSource } from '@/data'
import { CATEGORIES } from '@/domain/constants'
import type { PhotoLicense } from '@/domain/types'
import { compressImage, validateImageFile } from '@/lib/image/compress'
import { parseExifWhitelist, assertNoGps } from '@/lib/image/exif'

const DRAFT_KEY = 'gy:draft:publish'

interface DraftState {
  title: string
  description: string
  categorySlug: string
  locationName: string
  license: PhotoLicense
  tags: string[]
}

const LICENSE_OPTIONS: Array<{ value: PhotoLicense; label: string }> = [
  { value: 'all_rights_reserved', label: '保留所有权利（默认）' },
  { value: 'cc_by', label: 'CC BY 4.0（署名）' },
  { value: 'cc_by_nc', label: 'CC BY-NC 4.0（署名-非商业）' },
  { value: 'cc_by_nc_nd', label: 'CC BY-NC-ND 4.0（署名-非商业-禁止演绎）' },
  { value: 'cc0', label: 'CC0（放弃权利）' },
]

export function PublishPage() {
  return (
    <RequireAuth>
      <PublishInner />
    </RequireAuth>
  )
}

function PublishInner() {
  const isApi = dataSource() === 'api'
  const { data: session } = useSession()
  const navigate = useNavigate()
  const toast = useToast()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [categorySlug, setCategorySlug] = useState(CATEGORIES[0]?.slug ?? 'landscape')
  const [locationName, setLocationName] = useState('')
  const [license, setLicense] = useState<PhotoLicense>('all_rights_reserved')
  const [tags, setTags] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [exifPreview, setExifPreview] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [draftRestored, setDraftRestored] = useState(false)
  const draftTimer = useRef<number | null>(null)

  // 草稿恢复（刷新后不丢，FRONTEND-WORK §2.17 验收）
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        const d = JSON.parse(raw) as DraftState
        setTitle(d.title)
        setDescription(d.description)
        setCategorySlug(d.categorySlug)
        setLocationName(d.locationName)
        setLicense(d.license)
        setTags(d.tags.join(' '))
        setDraftRestored(true)
      }
    } catch {
      /* 忽略损坏草稿 */
    }
  }, [])

  // 自动保存草稿（防抖 1s）
  const saveDraft = useCallback(() => {
    const draft: DraftState = {
      title,
      description,
      categorySlug,
      locationName,
      license,
      tags: tags.split(/\s+/).filter(Boolean).slice(0, 5),
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  }, [title, description, categorySlug, locationName, license, tags])

  useEffect(() => {
    if (draftTimer.current) window.clearTimeout(draftTimer.current)
    draftTimer.current = window.setTimeout(saveDraft, 1000)
    return () => {
      if (draftTimer.current) window.clearTimeout(draftTimer.current)
    }
  }, [saveDraft])

  const handleFile = async (f: File) => {
    const check = validateImageFile(f)
    if (!check.ok) {
      setError(check.reason)
      return
    }
    setError('')
    setFile(f)
    setUploading(true)
    try {
      const exif = await parseExifWhitelist(f)
      if (!assertNoGps(exif)) {
        setError('EXIF 含 GPS 字段（不应发生，已防御拦截）')
      }
      setExifPreview(exif)
    } catch {
      setExifPreview(null) // EXIF 解析失败静默降级
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!session) {
      setError('请先登录')
      return
    }
    if (!title.trim()) {
      setError('请填写标题')
      return
    }
    if (!categorySlug) {
      setError('请选择分类')
      return
    }
    if (!file) {
      setError('请选择要发布的图片（仅 JPG）')
      return
    }

    setUploading(true)
    try {
      const repos = createRepositories()
      // 生成作品 ID，按键规则写图片
      const photoId = crypto.randomUUID()
      const display = await compressImage(file, { maxEdge: 2400, quality: 0.82 })
      const thumb = await compressImage(file, { maxEdge: 640, quality: 0.75 })

      const imageKey = `photos/${session.userId}/${photoId}/display.webp`
      const thumbKey = `photos/${session.userId}/${photoId}/thumb.webp`
      await repos.storage.put(imageKey, display.blob)
      await repos.storage.put(thumbKey, thumb.blob)

      const photo = await repos.photos.create({
        authorId: session.userId,
        title: title.trim(),
        description,
        categorySlug,
        tags: tags.split(/\s+/).filter(Boolean).slice(0, 5),
        locationName,
        locationLat: null,
        locationLng: null,
        locationPrecision: 'city',
        shotAt: null,
        exif: exifPreview,
        imageKey,
        thumbKey,
        width: display.width,
        height: display.height,
        blurhash: null,
        license,
        credit: null,
      })
      await repos.photos.publish(photo.id)

      localStorage.removeItem(DRAFT_KEY)
      toast.show('success', '发布成功')
      navigate(`/works/${photo.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Container size="md">
      <PageHeader
        title="发布作品"
        description="分享拍摄的相片、地点与心得"
        breadcrumbs={[{ label: '首页', to: '/' }, { label: '发布' }]}
      />
      {draftRestored && (
        <p className="g-draft-note" role="status">
          已恢复上次未发布的草稿。
        </p>
      )}
      <form className="g-publish-form" onSubmit={handleSubmit}>
        <div className="g-upload-zone">
          <label className="g-upload-label">
            {file ? (
              <span className="g-upload-has-file">
                已选择：{file.name}（{exifPreview ? 'EXIF 已读取（白名单）' : '无 EXIF'}）
              </span>
            ) : (
              <span className="g-upload-empty">
                点击选择图片（仅 JPG/JPEG，≤20MB）
                <br />
                <small>GPS 与设备信息会自动剔除</small>
              </span>
            )}
            <input
              type="file"
              accept="image/jpeg,.jpg,.jpeg"
              className="g-visually-hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f)
              }}
            />
          </label>
          {uploading && <p className="g-upload-status">处理中…（压缩 + EXIF 白名单提取）</p>}
        </div>

        <Input label="标题" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="作品标题（1–60 字）" required />
        <Textarea
          label="拍摄心得"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          showCount
          placeholder="分享拍摄故事、技巧、感受…（类似 QQ 空间动态的正文）"
        />
        <div className="g-field">
          <label className="g-label" htmlFor="publish-category">
            分类
          </label>
          <select
            id="publish-category"
            className="g-select"
            value={categorySlug}
            onChange={(e) => setCategorySlug(e.target.value)}
            required
          >
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}（{c.description}）
              </option>
            ))}
          </select>
        </div>
        <Input
          label="拍摄地点"
          value={locationName}
          onChange={(e) => setLocationName(e.target.value)}
          maxLength={80}
          placeholder="如：云南·梅里雪山（最多 80 字）"
        />
        <Input
          label="标签"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="空格分隔，最多 5 个"
          hint="如：风光 长曝 日出"
        />
        <div className="g-field">
          <label className="g-label" htmlFor="publish-license">
            作品授权
          </label>
          <select
            id="publish-license"
            className="g-select"
            value={license}
            onChange={(e) => setLicense(e.target.value as PhotoLicense)}
          >
            {LICENSE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p className="g-auth-error" role="alert">
            {error}
          </p>
        )}

        <div className="g-publish-actions">
          <Button type="submit" loading={uploading}>
            发布作品
          </Button>
          <Button type="button" variant="ghost" onClick={saveDraft}>
            保存草稿
          </Button>
        </div>
        <p className="g-publish-hint">
          {isApi
            ? '在线模式：图片与作品资料将上传至本站服务器。'
            : '演示模式：图片仅存于你的浏览器（IndexedDB），换设备不可见。'}
        </p>
      </form>
    </Container>
  )
}
