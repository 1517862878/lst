/**
 * Mock 存储仓储。契约：StorageRepository。
 * 图片 Blob 存 IndexedDB gy-assets 库（与实体库分离，DATA-MODEL §6）。
 * 键规则与动态期 Storage 路径完全一致：photos/{authorId}/{photoId}/display.webp
 */
import { AppError, ErrorCodes, type StorageRepository } from '@/data/contracts'
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

interface AssetsSchema extends DBSchema {
  images: { key: string; value: { key: string; blob: Blob; width: number; height: number; createdAt: string } }
}

let assetsPromise: Promise<IDBPDatabase<AssetsSchema>> | null = null

function getAssetsDb(): Promise<IDBPDatabase<AssetsSchema>> {
  if (assetsPromise) return assetsPromise
  assetsPromise = openDB<AssetsSchema>('gy-assets', 1, {
    upgrade(db) {
      db.createObjectStore('images', { keyPath: 'key' })
    },
  })
  return assetsPromise
}

export const mockStorageRepository: StorageRepository = {
  async put(key: string, blob: Blob): Promise<void> {
    const db = await getAssetsDb()
    await db.put('images', {
      key,
      blob,
      width: 0,
      height: 0,
      createdAt: new Date().toISOString(),
    })
  },

  async get(key: string): Promise<Blob> {
    const db = await getAssetsDb()
    const row = await db.get('images', key)
    if (!row) throw new AppError(ErrorCodes.NOT_FOUND, `图片不存在：${key}`)
    return row.blob
  },
}
