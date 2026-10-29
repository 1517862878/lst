import type { FastifyInstance } from 'fastify'
import { requireUser } from '../lib/auth.js'
import { clearSessionCookie, requestIpHash } from '../lib/session.js'
import { notFound, validation } from '../lib/errors.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { getOwnCredential, setOwnPassword } from '../repositories/accounts.js'
import * as account from '../repositories/account-center.js'

const PROFILE_KEYS = new Set(['displayName', 'bio', 'links', 'licensePreference', 'avatarKey'])
const PREFERENCE_KEYS = new Set([
  'visibility', 'showLikes', 'showFavorites', 'discoverable', 'notificationPreferences',
])
const NOTIFICATION_KEYS = new Set(['accountSecurity', 'productUpdates'])
const PASSWORD_KEYS = new Set(['oldPassword', 'newPassword'])
const DELETE_KEYS = new Set(['password', 'confirm', 'reason'])
const EXIF_VISIBILITY_KEYS = new Set(['visibility'])
const PINNED_KEYS = new Set(['photoIds'])
/** 代表作上限：与 profiles.pinned_photo_ids 的 ck_profiles_pinned_photo_ids 一致。 */
const PINNED_LIMIT = 3
const LICENSES = new Set(['all_rights_reserved', 'cc_by', 'cc_by_nc', 'cc_by_nc_nd', 'cc0'])
const CONTROL_RE = /[\p{Cc}\p{Cf}]/u
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function objectBody(value: unknown, allowed: ReadonlySet<string>): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw validation('请求体必须是普通对象')
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) throw validation('请求体必须是普通对象')
  const body = value as Record<string, unknown>
  const unknown = Object.keys(body).filter((key) => !allowed.has(key))
  if (unknown.length > 0) throw validation('请求体包含未知字段', { fields: unknown })
  return body
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string') throw validation(`${key} 必须是字符串`)
  return value
}

function requiredBoolean(body: Record<string, unknown>, key: string): boolean {
  const value = body[key]
  if (typeof value !== 'boolean') throw validation(`${key} 必须是布尔值`)
  return value
}

function parseLinks(value: unknown): Array<{ label: string; url: string }> {
  if (!Array.isArray(value) || value.length > 3) throw validation('主页链接必须是最多 3 条的数组')
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw validation(`第 ${index + 1} 条链接必须是对象`)
    }
    const keys = Object.keys(entry)
    if (keys.length !== 2 || !keys.includes('label') || !keys.includes('url')) {
      throw validation('每条链接只能包含 label 和 url')
    }
    const row = entry as Record<string, unknown>
    if (typeof row.label !== 'string' || typeof row.url !== 'string') {
      throw validation('链接 label 和 url 必须是字符串')
    }
    const label = row.label.trim()
    if (!label || label.length > 40 || CONTROL_RE.test(label)) {
      throw validation('链接名称需为 1–40 个可见字符')
    }
    if (row.url.length > 500 || CONTROL_RE.test(row.url)) throw validation('链接地址不合法')
    let url: URL
    try { url = new URL(row.url) } catch { throw validation('链接必须是有效的 HTTPS 地址') }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
      throw validation('链接必须使用 HTTPS，且不能包含认证信息')
    }
    return { label, url: url.toString() }
  })
}

function parseAvatarKey(value: unknown, userId: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw validation('avatarKey 必须是字符串或 null')
  const key = value.trim()
  if (!key) return null
  if (
    key.length > 512 || CONTROL_RE.test(key) || /(^|\/)\.\.(\/|$)/.test(key)
    || /^[a-z][a-z0-9+.-]*:\/\//i.test(key)
    || !new RegExp(`^avatars/${userId}/[A-Za-z0-9][A-Za-z0-9._/-]*$`).test(key)
  ) throw validation('头像存储键必须属于当前账号且不能包含路径穿越')
  return key
}

function parseNotifications(value: unknown): { accountSecurity: boolean; productUpdates: boolean } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw validation('通知偏好必须是对象')
  }
  const body = value as Record<string, unknown>
  const keys = Object.keys(body)
  if (keys.length !== 2 || keys.some((key) => !NOTIFICATION_KEYS.has(key))) {
    throw validation('通知偏好必须且只能包含 accountSecurity、productUpdates')
  }
  return {
    accountSecurity: requiredBoolean(body, 'accountSecurity'),
    productUpdates: requiredBoolean(body, 'productUpdates'),
  }
}

async function credentialFor(userId: string): Promise<string | null> {
  const credential = await getOwnCredential(userId)
  if (!credential || credential.userId !== userId) return null
  return credential.passwordHash
}

