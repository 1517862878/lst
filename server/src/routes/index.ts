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
  setCommentsLocked,
  setFavorite,
  setLike,
  updatePhoto,
} from '../repositories/writes.js'
import { listComments } from '../repositories/comments.js'
import { getInteractionState, listByPhoto, listFavoritesByUser, listLikesByUser } from '../repositories/interactions.js'
import { listPhotos, getPhoto, relatedPhotos } from '../repositories/photos.js'
import { listPhotoItems, replacePhotoItems, type PhotoItemInput } from '../repositories/photo-items.js'
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
import { registerDiscoverRoutes } from './discover.js'
import { registerStatsRoutes } from './stats.js'
import { registerGearRoutes } from './gear.js'
import { searchPhotos } from '../repositories/search.js'
import { logSearch } from '../repositories/discover.js'
import { requestIpHash } from '../lib/session.js'

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
  const allowed = new Set([
    'title', 'description', 'categorySlug', 'tags', 'locationName', 'license', 'status', 'exifHidden',
  ])
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
  // 0031：逐张隐藏拍摄参数。只认真正的布尔 —— "true"/1 一律 400，
  // 隐私开关上「静默纠正」的代价是把用户以为藏住的东西放了出去。
  if ('exifHidden' in body) {
    if (typeof body.exifHidden !== 'boolean') throw validation('exifHidden 必须是布尔值')
    patch.exifHidden = body.exifHidden
  }
  return patch
}

/** 组照上限：与 0033 的 ck_photo_items_position / api_replace_photo_items 一致。 */
export const MAX_PHOTO_ITEMS = 9
/** 单张说明上限：与 ck_photo_items_caption 一致（200 字，按码点计）。 */
export const MAX_ITEM_CAPTION = 200

/**
 * 解析 PUT /api/photos/:id/items 的请求体 → 归一化条目数组。
 *
 * 两处刻意的设计决定：
 *  1) 位置由数组顺序决定，不认客户端的 position/id —— 传入的这两个键会被忽略。
 *     前端上传完可能把现有 items 原样回传（里面带着 id/position），
 *     如果对它们做「未知字段即 400」，用户只是重排一下顺序就会失败；
 *     而 position 本来就该由服务端按顺序重排，不能采信客户端。
 *  2) 校验只做到形状/类型/长度这一层，图片键的归属（必须落在本人 + 本作品的
 *     目录里）交给数据库的 api_replace_photo_items —— 那是唯一能拿到 auth.uid()
 *     与作品作者的地方，两边都写等于埋一个「谁改谁漏」的分裂。
 */
