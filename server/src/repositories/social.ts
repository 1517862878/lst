/**
 * 社交关系闭环数据访问层（0022）。
 *
 * 约定：
 *   1) follows / notifications 两张表对 app_user 完全关闭（无表级权限 + RLS 无
 *      policy），所以这里的每一次读写都只能经 0022 的 SECURITY DEFINER 函数；
 *   2) 调用方必须把 client 放进 withRls(userId, ...) 事务里 —— auth.uid() 读的是
 *      事务级的 app.user_id，事务外调用会退化成匿名，写操作会直接 AUTH_REQUIRED；
 *   3) 游标编码与 repositories/comments.ts 完全一致（base64url 的 [iso, id]），
 *      这样两个列表的游标语义相同，前端可以复用同一套翻页逻辑。
 */
import type { PoolClient } from 'pg'
import { notFound, validation } from '../lib/errors.js'
import { mapPhoto, mapPublicProfile, type PhotoRow } from '../lib/mappers.js'

/** 对外分页上限；SQL 侧钳到 51，多取的那一行只用于判断 hasMore。 */
export const MAX_PAGE_SIZE = 50

export interface FollowState {
  isFollowing: boolean
  followerCount: number
  followingCount: number
}

/**
 * 公开资料投影的列（SQL 侧与 0018 的 api_get_own_profile 同一份字段集）。
 * phone / phone_verified_at 故意不在这里：社交接口没有任何拿到手机号的路径。
 */
interface PublicProfileColumns {
  id: string
  username: string
  display_name: string
  avatar_key: string | null
  bio: string
  role: string
  links: unknown
  license_preference: string
  created_at: unknown
  updated_at: unknown
  deleted_at: unknown
}

/**
 * 复用 lib/mappers 的 mapPublicProfile，而不是自己拼字段：
 * 将来 mapProfile 新增字段时，「对外」的形状由那一份显式白名单决定，
 * 这里不会因为懒省事（`...row`）把手机号之类的字段带出去。
 */
function toPublicProfile(row: PublicProfileColumns) {
  return mapPublicProfile({ ...row, phone: null, phone_verified_at: null })
}

/**
 * 关注列表的一行 = 一份公开资料 + 关系元数据。
 * 资料部分就是前端 domain 里的 Profile（含 id：前端拿它作列表 key 与去重键），
 * followedAt / isFollowing 是列表自己的附加信息。
 */
export interface FollowListEntry extends ReturnType<typeof toPublicProfile> {
  followedAt: string
  isFollowing: boolean
}

export interface FeedItem extends ReturnType<typeof mapPhoto> {
  authorUsername: string
  authorDisplayName: string
  authorAvatarKey: string | null
}

export interface NotificationItem {
  id: string
  kind: 'like' | 'comment' | 'follow' | 'system'
  /** 触发者；系统通知为 null。内联成资料对象，列表页不必再按 id 回查用户。 */
  actor: ReturnType<typeof toPublicProfile> | null
  photoId: string | null
  /** 作品标题/缩略图与评论摘要由服务端一并给出，且按“当前可见性”过滤（下架/隐藏则不给）。 */
  photoTitle: string | null
  photoThumbKey: string | null
  commentId: string | null
  commentExcerpt: string | null
  readAt: string | null
  createdAt: string
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

function isoOrNull(value: unknown): string | null {
  return value == null ? null : iso(value)
}

function encodeCursor(row: { created_at: unknown; id: string }): string {
  const date = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
  return Buffer.from(JSON.stringify([date, row.id]), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): [string, string] | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    return Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'string')
      ? [value[0] as string, value[1] as string]
      : null
  } catch {
    return null
  }
}

/** 解析游标；非法游标直接报 400，而不是静默从头开始（会让用户看到重复数据）。 */
function parseCursor(cursor: string | undefined, label: string): [string, string] | null {
  if (!cursor) return null
  if (cursor.length > 200) throw validation(`无效的${label}游标`)
  const decoded = decodeCursor(cursor)
  if (!decoded) throw validation(`无效的${label}游标`)
  return decoded
}

/**
 * 数据库里 PROFILE_NOT_FOUND(P0002) 表示“目标资料不存在，或对当前用户不可见”。
 * 直接冒泡会把 'PROFILE_NOT_FOUND' 当成用户可见文案，所以在这里翻成 404。
 */
async function asProfileNotFound<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'P0002') {
      throw notFound('用户不存在或未公开')
    }
    throw err
  }
}

