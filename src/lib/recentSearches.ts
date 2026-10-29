/**
 * 最近搜索（8.3a 搜索页增强）。
 *
 * 放在本地而不是服务端：最近搜索是「个人设备上的输入历史」，
 * 不需要跨设备同步，也没有必要为它多一个接口和一份隐私面。
 * 存储失败（隐私模式 / 配额满 / 手工禁用 localStorage）一律静默降级成空列表 ——
 * 搜索本身不能因为「记不住历史」而不可用。
 */
/**
 * 存储键（8.3c 起冻结为 `gy:recent-searches`）。
 *
 * 老版本用的是 `g.recent-searches`；换前缀是为了让「本机历史」和站内其它
 * localStorage 键（gy:session 等）统一在 gy: 命名空间下，清除站点数据时
 * 不会漏掉某一类。
 */
const STORAGE_KEY = 'gy:recent-searches'
/** 最多保留条数（冻结契约要求 10）：超过后丢最旧的 */
export const RECENT_SEARCH_MAX = 10
/** 单条关键词长度上限（与标签上限对齐，避免存进超长串） */
export const RECENT_SEARCH_TERM_MAX = 32

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

/** 关键词归一：折叠空白，去掉首尾空白 */
export function normalizeSearchTerm(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, RECENT_SEARCH_TERM_MAX)
}

export function readRecentSearches(): string[] {
  const store = storage()
  if (!store) return []
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map(normalizeSearchTerm)
      .filter(Boolean)
      .slice(0, RECENT_SEARCH_MAX)
  } catch {
    return []
  }
}

/** 记录一次搜索：去重（大小写不敏感）后置顶 */
export function pushRecentSearch(term: string): string[] {
  const value = normalizeSearchTerm(term)
  if (!value) return readRecentSearches()
  const key = value.toLocaleLowerCase()
  const next = [value, ...readRecentSearches().filter((item) => item.toLocaleLowerCase() !== key)].slice(
    0,
    RECENT_SEARCH_MAX,
  )
  const store = storage()
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 配额或权限问题：内存里的返回值仍然正确，只是不持久
  }
  return next
}

/**
 * 删除单条（8.3c）：按大小写不敏感匹配，删完立即落盘。
 *
 * 最近搜索是「我搜过什么」，用户误点/不想留痕时应该能只删一条，
 * 而不是只有「清空」这一种粗暴操作。
 */
export function removeRecentSearch(term: string): string[] {
  const key = normalizeSearchTerm(term).toLocaleLowerCase()
  const next = readRecentSearches().filter((item) => item.toLocaleLowerCase() !== key)
  const store = storage()
  try {
    if (next.length === 0) store?.removeItem(STORAGE_KEY)
    else store?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 忽略：删不掉也不该让页面报错
  }
  return next
}

export function clearRecentSearches(): string[] {
  try {
    storage()?.removeItem(STORAGE_KEY)
  } catch {
    // 忽略：清不掉也不该让页面报错
  }
  return []
}
