import type pg from 'pg'
import { withRls } from '../lib/db.js'

export interface AccountSettings {
  id: string; username: string; displayName: string; avatarKey: string | null; bio: string; role: string
  phone: string | null; links: unknown[]; licensePreference: string; visibility: 'public' | 'private'
  showLikes: boolean; showFavorites: boolean; discoverable: boolean
  notificationPreferences: Record<string, boolean>; createdAt: string; updatedAt: string
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
  }
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
export async function updateOwnPreferences(userId:string,input:{visibility:'public'|'private';showLikes:boolean;showFavorites:boolean;discoverable:boolean;notificationPreferences:Record<string,boolean>}):Promise<AccountSettings|null>{
  await withRls(userId,(c)=>c.query('select public.api_update_own_preferences($1,$2,$3,$4,$5::jsonb)',[input.visibility,input.showLikes,input.showFavorites,input.discoverable,JSON.stringify(input.notificationPreferences)]))
  return getOwnSettings(userId)
}
export async function listSessions(userId:string,currentSessionId:string){return withRls(userId,async(c)=>{const r=await c.query('select * from public.api_list_own_sessions()');return r.rows.map((x)=>({id:x.id,currentSession:x.id===currentSessionId,userAgent:x.user_agent,createdAt:iso(x.created_at),lastSeenAt:iso(x.last_seen_at),expiresAt:iso(x.expires_at)}))})}
export async function revokeOwnSession(userId:string,sessionId:string):Promise<boolean>{return withRls(userId,async(c)=>{const r=await c.query<{ok:boolean}>('select public.api_revoke_own_session($1) ok',[sessionId]);return r.rows[0]?.ok??false})}
export async function deleteOwnAccount(userId:string,reason:string,ipHash:string,userAgent:string|null):Promise<void>{await withRls(userId,(c)=>c.query('select public.api_delete_own_account($1,$2,$3)',[reason,ipHash,userAgent]))}