function toFollowState(row: {
  is_following: boolean
  target_follower_count: number
  viewer_following_count: number
}): FollowState {
  return {
    isFollowing: row.is_following === true,
    followerCount: Number(row.target_follower_count ?? 0),
    followingCount: Number(row.viewer_following_count ?? 0),
  }
}

// ============================================================================
// 关注关系
// ============================================================================

/** 关注（幂等：重复关注不会报错，也不会重复计数）。 */
export async function followUser(client: PoolClient, username: string): Promise<FollowState> {
  return asProfileNotFound(async () => {
    const { rows } = await client.query<{
      is_following: boolean
      target_follower_count: number
      viewer_following_count: number
    }>('select * from public.api_follow($1)', [username])
    return toFollowState(rows[0]!)
  })
}

/** 取关（幂等：没关注也返回成功）。 */
export async function unfollowUser(client: PoolClient, username: string): Promise<FollowState> {
  return asProfileNotFound(async () => {
    const { rows } = await client.query<{
      is_following: boolean
      target_follower_count: number
      viewer_following_count: number
    }>('select * from public.api_unfollow($1)', [username])
    return toFollowState(rows[0]!)
  })
}

/** 当前用户是否关注了该用户；游客恒为 false。 */
export async function isFollowingUser(client: PoolClient, username: string): Promise<boolean> {
  return asProfileNotFound(async () => {
    const { rows } = await client.query<{ is_following: boolean }>(
      'select * from public.api_is_following($1)',
      [username],
    )
    return rows[0]?.is_following === true
  })
}

/** 资料页的粉丝/关注数（读计数列，不扫 follows 全表）。 */
export async function getFollowCounts(
  client: PoolClient,
  username: string,
): Promise<{ followerCount: number; followingCount: number }> {
  return asProfileNotFound(async () => {
    const { rows } = await client.query<{ follower_count: number; following_count: number }>(
      'select * from public.api_follow_counts($1)',
      [username],
    )
    const row = rows[0]
    return {
      followerCount: Number(row?.follower_count ?? 0),
      followingCount: Number(row?.following_count ?? 0),
    }
  })
}

interface FollowRow extends PublicProfileColumns {
  followed_at: unknown
  is_following: boolean
}

function mapFollowRow(row: FollowRow): FollowListEntry {
  return {
    ...toPublicProfile(row),
    followedAt: iso(row.followed_at),
    isFollowing: row.is_following === true,
  }
}

async function listFollowRelation(
  client: PoolClient,
  fn: 'api_list_followers' | 'api_list_following',
  input: { username: string; cursor?: string; limit?: number },
) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_PAGE_SIZE)
  const cursor = parseCursor(input.cursor, '关注列表')
  return asProfileNotFound(async () => {
    const { rows } = await client.query<FollowRow>(
      `select * from public.${fn}($1::text, $2::integer, $3::timestamptz, $4::text)`,
      [input.username, limit + 1, cursor?.[0] ?? null, cursor?.[1] ?? null],
    )
    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    const counts = await getFollowCounts(client, input.username)
    const last = pageRows[pageRows.length - 1]
    return {
      items: pageRows.map(mapFollowRow),
      nextCursor: hasMore && last ? encodeCursor({ created_at: last.followed_at, id: last.username }) : null,
      total: fn === 'api_list_followers' ? counts.followerCount : counts.followingCount,
    }
  })
}

/**
 * 粉丝列表。
 * 注意：数据库函数按 0018 的可见性语义执行（私密资料只有本人能翻自己的列表），
 * 不可见 / 不存在都会抛 PROFILE_NOT_FOUND → 404。
 */
export async function listFollowers(
  client: PoolClient,
  input: { username: string; cursor?: string; limit?: number },
) {
  return listFollowRelation(client, 'api_list_followers', input)
}

/** 关注列表，分页语义同 listFollowers。 */
export async function listFollowing(
  client: PoolClient,
  input: { username: string; cursor?: string; limit?: number },
) {
  return listFollowRelation(client, 'api_list_following', input)
}

// ============================================================================
// 关注动态流
// ============================================================================

type FeedRow = PhotoRow & {
  author_username: string
  author_display_name: string
  author_avatar_key: string | null
}

/**
 * 关注动态流：只包含“我关注的人”的已发布作品（不含自己、草稿、已删、隐藏、已下架）。
 * 未登录会由数据库函数抛 AUTH_REQUIRED，路由层已经用 requireUser 拦过一道。
 */
