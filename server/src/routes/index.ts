/**
 * 路由注册入口。
 *
 * 第 1 步：只读接口。
 * 第 2 步（本次）：鉴权 —— 身份改为来自 lib/auth.ts 的 JWT 验签结果，
 *                  并挂上 /api/auth/* 与 /api/profiles/*。
 * 后续阶段再加：写入（点赞/收藏/评论）、上传、搜索。
 */
import type { FastifyInstance } from 'fastify'
import { currentUser, requireUser } from '../lib/auth.js'
import { withAnonymous, withRls } from '../lib/db.js'
import { notFound, validation } from '../lib/errors.js'
import {
  createComment,
  createPhoto,
  publishPhoto,
  removeComment,
  removePhoto,
  setFavorite,
  setLike,
  updatePhoto,
} from '../repositories/writes.js'
import { listComments } from '../repositories/comments.js'
import { getInteractionState, listByPhoto, listFavoritesByUser, listLikesByUser } from '../repositories/interactions.js'
import { listPhotos, getPhoto, relatedPhotos } from '../repositories/photos.js'
import { listCategories, getCategory, listArticleTopics } from '../repositories/categories.js'
import { listArticles, getArticleBySlug } from '../repositories/articles.js'
import {
  getLiveRanking,
  getFinalRanking,
  listRankingWeeks,
  getPhotosByIds,
} from '../repositories/rankings.js'
import { registerAuthRoutes } from './auth.js'
import { registerProfileRoutes } from './profiles.js'
import { registerAccountCenterRoutes } from './account-center.js'
import { registerModerationRoutes } from './moderation.js'
import { registerSocialRoutes } from './social.js'
import { registerTagRoutes } from './tags.js'
import { registerCollectionRoutes } from './collections.js'
import { searchPhotos } from '../repositories/search.js'

/**
 * authorUsername 的输入护栏。
 *
 * profiles.username 的约束是 3～20 字符（0003），这里放宽到 64：只挡病态输入，
 * 形状不合法但长度正常的用户名照常走「数据库查不到 ⇒ 空列表」，不额外制造 400 分支。
 */
const MAX_USERNAME_INPUT = 64

export const PHOTO_LICENSES = [
  'all_rights_reserved',
  'cc_by',
  'cc_by_nc',
  'cc_by_nc_nd',
  'cc0',
] as const
const EXIF_KEYS = [
  'Make',
  'Model',
  'LensModel',
  'FNumber',
  'ExposureTime',
  'ISO',
  'FocalLength',
  'DateTimeOriginal',
] as const
const MUTATION_RATE_LIMIT = { max: 60, timeWindow: '1 minute' } as const
const COMMENT_RATE_LIMIT = { max: 20, timeWindow: '1 minute' } as const
const PUBLISH_RATE_LIMIT = { max: 10, timeWindow: '1 hour' } as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function validateExif(value: unknown): Record<string, unknown> | null {
  if (value == null) return null
  if (!isPlainObject(value)) throw validation('exif 必须是普通对象或 null')
  const allowed = new Set<string>(EXIF_KEYS)
  for (const [key, entry] of Object.entries(value)) {
    if (!allowed.has(key) || (typeof entry === 'object' && entry !== null)) {
      throw validation('exif 含白名单之外或嵌套的字段')
    }
  }
  return value
}

export function publicLocation(
  precision: string,
  name: string,
  lat: number | null,
  lng: number | null,
): { name: string; lat: number | null; lng: number | null } {
  if (precision === 'hidden') return { name: '', lat: null, lng: null }
  if (precision === 'city' || precision === 'district') return { name, lat: null, lng: null }
  return { name, lat, lng }
}

