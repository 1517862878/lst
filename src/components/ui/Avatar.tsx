import { cn } from '@/lib/cn'

export type AvatarSize = 32 | 48 | 64
export type AvatarShape = 'circle' | 'square'

export interface AvatarProps {
  src?: string | null
  /** 用户名，用于 alt 与首字母兜底 */
  name: string
  size?: AvatarSize
  shape?: AvatarShape
  className?: string
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

/** 头像基元：有图用图，无图用首字母兜底（FRONTEND-WORK §3.1 Avatar） */
export function Avatar({ src, name, size = 48, shape = 'circle', className }: AvatarProps) {
  const style: React.CSSProperties = { width: size, height: size, fontSize: size * 0.4 }

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={cn('g-avatar', `g-avatar-${shape}`, className)}
        style={style}
      />
    )
  }

  return (
    <span
      className={cn('g-avatar g-avatar-fallback', `g-avatar-${shape}`, className)}
      style={style}
      role="img"
      aria-label={name}
    >
      {initial(name)}
    </span>
  )
}
