/**
 * Mock 资料侧摄影设置（8.4a）：拍摄参数默认范围 + 主页代表作。
 *
 * 与后端同口径的校验：
 *   · 未登录 → UNAUTHORIZED（不是「静默无效」）；
 *   · 代表作最多 3 件、必须都是**本人的在架作品**，否则 VALIDATION
 *     （后端抛 23514 带中文文案，这里用同一句）；
 *   · 传空数组 = 清空。
 *
 * 摘要一律「读时算」：profile.pinned 由 pinnedPhotoIds + 当前 photos 派生，
 * 于是作品改名、撤回后主页不会留下过期的标题/缩略图。
 */
import { AppError, ErrorCodes, type PinnedPhotosResult, type ProfileRepository } from '@/data/contracts'
import type { Profile } from '@/domain/types'
import { PINNED_MAX, normalizePinnedIds, pinnedPhotosFrom } from '@/domain/photography'
import { bumpDataVersion, getDb } from '../db'
import { mockAuthRepository } from './auth'

const REQUIRE_LOGIN = '请先登录后再修改摄影设置'
const PINNED_LIMIT_MESSAGE = `代表作最多 ${PINNED_MAX} 件，且必须是你自己的在架作品`

async function requireProfile(): Promise<Profile> {
  const session = await mockAuthRepository.getSession()
  if (!session) throw new AppError(ErrorCodes.UNAUTHORIZED, REQUIRE_LOGIN)
  const db = await getDb()
  const profile = await db.get('profiles', session.userId)
  if (!profile) throw new AppError(ErrorCodes.NOT_FOUND, `用户不存在：${session.userId}`)
  return profile
}

/** 写入资料行并返回更新后的行（两个设置共用） */
async function saveProfile(profile: Profile, patch: Partial<Profile>): Promise<Profile> {
  const db = await getDb()
  const updated: Profile = { ...profile, ...patch, updatedAt: new Date().toISOString() }
  await db.put('profiles', updated)
  await bumpDataVersion()
  return updated
}

export const mockProfileRepository: ProfileRepository = {
  async setExifVisibility(visibility): Promise<void> {
    const profile = await requireProfile()
    // 账户级默认是「兜底关」：改为 hidden 时不必逐张写 photos.exif_hidden，
    // 有效可见性在读取投影时按 `exifHidden or exifVisibility='hidden'` 计算。
    await saveProfile(profile, { exifVisibility: visibility })
  },

  async setPinned(photoIds: string[]): Promise<PinnedPhotosResult> {
    const profile = await requireProfile()
    const cleaned = [...new Set(photoIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
    if (cleaned.length > PINNED_MAX) {
      throw new AppError(ErrorCodes.VALIDATION, PINNED_LIMIT_MESSAGE)
    }
    const ids = normalizePinnedIds(cleaned)

    const db = await getDb()
    const photos = await db.getAll('photos')
    const byId = new Map(photos.map((photo) => [photo.id, photo]))
    for (const id of ids) {
      const photo = byId.get(id)
      // 越权与「已撤回」用同一句文案：不区分「不是你的」与「已经不在架」，
      // 避免把别人的作品 id 当成探测手段（存在性泄露）。
      if (!photo || photo.authorId !== profile.id || photo.status !== 'published' || photo.deletedAt) {
        throw new AppError(ErrorCodes.VALIDATION, PINNED_LIMIT_MESSAGE)
      }
    }

    const updated = await saveProfile(profile, { pinnedPhotoIds: ids })
    return {
      pinnedPhotoIds: updated.pinnedPhotoIds ?? [],
      pinned: pinnedPhotosFrom(ids, photos),
    }
  },
}