export function parsePhotoPatch(body: Record<string, unknown>) {
  const allowed = new Set(['title', 'description', 'categorySlug', 'tags', 'locationName', 'license', 'status'])
  const unknown = Object.keys(body).filter((key) => !allowed.has(key))
  if (unknown.length > 0) throw validation('包含不可修改的作品字段', { fields: unknown })
  if (Object.keys(body).length === 0) throw validation('至少提供一个可修改字段')

  const patch: Parameters<typeof updatePhoto>[2] = {}
  if ('title' in body) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 60) throw validation('title 不合法')
    patch.title = body.title.trim()
  }
  if ('description' in body) {
    if (typeof body.description !== 'string' || body.description.length > 2000) throw validation('description 不合法')
    patch.description = body.description.trim()
  }
  if ('categorySlug' in body) {
    if (typeof body.categorySlug !== 'string' || !body.categorySlug.trim() || body.categorySlug.trim().length > 80) throw validation('categorySlug 不合法')
    patch.categorySlug = body.categorySlug.trim()
  }
  if ('tags' in body) {
    if (!Array.isArray(body.tags) || !body.tags.every((entry) => typeof entry === 'string')) throw validation('tags 不合法')
    const tags = [...new Set((body.tags as string[]).map((entry) => entry.trim()).filter(Boolean))]
    if (tags.length > 5 || tags.some((entry) => entry.length > 20 || /[\p{Cc}\p{Cf}]/u.test(entry))) throw validation('tags 最多 5 个且每个不超过 20 字')
    patch.tags = tags
  }
  if ('locationName' in body) {
    if (typeof body.locationName !== 'string' || body.locationName.length > 80) throw validation('locationName 不合法')
    patch.locationName = body.locationName.trim()
  }
  if ('license' in body) {
    if (typeof body.license !== 'string' || !(PHOTO_LICENSES as readonly string[]).includes(body.license)) throw validation('license 不合法')
    patch.license = body.license
  }
  if ('status' in body) {
    if (body.status !== 'removed') throw validation('status 只能用于撤回作品')
    patch.status = body.status
  }
  return patch
}

