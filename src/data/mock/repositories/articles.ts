/**
 * Mock 文章仓储。契约：ArticleRepository。
 *
 * 写入（0039 的 mock 对应物）：用户自行上传教程文章。
 * 与 api 实现同构的几个约束，逐条对齐，否则两种模式行为会分叉：
 *   · 作者恒为当前会话用户（调用方传不了 authorId）；
 *   · slug 全局唯一（重复给 CONFLICT，不是静默覆盖）；
 *   · publishedAt 只在首次发布时写入，重复发布不刷新；
 *   · version 在标题/正文/摘要变化时 +1（与 0007 的 bump_article_version 同口径）。
 */
import { AppError, ErrorCodes, type ArticleListQuery, type ArticleRepository } from '@/data/contracts'
import type { Article, ArticleStatus, ArticleTopic } from '@/domain/types'
import { ARTICLE_TOPICS } from '@/domain/constants'
import { getDb, bumpDataVersion } from '../db'
import { mockAuthRepository } from './auth'

const SLUG_RE = /^[a-z0-9-]{1,80}$/

/** mock 模式的 slug 占用检查与 api 的 articleSlugTaken 同口径（全局唯一，不看作者） */
async function slugTaken(slug: string): Promise<boolean> {
  const db = await getDb()
  const all = await db.getAll('articles')
  return all.some((a) => a.slug === slug)
}

async function requireSession() {
  const session = await mockAuthRepository.getSession()
  if (!session) throw new AppError(ErrorCodes.UNAUTHORIZED, '请先登录')
  return session
}

/** 入参校验（与后端 readArticleFields 的上下限逐条一致） */
function validateFields(input: {
  topicSlug: string
  title: string
  summary: string
  difficulty: string
  tags: string[]
  equipment: string[]
}) {
  const title = input.title.trim()
  if (!title) throw new AppError(ErrorCodes.VALIDATION, '标题不能为空')
  if (title.length > 80) throw new AppError(ErrorCodes.VALIDATION, '标题不能超过 80 个字符')
  if (input.summary.length > 140) throw new AppError(ErrorCodes.VALIDATION, '摘要不能超过 140 个字符')
  if (!['beginner', 'intermediate', 'advanced'].includes(input.difficulty)) {
    throw new AppError(ErrorCodes.VALIDATION, '难度取值不合法')
  }
  if (!ARTICLE_TOPICS.some((t) => t.slug === input.topicSlug)) {
    throw new AppError(ErrorCodes.VALIDATION, '主题不存在')
  }
  if (input.tags.length > 6) throw new AppError(ErrorCodes.VALIDATION, '标签最多 6 个')
  if (input.equipment.length > 6) throw new AppError(ErrorCodes.VALIDATION, '器材最多 6 条')
}

