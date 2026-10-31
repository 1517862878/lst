import type pg from 'pg'
import { withRls } from '../lib/db.js'
import { mapExifVisibility, mapPinnedSummaries, type PinnedPhotoSummary } from '../lib/mappers.js'

export interface AccountSettings {
  id: string; username: string; displayName: string; avatarKey: string | null; bio: string; role: string
  phone: string | null; links: unknown[]; licensePreference: string; visibility: 'public' | 'private'
  showLikes: boolean; showFavorites: boolean; discoverable: boolean
  notificationPreferences: Record<string, boolean>; createdAt: string; updatedAt: string
  /** 0031：账户级拍摄参数可见性。 */
  exifVisibility: 'public' | 'hidden'
  /** 0031：主页代表作 id（顺序即展示顺序）。 */
  pinnedPhotoIds: string[]
  /** 0031：代表作摘要，供设置页直接渲染，不必再拉一次作品。 */
  pinned: PinnedPhotoSummary[]
  /** 0037：账号级背景照片对象键（null = 未设置）。 */
  backgroundPhotoKey: string | null
  /** 0037：背景照片元数据（luma/尺寸/模糊/焦点等），供前端算压暗强度。 */
  backgroundPhotoMeta: BackgroundPhotoMeta | null
}

/** 0037：背景照片元数据的形状（与迁移里 is_valid_background_meta 的键白名单一致） */
export interface BackgroundPhotoMeta {
  luma: number
  width: number
  height: number
  blur: number
  strength: number
  focusX: number
  focusY: number
}

function iso(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value) }
function map(row: Record<string, unknown>): AccountSettings {
  return {
    id: String(row.id), username: String(row.username), displayName: String(row.display_name),
    avatarKey: typeof row.avatar_key === 'string' ? row.avatar_key : null,
    bio: String(row.bio ?? ''), role: String(row.role), phone: typeof row.phone === 'string' ? row.phone : null,
    links: Array.isArray(row.links) ? row.links : [], licensePreference: String(row.license_preference),
    visibility: row.visibility === 'private' ? 'private' : 'public', showLikes: row.show_likes === true,
    showFavorites: row.show_favorites === true, discoverable: row.discoverable !== false,
    notificationPreferences: typeof row.notification_preferences === 'object' && row.notification_preferences !== null
      ? row.notification_preferences as Record<string, boolean> : {},
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    exifVisibility: mapExifVisibility(row.exif_visibility),
    pinnedPhotoIds: Array.isArray(row.pinned_photo_ids) ? (row.pinned_photo_ids as string[]) : [],
    pinned: mapPinnedSummaries(row.pinned),
    backgroundPhotoKey: typeof row.background_photo_key === 'string' ? row.background_photo_key : null,
    backgroundPhotoMeta: isMeta(row.background_photo_meta) ? (row.background_photo_meta as BackgroundPhotoMeta) : null,
  }
}

