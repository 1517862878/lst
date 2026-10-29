/**
 * 发现增强仓储（0029）。
 *
 * 分工：
 *   * 热门搜索、新作者、编辑精选打标 —— 由 0029 的 SECURITY DEFINER 函数完成，
 *     因为它们是聚合/权限敏感操作，口径不能散落在 TypeScript 里。
 *   * 精选作品流 —— 直接在 SQL 里查 public.photos，**复用 /api/photos 的同一套投影**
 *     （p.* + 作者公开字段）。理由见 0029 迁移第 8 节：作品投影只该有一份，否则
 *     「列表里有 authorUsername、精选流里没有」这类分叉迟早会发生。
 *
 * 可见性兜底：public.photos 的 RLS 只放行在架作品，所以这里的查询即使忘了写
 * status 条件也不会泄露草稿；但显式条件仍然写上，避免将来 RLS 调整后静默放宽。
 */
import type { PoolClient } from 'pg'
import { validation } from '../lib/errors.js'
import { mapPhoto, type PhotoRow } from '../lib/mappers.js'
import { mapPhotoWithAuthor, type PhotoWithAuthorRow } from './photos.js'

const MAX_LIMIT = 50
const MAX_CURSOR_LENGTH = 200

export interface HotSearchDto {
  term: string
  searchCount: number
}

export interface NewAuthorDto {
  username: string
  displayName: string
  avatarKey: string | null
  photoCount: number
  likeTotal: number
  memberSince: string
}

export interface EditorChoiceDto {
  photoId: string
  featuredAt: string | null
}

/** 与 repositories/comments.ts、social.ts、interactions.ts 同一套：base64url 的 [iso, id]。 */
function encodeCursor(date: Date, id: string): string {
  return Buffer.from(JSON.stringify([date.toISOString(), id]), 'utf8').toString('base64url')
}

function decodeCursor(raw: string): { at: string; id: string } {
  if (raw.length > MAX_CURSOR_LENGTH) throw validation('游标过长')
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    throw validation('游标格式无效')
  }
  if (!Array.isArray(value) || value.length !== 2) throw validation('游标格式无效')
  const [at, id] = value
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) throw validation('游标格式无效')
  if (typeof id !== 'string' || id.length === 0) throw validation('游标格式无效')
  return { at, id }
}

function clampInt(raw: unknown, fallback: number, min: number, max: number, label: string): number {
  if (raw === undefined || raw === null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw validation(`${label}必须是整数`)
  }
  return Math.min(Math.max(value, min), max)
}

/** 记录一次搜索（失败不影响搜索本身，调用方负责吞异常）。 */
export async function logSearch(
  client: PoolClient,
  input: { term: string; userId: string | null; ipHash: string | null },
): Promise<void> {
  await client.query('select public.api_log_search($1, $2, $3)', [input.term, input.userId, input.ipHash])
}

export async function listHotSearches(
  client: PoolClient,
  query: { days?: unknown; limit?: unknown },
): Promise<HotSearchDto[]> {
  const days = clampInt(query.days, 7, 1, 30, '统计天数')
  const limit = clampInt(query.limit, 10, 1, 20, '条数')
  const { rows } = await client.query<{ term: string; search_count: string }>(
    'select term, search_count from public.api_hot_searches($1, $2)',
    [days, limit],
  )
  return rows.map((row) => ({ term: row.term, searchCount: Number(row.search_count) }))
}

export async function listNewAuthors(
  client: PoolClient,
  query: { days?: unknown; limit?: unknown },
): Promise<NewAuthorDto[]> {
  const days = clampInt(query.days, 90, 7, 365, '时间窗口')
  const limit = clampInt(query.limit, 6, 1, 24, '条数')
  const { rows } = await client.query<{
    username: string
    display_name: string
    avatar_key: string | null
    photo_count: number
    like_total: string
    member_since: Date
  }>('select * from public.api_list_new_authors($1, $2)', [days, limit])

  return rows.map((row) => ({
    username: row.username,
    displayName: row.display_name,
    avatarKey: row.avatar_key,
    photoCount: Number(row.photo_count),
    likeTotal: Number(row.like_total),
    memberSince: row.member_since.toISOString(),
  }))
}

export interface FeaturedPage {
  items: ReturnType<typeof mapPhotoWithAuthor>[]
  nextCursor: string | null
}

/**
 * 编辑精选作品流。
 *
 * 排序键 (featured_at desc, id desc) —— 精选时间是编辑动作的时刻，不是发布时间，
 * 这样「刚被选上」的作品会立刻出现在最前面。
 */
export async function listFeaturedPhotos(
  client: PoolClient,
  query: { limit?: unknown; cursor?: unknown },
): Promise<FeaturedPage> {
  const limit = clampInt(query.limit, 12, 1, MAX_LIMIT, '条数')
  const params: unknown[] = []
  const where: string[] = [
    "p.status = 'published'",
    'p.deleted_at is null',
    'p.published_at is not null',
    'p.featured_at is not null',
  ]

  if (query.cursor !== undefined && query.cursor !== null && query.cursor !== '') {
    if (typeof query.cursor !== 'string') throw validation('游标格式无效')
    const { at, id } = decodeCursor(query.cursor)
    params.push(at, id)
    where.push(`(p.featured_at, p.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
  }

  const limitIdx = params.length + 1
  params.push(limit + 1)

  const { rows } = await client.query<PhotoWithAuthorRow & { featured_at: Date }>(
    `select p.*,
            a.username as author_username,
            a.display_name as author_display_name,
            a.avatar_key as author_avatar_key
       from public.photos p
       left join public.profiles a on a.id = p.author_id
      where ${where.join(' and ')}
      order by p.featured_at desc, p.id desc
      limit $${limitIdx}`,
    params,
  )

  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const last = pageRows[pageRows.length - 1]

  return {
    items: pageRows.map((row) => ({
      ...mapPhotoWithAuthor(row),
      featuredAt: row.featured_at.toISOString(),
    })),
    nextCursor: hasMore && last ? encodeCursor(last.featured_at, last.id) : null,
  }
}

/** staff 打标 / 取消；角色与作品状态都由 0029 的函数再校验一次。 */
export async function setEditorChoice(
  client: PoolClient,
  input: { photoId: string; staffId: string; featured: boolean },
): Promise<EditorChoiceDto> {
  const { rows } = await client.query<{ photo_id: string; featured_at: Date | null }>(
    'select photo_id, featured_at from public.api_set_editor_choice($1, $2, $3)',
    [input.photoId, input.staffId, input.featured],
  )
  const row = rows[0]
  if (!row) throw validation('作品不存在或不在架')
  return { photoId: row.photo_id, featuredAt: row.featured_at ? row.featured_at.toISOString() : null }
}

/** 供 /api/photos 之外的路径判断是否已精选（详情页徽标复用，避免多写一次投影）。 */
export function featuredAtOf(row: PhotoRow & { featured_at?: Date | null }): string | null {
  const value = row.featured_at
  return value ? value.toISOString() : null
}

export { mapPhoto }