export const mockArticleRepository: ArticleRepository = {
  async list(query: ArticleListQuery): Promise<{ items: Article[]; nextCursor: string | null; total: number }> {
    const db = await getDb()
    let all = (await db.getAll('articles')).filter((a) => a.status === 'published')
    if (query.topicSlug) all = all.filter((a) => a.topicSlug === query.topicSlug)
    if (query.difficulty) all = all.filter((a) => a.difficulty === query.difficulty)
    all.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    const limit = query.limit ?? 20
    let startIndex = 0
    if (query.cursor) {
      startIndex = all.findIndex((a) => a.id === query.cursor)
      if (startIndex === -1) startIndex = 0
      else startIndex += 1
    }
    const items = all.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < all.length
    const nextCursor = hasMore ? items[items.length - 1]!.id : null
    return { items, nextCursor, total: all.length }
  },

  async getBySlug(slug: string): Promise<Article> {
    const db = await getDb()
    const all = await db.getAll('articles')
    const article = all.find((a) => a.slug === slug)
    if (!article) throw new AppError(ErrorCodes.NOT_FOUND, `文章不存在：${slug}`)
    return article
  },

  async listTopics(): Promise<ArticleTopic[]> {
    const db = await getDb()
    const rows = await db.getAll('topics')
    if (rows.length > 0) return rows.sort((a, b) => a.sortOrder - b.sortOrder)
    return [...ARTICLE_TOPICS].sort((a, b) => a.sortOrder - b.sortOrder)
  },

  /** 作者本人：自己的全部文章（草稿 + 已发布），按更新时间倒序 */
  async listMine(): Promise<Article[]> {
    const session = await requireSession()
    const db = await getDb()
    const mine = (await db.getAll('articles')).filter((a) => a.authorId === session.userId)
    return mine.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  },

  async create(input): Promise<Article> {
    const session = await requireSession()
    if (!SLUG_RE.test(input.slug)) {
      throw new AppError(ErrorCodes.VALIDATION, '文章地址只能用小写字母、数字和连字符')
    }
    validateFields(input)
    if (await slugTaken(input.slug)) {
      throw new AppError(ErrorCodes.CONFLICT, '这个文章地址已被占用，请换一个 slug')
    }
    const now = new Date().toISOString()
    const article: Article = {
      id: crypto.randomUUID(),
      slug: input.slug,
      topicSlug: input.topicSlug,
      title: input.title.trim(),
      summary: input.summary,
      bodyMd: input.bodyMd,
      coverKey: null,
      authorId: session.userId,
      difficulty: input.difficulty,
      readingMinutes: Math.max(1, Math.round(input.readingMinutes)),
      tags: input.tags,
      equipment: input.equipment,
      relatedPhotoIds: input.relatedPhotoIds,
      status: (input.publish ? 'published' : 'draft') as ArticleStatus,
      publishedAt: input.publish ? now : null,
      updatedAt: now,
      version: 1,
    }
    const db = await getDb()
    await db.put('articles', article)
    await bumpDataVersion()
    return article
  },

  async update(id, input): Promise<Article> {
    const session = await requireSession()
    validateFields(input)
    const db = await getDb()
    const existing = await db.get('articles', id)
    // 不区分「不存在」与「不是自己的」：与后端 42501 → 404/403 的口径一致，
    // 也不泄露「这篇文章存在但不属于你」。
    if (!existing || existing.authorId !== session.userId) {
      throw new AppError(ErrorCodes.NOT_FOUND, '文章不存在或无权修改')
    }
    const now = new Date().toISOString()
    // version 只在实质内容变化时 +1（标题/正文/摘要），与 0007 触发器同口径
    const contentChanged =
      existing.title !== input.title.trim() ||
      existing.bodyMd !== input.bodyMd ||
      existing.summary !== input.summary
    const article: Article = {
      ...existing,
      topicSlug: input.topicSlug,
      title: input.title.trim(),
      summary: input.summary,
      bodyMd: input.bodyMd,
      difficulty: input.difficulty,
      readingMinutes: Math.max(1, Math.round(input.readingMinutes)),
      tags: input.tags,
      equipment: input.equipment,
      relatedPhotoIds: input.relatedPhotoIds,
      status: input.publish ? 'published' : existing.status,
      // 只在首次发布时写时间；重复发布不刷新，避免改错别字就顶到列表最前
      publishedAt: input.publish && existing.publishedAt === null ? now : existing.publishedAt,
      updatedAt: now,
      version: contentChanged ? existing.version + 1 : existing.version,
    }
    await db.put('articles', article)
    await bumpDataVersion()
    return article
  },

  async remove(id: string): Promise<void> {
    const session = await requireSession()
    const db = await getDb()
    const existing = await db.get('articles', id)
    if (!existing || existing.authorId !== session.userId) {
      throw new AppError(ErrorCodes.NOT_FOUND, '文章不存在')
    }
    await db.delete('articles', id)
    await bumpDataVersion()
  },

  async slugTaken(slug: string): Promise<boolean> {
    return slugTaken(slug)
  },
}