export async function registerAccountCenterRoutes(app: FastifyInstance) {
  app.get('/api/me/account', async (req) => {
    const user = await requireUser(req)
    const result = await account.getOwnSettings(user.userId)
    if (!result) throw notFound('账号不存在')
    return result
  })

  // 完整替换语义：PUT 的五个字段全部必填，避免 PATCH 缺字段被默认为空值。
  app.put('/api/me/profile', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req)
    const body = objectBody(req.body, PROFILE_KEYS)
    const displayName = requiredString(body, 'displayName').trim()
    const bio = requiredString(body, 'bio')
    const licensePreference = requiredString(body, 'licensePreference')
    if (!displayName || displayName.length > 30 || CONTROL_RE.test(displayName)) throw validation('昵称需 1–30 个可见字符')
    if (bio.length > 160 || CONTROL_RE.test(bio)) throw validation('个人简介不能超过 160 个可见字符')
    if (!LICENSES.has(licensePreference)) throw validation('默认许可协议不合法')
    const result = await account.updateOwnProfile(user.userId, {
      displayName,
      bio,
      links: parseLinks(body.links),
      licensePreference,
      avatarKey: parseAvatarKey(body.avatarKey, user.userId),
    })
    if (!result) throw notFound('账号不存在')
    return result
  })

  app.put('/api/me/preferences', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req)
    const body = objectBody(req.body, PREFERENCE_KEYS)
    if (body.visibility !== 'public' && body.visibility !== 'private') throw validation('visibility 不合法')
    const result = await account.updateOwnPreferences(user.userId, {
      visibility: body.visibility,
      showLikes: requiredBoolean(body, 'showLikes'),
      showFavorites: requiredBoolean(body, 'showFavorites'),
      discoverable: requiredBoolean(body, 'discoverable'),
      notificationPreferences: parseNotifications(body.notificationPreferences),
    })
    if (!result) throw notFound('账号不存在')
    return result
  })

  // 0031：拍摄参数公开范围。完整替换语义（PUT），取值域只有 public | hidden；
  // 「隐藏」是账户级兜底，逐张覆盖仍由作品编辑页的 exifHidden 决定。
  app.put('/api/me/exif-visibility', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req)
    const body = objectBody(req.body, EXIF_VISIBILITY_KEYS)
    if (body.visibility !== 'public' && body.visibility !== 'hidden') {
      throw validation('visibility 必须是 public 或 hidden')
    }
    const result = await account.updateOwnExifVisibility(user.userId, body.visibility)
    if (!result) throw notFound('账号不存在')
    return result
  })

  // 0031：主页代表作。返回 { pinnedPhotoIds, pinned:[{id,title,thumbKey}] }：
  // 置顶区要立刻拿到标题与缩略图，让前端为此再拉一次作品列表不值得。
  // 上限 3、仅本人已发布作品的校验在 api_set_pinned_photos 里（23514 ⇒ 400）。
  app.put('/api/me/pinned', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req)
    const body = objectBody(req.body, PINNED_KEYS)
    const photoIds = body.photoIds
    if (!Array.isArray(photoIds)) throw validation('photoIds 必须是数组')
    if (photoIds.length > PINNED_LIMIT) throw validation(`代表作最多 ${PINNED_LIMIT} 件`)
    const ids: string[] = []
    for (const [index, entry] of photoIds.entries()) {
      if (typeof entry !== 'string' || !UUID_RE.test(entry)) {
        throw validation(`第 ${index + 1} 个代表作 id 不是合法的 UUID`)
      }
      // 同一次请求里的重复 id 直接拒：静默去重会让用户看到「选了 3 个、只存下 2 个」，
      // 而顺序是代表作叙事的一部分，谁被丢掉不该由后端决定。
      if (ids.includes(entry)) throw validation('photoIds 不能包含重复的作品')
      ids.push(entry)
    }
    return account.setOwnPinnedPhotos(user.userId, ids)
  })

  app.get('/api/me/sessions', async (req) => {
    const user = await requireUser(req)
    return account.listSessions(user.userId, user.sessionId)
  })

  app.delete<{ Params: { id: string } }>('/api/me/sessions/:id', async (req, reply) => {
    const user = await requireUser(req)
    if (!UUID_RE.test(req.params.id)) throw notFound('会话不存在')
    if (req.params.id === user.sessionId) throw validation('当前会话请使用退出登录')
    if (!(await account.revokeOwnSession(user.userId, req.params.id))) throw notFound('会话不存在')
    return reply.code(204).send()
  })

  app.patch('/api/me/password', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const user = await requireUser(req)
    const body = objectBody(req.body, PASSWORD_KEYS)
    const oldPassword = requiredString(body, 'oldPassword')
    const newPassword = requiredString(body, 'newPassword')
    if (newPassword.length < 8 || newPassword.length > 64) throw validation('新密码需 8–64 位')
    const hash = await credentialFor(user.userId)
    if (!(await verifyPassword(hash, oldPassword))) throw validation('当前密码不正确')
    await setOwnPassword(user.userId, await hashPassword(newPassword))
    clearSessionCookie(reply)
    return { ok: true, reloginRequired: true }
  })

  app.delete('/api/me/account', { config: { rateLimit: { max: 2, timeWindow: '1 hour' } } }, async (req, reply) => {
    const user = await requireUser(req)
    const body = objectBody(req.body, DELETE_KEYS)
    const password = requiredString(body, 'password')
    const confirm = requiredString(body, 'confirm')
    const reason = body.reason === undefined ? '' : requiredString(body, 'reason')
    if (confirm !== '注销账号') throw validation('请输入“注销账号”完成确认')
    if (reason.length > 500 || CONTROL_RE.test(reason)) throw validation('注销原因不能超过 500 个可见字符')
    const hash = await credentialFor(user.userId)
    if (!(await verifyPassword(hash, password))) throw validation('密码不正确')
    await account.deleteOwnAccount(
      user.userId,
      reason,
      requestIpHash(req),
      req.headers['user-agent']?.slice(0, 512) ?? null,
    )
    clearSessionCookie(reply)
    return reply.code(204).send()
  })
}
