import type { PoolClient } from 'pg'
import { notFound, validation } from '../lib/errors.js'
import { mapPhoto, type PhotoRow } from '../lib/mappers.js'

export interface InteractionRow {
  user_id: string
  photo_id: string
  created_at: Date | string
}

const photoColumns = `
  p.id, p.author_id, p.title, p.description, p.category_slug, p.tags,
  p.location_name, p.location_lat, p.location_lng, p.location_precision,
  p.shot_at, p.exif, p.image_key, p.thumb_key, p.width, p.height,
  p.blurhash, p.license, p.credit, p.status, p.like_count,
  p.favorite_count, p.comment_count, p.view_count, p.published_at,
  p.created_at, p.updated_at, p.deleted_at`

async function listByUser(client: PoolClient, table: 'likes' | 'favorites', userId: string) {
  const { rows } = await client.query<PhotoRow>(
    `select ${photoColumns}
       from public.${table} i
       join public.photos p on p.id = i.photo_id
      where i.user_id = $1::uuid and p.status = 'published' and p.deleted_at is null
      order by i.created_at desc`,
    [userId],
  )
  return rows.map(mapPhoto)
}

export const listLikesByUser = (client: PoolClient, userId: string) => listByUser(client, 'likes', userId)
export const listFavoritesByUser = (client: PoolClient, userId: string) => listByUser(client, 'favorites', userId)

export async function getInteractionState(
  client: PoolClient,
  table: 'likes' | 'favorites',
  userId: string,
  photoId: string,
) {
  const { rowCount } = await client.query(
    `select 1 from public.${table} where user_id = $1::uuid and photo_id = $2::uuid`,
    [userId, photoId],
  )
  return (rowCount ?? 0) > 0
}

export async function listByPhoto(
  client: PoolClient,
  table: 'likes' | 'favorites',
  photoId: string,
) {
  const { rows } = await client.query<InteractionRow>(
    `select user_id, photo_id, created_at from public.${table} where photo_id = $1::uuid order by created_at desc`,
    [photoId],
  )
  return rows.map((row) => ({
    userId: row.user_id,
    photoId: row.photo_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }))
}

// ============================================================================
// 按 username 读取某用户「公开的」喜欢 / 收藏（0023）
//
// 为什么不能直接用上面的 listLikesByUser：那个函数要 user UUID，而 0018 之后
// 公开接口不再返回 UUID，个人主页只有 username；而且它按调用者身份查自己的表，
// 没有可见性语义。这里的每一次调用都只能经 0023 的 SECURITY DEFINER 函数，
// 可见性（private / show_likes / show_favorites / published）全在数据库里判定：
//   * 资料不存在 或 私密且非本人  → P0002 → 404；
//   * show_likes/show_favorites 关闭且非本人 → 200 + 空 items。
// 这个区分是刻意的：前者是「看不到这个人」，后者是「这个人没公开这类互动」。
// ============================================================================

const PROFILE_PAGE_DEFAULT = 20
/** 对外分页上限；SQL 侧钳到 51，多取的那一行只用于判断 hasMore（与 0022 一致）。 */
export const MAX_PROFILE_PAGE_SIZE = 50

type ProfileInteractionRow = PhotoRow & {
  /** 互动时间（likes.created_at / favorites.created_at），本列表的排序键 */
  interacted_at: unknown
}

/** 游标编码与 repositories/comments.ts、social.ts 一致：base64url 的 [iso, id]。 */
function encodeCursor(row: ProfileInteractionRow): string {
  const date =
    row.interacted_at instanceof Date ? row.interacted_at.toISOString() : String(row.interacted_at)
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

/** 非法游标直接报 400，而不是静默从头开始（会让用户看到重复数据）。 */
function parseCursor(cursor: string | undefined): [string, string] | null {
  if (!cursor) return null
  if (cursor.length > 200) throw validation('无效的翻页游标')
  const decoded = decodeCursor(cursor)
  if (!decoded) throw validation('无效的翻页游标')
  return decoded
}

export interface ProfileInteractionsInput {
  username: string
  kind: 'likes' | 'favorites'
  cursor?: string
  limit?: number
}

/**
 * 某用户公开的喜欢/收藏列表（只有已发布作品），按互动时间倒序。
 *
 * 调用方必须放进 withRls(client, viewerId) 事务：auth.uid() 读的是事务级
 * app.user_id，事务外调用会退化成匿名，本人看自己私密账号的列表就会 404。
 * 未登录游客用 withRls(null) 即可，公开数据照常返回。
 */
export async function listProfileInteractions(
  client: PoolClient,
  input: ProfileInteractionsInput,
): Promise<{ items: ReturnType<typeof mapPhoto>[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? PROFILE_PAGE_DEFAULT, 1), MAX_PROFILE_PAGE_SIZE)
  const cursor = parseCursor(input.cursor)

  let rows: ProfileInteractionRow[]
  try {
    const res = await client.query<ProfileInteractionRow>(
      `select *
         from public.api_list_profile_interactions($1::text, $2::text, $3::integer, $4::timestamptz, $5::uuid)`,
      [input.username, input.kind, limit + 1, cursor?.[0] ?? null, cursor?.[1] ?? null],
    )
    rows = res.rows
  } catch (err) {
    // P0002 = 目标资料不存在，或对当前用户不可见 —— 数据库刻意让两者不可区分，
    // 直接冒泡会把 'PROFILE_NOT_FOUND' 当成用户可见文案，所以在这里翻成 404。
    if ((err as { code?: string } | null)?.code === 'P0002') {
      throw notFound('用户不存在或未公开')
    }
    throw err
  }

  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const last = pageRows[pageRows.length - 1]
  return {
    items: pageRows.map(mapPhoto),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  }
}
