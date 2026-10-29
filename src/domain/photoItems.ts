/**
 * 组照（8.4c）的纯函数：张数、封面、重排、校验。
 *
 * 为什么单独成文件：发布页、编辑页、画册、mock 仓储都要用同一套判定
 * （最多 9 张、说明 ≤200 字、第 1 张即封面），规则写一份才不会出现
 * 「页面允许 10 张、仓储拒收」这类只在边界上暴露的不一致。
 *
 * 这一层不认识 File、Blob 或 IndexedDB：它只处理「已经压好、已经上传」的
 * 键与尺寸，所以 api / mock 两侧和单测都能直接复用。
 */
import type { Photo, PhotoItem } from './types'

/** 一件作品最多几张（与迁移 0033 的 position between 0 and 8 一致） */
export const MAX_PHOTO_ITEMS = 9

/** 单张说明的字数上限（与 photo_items.caption 的 check 一致） */
export const MAX_ITEM_CAPTION = 200

/** 组照条目入参的最小结构（等于契约里的 PhotoItemInput，这里只依赖结构） */
export interface PhotoItemLike {
  imageKey: string
  thumbKey: string
  width: number
  height: number
  caption: string
}

/** 作品的组照条目；老数据没有 items 字段时是空数组 */
export function photoItemsOf(photo: Pick<Photo, 'items'>): PhotoItem[] {
  return photo.items ?? []
}

/**
 * 张数口径：详情以 items 为准（真实张数），列表只有 itemCount。
 *
 * 两边都缺时返回 0 —— 调用方按「单图」处理，和 8.4c 之前的行为一致。
 */
export function photoItemCount(photo: Pick<Photo, 'items' | 'itemCount'>): number {
  if (photo.items && photo.items.length > 0) return photo.items.length
  return photo.itemCount ?? 0
}

/** 是否需要渲染画册（>1 张）。单图作品必须继续走原来那条渲染路径。 */
export function hasPhotoGallery(photo: Pick<Photo, 'items' | 'itemCount'>): boolean {
  return photoItemCount(photo) > 1
}

/** 返回下标 0 的条目（封面）；空列表返回 null */
export function coverItem(items: readonly PhotoItem[]): PhotoItem | null {
  return items[0] ?? null
}

/** 把 from 位置的元素移到 to（越界时原样返回，供上移/下移按钮直接用） */
export function moveTo<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list]
  const next = [...list]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return [...list]
  next.splice(to, 0, moved)
  return next
}

/** 说明归一化：去掉首尾空白并截到 200 字（超长输入不应让整次上传白跑） */
export function normalizeCaption(caption: string): string {
  return caption.trim().slice(0, MAX_ITEM_CAPTION)
}

/**
 * 提交前的校验：返回错误文案，null = 通过。
 *
 * 与后端错误码一一对应：>9 张 = 23514（check 约束）、字段缺失 = 22023。
 */
export function validatePhotoItems(items: readonly PhotoItemLike[]): string | null {
  if (items.length > MAX_PHOTO_ITEMS) return `一件作品最多 ${MAX_PHOTO_ITEMS} 张图`
  for (const [index, item] of items.entries()) {
    const label = `第 ${index + 1} 张`
    if (!item.imageKey || !item.thumbKey) return `${label}缺少图片地址`
    if (!(item.width > 0) || !(item.height > 0)) return `${label}的尺寸无效`
    if (item.caption.length > MAX_ITEM_CAPTION) return `${label}的说明最多 ${MAX_ITEM_CAPTION} 字`
  }
  return null
}
