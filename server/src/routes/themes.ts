/**
 * 每周主题与活动路由（0036 / 8.4d，契约 .tmp/phase84d-freeze.md §2）。
 *
 * 组网要点（与 routes/collections.ts 同构，刻意不做第二套）：
 *   - 契约表里的 9 个端点全在这一个文件里；另有一个加性端点
 *     `GET /api/admin/themes`（后台主题 Tab 要看得见 draft，公开三档刻意不含草稿，
 *     详见文件末尾的说明）；
 *   - 写操作一律 requireUser + withRls(user.userId, ...)：photo_themes / theme_entries
 *     对 app_user 零权限、零 RLS 策略，事务级的 app.user_id 是 SECURITY DEFINER
 *     函数里 auth.uid() 的唯一来源，所以「忘掉 withRls」= 直接 AUTH_REQUIRED，
 *     不可能静默越权；
 *   - 读操作走 currentUser + withRls(uid ?? null)：匿名能看已发布主题，
 *     draft 主题在 api_get_theme 里就对非编辑返回 0 行（本层只把空集翻成 404，
 *     不写第二套权限判断）；
 *   - Origin / CSRF 校验不在这里：server/src/index.ts 的 registerRequestSecurity 是
 *     全局 onRequest 钩子，本文件的三个写接口自动受它保护（集成测试因此必须带
 *     Origin + gy_csrf 双提交 cookie）；
 *   - 参数形态校验在路由层（类型、必填、UUID 形状、slug 形状），**业务规则一律
 *     交给 0036 的函数**：投稿期、每人 3 件上限、重复投稿、slug 不可改、
 *     「同一时刻只有一个 active 主题」、封面必须是本主题投稿 —— 都在 SQL 里判并
 *     给出可读中文，本层不复制一份会漂移的判定。
 */
import type { FastifyInstance } from 'fastify'
import type { PoolClient } from 'pg'
import { currentUser, requireUser, type AuthPrincipal } from '../lib/auth.js'
import { withRls } from '../lib/db.js'
import { forbidden, notFound, validation } from '../lib/errors.js'
import {
  MAX_THEME_ENTRIES_PAGE_SIZE,
  getTheme,
  listAdminThemes,
  listMyThemeEntries,
  listThemeEntries,
  listThemes,
  selectThemeEntry,
  submitThemeEntry,
  upsertTheme,
  withdrawThemeEntry,
  type ThemeDetailDto,
  type ThemeFilter,
  type ThemeStatus,
  type ThemeUpsertInput,
} from '../repositories/themes.js'

/**
 * slug 在 URL 里的形状（与 ck_photo_themes_slug_format 一致）。
 *
 * 形状不合法 ⇒ 404 而不是 400：`/api/themes/ABC!` 与 `/api/themes/没有这个主题`
 * 对调用者是同一件事 —— 这个地址背后没有资源。契约 §2 明确要求「非法格式在路由层
 * 拦成 404，不要 500」（含有非法字符的 slug 直接进 SQL 只会得到暗淡的空集）。
 */
const THEME_SLUG_RE = /^[a-z0-9-]{2,40}$/

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const THEME_FILTERS: readonly ThemeFilter[] = ['active', 'upcoming', 'past']
const THEME_STATUSES: readonly ThemeStatus[] = ['draft', 'active', 'closed']

/** 投稿网格默认一页 24 条；与 SQL 里 least(greatest(p_limit,1),48) 的默认值一致。 */
const ENTRY_PAGE_DEFAULT = 24

/**
 * 投稿 / 撤回：正常节奏是「挑几件 → 提交」，30/min 足够宽松，
 * 真正的护栏是数据库里的「每人每主题 3 件」（54000 → 422），限流只挡脚本刷。
 */
const ENTRY_RATE_LIMIT = { max: 30, timeWindow: '1 minute' } as const
/** 建主题 / 改主题 / 精选：运营动作，量级很小。 */
const ADMIN_RATE_LIMIT = { max: 30, timeWindow: '1 minute' } as const

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

function isStaff(role: unknown): boolean {
  return role === 'editor' || role === 'admin'
}

/** 编辑身份在路由层先拦一次，让非 staff 拿到干净的 403（函数里还会再判一次）。 */
function requireStaff(user: AuthPrincipal): void {
  if (!isStaff(user.role)) throw forbidden('需要编辑权限')
}

/** URL 里的 slug：形状不合法 = 这个地址没有资源 → 404。 */
function parseSlugFromPath(raw: string): string {
  if (!THEME_SLUG_RE.test(raw)) throw notFound('主题不存在')
  return raw
}

/** 查询串里的 slug（/api/me/theme-entries?slug=）：缺失是请求写错了 → 400。 */
function parseSlugFromQuery(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw validation('slug 必填')
  return parseSlugFromPath(raw.trim())
}

