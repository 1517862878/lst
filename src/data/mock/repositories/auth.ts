/**
 * Mock 鉴权仓储（伪造会话，ROADMAP §5.1）。
 * 安全边界：演示模式，密码不加密、不假装安全；会话存 localStorage。
 */
import { AppError, ErrorCodes, type AuthRepository, type SignUpInput } from '@/data/contracts'
import type { Photo, Profile, Session, SessionRestriction } from '@/domain/types'
import { DEMO_PASSWORD } from '@/domain/constants'
import { pickActiveRestriction } from '@/domain/restrictions'
import { isBlockedBetween } from '@/domain/social'
import { pinnedPhotosFrom } from '@/domain/photography'
import { getDb } from '../db'

const SESSION_KEY = 'gy:session'

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Session
    if (new Date(s.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(SESSION_KEY)
      return null
    }
    return s
  } catch {
    return null
  }
}

function saveSession(s: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s))
}

/**
 * 从 user_sanctions 现算当前限制。
 *
 * 不把 restriction 只存在 localStorage 里：管理员撤销处罚、或期限到了以后，
 * 下一次 getSession 必须立刻消失，而不是等用户清缓存。读库失败时退回已存会话
 * （演示模式宁可少拦一次，也不要让整个站点因为 IndexedDB 异常而登不进去）。
 */
async function loadRestriction(userId: string): Promise<SessionRestriction | null> {
  try {
    const db = await getDb()
    const rows = await db.getAllFromIndex('sanctions', 'userId', userId)
    return pickActiveRestriction(rows, Date.now())
  } catch {
    return null
  }
}

/**
 * 公开资料里的代表作摘要（8.4a）。
 *
 * 库里只存 pinnedPhotoIds（与 profiles.pinned_photo_ids 一致），摘要在这里
 * 读时算：作品改名/撤回后主页不会留下过期的标题与缩略图，也不需要一次迁移回填。
 */
function withPinned(profile: Profile, photos: Photo[]): Profile {
  const ids = profile.pinnedPhotoIds ?? []
  if (ids.length === 0) return profile
  return { ...profile, pinned: pinnedPhotosFrom(ids, photos) }
}

export const mockAuthRepository: AuthRepository = {
  async getSession(): Promise<Session | null> {
    const stored = loadSession()
    if (!stored) return null
    const restriction = await loadRestriction(stored.userId)
    return { ...stored, restriction }
  },

  async signIn(username: string, password: string, _turnstileToken?: string): Promise<Session> {
    // 演示模式：密码固定 demo1234；明确不做加密假装安全（ROADMAP §5.1）
    if (password !== DEMO_PASSWORD) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, '密码错误（演示模式密码为 demo1234）')
    }
    const db = await getDb()
    const all = await db.getAll('profiles')
    const profile = all.find((p) => p.username === username)
    if (!profile) throw new AppError(ErrorCodes.UNAUTHORIZED, `用户不存在：${username}`)
    const restriction = await loadRestriction(profile.id)
    const session: Session = {
      userId: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      avatarKey: profile.avatarKey,
      role: profile.role,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
      restriction,
    }
    saveSession(session)
    return session
  },

  async requestRegistrationCode(_phone: string, _turnstileToken?: string): Promise<void> {
    // Mock 模式不发送短信；保留异步契约供 UI 无缝切换数据源。
  },

  async signUp(input: SignUpInput): Promise<Session> {
    // 与 usernameSchema、数据库 ck_profiles_username_format 保持一致（2–20 位，支持中文）
    if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]{2,20}$/u.test(input.username)) {
      throw new AppError(ErrorCodes.VALIDATION, '用户名需 2–20 位，可用中文、字母、数字、下划线、连字符')
    }
    const db = await getDb()
    const all = await db.getAll('profiles')
    if (all.some((p) => p.username === input.username)) {
      throw new AppError(ErrorCodes.CONFLICT, '用户名已被占用')
    }
    const now = new Date().toISOString()
    const profile: Profile = {
      id: crypto.randomUUID(),
      username: input.username,
      displayName: input.displayName || input.username,
      avatarKey: null,
      bio: '',
      role: 'user',
      links: [],
      licensePreference: 'all_rights_reserved',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    await db.put('profiles', profile)
    const session: Session = {
      userId: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      avatarKey: profile.avatarKey,
      role: profile.role,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
      restriction: null,
    }
    saveSession(session)
    return session
  },

  async signOut(): Promise<void> {
    localStorage.removeItem(SESSION_KEY)
  },

  async getProfile(id: string): Promise<Profile> {
    const db = await getDb()
    const profile = await db.get('profiles', id)
    if (!profile) throw new AppError(ErrorCodes.NOT_FOUND, `用户不存在：${id}`)
    return withPinned(profile, await db.getAll('photos'))
  },

  async getProfileByUsername(username: string): Promise<Profile> {
    const db = await getDb()
    const all = await db.getAll('profiles')
    const profile = all.find((p) => p.username.toLowerCase() === username.trim().toLowerCase())
    if (!profile) throw new AppError(ErrorCodes.NOT_FOUND, `用户不存在：${username}`)
    const session = loadSession()
    if (session && isBlockedBetween(await db.getAll('blocks'), session.userId, profile.id)) {
      throw new AppError(ErrorCodes.NOT_FOUND, `用户不存在：${username}`)
    }
    return withPinned(profile, await db.getAll('photos'))
  },
}