/** 元数据是 jsonb：pg 已解析成对象，只做形状确认，不再重复校验数值范围（那是前端的职责） */
function isMeta(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export async function getOwnSettings(userId: string): Promise<AccountSettings | null> {
  return withRls(userId, async (c: pg.PoolClient) => {
    const r=await c.query('select * from public.api_get_own_account_settings()')
    return r.rows[0] ? map(r.rows[0]) : null
  })
}
export async function updateOwnProfile(userId: string, input: {displayName:string;bio:string;links:unknown[];licensePreference:string;avatarKey:string|null}): Promise<AccountSettings|null> {
  await withRls(userId,(c)=>c.query('select public.api_update_own_profile($1,$2,$3::jsonb,$4,$5)',[input.displayName,input.bio,JSON.stringify(input.links),input.licensePreference,input.avatarKey]))
  return getOwnSettings(userId)
}
/**
 * 0037：保存背景照片。
 *
 * 校验在数据库函数里做（非法键 22023 ⇒ 400），这里只把参数原样传给函数据。
 * 归属（backgrounds/{本人}/…）由 SQL 依据 auth.uid() 判定，路由层不重复实现。
 */
export async function setOwnBackgroundPhoto(
  userId: string,
  key: string,
  meta: BackgroundPhotoMeta,
): Promise<AccountSettings | null> {
  await withRls(userId, (c) =>
    c.query('select public.api_set_own_background_photo($1, $2::jsonb)', [key, JSON.stringify(meta)]),
  )
  return getOwnSettings(userId)
}

/** 0037：清除背景照片，返回旧对象键（路由层据此删磁盘文件） */
export async function clearOwnBackgroundPhoto(userId: string): Promise<string | null> {
  const r = await withRls(userId, (c) => c.query('select public.api_clear_own_background_photo() as old_key'))
  const old = r.rows[0]?.old_key
  return typeof old === 'string' && old ? old : null
}

export async function updateOwnPreferences(userId:string,input:{visibility:'public'|'private';showLikes:boolean;showFavorites:boolean;discoverable:boolean;notificationPreferences:Record<string,boolean>}):Promise<AccountSettings|null>{
  await withRls(userId,(c)=>c.query('select public.api_update_own_preferences($1,$2,$3,$4,$5::jsonb)',[input.visibility,input.showLikes,input.showFavorites,input.discoverable,JSON.stringify(input.notificationPreferences)]))
  return getOwnSettings(userId)
}

/**
 * 0031：账户级拍摄参数可见性。
 *
 * 校验在数据库函数里做（非法取值 22023 ⇒ 400），路由层只做「字段是否存在 + 类型」
 * 的最低限度检查 —— 可见性语义只有一处定义，不会出现 TS 与 SQL 各判一套。
 */
export async function updateOwnExifVisibility(userId:string,visibility:'public'|'hidden'):Promise<AccountSettings|null>{
  return withRls(userId,async(c)=>{
    await c.query('select public.api_set_exif_visibility($1)',[visibility])
    const r=await c.query('select * from public.api_get_own_account_settings()')
    return r.rows[0]?map(r.rows[0]):null
  })
}

/**
 * 0031：设置主页代表作（≤3，仅本人已发布作品）。
 *
 * 返回摘要而不是整份账户设置：设置页只需要「刚存下的那 3 件」，
 * 让前端再解析一遍 20 个字段的账户载荷没有意义。
 * 归属/状态/上限的校验全在 api_set_pinned_photos 里（23514 中文文案 ⇒ 400）。
 */
export async function setOwnPinnedPhotos(userId:string,photoIds:string[]):Promise<{pinnedPhotoIds:string[];pinned:PinnedPhotoSummary[]}>{
  return withRls(userId,async(c)=>{
    await c.query('select public.api_set_pinned_photos($1::uuid,$2::uuid[])',[userId,photoIds])
    const r=await c.query<{pinned_photo_ids:string[]|null;pinned:unknown}>('select * from public.api_get_own_pinned()')
    const row=r.rows[0]
    return {
      pinnedPhotoIds:Array.isArray(row?.pinned_photo_ids)?row.pinned_photo_ids:[],
      pinned:mapPinnedSummaries(row?.pinned),
    }
  })
}
export async function listSessions(userId:string,currentSessionId:string){return withRls(userId,async(c)=>{const r=await c.query('select * from public.api_list_own_sessions()');return r.rows.map((x)=>({id:x.id,currentSession:x.id===currentSessionId,userAgent:x.user_agent,createdAt:iso(x.created_at),lastSeenAt:iso(x.last_seen_at),expiresAt:iso(x.expires_at)}))})}
export async function revokeOwnSession(userId:string,sessionId:string):Promise<boolean>{return withRls(userId,async(c)=>{const r=await c.query<{ok:boolean}>('select public.api_revoke_own_session($1) ok',[sessionId]);return r.rows[0]?.ok??false})}
export async function deleteOwnAccount(userId:string,reason:string,ipHash:string,userAgent:string|null):Promise<void>{await withRls(userId,(c)=>c.query('select public.api_delete_own_account($1,$2,$3)',[reason,ipHash,userAgent]))}
