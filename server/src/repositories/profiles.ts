import type pg from 'pg'
import { withRls } from '../lib/db.js'

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
    }
  })
}

/** 公开 username 直达接口：不返回 profiles.id，visibility 由数据库函数强制执行。 */
export async function getProfileByUsername(
  username: string,
  viewerId: string | null,
): Promise<PublicProfile | null> {
  return withRls(viewerId, async (c: pg.PoolClient) => {
    const r = await c.query<{
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
    }>('select * from public.api_get_profile_by_username($1)', [username])
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
    }
  })
}
