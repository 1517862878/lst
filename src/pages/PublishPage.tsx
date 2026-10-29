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
import { useProfileByUsername, useSession } from '@/hooks/useSession'
import { createRepositories, dataSource } from '@/data'
import { CATEGORIES } from '@/domain/constants'
import { LICENSE_DESCRIPTORS } from '@/domain/licenses'
import { formatDate } from '@/lib/time'
import type { PhotoLicense } from '@/domain/types'
import { Checkbox } from '@/components/ui/Checkbox'
import { Link } from 'react-router'
import { parseTags } from '@/lib/search/normalize'
import { PublishTagSuggest } from '@/features/tags/PublishTagSuggest'
import { compressImage, validateImageFile } from '@/lib/image/compress'
import { parseExifWhitelist, assertNoGps } from '@/lib/image/exif'
import { useDeleteMyDraft, useMyDraft, useSaveMyDraft } from '@/hooks/useCollections'
import type { PublishDraftPayload } from '@/domain/types'

/**
 * 草稿策略（8.3b）：
 *   - api 模式：草稿跟着账号走，存在服务端（换设备/换浏览器也能恢复）；
 *   - mock 模式：没有后端，继续用 localStorage，行为与之前一致。
 * 老用户（api 模式下已有本地草稿）在第一次进入时会被迁移到服务端，然后删掉本地键。
 */
const DRAFT_KEY = 'gy:draft:publish'

