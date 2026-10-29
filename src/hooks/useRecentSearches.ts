/**
 * 最近搜索的 React 适配层（8.3a）。
 * 数据在 src/lib/recentSearches.ts，这里只负责把结果变成可 re-render 的 state。
 */
import { useCallback, useState } from 'react'
import {
  clearRecentSearches,
  pushRecentSearch,
  readRecentSearches,
  removeRecentSearch,
} from '@/lib/recentSearches'

export function useRecentSearches() {
  // 惰性初始化：首帧就读本地存储，避免「先空一排再突然冒出来」
  const [items, setItems] = useState<string[]>(() => readRecentSearches())

  const push = useCallback((term: string) => {
    setItems(pushRecentSearch(term))
  }, [])

  const remove = useCallback((term: string) => {
    setItems(removeRecentSearch(term))
  }, [])

  const clear = useCallback(() => {
    setItems(clearRecentSearches())
  }, [])

  return { items, push, remove, clear }
}
