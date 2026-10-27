/**
 * 资料仓储。
 *
 * 这个模块此前一直缺位：契约里的 AuthRepository.getProfile / getProfileByUsername
 * 没有对应的 HTTP 接口，前端 api 适配器只能挂在 pending.ts 里抛"尚未接入"。第 2 步补齐。
 *
 * RLS 提醒（实测 pg_policies）：
 *   p_profiles_select = (deleted_at IS NULL) OR (id = auth.uid()) OR is_editor_or_admin()
 *   → 匿名 / 他人只能看到未注销的资料；本人与管理员能看到全部。
 *   所以"可选身份"的查看接口必须把当前用户 id 传进来，不能图省事传 null，
 *   否则用户访问自己的个人主页时，注销状态就看不到了。
 */
import type pg from 'pg'
import { withRls } from '../lib/db.js'
import { mapPublicProfile, type ProfileRow } from '../lib/mappers.js'

/**
 * 显式列名，不用 select *：
 * 以后 profiles 加列时，不会因为一个通配符就把新字段（可能是私有字段）带进公开响应。
 */
const COLUMNS = `
  id, username, display_name, avatar_key, bio, role, links,
  license_preference, phone, phone_verified_at,
  created_at, updated_at, deleted_at
`

export type PublicProfile = ReturnType<typeof mapPublicProfile>

/** 按 id 取资料；viewerId 决定 RLS 可见性（本人能读到已注销的自己的资料） */
export async function getProfileById(
  id: string,
  viewerId: string | null,
): Promise<PublicProfile | null> {
  return withRls(viewerId, async (c: pg.PoolClient) => {
    // id 是 uuid 列，格式不对时 Postgres 抛 22P02 → translateDbError 翻成 VALIDATION，
    // 所以路由层会先做一次 UUID 形状校验，把它变成更准确的 404。
    const r = await c.query<ProfileRow>(
      `select ${COLUMNS} from public.profiles where id = $1 limit 1`,
      [id],
    )
    const row = r.rows[0]
    return row ? mapPublicProfile(row) : null
  })
}

/** 按用户名取资料（个人主页路径用）。username 是 citext，比较自动忽略大小写 */
export async function getProfileByUsername(
  username: string,
  viewerId: string | null,
): Promise<PublicProfile | null> {
  return withRls(viewerId, async (c: pg.PoolClient) => {
    const r = await c.query<ProfileRow>(
      `select ${COLUMNS} from public.profiles where username = $1::citext limit 1`,
      [username],
    )
    const row = r.rows[0]
    return row ? mapPublicProfile(row) : null
  })
}
