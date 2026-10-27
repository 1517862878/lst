/**
 * 路由注册入口。
 *
 * 当前阶段（第 1 步）：只读接口。
 * 后续阶段再加：鉴权、写入、上传。
 */
import type { FastifyInstance } from 'fastify'
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

/** 从 Authorization 头解析用户 id（第 2 步接入 JWT 后替换实现） */
function userIdOf(req: { headers: Record<string, unknown> }): string | null {
  const h = req.headers.authorization
  if (typeof h !== 'string') return null
  // 临时占位：Bearer <uuid>（第 2 步改成 JWT 校验）
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m ? m[1]!.trim() : null
}

export async function registerRoutes(app: FastifyInstance) {
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
    const userId = userIdOf(req)
    // 用带身份的上下文：作者本人能看自己的草稿，他人看不到（RLS 保证）
    return withRls(userId, (c) => getPhoto(c, req.params.id))
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