function parseUuid(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || !UUID_PATTERN.test(raw)) throw validation(`${label} 不合法`)
  return raw
}

function parseThemeId(raw: string): string {
  return parseUuid(raw, '主题 id')
}

function parsePhotoId(raw: unknown): string {
  return parseUuid(raw, 'photoId')
}

/** 公开列表的三个档位；不传 = 进行中 + 即将开始 + 最近 12 期往期（SQL 的行为）。 */
function parseFilter(raw: unknown): ThemeFilter | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'string' && (THEME_FILTERS as readonly string[]).includes(raw)) {
    return raw as ThemeFilter
  }
  throw validation('status 只能是 active / upcoming / past')
}

/** 后台列表的三档（含 draft）；不认识的值直接 400，不让脏值进 SQL 的白名单分支。 */
function parseAdminStatus(raw: unknown): ThemeStatus | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'string' && (THEME_STATUSES as readonly string[]).includes(raw)) {
    return raw as ThemeStatus
  }
  throw validation('status 只能是 draft / active / closed')
}

function parseEntryStatus(raw: unknown): ThemeStatus {
  if (typeof raw === 'string' && (THEME_STATUSES as readonly string[]).includes(raw)) {
    return raw as ThemeStatus
  }
  throw validation('status 只能是 draft / active / closed')
}

/** 1..48；传大了照 48 算（SQL 也是这个钳制），传 0/负数/小数是参数错误。 */
function parseLimit(raw: unknown): number {
  if (raw == null || raw === '') return ENTRY_PAGE_DEFAULT
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw validation('limit 必须是正整数')
  return Math.min(value, MAX_THEME_ENTRIES_PAGE_SIZE)
}

function parseOffset(raw: unknown): number {
  if (raw == null || raw === '') return 0
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) throw validation('offset 必须是非负整数')
  return value
}

/** `selected=1`（前端）与 `selected=true` 都认；空/0/false = 全部投稿。 */
function parseSelectedOnly(raw: unknown): boolean {
  if (raw == null || raw === '' || raw === '0' || raw === 'false') return false
  if (raw === '1' || raw === 'true') return true
  throw validation('selected 只能是 1 或 0')
}

function parseText(raw: unknown, label: string): string {
  if (typeof raw !== 'string') throw validation(`${label} 必须是字符串`)
  return raw.trim()
}

/**
 * 可解析的 ISO-8601 时间。
 *
 * 只校验「可解析」并把原字符串透传给 PostgreSQL（`$7::timestamptz`）：
 * 时区、精度这些由数据库的 timestamptz 语义决定，路由层再写一套日期解析只会
 * 制造两种口径。长度上限交给库（ends_at > starts_at 的校验也在函数里）。
 */
function parseTimestamp(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw validation(`${label} 必须是 ISO-8601 时间字符串`)
  }
  const value = raw.trim()
  if (Number.isNaN(Date.parse(value))) throw validation(`${label} 不是可解析的时间`)
  return value
}

/**
 * DTO 上的 startsAt / endsAt 是 `string | null`（保守类型），但两个列都是
 * `not null`。真读到 null 说明数据被外力改坏 —— 宁可 500，也不要把空值
 * 传给 SQL 变成「把投稿期清空」。
 */
function requireWindow(value: string | null, label: string): string {
  if (value == null) throw new Error(`主题的 ${label} 不应为空（photo_themes 是 not null）`)
  return value
}

function parseCoverPhotoId(raw: unknown): string | null {
  if (raw == null) return null
  return parseUuid(raw, 'coverPhotoId')
}

// ============================================================================
// 编辑写入（POST / PATCH /api/admin/themes）
// ============================================================================

const THEME_WRITE_FIELDS = [
  'slug',
  'title',
  'description',
  'rules',
  'status',
  'startsAt',
  'endsAt',
  'coverPhotoId',
  'resultNote',
] as const

/**
 * 新建主题。
 *
 * slug / title / startsAt / endsAt 必填（缺了就是 400，而不是让 SQL 收到 null 再
 * 抛一句不好定位的话）；status 缺省 draft —— 与前端 mock 实现
 * （src/data/mock/repositories/themes.ts 的 `input.status ?? 'draft'`）一致：
 * 运营先把主题存成草稿、排好期再激活是常规流程。
 *
 * slug 的**格式**不在这里判：`api_admin_upsert_theme` 会给出一句可读中文
 * （23514 → 400）。请求体里的字段非法是 400，URL 里的 slug 不存在才是 404，
 * 两者不要混成一个码。
 */
