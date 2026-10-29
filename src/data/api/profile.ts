/**
 * API 资料侧摄影设置（8.4a）。
 *
 * 契约：ProfileRepository（src/data/contracts）。
 *   PUT /api/me/exif-visibility  { visibility: 'public' | 'hidden' }
 *   PUT /api/me/pinned          { photoIds: string[] } → { pinnedPhotoIds, pinned }
 *
 * 两个接口都是「读当前会话」，不接收 user id：越权（拿别人的 username 改设置）
 * 在后端就没有入口，前端也不提供参数。
 */
import type { PinnedPhotosResult, ProfileRepository } from '@/data/contracts'
import type { ExifVisibility } from '@/domain/photography'
import { request } from './client'

export const apiProfileRepository: ProfileRepository = {
  async setExifVisibility(visibility: ExifVisibility): Promise<void> {
    await request<void>('/api/me/exif-visibility', {
      method: 'PUT',
      body: { visibility },
    })
  },

  async setPinned(photoIds: string[]): Promise<PinnedPhotosResult> {
    return request<PinnedPhotosResult>('/api/me/pinned', {
      method: 'PUT',
      body: { photoIds },
    })
  },
}
