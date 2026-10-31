/**
 * 背景照片管线（规格 §3）。
 *
 * 职责边界：
 *  · 校验（类型/体积/长边/宽高比）—— 规格 §3.1 的「拒绝」行
 *  · 压缩（长边 2160，WebP q0.85）—— 控 IndexedDB 体积，避免几十 MB 原图塞浏览器
 *  · 采样文字安全区亮度 —— 规格 §3.4 算法第 1–2 步，供 scrimPlan() 查表
 *  · IndexedDB 存取（gy-appearance/photos/background）—— 二进制不进 localStorage
 *
 * 为什么不落服务器：本期是「个人外观偏好」，与账号无关；mock 与 api 两种数据源
 * 都要能工作，走本地存储最省事且不产生新的后端契约。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { BG_PHOTO_LIMITS, BACKGROUND_MIMES, rgbToHex } from '@/domain/appearance'
import { compressImage } from '@/lib/image/compress'
import { useEffect, useState } from 'react'

interface AppearanceSchema extends DBSchema {
  photos: { key: string; value: { key: string; blob: Blob; savedAt: string } }
}

let dbPromise: Promise<IDBPDatabase<AppearanceSchema>> | null = null

function getDb(): Promise<IDBPDatabase<AppearanceSchema>> {
  if (dbPromise) return dbPromise
  dbPromise = openDB<AppearanceSchema>(BG_PHOTO_LIMITS.dbName, 1, {
    upgrade(db) {
      db.createObjectStore(BG_PHOTO_LIMITS.storeName, { keyPath: 'key' })
    },
  })
  return dbPromise
}

/** 写入背景照片（覆盖旧图），主键固定，天然只留一张 */
export async function saveBackgroundPhoto(blob: Blob): Promise<void> {
  const db = await getDb()
  await db.put(BG_PHOTO_LIMITS.storeName, {
    key: BG_PHOTO_LIMITS.key,
    blob,
    savedAt: new Date().toISOString(),
  })
}

export async function loadBackgroundPhoto(): Promise<Blob | null> {
  const db = await getDb()
  const row = await db.get(BG_PHOTO_LIMITS.storeName, BG_PHOTO_LIMITS.key)
  return row?.blob ?? null
}

export async function deleteBackgroundPhoto(): Promise<void> {
  const db = await getDb()
  await db.delete(BG_PHOTO_LIMITS.storeName, BG_PHOTO_LIMITS.key)
}

/* ─────────────────────────── 校验 ─────────────────────────── */

export type ValidateResult = { ok: true } | { ok: false; reason: string }

/** 类型/体积的同步校验（不读像素，先挡掉明显不合规的文件） */
export function validateBackgroundFile(file: File): ValidateResult {
  const type = file.type.toLowerCase()
  const isAllowed =
    (BACKGROUND_MIMES as readonly string[]).includes(type) || /\.(jpe?g|png|webp)$/i.test(file.name)
  if (!isAllowed) return { ok: false, reason: '仅支持 JPG / PNG / WebP 图片' }
  if (file.size > BG_PHOTO_LIMITS.maxBytes) {
    return { ok: false, reason: `图片不能超过 ${Math.round(BG_PHOTO_LIMITS.maxBytes / 1024 / 1024)}MB` }
  }
  if (file.size === 0) return { ok: false, reason: '文件为空，请重新选择' }
  return { ok: true }
}

/** 像素级校验：长边太小会放大必糊，宽高比极端则 cover 裁切后只剩一条 */
export function validateDimensions(width: number, height: number): ValidateResult {
  const longEdge = Math.max(width, height)
  const shortEdge = Math.min(width, height)
  if (longEdge < BG_PHOTO_LIMITS.minLongEdge) {
    return { ok: false, reason: `长边至少 ${BG_PHOTO_LIMITS.minLongEdge}px（当前 ${longEdge}px），放大会糊` }
  }
  if (shortEdge > 0 && longEdge / shortEdge > BG_PHOTO_LIMITS.maxAspect) {
    return { ok: false, reason: `宽高比过于极端（${(longEdge / shortEdge).toFixed(1)}:1），请换接近 3:2 或 16:9 的照片` }
  }
  return { ok: true }
}

/* ─────────────────────────── 处理 ─────────────────────────── */

export interface PreparedPhoto {
  blob: Blob
  width: number
  height: number
  /** 文字安全区加权亮度 0–1 */
  luma: number
}

export type PrepareResult = { ok: true; photo: PreparedPhoto } | { ok: false; reason: string }

/**
 * 完整处理链路：校验 → 读尺寸 → 压缩 → 采样亮度。
 * 任何一步失败都返回中文原因，由页面用 toast 展示（不抛异常给 React）。
 */
export async function prepareBackgroundPhoto(file: File): Promise<PrepareResult> {
  const basic = validateBackgroundFile(file)
  if (!basic.ok) return basic

  let width = 0
  let height = 0
  try {
    const bitmap = await createImageBitmap(file)
    width = bitmap.width
    height = bitmap.height
    bitmap.close?.()
  } catch {
    return { ok: false, reason: '无法读取该图片，文件可能已损坏' }
  }

  const dims = validateDimensions(width, height)
  if (!dims.ok) return dims

  const compressed = await compressImage(file, {
    maxEdge: BG_PHOTO_LIMITS.targetLongEdge,
    quality: 0.85,
  })
  const luma = await sampleSafeAreaLuma(compressed.blob)

  return { ok: true, photo: { blob: compressed.blob, width: compressed.width, height: compressed.height, luma } }
}

