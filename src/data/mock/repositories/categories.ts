/**
 * Mock 分类仓储。契约：CategoryRepository。
 */
import { AppError, ErrorCodes, type CategoryRepository } from '@/data/contracts'
import type { Category } from '@/domain/types'
import { CATEGORIES } from '@/domain/constants'
import { getDb } from '../db'

export const mockCategoryRepository: CategoryRepository = {
  async list(): Promise<Category[]> {
    // 优先读库（seed 已写入），空库回退常量（保证首屏可用）
    const db = await getDb()
    const rows = await db.getAll('categories')
    if (rows.length > 0) return rows.sort((a, b) => a.sortOrder - b.sortOrder)
    return [...CATEGORIES].sort((a, b) => a.sortOrder - b.sortOrder)
  },

  async get(slug: string): Promise<Category> {
    const db = await getDb()
    const row = await db.get('categories', slug)
    if (row) return row
    const fromConst = CATEGORIES.find((c) => c.slug === slug)
    if (fromConst) return fromConst
    throw new AppError(ErrorCodes.NOT_FOUND, `分类不存在：${slug}`)
  },
}