export async function registerRoutes(app: FastifyInstance) {
  // ==========================================================================
  // 鉴权与资料
  // ==========================================================================
  await registerAuthRoutes(app)
  await registerProfileRoutes(app)
  await registerAccountCenterRoutes(app)
  await registerModerationRoutes(app)

  // ==========================================================================
  // 社交关系闭环（0022）：关注 / 粉丝、关注动态流、通知中心
  // ==========================================================================
  await registerSocialRoutes(app)
  await registerTagRoutes(app)

  // ==========================================================================
  // 服务端草稿 + 收藏夹/公开相册（0028）：草稿跨设备恢复、夹的增删改与条目分页
  // ==========================================================================
  await registerCollectionRoutes(app)

  // ==========================================================================
  // 作品
  // ==========================================================================

  app.get<{
    Querystring: {
      sort?: string
      categorySlug?: string
      cursor?: string
      limit?: string
      authorUsername?: string
    }
  }>('/api/photos', async (req) => {
    const sort = req.query.sort === 'popular' ? 'popular' : 'latest'
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
      throw validation('limit 必须是正整数')
    }

    // authorUsername：个人主页按用户名拉作品（0018 之后前端已拿不到 user UUID）。
    // 只做长度护栏，不做形状校验 —— 用户名形状不合法 = 数据库里查不到 = 空列表，
    // 这正是需求要的语义（用户名不存在返回空 items，而不是 500/400）。
    const authorUsername = req.query.authorUsername?.trim()
    if (authorUsername !== undefined && authorUsername.length > MAX_USERNAME_INPUT) {
      throw validation('authorUsername 过长')
    }

    return withAnonymous((c) =>
      listPhotos(c, {
        sort,
        categorySlug: req.query.categorySlug,
        authorUsername,
        cursor: req.query.cursor,
        limit,
      }),
    )
  })

  app.get<{ Params: { id: string } }>('/api/photos/:id', async (req) => {
    // 身份来自 JWT 验签（第 2 步）：伪造令牌不再可能。
    // 用带身份的上下文：作者本人能看自己的草稿，他人看不到（RLS 保证）。
    const user = await currentUser(req)
    return withRls(user?.userId ?? null, (c) => getPhoto(c, req.params.id))
  })

  app.post<{ Body: Record<string, unknown> }>(
    '/api/photos',
    { config: { rateLimit: PUBLISH_RATE_LIMIT } },
    async (req) => {
    const user = await requireUser(req)
    const b = req.body ?? {}
    const text = (name: string, max: number, required = true) => {
      const value = typeof b[name] === 'string' ? b[name].trim() : ''
      if (required && !value) throw validation(`${name} 不能为空`)
      if (value.length > max) throw validation(`${name} 不能超过 ${max} 个字符`)
      return value
    }
    const nullableNumber = (name: string) => {
      const value = b[name]
      if (value == null) return null
      if (typeof value !== 'number' || !Number.isFinite(value)) throw validation(`${name} 必须是数字或 null`)
      return value
    }
    const id = text('id', 36)
    const tags = Array.isArray(b.tags) && b.tags.every((v) => typeof v === 'string')
      ? [...new Set((b.tags as string[]).map((v) => v.trim()).filter(Boolean))]
      : []
    if (tags.length > 5 || tags.some((v) => v.length > 20 || /[\p{Cc}\p{Cf}]/u.test(v))) throw validation('tags 最多 5 个且每个不超过 20 字')
    const width = b.width
    const height = b.height
    if (!Number.isInteger(width) || Number(width) < 1 || !Number.isInteger(height) || Number(height) < 1) {
      throw validation('width 与 height 必须是正整数')
    }
    const precision = text('locationPrecision', 20)
    if (!['exact', 'district', 'city', 'hidden'].includes(precision)) throw validation('locationPrecision 不合法')
    const license = text('license', 40)
    if (!(PHOTO_LICENSES as readonly string[]).includes(license)) throw validation('license 不合法')
    const exif = validateExif(b.exif)
    const location = publicLocation(
      precision,
      text('locationName', 80, false),
      nullableNumber('locationLat'),
      nullableNumber('locationLng'),
    )

    return withRls(user.userId, (c) => createPhoto(c, {
      id,
      title: text('title', 60),
      description: text('description', 2000, false),
      categorySlug: text('categorySlug', 80),
      tags,
      locationName: location.name,
      locationLat: location.lat,
      locationLng: location.lng,
      locationPrecision: precision,
      shotAt: b.shotAt == null ? null : text('shotAt', 40),
      exif: exif as Record<string, unknown> | null,
      imageKey: text('imageKey', 300),
      thumbKey: text('thumbKey', 300),
      width: Number(width),
      height: Number(height),
      blurhash: b.blurhash == null ? null : text('blurhash', 200),
      license,
      credit: b.credit == null ? null : text('credit', 200, false),
    }))
    },
  )

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/photos/:id',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      const patch = parsePhotoPatch(req.body ?? {})
      return withRls(user.userId, (c) => updatePhoto(c, req.params.id, patch))
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/photos/:id',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req, reply) => {
      const user = await requireUser(req)
      const removed = await withRls(user.userId, (c) => removePhoto(c, req.params.id))
      if (!removed) throw notFound('作品不存在')
      return reply.status(204).send()
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/photos/:id/publish',
    { config: { rateLimit: PUBLISH_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      return withRls(user.userId, (c) => publishPhoto(c, req.params.id))
    },
  )

  app.put<{ Params: { id: string }; Body: { liked?: unknown } }>(
    '/api/photos/:id/like',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      if (typeof req.body?.liked !== 'boolean') throw validation('liked 必须是布尔值')
      return { liked: await withRls(user.userId, (c) => setLike(c, req.params.id, req.body.liked as boolean)) }
    },
  )

  app.put<{ Params: { id: string }; Body: { favorited?: unknown } }>(
    '/api/photos/:id/favorite',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      if (typeof req.body?.favorited !== 'boolean') throw validation('favorited 必须是布尔值')
      return { favorited: await withRls(user.userId, (c) => setFavorite(c, req.params.id, req.body.favorited as boolean)) }
    },
  )

  app.get<{ Querystring: { userId?: string; kind?: string } }>('/api/interactions', async (req) => {
    const user = await requireUser(req)
    if (req.query.userId && req.query.userId !== user.userId) throw validation('只能读取自己的互动列表')
    if (req.query.kind === 'likes') return withRls(user.userId, (c) => listLikesByUser(c, user.userId))
    if (req.query.kind === 'favorites') return withRls(user.userId, (c) => listFavoritesByUser(c, user.userId))
    throw validation('kind 必须是 likes 或 favorites')
  })

  app.get<{ Params: { id: string }; Querystring: { kind?: string; userId?: string } }>('/api/photos/:id/interaction-state', async (req) => {
    const user = await requireUser(req)
    if (req.query.userId && req.query.userId !== user.userId) throw validation('只能读取自己的互动状态')
    if (req.query.kind !== 'like' && req.query.kind !== 'favorite') throw validation('kind 必须是 like 或 favorite')
    const table = req.query.kind === 'like' ? 'likes' : 'favorites'
    return { active: await withRls(user.userId, (c) => getInteractionState(c, table, user.userId, req.params.id)) }
  })

  app.get<{ Params: { id: string }; Querystring: { kind?: string } }>('/api/photos/:id/interactions', async (req) => {
    const user = await requireUser(req)
    const kind = req.query.kind
    if (kind !== 'likes' && kind !== 'favorites') throw validation('kind 必须是 likes 或 favorites')
    return withRls(user.userId, (c) => listByPhoto(c, kind, req.params.id))
  })

  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>('/api/photos/:id/comments', async (req) => {
    const user = await currentUser(req)
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw validation('limit 必须是正整数')
    return withRls(user?.userId ?? null, (c) => listComments(c, {
      photoId: req.params.id,
      ...(req.query.cursor ? { cursor: req.query.cursor } : {}),
      ...(limit === undefined ? {} : { limit }),
    }))
  })

  app.post<{ Params: { id: string }; Body: { parentId?: unknown; body?: unknown } }>(
    '/api/photos/:id/comments',
    { config: { rateLimit: COMMENT_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      const body = typeof req.body?.body === 'string' ? req.body.body.trim() : ''
      if (!body || body.length > 1000) throw validation('评论正文须为 1–1000 个字符')
      const parentId = req.body?.parentId == null ? null : String(req.body.parentId)
      return withRls(user.userId, (c) => createComment(c, { photoId: req.params.id, parentId, body }))
    },
  )

  app.delete<{ Params: { id: string } }>('/api/comments/:id', async (req, reply) => {
    const user = await requireUser(req)
    await withRls(user.userId, (c) => removeComment(c, req.params.id))
    return reply.status(204).send()
  })

  app.get<{
    Querystring: { q?: string; categorySlug?: string; sort?: string; limit?: string }
  }>('/api/search', async (req) => {
    const text = req.query.q?.trim() ?? ''
    if (!text) throw validation('q 不能为空')
    if (text.length > 120) throw validation('q 不能超过 120 个字符')
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw validation('limit 必须是正整数')
    }
    return withAnonymous((c) =>
      searchPhotos(c, {
        text,
        sort: req.query.sort === 'popular' ? 'popular' : 'latest',
        ...(req.query.categorySlug ? { categorySlug: req.query.categorySlug } : {}),
        ...(limit === undefined ? {} : { limit }),
      }),
    )
  })

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/photos/:id/related',
    async (req) => {
      const limit = req.query.limit ? Number(req.query.limit) : 6
      return withAnonymous((c) => relatedPhotos(c, req.params.id, limit))
    },
  )

  // ==========================================================================
  // 分类
  // ==========================================================================

  app.get('/api/categories', async () => {
    return withAnonymous((c) => listCategories(c))
  })

  app.get<{ Params: { slug: string } }>('/api/categories/:slug', async (req) => {
    return withAnonymous((c) => getCategory(c, req.params.slug))
  })

  // ==========================================================================
  // 教程
  // ==========================================================================

  app.get<{
    Querystring: { topicSlug?: string; difficulty?: string; cursor?: string; limit?: string }
  }>('/api/articles', async (req) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    return withAnonymous((c) =>
      listArticles(c, {
        topicSlug: req.query.topicSlug,
        difficulty: req.query.difficulty,
        cursor: req.query.cursor,
        limit,
      }),
    )
  })

  app.get<{ Params: { slug: string } }>('/api/articles/:slug', async (req) => {
    return withAnonymous((c) => getArticleBySlug(c, req.params.slug))
  })

  app.get('/api/article-topics', async () => {
    return withAnonymous((c) => listArticleTopics(c))
  })

  // ==========================================================================
  // 周榜
  // ==========================================================================

  app.get<{ Params: { isoWeek: string }; Querystring: { kind?: string; withPhotos?: string } }>(
    '/api/rankings/:isoWeek',
    async (req) => {
      const kind = req.query.kind === 'final' ? 'final' : 'live'
      const withPhotos = req.query.withPhotos !== '0'

      const ranking = await withAnonymous((c) =>
        kind === 'final' ? getFinalRanking(c, req.params.isoWeek) : getLiveRanking(c, req.params.isoWeek),
      )

      // 前端榜单页需要作品的标题与缩略图，一并返回省一次往返
      if (withPhotos && ranking.entries.length > 0) {
        const ids = ranking.entries.map((e) => e.photoId)
        const photos = await withAnonymous((c) => getPhotosByIds(c, ids))
        const byId = new Map(photos.map((p) => [p.id, p]))
        return {
          ...ranking,
          entries: ranking.entries.map((e) => ({ ...e, photo: byId.get(e.photoId) ?? null })),
        }
      }

      return ranking
    },
  )

  app.get('/api/rankings', async () => {
    return withAnonymous((c) => listRankingWeeks(c))
  })
}
