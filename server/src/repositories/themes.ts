/**
 * 每周主题与活动数据访问层（0036 / 8.4d）。
 *
 * 约定（与 repositories/collections.ts 同构）：
 *   1) photo_themes / theme_entries 两张表对 app_user 完全没有权限（RLS 打开、
 *      零 policy、revoke all），所以这里的每一次读写都只能经 0036 的
 *      SECURITY DEFINER 函数；
 *   2) 调用方必须把 client 放进 withRls(userId, ...) 事务里 —— auth.uid() 读的是
 *      事务级的 app.user_id，事务外调用会退化成匿名，写操作直接 AUTH_REQUIRED(42501)；
 *   3) **可见性与编辑身份判定只在 SQL 函数里做一次**：draft 主题对非编辑不可见、
 *      精选/建主题只认 editor/admin、投稿限额、「同一时刻只有一个 active 主题」。
 *      本层只把「函数返回空集」翻译成 404 / 把函数抛出的状态码交给路由，
 *      不在 TS 里再写一套权限逻辑（两套判定迟早会漂移）；
 *   4) DTO 逐字段显式映射（camelCase），JSON 形状即前端 src/domain/types.ts 的
 *      ThemeSummary / ThemeDetail / ThemeEntry / MyThemeEntry —— 默认拒绝，
 *      不让数据库多出来的列悄悄漏给前端。
 */
import type { PoolClient } from 'pg'
import { iso } from '../lib/mappers.js'

/** 主题状态。draft 仅编辑可见，active 全库最多一个（部分唯一索引）。 */
export type ThemeStatus = 'draft' | 'active' | 'closed'

/** 公开列表的过滤桶：进行中 / 即将开始 / 往期。 */
export type ThemeFilter = 'active' | 'upcoming' | 'past'

/** GET /api/themes 与 /api/admin/themes 的每一项。 */
export interface ThemeSummaryDto {
  id: string
  slug: string
  title: string
  description: string
  status: ThemeStatus
  startsAt: string | null
  endsAt: string | null
  coverPhotoId: string | null
  /** 主题里「已发布且未删除」的投稿数 */
  entryCount: number
  /** 其中被编辑精选的数量 */
  selectedCount: number
}

/** 单主题详情：摘要 + 规则 / 结果文案 / 是否在投稿期。 */
export interface ThemeDetailDto extends ThemeSummaryDto {
  rules: string
  resultNote: string
  isOpen: boolean
}

/** 主题页投稿网格里的一行（含作者公开字段与作品图片键）。 */
export interface ThemeEntryDto {
  photoId: string
  isSelected: boolean
  /** 编辑给的精选评语（≤200 字，未精选时为空串） */
  note: string
  selectedAt: string | null
  submittedAt: string | null
  title: string
  authorId: string
  authorUsername: string
  authorDisplayName: string
  imageKey: string
  thumbKey: string
  likeCount: number
  favoriteCount: number
}

/** GET /api/me/theme-entries 的一项：只看自己的投稿状态，不带作品图片。 */
export interface MyThemeEntryDto {
  photoId: string
  isSelected: boolean
  note: string
  submittedAt: string | null
  title: string
}

export interface ThemeEntriesPage {
  items: ThemeEntryDto[]
  /** 过滤后的总数（不含分页） */
  total: number
  /** 下一页 offset；没有下一页时 null */
  nextOffset: number | null
}

/** 编辑新建/更新主题的入参（slug 为 null 表示「不修改」，仅更新时允许）。 */
export interface ThemeUpsertInput {
  /** null = 新建 */
  id: string | null
  slug: string | null
  title: string
  description: string
  rules: string
  status: ThemeStatus
  /** ISO-8601 字符串（路由侧已校验可解析） */
  startsAt: string
  endsAt: string
  coverPhotoId: string | null
  resultNote: string
}

export interface ThemeIdentityDto {
  id: string
  slug: string
  status: ThemeStatus
}

interface ThemeRow {
  id: string
  slug: string
  title: string
  description: string
  status: string
  starts_at: unknown
  ends_at: unknown
  cover_photo_id: string | null
  entry_count: number | string | null
  selected_count: number | string | null
}

interface ThemeDetailRow extends ThemeRow {
  rules: string
  result_note: string
  is_open: boolean
}

interface ThemeEntryRow {
  photo_id: string
  is_selected: boolean
  note: string
  selected_at: unknown
  submitted_at: unknown
  title: string
  author_id: string
  author_username: string
  author_display_name: string
  image_key: string
  thumb_key: string
  like_count: number | string | null
  favorite_count: number | string | null
  total_count: number | string | null
}