export function parsePhotoItems(body: Record<string, unknown>): PhotoItemInput[] {
  const raw = body.items
  if (!Array.isArray(raw)) throw validation('items 必须是数组')
  if (raw.length > MAX_PHOTO_ITEMS) throw validation(`一件作品最多 ${MAX_PHOTO_ITEMS} 张图`)

  return raw.map((entry, index) => {
    if (!isPlainObject(entry)) throw validation(`items[${index}] 必须是普通对象`)
    const text = (name: string, max: number) => {
      const value = entry[name]
      if (typeof value !== 'string' || !value.trim()) throw validation(`items[${index}].${name} 不能为空`)
      if (value.length > max) throw validation(`items[${index}].${name} 过长`)
      return value.trim()
    }
    const side = (name: string) => {
      const value = entry[name]
      if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 40000) {
        throw validation(`items[${index}].${name} 必须是 1–40000 的整数`)
      }
      return Number(value)
    }
    const blurhash = entry.blurhash
    if (blurhash != null && typeof blurhash !== 'string') {
      throw validation(`items[${index}].blurhash 必须是字符串或 null`)
    }
    const captionRaw = entry.caption
    if (captionRaw != null && typeof captionRaw !== 'string') {
      throw validation(`items[${index}].caption 必须是字符串`)
    }
    const caption = typeof captionRaw === 'string' ? captionRaw.trim() : ''
    // 按码点计数（char_length 的语义），否则 200 个 emoji 会被 JS 的 UTF-16 长度误判成 400。
    if (Array.from(caption).length > MAX_ITEM_CAPTION) {
      throw validation(`items[${index}].caption 不能超过 ${MAX_ITEM_CAPTION} 字`)
    }

    return {
      imageKey: text('imageKey', 512),
      thumbKey: text('thumbKey', 512),
      width: side('width'),
      height: side('height'),
      blurhash: typeof blurhash === 'string' ? blurhash : null,
      caption,
    }
  })
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
  // 发现增强（0029）：热门搜索 / 新作者推荐 / 编辑精选流 / staff 打标
  // ==========================================================================
  await registerDiscoverRoutes(app)

  // ==========================================================================
  // 创作者统计（0030）：本人作品数/互动数/粉丝数 + 单件作品数据 + 榜单通知触发
  // ==========================================================================
  await registerStatsRoutes(app)

  // ==========================================================================
  // 摄影专业化（0031）：器材 / 地点 / 季节的公开聚合
  // ==========================================================================
  await registerGearRoutes(app)

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
    const photoId = req.params.id
    return withRls(user?.userId ?? null, async (c) => {
      const photo = await getPhoto(c, photoId)
      // 0033 组照：单图作品这里恒为 []（api_list_photo_items 返回空集），
      // 前端只按 items.length / itemCount 判断，不必区分两种作品形态。
      // 注意封面字段仍然来自 photos 行本身（mapPhoto 的 imageKey/thumbKey），
      // 没有把既有查询改成 join —— 单图作品的取数路径一个字节都没动。
      // 列表接口刻意不带 items：那是 N+1，itemCount 已经够前端渲染「共 N 张」。
      const items = await listPhotoItems(c, photoId)
      return { ...photo, items }
    })
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

  // 0033 组照：整组替换（作者本人）。空数组 = 退回单图作品（封面保持原样）。
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/photos/:id/items',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      const items = parsePhotoItems(req.body ?? {})
      const photoId = req.params.id
      return withRls(user.userId, async (c) => {
        const result = await replacePhotoItems(c, photoId, user.userId, items)
        // 回读一遍而不是把入参回显：位置以数据库里的 position 为准，
        // 也让「空数组 → item_count=0、items=[]」这条路径只有一种结果形状。
        return {
          photoId: result.photoId,
          itemCount: result.itemCount,
          items: await listPhotoItems(c, photoId),
        }
      })
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

  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string; sort?: string } }>('/api/photos/:id/comments', async (req) => {
    const user = await currentUser(req)
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw validation('limit 必须是正整数')
    // 0032：排序白名单。非法值必须 400 —— 静默回落成 latest 会让前端
    // 以为「最早」切换生效了，实际列表顺序没变，属于最难查的一类界面问题。
    const sort = req.query.sort ?? 'latest'
    if (sort !== 'latest' && sort !== 'oldest') throw validation('sort 只能是 latest 或 oldest')
    return withRls(user?.userId ?? null, (c) => listComments(c, {
      photoId: req.params.id,
      sort,
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

  // 0032：作者开关评论。非作者 403（42501），作品不存在/已删 404（P0002）。
  app.put<{ Params: { id: string }; Body: { locked?: unknown } }>(
    '/api/photos/:id/comments-lock',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      if (typeof req.body?.locked !== 'boolean') throw validation('locked 必须是布尔值')
      return withRls(user.userId, (c) =>
        setCommentsLocked(c, req.params.id, user.userId, req.body.locked as boolean),
      )
    },
  )

  app.delete<{ Params: { id: string } }>('/api/comments/:id', async (req, reply) => {
    const user = await requireUser(req)
    // 0032：评论作者或作品作者都能删；其它人 403，重复删幂等（不刷新时间戳）。
    await withRls(user.userId, (c) => removeComment(c, req.params.id, user.userId))
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
    const result = await withAnonymous((c) =>
      searchPhotos(c, {
        text,
        sort: req.query.sort === 'popular' ? 'popular' : 'latest',
        ...(req.query.categorySlug ? { categorySlug: req.query.categorySlug } : {}),
        ...(limit === undefined ? {} : { limit }),
      }),
    )

    // 热门搜索的来源只有这里。故意不 await：写日志失败（磁盘满、锁等待）绝不能
    // 让一次正常的搜索变成 500；用户拿到的是搜索结果，日志是副产品。
    const userId = (await currentUser(req).catch(() => null))?.userId ?? null
    void withAnonymous((c) =>
      logSearch(c, { term: text, userId, ipHash: requestIpHash(req) }),
    ).catch((error: unknown) => {
      app.log.warn({ err: error }, '记录搜索词失败（不影响搜索响应）')
    })

    return result
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