function parseThemeCreate(payload: Record<string, unknown>): ThemeUpsertInput {
  for (const field of ['slug', 'title', 'startsAt', 'endsAt'] as const) {
    if (payload[field] === undefined) throw validation(`${field} 必填`)
  }
  return {
    id: null,
    slug: parseText(payload.slug, 'slug'),
    title: parseText(payload.title, 'title'),
    description: payload.description === undefined ? '' : parseText(payload.description, 'description'),
    rules: payload.rules === undefined ? '' : parseText(payload.rules, 'rules'),
    status: payload.status === undefined ? 'draft' : parseEntryStatus(payload.status),
    startsAt: parseTimestamp(payload.startsAt, 'startsAt'),
    endsAt: parseTimestamp(payload.endsAt, 'endsAt'),
    coverPhotoId: parseCoverPhotoId(payload.coverPhotoId),
    resultNote: payload.resultNote === undefined ? '' : parseText(payload.resultNote, 'resultNote'),
  }
}

/**
 * PATCH 是「局部更新」，但 api_admin_upsert_theme 是**整体覆盖**（update 里
 * title/description/rules/status/窗口/封面/结果文案全部写回，没传的字段会变成
 * 空串或 null）。所以这里先按 id 取回原值，再把 patch 叠上去 —— 这正是
 * repositories/themes.ts 的 listAdminThemes 存在的第二个理由。
 */
function mergeTheme(existing: ThemeDetailDto, payload: Record<string, unknown>): ThemeUpsertInput {
  return {
    id: existing.id,
    // slug 传了就必须与库里一致（SQL 抛 22023 → 400「主题 slug 创建后不可修改」）；
    // 没传就原样回传，保持「不改 URL」的语义。
    slug: payload.slug === undefined ? existing.slug : parseText(payload.slug, 'slug'),
    title: payload.title === undefined ? existing.title : parseText(payload.title, 'title'),
    description:
      payload.description === undefined
        ? existing.description
        : parseText(payload.description, 'description'),
    rules: payload.rules === undefined ? existing.rules : parseText(payload.rules, 'rules'),
    status: payload.status === undefined ? existing.status : parseEntryStatus(payload.status),
    startsAt:
      payload.startsAt === undefined
        ? requireWindow(existing.startsAt, 'starts_at')
        : parseTimestamp(payload.startsAt, 'startsAt'),
    endsAt:
      payload.endsAt === undefined
        ? requireWindow(existing.endsAt, 'ends_at')
        : parseTimestamp(payload.endsAt, 'endsAt'),
    coverPhotoId:
      payload.coverPhotoId === undefined
        ? existing.coverPhotoId
        : parseCoverPhotoId(payload.coverPhotoId),
    resultNote:
      payload.resultNote === undefined
        ? existing.resultNote
        : parseText(payload.resultNote, 'resultNote'),
  }
}

/** 按 id 取单条（走后台全量表：它是唯一一个能看见 draft 的读路径）。 */
async function findAdminTheme(client: PoolClient, id: string): Promise<ThemeDetailDto> {
  const themes = await listAdminThemes(client, null)
  const theme = themes.find((item) => item.id === id)
  if (!theme) throw notFound('主题不存在')
  return theme
}

