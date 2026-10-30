/**
 * 每周主题与活动的 API 实现（8.4d）。
 *
 * 与 mock 实现同契约（src/data/mock/repositories/themes.ts），页面不知道用的是哪一套。
 * 三条约定：
 *   1) 后端返回的包装字段（{ items } / { theme }）在**这里**拆掉，页面拿到的永远是
 *      契约里的形状；
 *   2) 后端已经用 AppError 之外的形式表达「不存在」时（theme 缺字段），在这里转成
 *      NOT_FOUND，否则页面要把「404」与「空对象」两种情况都处理一遍；
 *   3) 不吞任何错误码：CONFLICT / LIMIT_EXCEEDED / FORBIDDEN 原样抛出，
 *      文案由后端给（「每个主题最多投稿 3 件作品」这类话必须与数据库一致）。
 */
import {
  AppError,
  ErrorCodes,
  type ThemeEntryPage,
  type ThemeInput,
  type ThemeListFilter,
  type ThemeRepository,
  type ThemeSelectResult,
  type ThemeSubmitResult,
  type ThemeWriteResult,
} from '@/data/contracts'
// 领域类型从 domain 取，契约只放仓储接口与请求/响应包装（与其它仓储实现一致）
import type { MyThemeEntry, ThemeDetail, ThemeEntry, ThemeSummary } from '@/domain/types'
import { qs, request } from './client'

const themePath = (slug: string) => `/api/themes/${encodeURIComponent(slug)}`

async function listThemes(status: ThemeListFilter): Promise<ThemeSummary[]> {
  const data = await request<{ items?: ThemeSummary[] }>(`/api/themes${qs({ status })}`)
  return data.items ?? []
}

export const apiThemeRepository: ThemeRepository = {
  list: listThemes,

  async get(slug: string): Promise<ThemeDetail> {
    const data = await request<{ theme?: ThemeDetail }>(themePath(slug))
    // 草稿主题对非编辑也是 404（后端不泄露存在性），所以这里统一说「不存在」
    if (!data.theme) throw new AppError(ErrorCodes.NOT_FOUND, '这个主题不存在或还没公开')
    return data.theme
  },

  async listEntries(slug: string, query): Promise<ThemeEntryPage> {
    const path = `${themePath(slug)}/entries${qs({
      limit: query?.limit,
      offset: query?.offset,
      selected: query?.selectedOnly ? 1 : undefined,
    })}`
    const data = await request<{ items?: ThemeEntry[]; total?: number; nextOffset?: number | null }>(path)
    return {
      items: data.items ?? [],
      total: data.total ?? data.items?.length ?? 0,
      nextOffset: data.nextOffset ?? null,
    }
  },

  async myEntries(slug: string): Promise<MyThemeEntry[]> {
    const data = await request<{ items?: MyThemeEntry[] }>(`/api/me/theme-entries${qs({ slug })}`)
    return data.items ?? []
  },

  async submitEntry(slug: string, photoId: string): Promise<ThemeSubmitResult> {
    return request<ThemeSubmitResult>(`${themePath(slug)}/entries`, {
      method: 'POST',
      body: { photoId },
    })
  },

  async withdrawEntry(slug: string, photoId: string): Promise<void> {
    await request<void>(`${themePath(slug)}/entries/${encodeURIComponent(photoId)}`, {
      method: 'DELETE',
    })
  },

  async createTheme(input: ThemeInput): Promise<ThemeWriteResult> {
    return request<ThemeWriteResult>('/api/admin/themes', { method: 'POST', body: input })
  },

  async updateTheme(id: string, patch: Partial<ThemeInput>): Promise<ThemeWriteResult> {
    return request<ThemeWriteResult>(`/api/admin/themes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
    })
  },

  async selectEntry(slug, photoId, input): Promise<ThemeSelectResult> {
    return request<ThemeSelectResult>(
      `/api/admin/themes/${encodeURIComponent(slug)}/entries/${encodeURIComponent(photoId)}/select`,
      { method: 'POST', body: input },
    )
  },

  async adminList(): Promise<ThemeSummary[]> {
    try {
      const data = await request<{ items?: ThemeSummary[] }>('/api/admin/themes')
      return data.items ?? []
    } catch (error) {
      // 后端还没实现这个只读端点（契约 §2 未定义，见 ThemeRepository.adminList 的注释）：
      // 退回三个公开档的合并。草稿这一档会缺，其余照常可管理，不会白屏。
      const missing =
        error instanceof AppError &&
        (error.code === ErrorCodes.NOT_FOUND || error.code === ErrorCodes.VALIDATION)
      if (!missing) throw error
      const [active, upcoming, past] = await Promise.all([
        listThemes('active'),
        listThemes('upcoming'),
        listThemes('past'),
      ])
      return [...active, ...upcoming, ...past]
    }
  },
}
