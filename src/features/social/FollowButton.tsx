/**
 * 关注按钮（S8 社交闭环）。
 *
 * 三条容易踩空的行为，都在这里一次说清：
 *  1. 本人主页不渲染按钮 —— 由调用方传 isSelf，组件自身也兜底 return null。
 *  2. 未登录点击**不是**禁用，而是跳登录并在登录后回跳原页（沿用 RequireAuth 的
 *     `?next=` 约定，见 src/components/layout/guards.tsx）。做成 disabled 的话，
 *     游客只看到一块点不动的灰按钮，不知道该怎么办。
 *  3. pending 期间按钮显示的是**目标状态**而不是当前状态：点「关注」后立刻变成
 *     「已关注」的样式，否则用户会以为没点上而反复点（接口是幂等的，但观感很差）。
 */
import { useLocation, useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/useToast'
import { AppError } from '@/data/contracts'
import { useSession } from '@/hooks/useSession'
import { useFollowState, useToggleFollow } from '@/hooks/useSocial'

export interface FollowButtonProps {
  username: string
  /** 是不是本人主页（本人不显示关注按钮） */
  isSelf?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function FollowButton({ username, isSelf = false, size = 'md', className }: FollowButtonProps) {
  const { data: session } = useSession()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()

  // isSelf 时不查询：按钮根本不渲染，没必要为本人主页多打一次接口
  const stateQuery = useFollowState(isSelf ? '' : username)
  const toggle = useToggleFollow(username)

  if (isSelf) return null

  const following = toggle.isPending ? (toggle.variables ?? false) : (stateQuery.data ?? false)

  const handleClick = () => {
    if (!session) {
      const next = encodeURIComponent(location.pathname + location.search)
      navigate(`/login?next=${next}`)
      return
    }

    toggle.mutate(!following, {
      onSuccess: () =>
        toast.show('success', following ? `已取消关注 @${username}` : `已关注 @${username}`),
      onError: (error) =>
        toast.show('error', error instanceof AppError ? error.message : '操作失败，请稍后重试'),
    })
  }

  return (
    <Button
      variant={following ? 'secondary' : 'primary'}
      size={size}
      className={className ? `g-follow-btn ${className}` : 'g-follow-btn'}
      loading={toggle.isPending}
      aria-pressed={following}
      onClick={handleClick}
    >
      {following ? '已关注' : '关注'}
    </Button>
  )
}
