/**
 * 路由注册入口。
 *
 * 第 1 步：只读接口。
 * 第 2 步（本次）：鉴权 —— 身份改为来自 lib/auth.ts 的 JWT 验签结果，
 *                  并挂上 /api/auth/* 与 /api/profiles/*。
 * 后续阶段再加：写入（点赞/收藏/评论）、上传、搜索。
 */
import type { FastifyInstance } from 'fastify'
import { currentUser } from '../lib/auth.js'
import { withAnonymous, withRls } from '../lib/db.js'
import { validation } from '../lib/errors.js'
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
import { searchPhotos } from '../repositories/search.js'

export async function registerRoutes(app: FastifyInstance) {
  // ==========================================================================
  // 鉴权与资料
  // ==========================================================================
  await registerAuthRoutes(app)
  await registerProfileRoutes(app)

  // ==========================================================================
  // 作品
  // ==========================================================================

  app.get<{
    Querystring: { sort?: string; categorySlug?: string; cursor?: string; limit?: string }
  }>('/api/photos', async (req) => {
    const sort = req.query.sort === 'popular' ? 'popular' : 'latest'
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
      throw validation('limit 必须是正整数')
    }

    return withAnonymous((c) =>
      listPhotos(c, {
        sort,
        categorySlug: req.query.categorySlug,
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