/**
 * 列表分页上限；与 SQL 里 least(greatest(p_limit, 1), 48) 的钳制一致。
 * 路由把它作为「用户传了大于 48 就照 48 算」的依据，不报错。
 */
export const MAX_THEME_ENTRIES_PAGE_SIZE = 48

function toSummary(row: ThemeRow): ThemeSummaryDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status as ThemeStatus,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    coverPhotoId: row.cover_photo_id,
    entryCount: Number(row.entry_count ?? 0),
    selectedCount: Number(row.selected_count ?? 0),
  }
}

function toDetail(row: ThemeDetailRow): ThemeDetailDto {
  return {
    ...toSummary(row),
    rules: row.rules,
    resultNote: row.result_note,
    isOpen: Boolean(row.is_open),
  }
}

function toEntry(row: ThemeEntryRow): ThemeEntryDto {
  return {
    photoId: row.photo_id,
    isSelected: Boolean(row.is_selected),
    note: row.note,
    selectedAt: iso(row.selected_at),
    submittedAt: iso(row.submitted_at),
    title: row.title,
    authorId: row.author_id,
    authorUsername: row.author_username,
    authorDisplayName: row.author_display_name,
    imageKey: row.image_key,
    thumbKey: row.thumb_key,
    likeCount: Number(row.like_count ?? 0),
    favoriteCount: Number(row.favorite_count ?? 0),
  }
}

// ============================================================================
// 公开读
// ============================================================================

/**
 * 公开主题列表。status 为 null 时返回「进行中 + 即将开始 + 最近 12 期往期」。
 * draft 主题永远不会出现在这里（SQL 里就过滤掉了，不是本层再做一次判断）。
 */
export async function listThemes(
  client: PoolClient,
  status: ThemeFilter | null,
): Promise<ThemeSummaryDto[]> {
  const { rows } = await client.query<ThemeRow>(
    `select id, slug, title, description, status, starts_at, ends_at,
            cover_photo_id, entry_count, selected_count
       from public.api_list_themes($1::text)`,
    [status],
  )
  return rows.map(toSummary)
}

/**
 * 单个主题详情。不存在、或是不该被当前访客看到的 draft → null（路由翻成 404）。
 * 编辑能看到 draft（SQL 内部按 is_editor_or_admin() 判定）。
 */
export async function getTheme(client: PoolClient, slug: string): Promise<ThemeDetailDto | null> {
  const { rows } = await client.query<ThemeDetailRow>(
    `select id, slug, title, description, rules, status, starts_at, ends_at,
            cover_photo_id, result_note, entry_count, selected_count, is_open
       from public.api_get_theme($1::text)`,
    [slug],
  )
  const row = rows[0]
  return row ? toDetail(row) : null
}

/**
 * 主题投稿列表（分页）。
 *
 * total 由 SQL 用 count(*) over 在同一个 CTE 里给出，保证「列表与总数同一次快照」；
 * 坏主题（不存在 / draft 对非编辑）在这里表现为空集，所以调用方必须先 getTheme
 * 判存在性 —— 本层不替路由决定 404 还是空列表。
 */
export async function listThemeEntries(
  client: PoolClient,
  slug: string,
  options: { limit: number; offset: number; selectedOnly: boolean },
): Promise<ThemeEntriesPage> {
  const { rows } = await client.query<ThemeEntryRow>(
    `select photo_id, is_selected, note, selected_at, submitted_at, title,
            author_id, author_username, author_display_name, image_key, thumb_key,
            like_count, favorite_count, total_count
       from public.api_list_theme_entries($1::text, $2::integer, $3::integer, $4::boolean)`,
    [slug, options.limit, options.offset, options.selectedOnly],
  )

  const items = rows.map(toEntry)
  const total = rows[0] ? Number(rows[0].total_count ?? 0) : 0
  const nextOffset = options.offset + items.length < total ? options.offset + items.length : null
  return { items, total, nextOffset }
}

/** 我在某主题下的投稿（需登录；未登录时 SQL 抛 AUTH_REQUIRED）。 */
export async function listMyThemeEntries(
  client: PoolClient,
  slug: string,
): Promise<MyThemeEntryDto[]> {
  const { rows } = await client.query<{
    photo_id: string
    is_selected: boolean
    note: string
    submitted_at: unknown
    title: string
  }>(
    `select photo_id, is_selected, note, submitted_at, title
       from public.api_my_theme_entries($1::text)`,
    [slug],
  )
  return rows.map((row) => ({
    photoId: row.photo_id,
    isSelected: Boolean(row.is_selected),
    note: row.note,
    submittedAt: iso(row.submitted_at),
    title: row.title,
  }))
}

