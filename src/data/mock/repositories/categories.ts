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
    // 与后端 listCategories 同一口径：只列启用的分类
    const active = rows.filter((c) => c.isActive)
    if (active.length > 0) return active.sort((a, b) => a.sortOrder - b.sortOrder)
    return CATEGORIES.filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
  },

  async get(slug: string): Promise<Category> {
    const db = await getDb()
    const row = await db.get('categories', slug)
    /*
     * 已下架的分类一律 404（与后端 getCategory 同一口径）。
     * 2026-11 分类换代后，旧题材分类（landscape 等）被软下架而不是删除，
     * 不过滤的话 /categories/landscape 会打开一个「有名字但没作品」的空页面。
     */
    if (row) {
      if (!row.isActive) throw new AppError(ErrorCodes.NOT_FOUND, `分类不存在：${slug}`)
      return row
    }
    const fromConst = CATEGORIES.find((c) => c.slug === slug)
    if (fromConst && fromConst.isActive) return fromConst
    throw new AppError(ErrorCodes.NOT_FOUND, `分类不存在：${slug}`)
  },
}
