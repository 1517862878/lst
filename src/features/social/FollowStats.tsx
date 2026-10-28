/**
 * 个人主页的粉丝数 / 关注数，点击就地展开对应列表（S8）。
 *
 * 为什么是同页展开而不是跳到独立路由：进主页的人最关心「这个人被谁关注」，
 * 一跳走就丢了当前上下文（返回键也不一定回得来）。把面板插在统计行下面，
 * 视线不用离开资料区，关掉也只需再点一次。
 *
 * 关注按钮通过 leading 插进同一行：光标从左到右依次是
 * 「关注 → 粉丝数 → 关注数」，三个动作互不遮挡，窄屏自动换行。
 */
import { useState, type ReactNode } from 'react'
import { useFollowCounts } from '@/hooks/useSocial'
import type { FollowListKind } from '@/hooks/queryKeys'
import { FollowList } from './FollowList'

export interface FollowStatsProps {
  username: string
  /** 行首插槽（通常是关注按钮；本人主页不传） */
  leading?: ReactNode
}

export function FollowStats({ username, leading = null }: FollowStatsProps) {
  const [open, setOpen] = useState<FollowListKind | null>(null)
  const counts = useFollowCounts(username)

  const toggle = (kind: FollowListKind) => setOpen((current) => (current === kind ? null : kind))

  const renderStat = (kind: FollowListKind, label: string, value: number | undefined) => (
    <button
      type="button"
      className="g-profile-stat"
      aria-expanded={open === kind}
      // 只在面板真的挂载时才指向它：aria-controls 指向不存在的 id 会被读屏当成坏引用
      aria-controls={open === kind ? 'g-follow-panel' : undefined}
      onClick={() => toggle(kind)}
    >
      {/* 计数还没回来时显示占位符而不是 0：0 是一个会被当真的假数字 */}
      <span className="g-profile-stat-value">{counts.isLoading ? '—' : (value ?? 0)}</span>
      <span className="g-profile-stat-label">{label}</span>
    </button>
  )

  return (
    <>
      <div className="g-profile-actions">
        {leading}
        {renderStat('followers', '粉丝', counts.data?.followers)}
        {renderStat('following', '关注', counts.data?.following)}
      </div>
      {open && <FollowList username={username} kind={open} />}
    </>
  )
}
