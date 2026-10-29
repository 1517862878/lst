/**
 * 服务端草稿 + 收藏夹/公开相册（0028，契约 .tmp/phase83b-freeze.md §2）。
 *
 * 组网要点：
 *   - 全部 12 个端点都在这个文件里（草稿与收藏夹同属 8.3b，分开注册只会让
 *     "谁先注册"变成隐式依赖）；
 *   - 写操作一律 requireUser + withRls(user.userId, ...)：三张新表对 app_user
 *     零权限，事务级的 app.user_id 是 SECURITY DEFINER 函数里 auth.uid() 的唯一来源，
 *     所以「忘掉 withRls」= 直接 AUTH_REQUIRED，不会静默越权；
 *   - 读操作走 currentUser + withRls(uid ?? null)：匿名能看 public 夹，
 *     private 夹在 SQL 里就对匿名不可见（本层不写第二套权限判断）；
 *   - 可见性/上限/幂等全部由 0028 的函数决定，本层只做参数形态校验与空集→404 翻译。
 */
import type { FastifyInstance } from 'fastify'
import { currentUser, requireUser } from '../lib/auth.js'
import { withRls } from '../lib/db.js'
import { validation } from '../lib/errors.js'
import {
  addCollectionItem,
  createCollection,
  deleteCollection,
  deletePublishDraft,
  getCollection,
  getPublishDraft,
  listCollectionItems,
  listCollections,
  removeCollectionItem,
  savePublishDraft,
  updateCollection,
  type CollectionVisibility,
} from '../repositories/collections.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLLECTION_VISIBILITIES: readonly CollectionVisibility[] = ['private', 'unlisted', 'public']

/** 标题 / 简介的长度上限与 0028 的 check 约束一致（这里先拦，省一次数据库往返）。 */
const TITLE_MAX = 40
const DESCRIPTION_MAX = 200

/**
 * 草稿 PUT 是 5 秒防抖的自动保存：单个用户一分钟最多 12 次正常请求，
 * 上限给到 120 是为了容忍「改一个字 + 刷新」这类抖动，同时挡住脚本刷。
 */
const DRAFT_RATE_LIMIT = { max: 120, timeWindow: '1 minute' } as const
/**
 * 建夹/改夹/删夹。
 *
 * 上限给到 120/min 而不是更紧的值：一次「整理夹子」的真实操作会连续建好几个，
 * 而真正的护栏是数据库里的 30 个夹配额（53400 → 422），限流只是挡住脚本刷。
 */
const COLLECTION_RATE_LIMIT = { max: 120, timeWindow: '1 minute' } as const
/** 加入/移出作品：批量整理夹子时会连点，给宽一点。 */
const ITEM_RATE_LIMIT = { max: 120, timeWindow: '1 minute' } as const

function body(req: { body?: unknown }): Record<string, unknown> {
  const value = req.body
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw validation('请求体必须是 JSON 对象')
  }
  return value as Record<string, unknown>
}

/** 只允许白名单键；多传字段说明前端写错了，静默忽略会让人查半天。 */
function rejectUnknown(bodyValue: Record<string, unknown>, allowed: readonly string[]) {
  const unknownKeys = Object.keys(bodyValue).filter((key) => !allowed.includes(key))
  if (unknownKeys.length) throw validation('包含未知字段', { fields: unknownKeys })
}

function parseCollectionId(raw: string): string {
  if (!UUID_PATTERN.test(raw)) throw validation('收藏夹 id 不合法')
  return raw
}

function parsePhotoId(raw: unknown): string {
  if (typeof raw !== 'string' || !UUID_PATTERN.test(raw)) throw validation('photoId 不合法')
  return raw
}

/** 标题：trim 后 1..40 个字符（按 Unicode 码点计数，与 SQL 的 char_length 一致）。 */
function parseTitle(raw: unknown): string {
  if (typeof raw !== 'string') throw validation('title 必须是字符串')
  const title = raw.trim()
  if (!title) throw validation('收藏夹标题不能为空')
  if ([...title].length > TITLE_MAX) throw validation(`收藏夹标题最多 ${TITLE_MAX} 字`)
  return title
}

function parseDescription(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw !== 'string') throw validation('description 必须是字符串')
  const description = raw.trim()
  if ([...description].length > DESCRIPTION_MAX) {
    throw validation(`收藏夹简介最多 ${DESCRIPTION_MAX} 字`)
  }
  return description
}

function parseVisibility(raw: unknown): CollectionVisibility {
  if (typeof raw !== 'string' || !(COLLECTION_VISIBILITIES as readonly string[]).includes(raw)) {
    throw validation('visibility 只能是 private / unlisted / public')
  }
  return raw as CollectionVisibility
}

function parseLimit(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw validation('limit 必须是正整数')
  return value
}

/**
 * 草稿载荷：只要求是 JSON 对象。
 *
 * 形状与 64KB 上限都由 api_save_publish_draft 兜底（23514），这里不做第二份校验：
 * 前端字段集（§3.2）将来会加字段，路由层硬编码白名单只会变成维护负担。
 */
function parseDraftPayload(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw validation('payload 必须是 JSON 对象')
  }
  return raw as Record<string, unknown>
}

