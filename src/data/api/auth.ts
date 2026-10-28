/** 真实后端鉴权仓储：会话由 HttpOnly cookie 持有。 */
import { AppError, ErrorCodes, type AuthRepository, type SignUpInput } from '@/data/contracts'
import type { Profile, Session } from '@/domain/types'
import { request } from './client'

export const apiAuthRepository: AuthRepository = {
  async getSession(): Promise<Session | null> {
    try {
      return await request<Session | null>('/api/auth/session')
    } catch (err) {
      // 未登录和已过期对调用方都表现为“没有会话”。
      if (err instanceof AppError && err.code === ErrorCodes.UNAUTHORIZED) return null
      throw err
    }
  },

  async signIn(username: string, password: string, turnstileToken?: string): Promise<Session> {
    return request<Session>('/api/auth/login', {
      method: 'POST',
      body: { username, password, ...(turnstileToken ? { turnstileToken } : {}) },
    })
  },

  async requestRegistrationCode(phone: string, turnstileToken?: string): Promise<void> {
    await request<void>('/api/auth/register/request-code', {
      method: 'POST',
      body: { phone, ...(turnstileToken ? { turnstileToken } : {}) },
    })
  },

  async signUp(input: SignUpInput): Promise<Session> {
    return request<Session>('/api/auth/register', {
      method: 'POST',
      body: input,
    })
  },

  async signOut(): Promise<void> {
    await request<void>('/api/auth/logout', { method: 'POST' })
  },

  async getProfile(id: string): Promise<Profile> {
    return request<Profile>(`/api/profiles/${encodeURIComponent(id)}`)
  },

  async getProfileByUsername(username: string): Promise<Profile> {
    return request<Profile>(`/api/profiles/by-username/${encodeURIComponent(username)}`)
  },
}
