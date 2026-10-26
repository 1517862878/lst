/**
 * 权限纯函数（ROADMAP §5.1：静态期与动态期共用同一套判断；动态期在 RLS 再实现一遍）。
 * 规则：零 React 依赖。
 */
import type { Comment, Photo, Profile } from './types'

/** 当前用户能否编辑该作品（作者本人，或管理员） */
export function canEditPhoto(user: Profile | null, photo: Photo): boolean {
  if (!user) return false
  if (user.role === 'admin') return true
  return photo.authorId === user.id
}

/** 当前用户能否删除该作品（作者本人，或管理员） */
export function canDeletePhoto(user: Profile | null, photo: Photo): boolean {
  return canEditPhoto(user, photo)
}

/** 当前用户能否编辑该评论（作者本人，或管理员） */
export function canEditComment(user: Profile | null, comment: Comment): boolean {
  if (!user) return false
  if (user.role === 'admin') return true
  return comment.authorId === user.id
}

/** 当前用户能否举报（所有登录用户均可） */
export function canReport(user: Profile | null): boolean {
  return user !== null
}

/** 当前用户能否发布作品（所有登录用户均可） */
export function canPublish(user: Profile | null): boolean {
  return user !== null
}

/** 当前用户能否浏览私密内容（第一阶段全公开，恒为 true） */
export function canBrowsePrivate(_user: Profile | null): boolean {
  return true
}