/**
 * 采样「文字安全区」亮度（规格 §3.4 第 1–2 步）。
 *
 * 降采样到 32×32 后按竖直三分区加权：
 *   标题区 0–25%：0.5   正文区 25–75%：0.35   页脚区 75–100%：0.15
 * 权重来自各区文字量 —— 标题字号最大，所以最需要暗底。
 *
 * jsdom/无 canvas 环境返回 0.5（中性值），保证单测能跑通。
 */
export async function sampleSafeAreaLuma(blob: Blob): Promise<number> {
  try {
    const bitmap = await createImageBitmap(blob)
    const size = 32
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      bitmap.close?.()
      return 0.5
    }
    ctx.drawImage(bitmap, 0, 0, size, size)
    bitmap.close?.()
    const data = ctx.getImageData(0, 0, size, size).data

    let head = 0
    let body = 0
    let foot = 0
    let headN = 0
    let bodyN = 0
    let footN = 0
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4
        const l = pixelLuminance(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
        const ratio = y / size
        if (ratio < 0.25) {
          head += l
          headN++
        } else if (ratio < 0.75) {
          body += l
          bodyN++
        } else {
          foot += l
          footN++
        }
      }
    }
    const h = headN ? head / headN : 0
    const b = bodyN ? body / bodyN : 0
    const f = footN ? foot / footN : 0
    return Math.min(1, Math.max(0, h * 0.5 + b * 0.35 + f * 0.15))
  } catch {
    return 0.5
  }
}

function pixelLuminance(r: number, g: number, b: number): number {
  const f = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** 采样结果转成人话，给页面显示（「照片偏亮，自动压暗 0.68」） */
export function describeLuma(luma: number): string {
  if (luma >= 0.75) return '极亮（雪景/逆光天空级）'
  if (luma >= 0.55) return '偏亮'
  if (luma >= 0.4) return '中等'
  if (luma >= 0.25) return '偏暗'
  if (luma >= 0.12) return '很暗'
  return '极暗（夜景级）'
}

/** 供页面显示的十六进制「等效平均色」，纯诊断用 */
export function lumaSwatch(luma: number): string {
  const v = Math.round(Math.min(1, Math.max(0, luma)) ** (1 / 2.2) * 255)
  return rgbToHex(v, v, v)
}

/* ─────────────────────────── 读取 hook ─────────────────────────── */

export interface BackgroundPhotoUrl {
  /** 可直接放进 <img src> 的 object URL；未就绪/未启用时为 null */
  url: string | null
  /** 元数据说有照片，但 IndexedDB 里找不到（清过站点数据） */
  missing: boolean
}

/**
 * 读取背景照片 Blob 并转 object URL。
 * 依赖只看 key + 开关：调模糊/焦点不会重读二进制（走 CSS 变量）。
 */
export function useBackgroundPhotoUrl(photoKey: string | null, enabled: boolean): BackgroundPhotoUrl {
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (!photoKey || !enabled) {
      setUrl(null)
      setMissing(false)
      return
    }

    let cancelled = false
    let objectUrl: string | null = null

    loadBackgroundPhoto()
      .then((blob) => {
        if (cancelled) return
        if (!blob) {
          setMissing(true)
          return
        }
        objectUrl = URL.createObjectURL(blob)
        setMissing(false)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setMissing(true)
      })

    return () => {
      cancelled = true
      // 只回收本次创建的 URL：父级重渲染不会留下泄漏的 blob URL
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(null)
    }
  }, [photoKey, enabled])

  return { url, missing }
}

/* ─────────────────────────── 0037：账号级背景照片 ─────────────────────────── */

/**
 * 登录用户的背景照片同步。
 *
 * 三条约束：
 *  1. 游客不参与：没有登录态就完全走本机 IndexedDB（原路径不变）。
 *  2. 二进制仍走既有的「先传图、再登记键」两段式（与作品图片同构）。
 *  3. 读回来优先用服务器（换设备才有意义），服务器没有才回落到本机。
 *
 * 这里只放纯函数，不依赖 React；页面层负责调用时机。
 */
import type { AccountBackgroundMeta } from '@/data/api/account'

/** 账号级背景照片的对象键：一人一张，固定形状（与后端 BACKGROUND_KEY_RE 一致） */
export function accountBackgroundKey(userId: string): string {
  return `backgrounds/${userId.toLowerCase()}/background.webp`
}

/**
 * 把本机已处理好的照片同步到账号。
 * 返回登记后的对象键；调用方负责把元数据也写进本地 store。
 */
export async function syncBackgroundToAccount(params: {
  userId: string
  blob: Blob
  meta: AccountBackgroundMeta
  put: (key: string, blob: Blob) => Promise<void>
  setBackground: (key: string, meta: AccountBackgroundMeta) => Promise<unknown>
}): Promise<string> {
  const key = accountBackgroundKey(params.userId)
  await params.put(key, params.blob)
  await params.setBackground(key, params.meta)
  return key
}

/** 账号背景照片的访问地址（走 /images/ 静态服务，与头像同一条链路） */
export function accountBackgroundUrl(key: string | null | undefined): string | null {
  const value = key?.trim()
  if (!value) return null
  return value
}
