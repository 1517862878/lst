/**
 * 读取存储层图片 Blob 并转成可用的 object URL。
 *
 * 为什么需要它：
 *   静态期作品图片存在 IndexedDB（gy-assets 库）里，`imageKey` / `thumbKey` 是键，
 *   不是可直接放进 <img src> 的地址。必须取出 Blob 再用 URL.createObjectURL 生成临时地址。
 *
 * 生命周期（重要）：
 *   object URL 不随组件卸载自动释放，会让 Blob 一直占内存。
 *   所以用 useEffect 的清理函数在卸载/键变化时 revokeObjectURL。
 *
 * 加载策略：
 *   列表用 thumb（640px），详情用 display（2400px）。
 *   查不到时返回 null，由调用方回退到占位色块 —— 这样种子数据（没有真实文件）也能正常显示。
 */
import { useEffect, useState } from 'react'
import { createRepositories } from '@/data'

export interface UsePhotoImageResult {
  /** 可直接用于 <img src> 的地址；加载中或不存在时为 null */
  url: string | null
  loading: boolean
}

/**
 * @param key 图片在存储层的键（photo.thumbKey 或 photo.imageKey），空值表示不加载
 */
export function usePhotoImage(key: string | null | undefined): UsePhotoImageResult {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(Boolean(key))

  useEffect(() => {
    if (!key) {
      setUrl(null)
      setLoading(false)
      return
    }

    let cancelled = false
    let createdUrl: string | null = null

    setLoading(true)
    setUrl(null)

    // storage.get 在键不存在时抛 NOT_FOUND；这里视为"没有图片"，回退占位块
    createRepositories()
      .storage.get(key)
      .then((blob) => {
        if (cancelled) return
        createdUrl = URL.createObjectURL(blob)
        setUrl(createdUrl)
      })
      .catch(() => {
        if (cancelled) return
        setUrl(null)
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })

    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [key])

  return { url, loading }
}
