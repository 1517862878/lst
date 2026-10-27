/**
 * Mock 鉴权仓储（伪造会话，ROADMAP §5.1）。
 * 安全边界：演示模式，密码不加密、不假装安全；会话存 localStorage。
 */
import { AppError, ErrorCodes, type AuthRepository } from '@/data/contracts'
import type { Profile, Session } from '@/domain/types'
import { DEMO_PASSWORD } from '@/domain/constants'
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

export const mockAuthRepository: AuthRepository = {
  async getSession(): Promise<Session | null> {
    return loadSession()
  },

  async signIn(username: string, password: string): Promise<Session> {
    // 演示模式：密码固定 demo1234；明确不做加密假装安全（ROADMAP §5.1）
    if (password !== DEMO_PASSWORD) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, '密码错误（演示模式密码为 demo1234）')
    }
    const db = await getDb()
    const all = await db.getAll('profiles')
    const profile = all.find((p) => p.username === username)
    if (!profile) throw new AppError(ErrorCodes.UNAUTHORIZED, `用户不存在：${username}`)
    const session: Session = {
      userId: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      token: `mock.${crypto.randomUUID()}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    }
    saveSession(session)
    return session
  },

  async signUp(input: { username: string; displayName: string; password: string }): Promise<Session> {
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
      token: `mock.${crypto.randomUUID()}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
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
    return profile
  },

  async getProfileByUsername(username: string): Promise<Profile> {
    const db = await getDb()
    const all = await db.getAll('profiles')
    const profile = all.find((p) => p.username === username)
    if (!profile) throw new AppError(ErrorCodes.NOT_FOUND, `用户不存在：${username}`)
    return profile
  },
}
