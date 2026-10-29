/**
 * 摄影专业化路由（0031）：器材、地点、季节。
 *
 * 六个端点全是**公开只读**数据（游客与登录用户看到的内容一致：统计只基于在架作品，
 * 且已排除作者选择隐藏 EXIF / 隐藏地点的作品），因此统一走 withAnonymous()。
 *
 * 为什么 label 走 query 而不是路径段：机型名与地名是中文（"Canon EOS R5"、
 * "杭州 · 西湖"），进路径要处理编码之外的斜杠/百分号歧义；Freeze §3 也明确
 * 由 query 传。`:kind` 仍在路径里，但它只接受 body|lens 两个 ASCII 枚举。
 */
import type { FastifyInstance } from 'fastify'
import { withAnonymous } from '../lib/db.js'
import { validation } from '../lib/errors.js'
import {
  listGear,
  listGearPhotos,
  listPlacePhotos,
  listPlaces,
  listSeasons,
  type GearKind,
} from '../repositories/gear.js'

const GEAR_KINDS = new Set<GearKind>(['body', 'lens'])
/** 与 mappers/SQL 的裁剪口径一致：机型全名（"Canon Canon EOS R5"）也能放下。 */
const LABEL_MAX_LENGTH = 80
const LABEL_FORBIDDEN = /[\p{Cc}\p{Cf}]/u

function parseKind(raw: string | undefined): GearKind {
  const value = (raw ?? '').trim().toLowerCase()
  if (!GEAR_KINDS.has(value as GearKind)) throw validation('kind 必须是 body 或 lens')
  return value as GearKind
}

/**
 * 器材/地点名归一化。
 *
 * 空 label 是**参数错误**而不是「返回全部」：把空串当通配会让 /api/gear/body/photos
 * 变成一次全站作品拉取，等于绕过聚合页的语义。
 */
function parseLabel(raw: string | undefined, field: string): string {
  const label = (raw ?? '').trim()
  if (!label) throw validation(`${field} 不能为空`)
  if (label.length > LABEL_MAX_LENGTH) throw validation(`${field} 不能超过 ${LABEL_MAX_LENGTH} 个字符`)
  if (LABEL_FORBIDDEN.test(label)) throw validation(`${field} 包含不可见字符`)
  return label
}

function parseLimit(raw: string | undefined, fallback: number): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 50) throw validation('limit 必须是 1–50 的整数')
  return value || fallback
}

export async function registerGearRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/gear?limit= — 机身 + 镜头一起返回（kind 区分），按作品数倒序
  app.get<{ Querystring: { limit?: string } }>('/api/gear', async (request) => {
    const limit = parseLimit(request.query.limit, 30)
    const items = await withAnonymous((client) => listGear(client, { limit }))
    return { items }
  })

  // GET /api/gear/:kind?limit= — 只取一组（/gear 页的两个 tab）
  app.get<{ Params: { kind: string }; Querystring: { limit?: string } }>(
    '/api/gear/:kind',
    async (request) => {
      const kind = parseKind(request.params.kind)
      const limit = parseLimit(request.query.limit, 30)
      const items = await withAnonymous((client) => listGear(client, { limit }))
      return { items: items.filter((item) => item.kind === kind) }
    },
  )

  // GET /api/gear/:kind/photos?label=&limit=&cursor=
  app.get<{
    Params: { kind: string }
    Querystring: { label?: string; limit?: string; cursor?: string }
  }>('/api/gear/:kind/photos', async (request) => {
    const kind = parseKind(request.params.kind)
    const label = parseLabel(request.query.label, 'label')
    const limit = parseLimit(request.query.limit, 20)
    const cursor = request.query.cursor?.trim() || undefined
    return withAnonymous((client) => listGearPhotos(client, { kind, label, cursor, limit }))
  })

  // GET /api/places?limit= — 地点卡片（作品数 + 最近更新时间）
  app.get<{ Querystring: { limit?: string } }>('/api/places', async (request) => {
    const limit = parseLimit(request.query.limit, 30)
    const items = await withAnonymous((client) => listPlaces(client, { limit }))
    return { items }
  })

  // GET /api/places/photos?label=&limit=&cursor=
  app.get<{ Querystring: { label?: string; limit?: string; cursor?: string } }>(
    '/api/places/photos',
    async (request) => {
      const label = parseLabel(request.query.label, 'label')
      const limit = parseLimit(request.query.limit, 20)
      const cursor = request.query.cursor?.trim() || undefined
      return withAnonymous((client) => listPlacePhotos(client, { label, cursor, limit }))
    },
  )

  // GET /api/seasons — 四季恒 4 行（计数 0 也返回），顺序 spring→winter
  app.get('/api/seasons', async () => {
    const items = await withAnonymous((client) => listSeasons(client))
    return { items }
  })
}
