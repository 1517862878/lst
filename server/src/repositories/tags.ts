/**
 * 标签体系仓储（0027）。
 *
 * 四个查询全部由 SECURITY DEFINER 函数在数据库里完成统计与分页，
 * 这里只负责三件事：
 *   1) 把客户端游标（base64url JSON 数组）与数据库需要的 jsonb 互转；
 *   2) 把 snake_case 行映射成前端契约（camelCase + Photo）；
 *   3) 把「游标与排序不一致」「排序方式非法」翻译成 400。
 *
 * 统计口径（published + 未删除 + 有发布时间）只存在于 tag_aggregate()，
 * 不要在 TypeScript 里再算一遍 —— 否则 /api/tags 与搜索建议的数字会打架。
 */
import type { PoolClient } from 'pg'
import { validation } from '../lib/errors.js'
import { mapPhoto, type PhotoRow } from '../lib/mappers.js'

const MAX_LIMIT = 50
const MAX_CURSOR_LENGTH = 200
const RELATED_TAG_LIMIT = 12

export type TagSort = 'hot' | 'latest'
export type TagPhotoSort = 'latest' | 'popular'

export interface TagSummaryDto {
  tag: string
  photoCount: number
  authorCount: number
  latestPublishedAt: string | null
}

export interface TagRelatedDto {
  tag: string
  count: number
}

export interface TagDetailDto extends TagSummaryDto {
  relatedTags: TagRelatedDto[]
}

export interface TagSuggestionDto {
  tag: string
  photoCount: number
}

export interface TagPhotoRow extends PhotoRow {
  author_username: string
  author_display_name: string
  author_avatar_key: string | null
  photoId: string
  cursorAt: unknown
  cursorId: string
  cursorScore: number
}

export interface TagPhotoItem {
  id: string
  [key: string]: unknown
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
 * 解码客户端游标。
 *
 * 与 api_tag_photos 的 jsonb 入参一致：
 *   latest  → ['latest', publishedAt, id]                 长度 3
 *   popular → ['popular', score, publishedAt, id]         长度 4
 * 长度不符直接 400：如果放行，函数里的 (p_cursor ->> n) 会变成 null，
 * 分页静默退化成「从头开始」，用户会看到重复内容。
 */
function parseCursor(cursor: string, expectedLength: number): (string | number)[] {
  if (cursor.length > MAX_CURSOR_LENGTH) throw validation('无效的翻页游标')
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw validation('无效的翻页游标')
  }
  if (!Array.isArray(parsed) || parsed.length !== expectedLength) throw validation('无效的翻页游标')
  if (!parsed.every((entry) => typeof entry === 'string' || typeof entry === 'number')) {
    throw validation('无效的翻页游标')
  }
  return parsed as (string | number)[]
}

/** 标签总览：热门（作品数降序）或最新（最近发布时间降序），可按前缀过滤。 */
export async function listTags(
  client: PoolClient,
  input: { sort?: TagSort; limit?: number; prefix?: string },
): Promise<TagSummaryDto[]> {
  const { rows } = await client.query<{
    tag: string
    photo_count: number
    author_count: number
    latest_published_at: unknown
  }>('select * from public.api_list_tags($1::text, $2::integer, $3::text)', [
    input.sort ?? 'hot',
    clampLimit(input.limit, 20),
    input.prefix?.trim() || null,
  ])
  return rows.map((row) => ({
    tag: row.tag,
    photoCount: row.photo_count,
    authorCount: row.author_count,
    latestPublishedAt: row.latest_published_at ? toIso(row.latest_published_at) : null,
  }))
}

/** 标签详情：未知标签返回 photoCount 0（空标签页是合法状态，不是 404）。 */
export async function getTagDetail(client: PoolClient, tag: string): Promise<TagDetailDto> {
  const { rows } = await client.query<{
    detail: {
      tag?: string
      photoCount?: number
      authorCount?: number
      latestPublishedAt?: string | null
      relatedTags?: TagRelatedDto[]
    }
  }>('select public.api_tag_detail($1::text) as detail', [tag])
  const detail = rows[0]?.detail ?? {}
  return {
    tag: detail.tag ?? tag,
    photoCount: Number(detail.photoCount ?? 0),
    authorCount: Number(detail.authorCount ?? 0),
    latestPublishedAt: detail.latestPublishedAt ?? null,
    relatedTags: (detail.relatedTags ?? []).slice(0, RELATED_TAG_LIMIT).map((entry) => ({
      tag: entry.tag,
      count: Number(entry.count ?? 0),
    })),
  }
}

/**
 * 标签下的作品流。
 * 多取一条判断 hasMore（与 api_feed 的做法一致），返回给前端时再切掉。
 */
export async function listTagPhotos(
  client: PoolClient,
  input: { tag: string; sort?: TagPhotoSort; cursor?: string; limit?: number },
): Promise<{ items: TagPhotoItem[]; total: number; nextCursor: string | null }> {
  const sort: TagPhotoSort = input.sort ?? 'latest'
  const limit = clampLimit(input.limit, 20)
  const cursorArray = input.cursor ? parseCursor(input.cursor, sort === 'popular' ? 4 : 3) : null
  if (cursorArray && cursorArray[0] !== sort) {
    throw validation('翻页游标与排序方式不一致，请重新筛选')
  }

  const { rows } = await client.query<{ page: { items: TagPhotoRow[]; total: number } }>(
    'select public.api_tag_photos($1::text, $2::text, $3::jsonb, $4::integer) as page',
    [input.tag, sort, cursorArray ? JSON.stringify(cursorArray) : null, limit + 1],
  )
  const page = rows[0]?.page
  const all = page?.items ?? []
  const hasMore = all.length > limit
  const pageItems = hasMore ? all.slice(0, limit) : all
  const last = pageItems[pageItems.length - 1]

  const items = pageItems.map((row) => ({
    ...mapPhoto(row),
    authorUsername: row.author_username,
    authorDisplayName: row.author_display_name,
    authorAvatarKey: row.author_avatar_key,
  })) as TagPhotoItem[]

  const nextCursor =
    hasMore && last
      ? sort === 'popular'
        ? encodeCursor(['popular', Number(last.cursorScore) || 0, toIso(last.cursorAt), last.cursorId])
        : encodeCursor(['latest', toIso(last.cursorAt), last.cursorId])
      : null

  return { items, total: Number(page?.total ?? 0), nextCursor }
}

/** 输入建议：前缀匹配 + 热门排序；空查询返回热门标签（搜索框聚焦时的默认建议）。 */
export async function suggestTags(
  client: PoolClient,
  input: { query?: string; limit?: number },
): Promise<TagSuggestionDto[]> {
  const { rows } = await client.query<{ tag: string; photo_count: number }>(
    'select * from public.api_search_tags($1::text, $2::integer)',
    [input.query?.trim() || null, clampLimit(input.limit, 10)],
  )
  return rows.map((row) => ({ tag: row.tag, photoCount: row.photo_count }))
}