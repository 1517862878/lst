/**
 * 摄影专业化（0031）：器材 / 地点 / 季节的公开只读聚合。
 *
 * 三个仓库函数组共用一个约定：统计与分页口径只在数据库函数里定义一次
 * （api_list_gear / api_gear_photos / api_list_places / api_place_photos /
 * api_list_seasons），这里只做参数整形与行 → DTO 的映射。
 *
 * 为什么不在 TS 里再算一遍：器材是 exif 的派生值，SQL 里有表达式索引
 * （idx_photos_gear_body_label 等）配合；在 Node 里聚合会把整表拉进内存，
 * 而且「有效 EXIF 可见性」（逐张 or 账户级）的判定会立刻与 SQL 漂移。
 *
 * 公开接口不返回用户 UUID：这里只返回计数与作品投影，
 * 作者信息沿用 8.3c 的 authorUsername/authorDisplayName/authorAvatarKey。
 */
import type pg from 'pg'
import { mapPhoto, type PhotoRow } from '../lib/mappers.js'
import { validation } from '../lib/errors.js'

/** 与 api_list_gear / api_list_places 的 p_limit 上限保持一致（函数内部还会再钳一次）。 */
const MAX_LIMIT = 50
const MAX_CURSOR_LENGTH = 512

export type GearKind = 'body' | 'lens'

export interface GearSummaryDto {
  kind: GearKind
  label: string
  photoCount: number
  authorCount: number
}

export interface PlaceSummaryDto {
  label: string
  photoCount: number
  authorCount: number
  latestPublishedAt: string | null
}

export interface SeasonSummaryDto {
  season: 'spring' | 'summer' | 'autumn' | 'winter'
  photoCount: number
}

export interface GearPhotoRow extends PhotoRow {
  author_username: string | null
  author_display_name: string | null
  author_avatar_key: string | null
}

export interface PhotoStreamItem {
  id: string
  [key: string]: unknown
}

export interface PhotoStreamPage {
  items: PhotoStreamItem[]
  nextCursor: string | null
}

function clampLimit(value: number | undefined, fallback: number): number {
  return Math.min(Math.max(value ?? fallback, 1), MAX_LIMIT)
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function encodeCursor(parts: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url')
}

/**
 * 解码翻页游标。
 *
 * 与 api_gear_photos / api_place_photos 的期望形状一致：['latest', publishedAt, id]。
 * 长度或首元素不符直接 400 —— 放行会让 SQL 里的 (p_cursor ->> n) 变成 null，
 * 分页静默退化为「从头开始」，用户看到重复内容。
 */
function parseCursor(cursor: string): (string | number)[] {
  if (cursor.length > MAX_CURSOR_LENGTH) throw validation('无效的翻页游标')
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw validation('无效的翻页游标')
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) throw validation('无效的翻页游标')
  if (!parsed.every((entry) => typeof entry === 'string' || typeof entry === 'number')) {
    throw validation('无效的翻页游标')
  }
  return parsed as (string | number)[]
}

/** 器材总览：机身（Make Model）与镜头（LensModel）两组，按作品数倒序。 */
export async function listGear(
  client: pg.PoolClient,
  input: { limit?: number } = {},
): Promise<GearSummaryDto[]> {
  const { rows } = await client.query<{
    kind: string
    label: string
    photo_count: number
    author_count: number
  }>('select * from public.api_list_gear($1::integer)', [clampLimit(input.limit, 30)])
  return rows.map((row) => ({
    kind: row.kind === 'lens' ? 'lens' : 'body',
    label: row.label,
    photoCount: Number(row.photo_count ?? 0),
    authorCount: Number(row.author_count ?? 0),
  }))
}

/**
 * 某个器材下的作品流（latest，published_at + id keyset）。
 *
 * 多取一条判断 hasMore（与 api_feed / api_tag_photos 的做法一致），返回前切掉。
 * 函数内部已经保证「不公开 EXIF 的作品不出现在器材流里」，此层不再过滤。
 */
export async function listGearPhotos(
  client: pg.PoolClient,
  input: { kind: GearKind; label: string; cursor?: string; limit?: number },
): Promise<PhotoStreamPage> {
  const limit = clampLimit(input.limit, 20)
  const cursorArray = input.cursor ? parseCursor(input.cursor) : null
  if (cursorArray && cursorArray[0] !== 'latest') throw validation('无效的翻页游标')

  const { rows } = await client.query<GearPhotoRow>(
    'select * from public.api_gear_photos($1::text, $2::text, $3::integer, $4::jsonb)',
    [input.kind, input.label, limit + 1, cursorArray ? JSON.stringify(cursorArray) : null],
  )
  return toPage(rows, limit)
}

/** 地点总览：按 location_name 归一化聚合，排除「不公开地点」与空名。 */
export async function listPlaces(
  client: pg.PoolClient,
  input: { limit?: number } = {},
): Promise<PlaceSummaryDto[]> {
  const { rows } = await client.query<{
    label: string
    photo_count: number
    author_count: number
    latest_published_at: unknown
  }>('select * from public.api_list_places($1::integer)', [clampLimit(input.limit, 30)])
  return rows.map((row) => ({
    label: row.label,
    photoCount: Number(row.photo_count ?? 0),
    authorCount: Number(row.author_count ?? 0),
    latestPublishedAt: row.latest_published_at ? toIso(row.latest_published_at) : null,
  }))
}

/** 某个地点下的作品流（latest keyset）。 */
export async function listPlacePhotos(
  client: pg.PoolClient,
  input: { label: string; cursor?: string; limit?: number },
): Promise<PhotoStreamPage> {
  const limit = clampLimit(input.limit, 20)
  const cursorArray = input.cursor ? parseCursor(input.cursor) : null
  if (cursorArray && cursorArray[0] !== 'latest') throw validation('无效的翻页游标')

  const { rows } = await client.query<GearPhotoRow>(
    'select * from public.api_place_photos($1::text, $2::integer, $3::jsonb)',
    [input.label, limit + 1, cursorArray ? JSON.stringify(cursorArray) : null],
  )
  return toPage(rows, limit)
}

/**
 * 四季作品数。
 *
 * 数据库保证四季恒返回 4 行（计数 0 也在），前端的筛选 chips 因此不会缺项；
 * 顺序也由 SQL 的 order by ord 固定，这里不再排序。
 */
export async function listSeasons(client: pg.PoolClient): Promise<SeasonSummaryDto[]> {
  const { rows } = await client.query<{ season: string; photo_count: number }>(
    'select * from public.api_list_seasons()',
  )
  const allowed = new Set(['spring', 'summer', 'autumn', 'winter'])
  return rows
    .filter((row) => allowed.has(row.season))
    .map((row) => ({
      season: row.season as SeasonSummaryDto['season'],
      photoCount: Number(row.photo_count ?? 0),
    }))
}

/** 行 → 分页页（投影与 /api/photos 一致，作者三字段沿用 8.3c 命名）。 */
function toPage(rows: GearPhotoRow[], limit: number): PhotoStreamPage {
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const last = pageRows[pageRows.length - 1]
  const items = pageRows.map((row) => ({
    ...mapPhoto(row),
    authorUsername: row.author_username,
    authorDisplayName: row.author_display_name,
    authorAvatarKey: row.author_avatar_key,
  })) as PhotoStreamItem[]
  const nextCursor =
    hasMore && last ? encodeCursor(['latest', toIso(last.published_at), last.id]) : null
  return { items, nextCursor }
}
