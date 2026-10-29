/**
 * 标签体系路由（0027）：标签总览、标签详情、标签作品流、标签搜索建议。
 *
 * 四个端点都是**公开只读**数据：游客与登录用户看到的内容完全一致
 * （标签统计只基于已发布作品，不涉及任何个人资料可见性），
 * 因此统一走 withAnonymous()，不做 requireUser。
 *
 * 这里只做参数校验与错误翻译，统计与分页全在数据库函数里，
 * 避免 TypeScript 与 SQL 各算一套口径。
 */
import type { FastifyInstance } from 'fastify'
import { withAnonymous } from '../lib/db.js'
import { validation } from '../lib/errors.js'
import { getTagDetail, listTags, listTagPhotos, suggestTags } from '../repositories/tags.js'

/** 与 photos.tags 的元素长度约束保持一致（发布接口限制每个标签 ≤20 字）。 */
const TAG_MAX_LENGTH = 32
const TAG_FORBIDDEN = /[\p{Cc}\p{Cf}]/u
const TAG_SORTS = new Set(['hot', 'latest'])
const TAG_PHOTO_SORTS = new Set(['latest', 'popular'])

function normalizeTag(raw: string): string {
  const tag = raw.trim()
  if (!tag) throw validation('标签不能为空')
  if (tag.length > TAG_MAX_LENGTH) throw validation(`标签不能超过 ${TAG_MAX_LENGTH} 个字符`)
  if (TAG_FORBIDDEN.test(tag)) throw validation('标签包含不可见字符')
  return tag
}

function parseSort<T extends string>(raw: string | undefined, allowed: Set<string>, fallback: T): T {
  if (!raw) return fallback
  const value = raw.trim().toLowerCase()
  if (!value) return fallback
  if (!allowed.has(value)) throw validation('排序方式不合法')
  return value as T
}

function parseLimit(raw: string | undefined, fallback: number): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 50) throw validation('limit 必须是 1–50 的整数')
  return value || fallback
}

export async function registerTagRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/tags?sort=hot|latest&limit=&prefix=
  app.get<{ Querystring: { sort?: string; limit?: string; prefix?: string } }>(
    '/api/tags',
    async (request) => {
      const sort = parseSort(request.query.sort, TAG_SORTS, 'hot')
      const limit = parseLimit(request.query.limit, 20)
      const prefix = request.query.prefix?.trim() || undefined
      const items = await withAnonymous((client) => listTags(client, { sort, limit, prefix }))
      return { items }
    },
  )

  // GET /api/tags/:tag — 未知标签返回 200 + photoCount 0（空态页）
  app.get<{ Params: { tag: string } }>('/api/tags/:tag', async (request) => {
    const tag = normalizeTag(request.params.tag)
    return withAnonymous((client) => getTagDetail(client, tag))
  })

  // GET /api/tags/:tag/photos?sort=latest|popular&cursor=&limit=
  app.get<{
    Params: { tag: string }
    Querystring: { sort?: string; cursor?: string; limit?: string }
  }>('/api/tags/:tag/photos', async (request) => {
    const tag = normalizeTag(request.params.tag)
    const sort = parseSort(request.query.sort, TAG_PHOTO_SORTS, 'latest')
    const limit = parseLimit(request.query.limit, 20)
    const cursor = request.query.cursor?.trim() || undefined
    return withAnonymous((client) => listTagPhotos(client, { tag, sort, cursor, limit }))
  })

  // GET /api/search/tags?q=&limit= — 前缀匹配，q 为空返回热门标签
  app.get<{ Querystring: { q?: string; limit?: string } }>(
    '/api/search/tags',
    async (request) => {
      const query = request.query.q?.trim() ?? ''
      if (query.length > TAG_MAX_LENGTH) throw validation(`搜索词不能超过 ${TAG_MAX_LENGTH} 个字符`)
      if (TAG_FORBIDDEN.test(query)) throw validation('搜索词包含不可见字符')
      const limit = parseLimit(request.query.limit, 10)
      const items = await withAnonymous((client) => suggestTags(client, { query, limit }))
      return { items }
    },
  )
}