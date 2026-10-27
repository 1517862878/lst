import { AppError, ErrorCodes, type StorageRepository } from '@/data/contracts'
import { API_BASE, request } from './client'

function pathOf(key: string): string {
  return `/api/storage/${key.split('/').map(encodeURIComponent).join('/')}`
}

export const apiStorageRepository: StorageRepository = {
  async put(key: string, blob: Blob): Promise<void> {
    await request<{ key: string; size: number }>(pathOf(key), {
      method: 'PUT',
      rawBody: blob,
      contentType: 'image/webp',
    })
  },

  async get(key: string): Promise<Blob> {
    const url = API_BASE + `/images/${key.split('/').map(encodeURIComponent).join('/')}`
    let response: Response
    try {
      response = await fetch(url)
    } catch (err) {
      throw new AppError(ErrorCodes.STORAGE, `无法读取图片：${err instanceof Error ? err.message : String(err)}`)
    }
    if (!response.ok) {
      throw new AppError(
        response.status === 404 ? ErrorCodes.NOT_FOUND : ErrorCodes.STORAGE,
        response.status === 404 ? `图片不存在：${key}` : `图片读取失败（${response.status}）`,
      )
    }
    return response.blob()
  },
}