export async function registerThemeRoutes(app: FastifyInstance): Promise<void> {
  // ==========================================================================
  // 公开读：列表 / 详情 / 投稿网格
  // ==========================================================================

  app.get<{ Querystring: { status?: string } }>('/api/themes', async (req) => {
    const viewer = await currentUser(req)
    const filter = parseFilter(req.query.status)
    const items = await withRls(viewer?.userId ?? null, (client) => listThemes(client, filter))
    return { items }
  })

  app.get<{ Params: { slug: string } }>('/api/themes/:slug', async (req) => {
    const viewer = await currentUser(req)
    const slug = parseSlugFromPath(req.params.slug)
    const theme = await withRls(viewer?.userId ?? null, (client) => getTheme(client, slug))
    // 不存在、或草稿而调用者不是编辑 —— 两种情况对调用者是同一件事（不泄露存在性）。
    if (!theme) throw notFound('主题不存在')
    return { theme }
  })

  app.get<{
    Params: { slug: string }
    Querystring: { limit?: string; offset?: string; selected?: string }
  }>('/api/themes/:slug/entries', async (req) => {
    const viewer = await currentUser(req)
    const slug = parseSlugFromPath(req.params.slug)
    const limit = parseLimit(req.query.limit)
    const offset = parseOffset(req.query.offset)
    const selectedOnly = parseSelectedOnly(req.query.selected)
    return withRls(viewer?.userId ?? null, async (client) => {
      // 投稿列表函数对「不存在的主题」只返回空集（它不负责区分 404），
      // 所以存在性判定必须在同一个事务里先做一次。
      const theme = await getTheme(client, slug)
      if (!theme) throw notFound('主题不存在')
      return listThemeEntries(client, slug, { limit, offset, selectedOnly })
    })
  })

  // ==========================================================================
  // 作者：我的投稿 / 投稿 / 撤回
  // ==========================================================================

  app.get<{ Querystring: { slug?: string } }>('/api/me/theme-entries', async (req) => {
    const user = await requireUser(req)
    const slug = parseSlugFromQuery(req.query.slug)
    const items = await withRls(user.userId, (client) => listMyThemeEntries(client, slug))
    return { items }
  })

  /**
   * 投稿。返回的 entryCount 是主题里「已发布未删除」的投稿总数（与列表里的同名同义），
   * 作者自己的进度用 GET /api/me/theme-entries 数。
   * 重复投稿 409、超 3 件 422、非本人/不存在的作品 404、未发布 400 —— 全在函数里。
   */
  app.post<{ Params: { slug: string } }>(
    '/api/themes/:slug/entries',
    { config: { rateLimit: ENTRY_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      const slug = parseSlugFromPath(req.params.slug)
      const payload = body(req)
      rejectUnknown(payload, ['photoId'])
      const photoId = parsePhotoId(payload.photoId)
      return withRls(user.userId, (client) => submitThemeEntry(client, slug, photoId))
    },
  )

  /** 撤回。已精选 → 403（函数用 FORBIDDEN_MSG 标记抛出业务文案）、非本人 → 404。 */
  app.delete<{ Params: { slug: string; photoId: string } }>(
    '/api/themes/:slug/entries/:photoId',
    { config: { rateLimit: ENTRY_RATE_LIMIT } },
    async (req, reply) => {
      const user = await requireUser(req)
      const slug = parseSlugFromPath(req.params.slug)
      const photoId = parsePhotoId(req.params.photoId)
      await withRls(user.userId, (client) => withdrawThemeEntry(client, slug, photoId))
      return reply.status(204).send()
    },
  )

  // ==========================================================================
  // 编辑：建主题 / 改主题 / 精选
  // ==========================================================================

  app.post('/api/admin/themes', { config: { rateLimit: ADMIN_RATE_LIMIT } }, async (req) => {
    const user = await requireUser(req)
    requireStaff(user)
    const payload = body(req)
    rejectUnknown(payload, THEME_WRITE_FIELDS)
    const input = parseThemeCreate(payload)
    return withRls(user.userId, (client) => upsertTheme(client, input))
  })

  app.patch<{ Params: { id: string } }>(
    '/api/admin/themes/:id',
    { config: { rateLimit: ADMIN_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      requireStaff(user)
      const id = parseThemeId(req.params.id)
      const payload = body(req)
      rejectUnknown(payload, THEME_WRITE_FIELDS)
      if (Object.keys(payload).length === 0) throw validation('没有需要更新的字段')
      return withRls(user.userId, async (client) => {
        const existing = await findAdminTheme(client, id)
        return upsertTheme(client, mergeTheme(existing, payload))
      })
    },
  )

  /**
   * 精选 / 取消精选（可同时写评语）。
   * 「从未入选 → 入选」且作者不是操作者时，函数会给作者写一条 kind='system' 通知；
   * 取消精选不发通知。
   */
  app.post<{ Params: { slug: string; photoId: string } }>(
    '/api/admin/themes/:slug/entries/:photoId/select',
    { config: { rateLimit: ADMIN_RATE_LIMIT } },
    async (req) => {
      const user = await requireUser(req)
      requireStaff(user)
      const slug = parseSlugFromPath(req.params.slug)
      const photoId = parsePhotoId(req.params.photoId)
      const payload = body(req)
      rejectUnknown(payload, ['selected', 'note'])
      if (typeof payload.selected !== 'boolean') throw validation('selected 必须是布尔值')
      const note = payload.note === undefined ? '' : parseText(payload.note, 'note')
      return withRls(user.userId, (client) =>
        selectThemeEntry(client, slug, photoId, payload.selected as boolean, note),
      )
    },
  )

  /**
   * 后台主题列表（含 draft）—— **契约 §2 之外的一个加性端点**。
   *
   * 为什么必须有：公开三档刻意不含草稿（「新建草稿 → 过几天再开始」是常规流程），
   * 没有这条，草稿建完就再也找不到了。前端的 ThemeRepository.adminList()
   * （src/data/contracts/index.ts 的注释与 src/data/api/themes.ts 的探针）
   * 已经先试这个端点、404 时退回三档合并，所以补上它只是让后台从「降级可见」
   * 升级成「完整可见」，不会破坏任何既有调用。
   */
  app.get<{ Querystring: { status?: string } }>('/api/admin/themes', async (req) => {
    const user = await requireUser(req)
    requireStaff(user)
    const status = parseAdminStatus(req.query.status)
    const items = await withRls(user.userId, (client) => listAdminThemes(client, status))
    return { items }
  })
}
