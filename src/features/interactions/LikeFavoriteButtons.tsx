/**
 * 点赞/收藏按钮（FRONTEND-WORK §3.3 LikeButton/FavoriteButton）。
 * 乐观更新由 hook 处理；未登录点击跳登录。
 */
import { Heart, Star } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { useFavoriteState, useLikeState, useToggleFavorite, useToggleLike } from '@/hooks/useInteractions'
import { cn } from '@/lib/cn'

export interface LikeButtonProps {
  photoId: string
  count: number
  userId: string | null
  className?: string
}

export function LikeButton({ photoId, count, userId, className }: LikeButtonProps) {
  const navigate = useNavigate()
  const liked = useLikeState(userId ?? '', photoId)
  const toggle = useToggleLike(userId ?? '', photoId)

  const handleClick = () => {
    if (!userId) {
      navigate(`/login?next=${encodeURIComponent(`/works/${photoId}`)}`)
      return
    }
    toggle.mutate()
  }

  const isLiked = liked.data === true
  return (
    <Button
      variant={isLiked ? 'primary' : 'secondary'}
      size="sm"
      icon={<Heart className={cn(isLiked && 'g-icon-filled')} aria-hidden="true" />}
      onClick={handleClick}
      loading={toggle.isPending}
      aria-pressed={isLiked}
      className={className}
    >
      点赞 {count}
    </Button>
  )
}

export interface FavoriteButtonProps {
  photoId: string
  count: number
  userId: string | null
  className?: string
}

export function FavoriteButton({ photoId, count, userId, className }: FavoriteButtonProps) {
  const navigate = useNavigate()
  const faved = useFavoriteState(userId ?? '', photoId)
  const toggle = useToggleFavorite(userId ?? '', photoId)

  const handleClick = () => {
    if (!userId) {
      navigate(`/login?next=${encodeURIComponent(`/works/${photoId}`)}`)
      return
    }
    toggle.mutate()
  }

  const isFaved = faved.data === true
  return (
    <Button
      variant={isFaved ? 'primary' : 'secondary'}
      size="sm"
      icon={<Star className={cn(isFaved && 'g-icon-filled')} aria-hidden="true" />}
      onClick={handleClick}
      loading={toggle.isPending}
      aria-pressed={isFaved}
      className={className}
    >
      收藏 {count}
    </Button>
  )
}
