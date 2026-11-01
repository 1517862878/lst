/**
 * 会话 hook（ROADMAP §5.1 / FRONTEND-WORK §4.1）。
 * 静态期：读 localStorage gy:session，40 分钟无操作过期提示重新登录。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createRepositories } from '@/data'
import type { PasswordResetInput, PhoneCodeResult, SignUpInput } from '@/data/contracts'
import type { Session } from '@/domain/types'
import { queryKeys } from './queryKeys'

const repos = () => createRepositories()

export function useSession() {
  return useQuery({
    queryKey: queryKeys.session(),
    queryFn: () => repos().auth.getSession(),
    staleTime: Infinity, // 事件驱动失效
  })
}

/** 按用户名取资料（个人主页用） */
export function useProfileByUsername(username: string) {
  return useQuery({
    queryKey: queryKeys.profileByUsername(username),
    queryFn: () => repos().auth.getProfileByUsername(username),
    retry: false,
  })
}

/** 按用户 ID 取资料（评论作者名用） */
export function useProfile(id: string) {
  return useQuery({
    queryKey: queryKeys.profile(id),
    queryFn: () => repos().auth.getProfile(id),
    enabled: Boolean(id),
  })
}

/** 登录后写缓存 */
export function useSignIn() {
  const queryClient = useQueryClient()
  return {
    async signIn(username: string, password: string, turnstileToken?: string): Promise<Session> {
      const session = await repos().auth.signIn(username, password, turnstileToken)
      queryClient.setQueryData(queryKeys.session(), session)
      return session
    },
  }
}

/** 登出 */
export function useSignOut() {
  const queryClient = useQueryClient()
  return {
    async signOut(): Promise<void> {
      await repos().auth.signOut()
      queryClient.setQueryData(queryKeys.session(), null)
    },
  }
}

/** 注册 */
export function useSignUp() {
  const queryClient = useQueryClient()
  return {
    async requestRegistrationCode(phone: string, turnstileToken?: string): Promise<PhoneCodeResult> {
      return repos().auth.requestRegistrationCode(phone, turnstileToken)
    },
    async signUp(input: SignUpInput): Promise<Session> {
      const session = await repos().auth.signUp(input)
      queryClient.setQueryData(queryKeys.session(), session)
      return session
    },
  }
}

/**
 * 忘记密码：请求重置验证码 + 提交新密码。
 *
 * 成功后服务端会清掉会话 Cookie（旧会话作废），所以这里把会话缓存也置空，
 * 避免界面上还显示「已登录」而实际请求已经 401。
 */
export function usePasswordReset() {
  const queryClient = useQueryClient()
  return {
    async requestCode(phone: string): Promise<PhoneCodeResult> {
      return repos().auth.requestPasswordResetCode(phone)
    },
    async reset(input: PasswordResetInput): Promise<void> {
      await repos().auth.resetPassword(input)
      queryClient.setQueryData(queryKeys.session(), null)
    },
  }
}
