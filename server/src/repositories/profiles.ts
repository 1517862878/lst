import type pg from 'pg'
import { withRls } from '../lib/db.js'
import { mapExifVisibility, mapPinnedSummaries, type PinnedPhotoSummary } from '../lib/mappers.js'

export interface OwnProfile {
  id: string
  username: string
  displayName: string
  avatarKey: string | null
  bio: string
  role: string
  links: unknown[]
  licensePreference: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  /** 0031：账户级拍摄参数可见性（public | hidden）。 */
  exifVisibility: 'public' | 'hidden'
  /** 0031：主页代表作的摘要（顺序即展示顺序）。 */
  pinned: PinnedPhotoSummary[]
}

export interface PublicProfile {
  username: string
  displayName: string
  avatarKey: string | null
  bio: string
  role: string
  links: unknown[]
  licensePreference: string
  visibility: 'public' | 'private'
  showLikes: boolean
  showFavorites: boolean
  discoverable: boolean
  createdAt: string
  isOwner: boolean
  /**
   * 0024：查看者与目标之间是否存在任一方向的拉黑。
   * 「被对方拉黑」不会走到这里（数据库抛 P0002 ⇒ 本函数返回 null ⇒ 404，
   * 与「用户不存在」不可区分），所以 true 实际只可能是「我拉黑了对方」。
   * 前端据此把主页切换成「你已拉黑该用户」并提供就地解除。
   */
  isBlocked: boolean
  /** 0031：作者账户级 EXIF 可见性，前端用它在主页给「无拍摄参数」一句解释。 */
  exifVisibility: 'public' | 'hidden'
  /** 0031：主页代表作摘要（只含 id/title/thumbKey，不含作者 UUID）。 */
  pinned: PinnedPhotoSummary[]
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

/**
 * 只取当前登录用户自己的资料。目标 id 不由调用方传入，避免重新引入按 UUID 读资料的旁路。
 */
export async function getOwnProfile(userId: string): Promise<OwnProfile | null> {
  return withRls(userId, async (c: pg.PoolClient) => {
    const r = await c.query<{
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
      exif_visibility: string
      pinned: unknown
    }>('select * from public.api_get_own_profile()')
    const row = r.rows[0]
    if (!row) return null
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarKey: row.avatar_key,
      bio: row.bio,
      role: row.role,
      links: Array.isArray(row.links) ? row.links : [],
      licensePreference: row.license_preference,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      deletedAt: row.deleted_at == null ? null : iso(row.deleted_at),
      exifVisibility: mapExifVisibility(row.exif_visibility),
      pinned: mapPinnedSummaries(row.pinned),
    }
  })
}

/** 公开 username 直达接口：不返回 profiles.id，visibility 由数据库函数强制执行。 */
export async function getProfileByUsername(
  username: string,
  viewerId: string | null,
): Promise<PublicProfile | null> {
  return withRls(viewerId, async (c: pg.PoolClient) => {
    let r: pg.QueryResult<{
      username: string
      display_name: string
      avatar_key: string | null
      bio: string
      role: string
      links: unknown
      license_preference: string
      visibility: 'public' | 'private'
      show_likes: boolean
      show_favorites: boolean
      discoverable: boolean
      created_at: unknown
      is_owner: boolean
      is_blocked: boolean
      exif_visibility: string
      pinned: unknown
    }>
    try {
      r = await c.query(
        'select * from public.api_get_profile_by_username($1)',
        [username],
      )
    } catch (err) {
      // 0024：被目标拉黑时数据库抛 P0002（契约 §1.4：与「用户不存在」不可区分）。
      // 在这里翻成 null，路由的既有 404 分支就顺带把它处理掉了，
      // 不必给「被拉黑」单开一条错误分支 —— 开了反而会让人以为两者可区分。
      if ((err as { code?: string } | null)?.code === 'P0002') return null
      throw err
    }
    const row = r.rows[0]
    if (!row) return null
    return {
      username: row.username,
      displayName: row.display_name,
      avatarKey: row.avatar_key,
      bio: row.bio,
      role: row.role,
      links: Array.isArray(row.links) ? row.links : [],
      licensePreference: row.license_preference,
      visibility: row.visibility,
      showLikes: row.show_likes,
      showFavorites: row.show_favorites,
      discoverable: row.discoverable,
      createdAt: iso(row.created_at),
      isOwner: row.is_owner,
      isBlocked: row.is_blocked === true,
      exifVisibility: mapExifVisibility(row.exif_visibility),
      pinned: mapPinnedSummaries(row.pinned),
    }
  })
}