const LICENSE_OPTIONS = (Object.entries(LICENSE_DESCRIPTORS) as Array<
  [PhotoLicense, (typeof LICENSE_DESCRIPTORS)[PhotoLicense]]
>).map(([value, descriptor]) => ({ value, label: descriptor.label }))

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
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null)
  const [publicationAccepted, setPublicationAccepted] = useState(false)
  // 逐张拍摄参数开关（8.4a）：初值跟随账户设置，作者仍可只对这一张关掉
  const [exifHidden, setExifHidden] = useState(false)
  // 允许评论（8.4b）：默认开。关掉的作品在详情页不渲染输入框，已有评论照常可读
  const [allowComments, setAllowComments] = useState(true)
  const draftTimer = useRef<number | null>(null)
  const restoredRef = useRef(false)

  const profileQuery = useProfileByUsername(session?.username ?? '')
  const exifDefaultApplied = useRef(false)
  useEffect(() => {
    if (exifDefaultApplied.current || !profileQuery.data) return
    exifDefaultApplied.current = true
    // 账户级「隐藏」时默认也不公开；作者仍可逐张打开（账户隐藏时打开也不生效，文案里写上）
    setExifHidden(profileQuery.data.exifVisibility === 'hidden')
  }, [profileQuery.data])

  // api 模式读服务端草稿；mock 模式这个查询不会发请求
  const draftQuery = useMyDraft({ enabled: isApi })
  const saveDraftMutation = useSaveMyDraft()
  const deleteDraftMutation = useDeleteMyDraft()
  // mutation 的 mutate 身份在 react-query 里是稳定的，用 ref 避免进 effect 依赖
  const saveDraftRef = useRef(saveDraftMutation.mutate)
  saveDraftRef.current = saveDraftMutation.mutate

  // 恢复草稿：服务端优先，其次本地旧草稿（迁移后删除本地键）
  useEffect(() => {
    if (restoredRef.current) return
    if (isApi && draftQuery.isPending) return

    const applyDraft = (d: PublishDraftPayload) => {
      setTitle(d.title)
      setDescription(d.description)
      setCategorySlug(d.categorySlug)
      setLocationName(d.locationName)
      setLicense(d.license)
      setTags(d.tags.join(' '))
      setDraftRestored(true)
    }
    const restoreLocal = (): boolean => {
      try {
        const raw = localStorage.getItem(DRAFT_KEY)
        if (!raw) return false
        applyDraft(JSON.parse(raw) as PublishDraftPayload)
        return true
      } catch {
        return false // 忽略损坏草稿
      }
    }

    restoredRef.current = true
    if (isApi) {
      const payload = draftQuery.data?.payload
      if (payload) {
        applyDraft(payload)
        setDraftUpdatedAt(draftQuery.data?.updatedAt ?? null)
        // 服务端已有草稿，本地那份已经多余
        localStorage.removeItem(DRAFT_KEY)
        return
      }
      // 服务端没有草稿：把本地旧草稿迁上去（下一次防抖保存就会写入）
      if (restoreLocal()) localStorage.removeItem(DRAFT_KEY)
      return
    }
    restoreLocal()
  }, [isApi, draftQuery.isPending, draftQuery.data])

  const draftPayload = useCallback(
    (): PublishDraftPayload => ({
      title,
      description,
      categorySlug,
      locationName,
      license,
      tags: parseTags(tags),
    }),
    [title, description, categorySlug, locationName, license, tags],
  )

  // 自动保存：api 模式 5 秒防抖写服务端，mock 模式 1 秒防抖写本地
  useEffect(() => {
    // 草稿还没恢复完就不要写，否则会用空表单覆盖服务端的草稿
    if (!restoredRef.current) return
    if (draftTimer.current) window.clearTimeout(draftTimer.current)
    draftTimer.current = window.setTimeout(() => {
      const payload = draftPayload()
      if (isApi) {
        saveDraftRef.current(payload)
        setDraftUpdatedAt(new Date().toISOString())
        return
      }
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload))
    }, isApi ? 5000 : 1000)
    return () => {
      if (draftTimer.current) window.clearTimeout(draftTimer.current)
    }
  }, [draftPayload, isApi])

  /** 手动「保存草稿」：不等防抖，立刻落盘 */
  const handleManualSave = () => {
    const payload = draftPayload()
    if (isApi) {
      saveDraftMutation.mutate(payload, {
        onSuccess: () => {
          setDraftUpdatedAt(new Date().toISOString())
          setDraftRestored(true)
          toast.show('success', '草稿已保存到你的账号')
        },
        onError: () => toast.show('error', '草稿保存失败，请稍后再试'),
      })
      return
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(payload))
    setDraftRestored(true)
    toast.show('success', '草稿已保存在本机')
  }

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
    if (!publicationAccepted) {
      setError('发布前请确认作品权利与平台发布协议')
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
        tags: parseTags(tags),
        locationName,
        locationLat: null,
        locationLng: null,
        locationPrecision: 'city',
        shotAt: null,
        exif: exifPreview,
        exifHidden,
        commentsLocked: !allowComments,
        imageKey,
        thumbKey,
        width: display.width,
        height: display.height,
        blurhash: null,
        license,
        credit: null,
      }, photoId)
      await repos.photos.publish(photo.id)

      // 评论开关补写（8.4b）：创建接口只保证接受老字段，锁状态的权威入口是
      // comments-lock。作品已经发布成功，这一步失败不能把整次发布判成失败，
      // 所以单独兜住并提示作者去作品页重设。
      if (!allowComments) {
        try {
          await repos.comments.setLocked(photo.id, true)
        } catch {
          toast.show('error', '作品已发布，但「关闭评论」没有保存成功，可在作品页重新关闭')
        }
      }

      // 发布成功即作废草稿：本地键 + 服务端（失败不影响发布结果）
      if (draftTimer.current) window.clearTimeout(draftTimer.current)
      restoredRef.current = false
      localStorage.removeItem(DRAFT_KEY)
      if (isApi) void deleteDraftMutation.mutateAsync().catch(() => undefined)
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
          已恢复上次未发布的草稿
          {draftUpdatedAt ? `（保存于 ${formatDate(draftUpdatedAt)}）` : ''}。
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
        <PublishTagSuggest value={tags} onChange={setTags} />
        <div className="g-field">
          <span className="g-label" id="publish-exif-label">拍摄参数</span>
          <label className="g-exif-switch" htmlFor="publish-exif-hidden">
            <input
              id="publish-exif-hidden"
              type="checkbox"
              checked={!exifHidden}
              onChange={(e) => setExifHidden(!e.target.checked)}
              aria-describedby="publish-exif-hint"
            />
            <span>
              <strong>公开这张作品的拍摄参数</strong>
              <small id="publish-exif-hint">
                默认跟随账号的「拍摄参数公开范围」。关闭后详情页显示「作者未公开拍摄参数」，器材与地点照常归类。
              </small>
            </span>
          </label>
        </div>
        <div className="g-field">
          <span className="g-label" id="publish-comments-label">评论</span>
          <label className="g-switch-row" htmlFor="publish-comments-allowed">
            <input
              id="publish-comments-allowed"
              type="checkbox"
              checked={allowComments}
              onChange={(e) => setAllowComments(e.target.checked)}
              aria-describedby="publish-comments-hint"
            />
            <span>
              <strong>允许评论</strong>
              <small id="publish-comments-hint">
                关闭后访客仍能看到已有评论，但不能再发表。发布后仍可在作品页随时打开。
              </small>
            </span>
          </label>
        </div>
        <div className="g-field">
          <label className="g-label" htmlFor="publish-license">
            作品授权
          </label>          <select
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
        <p className="g-publish-license-summary">{LICENSE_DESCRIPTORS[license].summary}</p>
        <Checkbox
          checked={publicationAccepted}
          onCheckedChange={setPublicationAccepted}
          required
          label={(
            <span>
              我确认拥有发布所需权利，并同意<Link to="/terms" target="_blank">用户协议</Link>与
              <Link to="/copyright" target="_blank">版权及发布规则</Link>。我理解所选许可会公开展示。
            </span>
          )}
        />

        {error && (
          <p className="g-auth-error" role="alert">
            {error}
          </p>
        )}

        <div className="g-publish-actions">
          <Button type="submit" loading={uploading}>
            发布作品
          </Button>
          <Button type="button" variant="ghost" onClick={handleManualSave}>
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
