/**
 * 写教程页 /learn/write（0039：用户自行上传文章）。
 *
 * 为什么放在学习板块而不是新开一节：
 *   文章本来就是学习板块的内容，作者入口应该贴着内容出现（学习首页右上角），
 *   而不是让用户去别处找。
 *
 * 三种出口：
 *   · 存草稿 —— publish=false，随时回来继续写（草稿只有作者自己看得到）
 *   · 直接发布 —— publish=true，立即出现在学习首页
 *   · 编辑既有文章 —— URL 带 ?slug=，加载自己的文章回填
 *
 * 为什么正文用纯文本域而不是富文本编辑器：
 *   项目已经有 marked + DOMPurify 的 Markdown 渲染管线（lib/markdown），
 *   作者写 Markdown 是一种契约；引入富文本编辑器会让「存储格式」变成 HTML，
 *   等于把净化管线绕过去（HTML 直接入库，渲染时反而更危险）。
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/useToast'
import { RequireAuth } from '@/components/layout/guards'
import { useSession } from '@/hooks/useSession'
import { useTopics } from '@/hooks/useContent'
import {
  useCreateArticle,
  useDeleteArticle,
  useMyArticles,
  useUpdateArticle,
} from '@/hooks/useArticles'
import { parseTags } from '@/lib/search/normalize'
import { slugFromTitle } from '@/features/learn/slugFromTitle'
import type { ArticleDifficulty } from '@/domain/types'

const DIFFICULTY_OPTIONS: ReadonlyArray<{ value: ArticleDifficulty; label: string }> = [
  { value: 'beginner', label: '入门' },
  { value: 'intermediate', label: '进阶' },
  { value: 'advanced', label: '高级' },
]

export function ArticleWritePage() {
  return (
    <RequireAuth>
      <ArticleWriteForm />
    </RequireAuth>
  )
}

function ArticleWriteForm() {
  const navigate = useNavigate()
  const toast = useToast()
  const { data: session } = useSession()
  const topicsQuery = useTopics()
  const mineQuery = useMyArticles({ enabled: Boolean(session) })
  const createMutation = useCreateArticle()
  const updateMutation = useUpdateArticle()
  const deleteMutation = useDeleteArticle()

  const [params] = useSearchParams()
  const editingSlug = params.get('slug')
  const editing = useMemo(
    () => (mineQuery.data ?? []).find((a) => a.slug === editingSlug) ?? null,
    [mineQuery.data, editingSlug],
  )

  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [bodyMd, setBodyMd] = useState('')
  const [topicSlug, setTopicSlug] = useState('')
  const [difficulty, setDifficulty] = useState<ArticleDifficulty>('beginner')
  const [readingMinutes, setReadingMinutes] = useState(5)
  const [tagsText, setTagsText] = useState('')
  const [equipmentText, setEquipmentText] = useState('')
  const [error, setError] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)

  const topics = useMemo(() => topicsQuery.data ?? [], [topicsQuery.data])

  // 主题首次加载后给个默认值，否则下拉是空的（用户会以为没得选）
  useEffect(() => {
    if (!topicSlug && topics.length > 0) setTopicSlug(topics[0]!.slug)
  }, [topics, topicSlug])

  // 编辑模式：把既有文章回填进表单
  useEffect(() => {
    if (!editing) return
    setSlug(editing.slug)
    setTitle(editing.title)
    setSummary(editing.summary)
    setBodyMd(editing.bodyMd)
    setTopicSlug(editing.topicSlug)
    setDifficulty(editing.difficulty)
    setReadingMinutes(editing.readingMinutes)
    setTagsText(editing.tags.join(' '))
    setEquipmentText(editing.equipment.join(' '))
    setSlugTouched(true)
  }, [editing])

  // 新建时随标题自动生成 slug；用户改过之后就不再覆盖（否则会把手改的值冲掉）
  useEffect(() => {
    if (slugTouched || editing) return
    if (!title.trim()) return
    setSlug(slugFromTitle(title))
  }, [title, slugTouched, editing])

  const submit = async (publish: boolean) => {
    setError('')
    if (!title.trim()) {
      setError('请填写标题')
      return
    }
    if (!topicSlug) {
      setError('请选择主题')
      return
    }
    if (!editing && !/^[a-z0-9-]{1,80}$/.test(slug)) {
      setError('文章地址只能用小写字母、数字和连字符')
      return
    }
    const payload = {
      slug,
      topicSlug,
      title: title.trim(),
      summary,
      bodyMd,
      difficulty,
      readingMinutes,
      tags: parseTags(tagsText),
      equipment: parseTags(equipmentText),
      relatedPhotoIds: [],
      publish,
    }
    try {
      const saved = editing
        ? await updateMutation.mutateAsync({ id: editing.id, input: payload })
        : await createMutation.mutateAsync(payload)
      toast.show('success', publish ? '文章已发布' : '草稿已保存')
      navigate(publish ? `/learn/${saved.slug}` : '/learn/write', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请稍后重试')
    }
  }

  const removeEditing = async () => {
    if (!editing) return
    setError('')
    try {
      await deleteMutation.mutateAsync(editing.id)
      toast.show('success', '文章已删除')
      navigate('/learn/write', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }

  const busy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending

  return (
    <Container>
      <PageHeader
        title={editing ? '编辑文章' : '写教程'}
        description="用 Markdown 写正文；存草稿可随时继续，发布后学习板块可见"
        breadcrumbs={[
          { label: '学习板块', to: '/learn' },
          { label: editing ? '编辑文章' : '写教程' },
        ]}
      />

      <form className="g-publish-form" onSubmit={(e) => e.preventDefault()} noValidate>
        <Input
          label="标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="一句话说清这篇讲什么（最多 80 字）"
          maxLength={80}
          required
        />
        <Input
          label="文章地址（URL）"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true)
            setSlug(e.target.value)
          }}
          // 编辑时不允许改 slug：已发布的链接会被收藏/分享，改了就 404
          disabled={Boolean(editing)}
          hint={
            editing
              ? '已发布的文章不能改地址，否则外部链接会失效'
              : '只能用小写字母、数字和连字符；中文标题会自动生成占位地址，可自行修改'
          }
          placeholder="my-first-article"
          required
        />
        <Textarea
          label="摘要"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="一两句话概括，列表页会显示（最多 140 字）"
          maxLength={140}
          showCount
        />
        <Textarea
          label="正文（Markdown）"
          value={bodyMd}
          onChange={(e) => setBodyMd(e.target.value)}
          placeholder={'# 标题\n\n正文内容……\n\n支持标题、列表、引用、代码块与链接'}
          rows={16}
        />

        <div className="g-field">
          <label className="g-label" htmlFor="article-topic">
            主题
          </label>
          <select
            id="article-topic"
            className="g-select"
            value={topicSlug}
            onChange={(e) => setTopicSlug(e.target.value)}
            required
          >
            {topics.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="g-field">
          <label className="g-label" htmlFor="article-difficulty">
            难度
          </label>
          <select
            id="article-difficulty"
            className="g-select"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as ArticleDifficulty)}
          >
            {DIFFICULTY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <Input
          label="阅读时长（分钟）"
          type="number"
          min={1}
          max={600}
          value={String(readingMinutes)}
          onChange={(e) => setReadingMinutes(Number(e.target.value) || 1)}
        />
        <Input
          label="标签"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="空格分隔，最多 6 个"
        />
        <Input
          label="涉及的器材"
          value={equipmentText}
          onChange={(e) => setEquipmentText(e.target.value)}
          placeholder="空格分隔，最多 6 条，可留空"
        />

        {error && (
          <p className="g-auth-error" role="alert">
            {error}
          </p>
        )}

        <div className="g-publish-actions">
          <Button type="button" onClick={() => void submit(false)} loading={busy} variant="secondary">
            存草稿
          </Button>
          <Button type="button" onClick={() => void submit(true)} loading={busy}>
            {editing ? '更新并发布' : '发布'}
          </Button>
          {editing && (
            <Button type="button" variant="danger" onClick={() => void removeEditing()}>
              删除这篇
            </Button>
          )}
        </div>
      </form>

      <section className="g-section">
        <h2 className="g-section-title">我的文章</h2>
        {(mineQuery.data ?? []).length === 0 ? (
          <p className="g-muted">你还没有写过教程。</p>
        ) : (
          <ul className="g-article-list" aria-label="我的文章列表">
            {(mineQuery.data ?? []).map((a) => (
              <li key={a.id}>
                <div className="g-article-list-item">
                  <div className="g-article-list-main">
                    {a.status === 'published' ? (
                      <Link to={`/learn/${a.slug}`} className="g-article-list-title-link">
                        {a.title}
                      </Link>
                    ) : (
                      <span className="g-article-list-title-link">{a.title}</span>
                    )}
                    <p className="g-article-list-summary">{a.summary}</p>
                  </div>
                  <div className="g-article-list-meta">
                    <Badge tone={a.status === 'published' ? 'success' : 'neutral'}>
                      {a.status === 'published' ? '已发布' : '草稿'}
                    </Badge>
                    <Link to={`/learn/write?slug=${encodeURIComponent(a.slug)}`} className="g-link">
                      编辑
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Container>
  )
}