export async function registerCollectionRoutes(app: FastifyInstance): Promise<void> {
  // ==========================================================================
  // 服务端草稿：跨设备恢复未提交的发布表单
  // ==========================================================================

  app.get('/api/me/publish-draft', async (req) => {
    const user = await requireUser(req)
    return withRls(user.userId, (client) => getPublishDraft(client))
  })

  app.put(
    '/api/me/publish-draft',
    { config: { rateLimit: DRAFT_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      const payload = body(req)
      rejectUnknown(payload, ['payload'])
      const draft = parseDraftPayload(payload.payload)
      return withRls(user.userId, (client) => savePublishDraft(client, draft))
    },
  )

  app.delete(
    '/api/me/publish-draft',
    { config: { rateLimit: DRAFT_RATE_LIMIT } },
    async (req, reply) => {
      const user = await requireUser(req)
      await withRls(user.userId, (client) => deletePublishDraft(client))
      return reply.status(204).send()
    },
  )

  // ==========================================================================
  // 收藏夹列表
  // ==========================================================================

  /** 我的夹：含 private。用户名取自会话，不接受前端传 —— 否则就成了越权入口。 */
  app.get('/api/me/collections', async (req) => {
    const user = await requireUser(req)
    const items = await withRls(user.userId, (client) =>
      listCollections(client, { ownerUsername: user.username, includePrivate: true }),
    )
    return { items }
  })

  /**
   * 某人的公开夹（public 主页的「相册」Tab）。
   *
   * includePrivate 仅在访问自己时传 true；即便传 true，0028 的函数内部也会
   * 比对 auth.uid()，非本人的 private 夹一行都不会出现（契约 §1.3 第 4 条）。
   */
  app.get<{ Params: { username: string } }>('/api/u/:username/collections', async (req) => {
    const viewer = await currentUser(req)
    const username = req.params.username.trim()
    if (!username) throw validation('用户名不合法')
    const includePrivate = viewer != null && viewer.username.toLowerCase() === username.toLowerCase()
    const items = await withRls(viewer?.userId ?? null, (client) =>
      listCollections(client, { ownerUsername: username, includePrivate }),
    )
    return { items }
  })

  // ==========================================================================
  // 收藏夹创建 / 修改 / 删除
  // ==========================================================================

  app.post(
    '/api/collections',
    { config: { rateLimit: COLLECTION_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      const payload = body(req)
      rejectUnknown(payload, ['title', 'description', 'visibility'])
      const title = parseTitle(payload.title)
      const description = parseDescription(payload.description)
      const visibility =
        payload.visibility === undefined ? 'private' : parseVisibility(payload.visibility)
      return withRls(user.userId, (client) =>
        createCollection(client, { title, description, visibility }),
      )
    },
  )

  /**
   * PATCH 语义：只改传了的字段（undefined = 不改）。SQL 里 null 表示「保持原值」，
   * 所以空字符串会走到 parseDescription 的 trim 后清空，而不是被当成「不改」。
   */
  app.patch<{ Params: { id: string } }>(
    '/api/collections/:id',
    { config: { rateLimit: COLLECTION_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      const id = parseCollectionId(req.params.id)
      const payload = body(req)
      rejectUnknown(payload, ['title', 'description', 'visibility'])
      const patch: {
        title?: string
        description?: string
        visibility?: CollectionVisibility
      } = {}
      if (payload.title !== undefined) patch.title = parseTitle(payload.title)
      if (payload.description !== undefined) patch.description = parseDescription(payload.description)
      if (payload.visibility !== undefined) patch.visibility = parseVisibility(payload.visibility)
      if (Object.keys(patch).length === 0) throw validation('没有需要更新的字段')
      return withRls(user.userId, (client) => updateCollection(client, id, patch))
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/collections/:id',
    { config: { rateLimit: COLLECTION_RATE_LIMIT } },
    async (req, reply) => {
      const user = await requireUser(req)
      const id = parseCollectionId(req.params.id)
      await withRls(user.userId, (client) => deleteCollection(client, id))
      return reply.status(204).send()
    },
  )

  // ==========================================================================
  // 夹详情 / 夹内条目
  // ==========================================================================

  /** 夹信息 + 第一页条目（一次事务两次查询，避免详情与首屏条目跨快照不一致）。 */
  app.get<{ Params: { id: string } }>('/api/collections/:id', async (req) => {
    const viewer = await currentUser(req)
    const id = parseCollectionId(req.params.id)
    return withRls(viewer?.userId ?? null, async (client) => {
      const collection = await getCollection(client, id)
      const page = await listCollectionItems(client, { collectionId: id, limit: 20 })
      return { collection, items: page.items, nextCursor: page.nextCursor }
    })
  })

  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>(
    '/api/collections/:id/items',
    async (req) => {
      const viewer = await currentUser(req)
      const id = parseCollectionId(req.params.id)
      const limit = parseLimit(req.query.limit)
      return withRls(viewer?.userId ?? null, (client) =>
        listCollectionItems(client, { collectionId: id, cursor: req.query.cursor, limit }),
      )
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/collections/:id/items',
    { config: { rateLimit: ITEM_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      const collectionId = parseCollectionId(req.params.id)
      const payload = body(req)
      rejectUnknown(payload, ['photoId'])
      const photoId = parsePhotoId(payload.photoId)
      const itemCount = await withRls(user.userId, (client) =>
        addCollectionItem(client, { collectionId, photoId }),
      )
      return { itemCount }
    },
  )

  app.delete<{ Params: { id: string; photoId: string } }>(
    '/api/collections/:id/items/:photoId',
    { config: { rateLimit: ITEM_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      const collectionId = parseCollectionId(req.params.id)
      const photoId = parsePhotoId(req.params.photoId)
      const itemCount = await withRls(user.userId, (client) =>
        removeCollectionItem(client, { collectionId, photoId }),
      )
      return { itemCount }
    },
  )
}
