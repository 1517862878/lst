/**
 * 创作者统计仓储（0030）。
 *
 * 只做两件事：调 0030 的 definer 函数、把 snake_case 行映射成前端契约。
 * 统计口径全部在 SQL 里（api_creator_stats / api_photo_stats），
 * 不要在 TypeScript 里再算一遍 —— 否则「/me 主页显示 12」与「作品管理页累加 13」会打架。
 *
 * 权限：两个函数都要求传入 userId，路由层用 requireUser 拿到的会话用户，
 * 不接受客户端传参，因此不可能读到别人的私有统计。
 */
import type { PoolClient } from 'pg'
import { validation } from '../lib/errors.js'

export interface CreatorStatsDto {
  photoCount: number
  publishedCount: number
  draftCount: number
  likeTotal: number
  favoriteTotal: number
  commentTotal: number
  viewTotal: number
  followerCount: number
  followingCount: number
}

export interface PhotoStatsDto {
  photoId: string
  title: string
  status: string
  publishedAt: string | null
  likeCount: number
  favoriteCount: number
  commentCount: number
  viewCount: number
  featuredAt: string | null
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export async function getCreatorStats(client: PoolClient, userId: string): Promise<CreatorStatsDto> {
  const { rows } = await client.query<{
    photo_count: number
    published_count: number
    draft_count: number
    like_total: string
    favorite_total: string
    comment_total: string
    view_total: string
    follower_count: number
    following_count: number
  }>('select * from public.api_creator_stats($1)', [userId])

  const row = rows[0]
  if (!row) throw validation('无法读取统计')

  return {
    photoCount: Number(row.photo_count),
    publishedCount: Number(row.published_count),
    draftCount: Number(row.draft_count),
    likeTotal: Number(row.like_total),
    favoriteTotal: Number(row.favorite_total),
    commentTotal: Number(row.comment_total),
    viewTotal: Number(row.view_total),
    followerCount: Number(row.follower_count),
    followingCount: Number(row.following_count),
  }
}

export async function listPhotoStats(
  client: PoolClient,
  userId: string,
  query: { limit?: unknown; offset?: unknown },
): Promise<PhotoStatsDto[]> {
  const limit = query.limit === undefined || query.limit === '' ? 50 : Number(query.limit)
  const offset = query.offset === undefined || query.offset === '' ? 0 : Number(query.offset)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw validation('条数必须是 1–100 的整数')
  if (!Number.isInteger(offset) || offset < 0) throw validation('偏移量必须是非负整数')

  const { rows } = await client.query<{
    photo_id: string
    title: string
    status: string
    published_at: Date | null
    like_count: number
    favorite_count: number
    comment_count: number
    view_count: number
    featured_at: Date | null
  }>('select * from public.api_photo_stats($1, $2, $3)', [userId, limit, offset])

  return rows.map((row) => ({
    photoId: row.photo_id,
    title: row.title,
    status: row.status,
    publishedAt: iso(row.published_at),
    likeCount: Number(row.like_count),
    favoriteCount: Number(row.favorite_count),
    commentCount: Number(row.comment_count),
    viewCount: Number(row.view_count),
    featuredAt: iso(row.featured_at),
  }))
}
