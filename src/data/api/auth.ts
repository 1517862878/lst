/**
 * 真实后端鉴权仓储（第 2 步）。
 *
 * 替换掉了 pending.ts 里的占位实现。行为与 mock 实现对齐，但有一处刻意的差异：
 *   会话不缓存到 localStorage（mock 存 gy:session），只存令牌（gy:token），
 *   每次读会话都问服务端。原因是 localStorage 里的 username/displayName 副本
 *   会跟服务端漂移（改名、软删、角色变更后就是错的），而令牌本身就是会话的唯一真相。
 */
import { AppError, ErrorCodes, type AuthRepository } from '@/data/contracts'
import type { Profile, Session } from '@/domain/types'
import { getToken, request, setToken } from './client'

export const apiAuthRepository: AuthRepository = {
  async getSession(): Promise<Session | null> {
    // 没有令牌就不发请求：省一次往返，也避免服务端把"没登录"记成异常
    if (!getToken()) return null

    try {
      return await request<Session | null>('/api/auth/session')
    } catch (err) {
      // 令牌过期或损坏：client.ts 的 401 分支已经把它从 localStorage 清掉了。
      // 对调用方来说"没有会话"和"会话已失效"是同一件事，所以返回 null 而不是抛错——
      // 否则 useSession 的 useQuery 会对 401 重试 3 次，路由守卫还得额外处理 error 分支。
      if (err instanceof AppError && err.code === ErrorCodes.UNAUTHORIZED) return null
      throw err
    }
  },

  async signIn(username: string, password: string): Promise<Session> {
    // auth: false —— 登录本身不该带旧令牌（带着一个坏令牌只会让服务端多绕一圈）
    const session = await request<Session>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      auth: false,
    })
    setToken(session.token)
    return session
  },

  async signUp(input: { username: string; displayName: string; password: string }): Promise<Session> {
    const session = await request<Session>('/api/auth/register', {
      method: 'POST',
      body: {
        username: input.username,
        displayName: input.displayName,
        password: input.password,
      },
      auth: false,
    })
    setToken(session.token)
    return session
  },

  async signOut(): Promise<void> {
    // 先清本地：即使请求失败（离线、服务没起），用户也必须能退出去。
    setToken(null)
    try {
      await request<void>('/api/auth/logout', { method: 'POST', auth: false })
    } catch {
      // 登出接口失败无关紧要：令牌是无状态的 JWT，本地清掉就等于退出登录
    }
  },

  async getProfile(id: string): Promise<Profile> {
    return request<Profile>(`/api/profiles/${encodeURIComponent(id)}`)
  },

  async getProfileByUsername(username: string): Promise<Profile> {
    return request<Profile>(`/api/profiles/by-username/${encodeURIComponent(username)}`)
  },
}
