/**
 * 作品图片对象键的唯一真源（上传白名单 + 清理 worker 共用）。
 *
 * 为什么必须只有一份：上传接口用它决定「允许写哪些路径」，清理 worker 用它决定
 * 「哪些路径可以删」。两处正则一旦漂移，就会出现「能传上去但永远删不掉」或者
 * 「清理任务反复抛错、队列只增不减」——两种都是线上才暴露、事后很难查的故障。
 *
 * 8.4c 起支持两种形状：
 *   1) 旧（单图作品）  photos/{userId}/{photoId}/display.webp
 *                      photos/{userId}/{photoId}/thumb.webp
 *   2) 新（组照槽位）  photos/{userId}/{photoId}/items/{0-8}/display.webp
 *                      photos/{userId}/{photoId}/items/{0-8}/thumb.webp
 *
 * 旧形状必须继续可用：已有作品的 image_key/thumb_key 就是它，
 * 而且前端对单图作品的上传路径不打算改（零回归）。
 */

/** 槽位上限：一件作品最多 9 张图（position 0–8，0 号为封面）。 */
export const MAX_PHOTO_ITEMS = 9

/**
 * 捕获组：1=上传者 uuid、2=作品 uuid、3=槽位序号（旧路径没有这一组）、4=display|thumb。
 * uuid 用宽松的 [0-9a-f-]{36}：这里只做形状闸门，真伪由数据库主键/外键兜底。
 */
const PHOTO_IMAGE_KEY_RE = /^photos\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/(?:items\/([0-8])\/)?(display|thumb)\.webp$/i

export interface ParsedPhotoImageKey {
  /** 归一化成小写：对象键本身保留原样，比较时才用小写。 */
  userId: string
  photoId: string
  /** 旧路径（单图封面）为 null；组照槽位为 0–8。 */
  slot: number | null
  kind: 'display' | 'thumb'
}

/**
 * 解析作品图片键；不合法的键返回 null（调用方决定抛 400 还是忽略）。
 */
export function parsePhotoImageKey(key: string): ParsedPhotoImageKey | null {
  const match = PHOTO_IMAGE_KEY_RE.exec(key)
  if (!match) return null
  const slot = match[3]
  return {
    userId: (match[1] ?? '').toLowerCase(),
    photoId: (match[2] ?? '').toLowerCase(),
    slot: slot === undefined ? null : Number(slot),
    kind: match[4]?.toLowerCase() === 'thumb' ? 'thumb' : 'display',
  }
}

/** 清理 worker 的闸门：只要形状合法就允许删，不问归属。 */
export function isPhotoObjectKey(key: string): boolean {
  return PHOTO_IMAGE_KEY_RE.test(key)
}