export async function listFeed(
  client: PoolClient,
  input: { cursor?: string; limit?: number },
): Promise<{ items: FeedItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_PAGE_SIZE)
  const cursor = parseCursor(input.cursor, '动态流')
  const { rows } = await client.query<FeedRow>(
    'select * from public.api_feed($1::integer, $2::timestamptz, $3::uuid)',
    [limit + 1, cursor?.[0] ?? null, cursor?.[1] ?? null],
  )
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const last = pageRows[pageRows.length - 1]
  return {
    items: pageRows.map((row) => ({
      ...mapPhoto(row),
      authorUsername: row.author_username,
      authorDisplayName: row.author_display_name,
      authorAvatarKey: row.author_avatar_key,
    })),
    nextCursor:
      hasMore && last ? encodeCursor({ created_at: last.published_at, id: last.id }) : null,
  }
}

// ============================================================================
// 通知中心
// ============================================================================

interface NotificationRow {
  id: string
  kind: string
  actor_id: string | null
  actor_username: string | null
  actor_display_name: string | null
  actor_avatar_key: string | null
  actor_bio: string | null
  actor_role: string | null
  actor_links: unknown
  actor_license_preference: string | null
  actor_created_at: unknown
  actor_updated_at: unknown
  actor_deleted_at: unknown
  photo_id: string | null
  photo_title: string | null
  photo_thumb_key: string | null
  comment_id: string | null
  comment_excerpt: string | null
  read_at: unknown
  created_at: unknown
}

const NOTIFICATION_KINDS = new Set(['like', 'comment', 'follow', 'system'])

/**
 * actor_id 为 null 有两种情况，都应当渲染成「没有触发者」：
 *   * 系统通知本来就没有 actor；
 *   * actor 已注销（SQL 侧 left join 带 deleted_at is null，profile 行取不到 ⇒ id 也为 null）。
 * 所以只需要判 actor_id 一个字段，不必逐个判空。
 */
function mapActor(row: NotificationRow): NotificationItem['actor'] {
  if (row.actor_id === null || row.actor_username === null) return null
  return toPublicProfile({
    id: row.actor_id,
    username: row.actor_username,
    display_name: row.actor_display_name ?? '',
    avatar_key: row.actor_avatar_key,
    bio: row.actor_bio ?? '',
    role: row.actor_role ?? 'user',
    links: row.actor_links,
    license_preference: row.actor_license_preference ?? 'all_rights_reserved',
    created_at: row.actor_created_at,
    updated_at: row.actor_updated_at,
    deleted_at: row.actor_deleted_at,
  })
}

function mapNotificationRow(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    kind: (NOTIFICATION_KINDS.has(row.kind) ? row.kind : 'system') as NotificationItem['kind'],
    actor: mapActor(row),
    photoId: row.photo_id,
    photoTitle: row.photo_title,
    photoThumbKey: row.photo_thumb_key,
    commentId: row.comment_id,
    commentExcerpt: row.comment_excerpt,
    readAt: isoOrNull(row.read_at),
    createdAt: iso(row.created_at),
  }
}

/**
 * 通知列表（最新在前）。
 * 不返回 total：未读数由 getUnreadNotificationCount 提供，团队约定里
 * 通知没有“总数”语义（读过就沉底），少一个函数少一次计数扫描。
 */
export async function listNotifications(
  client: PoolClient,
  input: { cursor?: string; limit?: number },
): Promise<{ items: NotificationItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_PAGE_SIZE)
  const cursor = parseCursor(input.cursor, '通知')
  const { rows } = await client.query<NotificationRow>(
    'select * from public.api_list_notifications($1::integer, $2::timestamptz, $3::uuid)',
    [limit + 1, cursor?.[0] ?? null, cursor?.[1] ?? null],
  )
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const last = pageRows[pageRows.length - 1]
  return {
    items: pageRows.map(mapNotificationRow),
    nextCursor: hasMore && last ? encodeCursor({ created_at: last.created_at, id: last.id }) : null,
  }
}

export async function getUnreadNotificationCount(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ unread_count: number }>(
    'select * from public.api_notifications_unread_count()',
  )
  return Number(rows[0]?.unread_count ?? 0)
}

/**
 * 标记已读。
 * @param ids 指定通知 id；null 表示“全部标记为已读”。
 *            不属于自己的 id 会被静默忽略（返回的 markedCount 只统计自己的行）。
 */
export async function markNotificationsRead(
  client: PoolClient,
  ids: string[] | null,
): Promise<number> {
  const { rows } = await client.query<{ marked_count: number }>(
    'select * from public.api_mark_notifications_read($1::uuid[])',
    [ids],
  )
  return Number(rows[0]?.marked_count ?? 0)
}