// ============================================================================
// 作者写
// ============================================================================

/**
 * 投稿。返回的 entryCount 与列表里的 entryCount 同名同义 = 主题里已发布未删除的
 * 投稿总数（作者自己的进度用 listMyThemeEntries 数）。
 */
export async function submitThemeEntry(
  client: PoolClient,
  slug: string,
  photoId: string,
): Promise<{ photoId: string; submittedAt: string | null; entryCount: number }> {
  const { rows } = await client.query<{
    entry_photo_id: string
    submitted_at: unknown
    entry_count: number | string | null
  }>(
    `select entry_photo_id, submitted_at, entry_count
       from public.api_submit_theme_entry($1::text, $2::uuid)`,
    [slug, photoId],
  )
  const row = rows[0]
  return {
    photoId: row?.entry_photo_id ?? photoId,
    submittedAt: iso(row?.submitted_at ?? null),
    entryCount: Number(row?.entry_count ?? 0),
  }
}

/** 撤回投稿。上层限制（是否本人 / 是否已精选 / 是否还在投稿期）全在 SQL 里判定。 */
export async function withdrawThemeEntry(
  client: PoolClient,
  slug: string,
  photoId: string,
): Promise<void> {
  await client.query('select public.api_withdraw_theme_entry($1::text, $2::uuid)', [slug, photoId])
}

// ============================================================================
// 编辑
// ============================================================================

/**
 * 新建 / 更新主题。
 * 「第二个 active 主题」「slug 不可改」「封面必须是本主题投稿」都在 SQL 里判并给出
 * 可读文案；本层不做二次判断。
 */
export async function upsertTheme(
  client: PoolClient,
  input: ThemeUpsertInput,
): Promise<ThemeIdentityDto> {
  const { rows } = await client.query<{ id: string; slug: string; status: string }>(
    `select id, slug, status
       from public.api_admin_upsert_theme(
         $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
         $7::timestamptz, $8::timestamptz, $9::uuid, $10::text
       )`,
    [
      input.id,
      input.slug,
      input.title,
      input.description,
      input.rules,
      input.status,
      input.startsAt,
      input.endsAt,
      input.coverPhotoId,
      input.resultNote,
    ],
  )
  const row = rows[0]
  // api_admin_upsert_theme 是 returns table(...)，正常必然有一行；为 undefined 时
  // 说明函数行为被改坏了，宁可在这里炸出明确错误，也不要让 undefined 传播到路由。
  if (!row) throw new Error('api_admin_upsert_theme 没有返回结果行')
  return { id: row.id, slug: row.slug, status: row.status as ThemeStatus }
}

/**
 * 精选 / 取消精选。首次精选时 SQL 会给作者写一条 kind='system' 的通知。
 * selectedCount 与列表里的同名同义 = 主题里已发布未删除的精选数。
 */
export async function selectThemeEntry(
  client: PoolClient,
  slug: string,
  photoId: string,
  selected: boolean,
  note: string,
): Promise<{ isSelected: boolean; selectedCount: number }> {
  const { rows } = await client.query<{ is_selected: boolean; selected_count: number | string | null }>(
    `select is_selected, selected_count
       from public.api_admin_select_theme_entry($1::text, $2::uuid, $3::boolean, $4::text)`,
    [slug, photoId, selected, note],
  )
  const row = rows[0]
  return {
    isSelected: Boolean(row?.is_selected),
    selectedCount: Number(row?.selected_count ?? 0),
  }
}

/**
 * 编辑用的主题全量列表（含 draft 与 rules / result_note 等完整字段）。
 * PATCH 的「局部更新」也靠它按 id 取回原值再合并 —— 为此不需要再开一个
 * api_admin_get_theme 函数或端点：主题表是小表（几十行量级），一次全量读
 * 比多一套「按 id 取主题」的权限面更划算。
 */
export async function listAdminThemes(
  client: PoolClient,
  status: ThemeStatus | null,
): Promise<ThemeDetailDto[]> {
  const { rows } = await client.query<ThemeDetailRow>(
    `select id, slug, title, description, rules, status, starts_at, ends_at,
            cover_photo_id, result_note, entry_count, selected_count,
            -- admin 列表没有 is_open 列（它只对「当前是否在投稿期」有意义，
            -- 后台关心的是 status），这里在 TS 侧算，避免为一个布尔值再动函数签名
            (status = 'active' and now() >= starts_at and now() < ends_at) as is_open
       from public.api_admin_list_themes($1::text)`,
    [status],
  )
  return rows.map(toDetail)
}
