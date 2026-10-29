/**
 * 摄影专业化派生层（8.4a）：器材 / 地点 / 季节 / EXIF 隐私 / 主页代表作。
 *
 * 与 social.ts、tags.ts、discover.ts 同一策略：把「聚合口径、排序、可见性、
 * 掩码、顺序调整」这些真正的业务规则做成不依赖数据库/网络/React 的纯函数，
 * mock 仓储、页面与单测共用同一份。
 *
 * 口径（与 .tmp/phase84a-freeze.md 第 2、4 节逐条对应）：
 *   · 器材：机身 label = "Make Model"（Model 已含 Make 前缀时不重复拼接），
 *           镜头 label = LensModel；只统计在架且未隐藏拍摄参数的作品；
 *   · 地点：按 location_name 聚合，排除空名与 location_precision='hidden'；
 *   · 季节：按 shot_at 的月份划分（3–5 春 / 6–8 夏 / 9–11 秋 / 12–2 冬），
 *           没有 shot_at 时回落到发布时间（演示数据都有 shotAt，正常不会命中）；
 *   · EXIF 隐私：有效可见性 = 作品级 exifHidden 或 作者级 exif_visibility='hidden'；
 *   · 代表作：最多 3 件、本人、在架，顺序即展示顺序。
 *
 * 所有聚合结果**不返回作者 UUID**（延续公开接口不暴露 UUID 的约定）：
 * 只给计数，不给 authorId 列表。
 *
 * 无 React、无仓储、无副作用。
 */
import type {
  ExifVisibility,
  IsoDate,
  Photo,
  PinnedPhoto,
  Profile,
} from './types'
import { isPublicPhoto } from './discover'

/** 拍摄参数公开范围（profiles.exif_visibility 的两种取值） */
export type { ExifVisibility }

// ===== 分页与上限（与后端函数的默认值对齐）=====

/** 器材总览默认条数（api_list_gear p_limit default 30） */
export const GEAR_LIMIT = 30
export const GEAR_LIMIT_MAX = 60
/** 地点总览默认条数（api_list_places p_limit default 30） */
export const PLACE_LIMIT = 30
export const PLACE_LIMIT_MAX = 60
/** 器材 / 地点作品流默认页长（与 api_gear_photos / api_place_photos 对齐） */
export const PHOTOGRAPHY_PAGE_SIZE = 24
export const PHOTOGRAPHY_PAGE_SIZE_MAX = 50
/** 主页代表作上限（后端 api_set_pinned_photos 的 23514 约束） */
export const PINNED_MAX = 3

// ===== 器材 =====

export type GearKind = 'body' | 'lens'

export const GEAR_KINDS: readonly GearKind[] = ['body', 'lens']

export const GEAR_KIND_LABELS: Record<GearKind, string> = {
  body: '机身',
  lens: '镜头',
}

export const GEAR_KIND_DESCRIPTIONS: Record<GearKind, string> = {
  body: '按品牌与机型聚合，看看同一台机器拍出的不同视角',
  lens: '按镜头聚合，同一支镜头下的各类题材',
}

export function isGearKind(value: string | null | undefined): value is GearKind {
  return value === 'body' || value === 'lens'
}

export interface GearSummary {
  kind: GearKind
  /** 机身："Make Model"；镜头：LensModel */
  label: string
  photoCount: number
  authorCount: number
}

/** 从 EXIF 里读一个文本型字段（数字/空白一律视为缺失，避免出现 "undefined" 标签） */
function exifText(exif: Record<string, unknown> | null | undefined, key: string): string | null {
  const raw = exif?.[key]
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  return text ? text : null
}

/**
 * 器材标签（唯一口径）。
 *
 * 机身在相机写出的 EXIF 里常有两种形态：`Make=Canon, Model=EOS R5`，或
 * `Make=SONY, Model=SONY ILCE-7M4`。后者直接拼会得到 "SONY SONY ILCE-7M4"，
 * 所以 Model 已经以 Make 开头时就只留 Model。
 */
export function gearLabel(
  exif: Record<string, unknown> | null | undefined,
  kind: GearKind,
): string | null {
  if (kind === 'lens') return exifText(exif, 'LensModel')
  const model = exifText(exif, 'Model')
  if (!model) return null
  const make = exifText(exif, 'Make')
  if (!make) return model
  return model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`
}

/** 一件作品的两个器材标签（详情页把机型/镜头做成链接时用） */
export function photoGear(photo: Photo): { body: string | null; lens: string | null } {
  return { body: gearLabel(photo.exif, 'body'), lens: gearLabel(photo.exif, 'lens') }
}

/** 标签比较口径：去空白 + 大小写不敏感（"SONY A7 IV" 与 "sony a7 iv" 是同一台） */
export function normalizeGearLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ')
}

function gearKey(kind: GearKind, label: string): string {
  return `${kind}\u0000${normalizeGearLabel(label).toLocaleLowerCase()}`
}

/**
 * 器材总览：按（type, label）聚合。
 *
 * 传入的 photos 应已按 EXIF 隐私掩码过（隐藏了拍摄参数的作品 exif 为空，
 * 自然聚合不出器材）—— 与后端 api_list_gear 只统计未隐藏 EXIF 的作品同口径。
 */
export function buildGearSummary(
  photos: readonly Photo[],
  limit: number = GEAR_LIMIT,
): GearSummary[] {
  const stats = new Map<
    string,
    { kind: GearKind; label: string; photoCount: number; authors: Set<string> }
  >()

  for (const photo of photos) {
    if (!isPublicPhoto(photo)) continue
    for (const kind of GEAR_KINDS) {
      const raw = gearLabel(photo.exif, kind)
      if (!raw) continue
      const label = normalizeGearLabel(raw)
      const key = gearKey(kind, label)
      const entry = stats.get(key) ?? { kind, label, photoCount: 0, authors: new Set<string>() }
      entry.photoCount += 1
      entry.authors.add(photo.authorId)
      stats.set(key, entry)
    }
  }

  const size = clampLimit(limit, GEAR_LIMIT, GEAR_LIMIT_MAX)
  return [...stats.values()]
    .map<GearSummary>((entry) => ({
      kind: entry.kind,
      label: entry.label,
      photoCount: entry.photoCount,
      authorCount: entry.authors.size,
    }))
    .sort(
      (a, b) =>
        GEAR_KINDS.indexOf(a.kind) - GEAR_KINDS.indexOf(b.kind) ||
        b.photoCount - a.photoCount ||
        a.label.localeCompare(b.label),
    )
    .slice(0, size)
}

/** 某器材下的在架作品（按发布时间倒序，同时间用 id 兜底成全序，保证游标翻页不重不漏） */
export function gearPhotos(
  photos: readonly Photo[],
  kind: GearKind,
  label: string,
): Photo[] {
  const target = gearKey(kind, label)
  return photos
    .filter((photo) => isPublicPhoto(photo) && gearKey(kind, gearLabel(photo.exif, kind) ?? '') === target)
    .sort(
      (a, b) =>
        (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || b.id.localeCompare(a.id),
    )
}

// ===== 地点 =====

export interface PlaceSummary {
  label: string
  photoCount: number
  authorCount: number
  latestPublishedAt: IsoDate | null
}

/** 地点名归一：折叠空白（"上海·陆家嘴 " 与 "上海·陆家嘴" 是同一个地点） */
export function normalizePlaceLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ')
}

/**
 * 这件作品能否出现在地点聚合里。
 *
 * `location_precision='hidden'` 表示作者不想公开位置 —— 此时连地点名都不该
 * 进入聚合（否则「按地点浏览」等于把隐藏的位置又列了出来）。
 */
export function hasPublicPlace(photo: Photo): boolean {
  if (photo.locationPrecision === 'hidden') return false
  return normalizePlaceLabel(photo.locationName ?? '') !== ''
}

/** 地点总览：按地点名聚合（作品数 / 作者数 / 最近发布） */
export function buildPlaceSummary(
  photos: readonly Photo[],
  limit: number = PLACE_LIMIT,
): PlaceSummary[] {
  const stats = new Map<
    string,
    { label: string; photoCount: number; authors: Set<string>; latest: string | null }
  >()

  for (const photo of photos) {
    if (!isPublicPhoto(photo) || !hasPublicPlace(photo)) continue
    const label = normalizePlaceLabel(photo.locationName)
    const key = label.toLocaleLowerCase()
    const entry = stats.get(key) ?? { label, photoCount: 0, authors: new Set<string>(), latest: null }
    entry.photoCount += 1
    entry.authors.add(photo.authorId)
    const publishedAt = photo.publishedAt ?? ''
    if (publishedAt && (!entry.latest || publishedAt > entry.latest)) entry.latest = publishedAt
    stats.set(key, entry)
  }

  const size = clampLimit(limit, PLACE_LIMIT, PLACE_LIMIT_MAX)
  return [...stats.values()]
    .map<PlaceSummary>((entry) => ({
      label: entry.label,
      photoCount: entry.photoCount,
      authorCount: entry.authors.size,
      latestPublishedAt: entry.latest,
    }))
    .sort(
      (a, b) =>
        b.photoCount - a.photoCount ||
        (b.latestPublishedAt ?? '').localeCompare(a.latestPublishedAt ?? '') ||
        a.label.localeCompare(b.label),
    )
    .slice(0, size)
}

/** 某地点下的在架作品（倒序 + 全序，游标翻页稳定） */
export function placePhotos(photos: readonly Photo[], label: string): Photo[] {
  const target = normalizePlaceLabel(label).toLocaleLowerCase()
  return photos
    .filter(
      (photo) =>
        isPublicPhoto(photo) &&
        hasPublicPlace(photo) &&
        normalizePlaceLabel(photo.locationName).toLocaleLowerCase() === target,
    )
    .sort(
      (a, b) =>
        (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || b.id.localeCompare(a.id),
    )
}

/**
 * 地点展示文案。
 *
 * 精确坐标一律不落到界面：`exact` 也只说「精确到拍摄点，具体坐标不公开」，
 * 其余精度直接说明按什么粒度展示（与 location_precision 语义一致）。
 */
export function locationPrecisionNote(precision: Photo['locationPrecision']): string {
  switch (precision) {
    case 'exact':
      return '作者标注为拍摄点，具体坐标不对访客公开'
    case 'district':
      return '位置精确到区县，不含具体坐标'
    case 'city':
      return '位置精确到城市，不含具体坐标'
    case 'hidden':
    default:
      return '作者未公开拍摄位置'
  }
}

// ===== 季节 =====

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter']

export const SEASON_LABELS: Record<Season, string> = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬',
}

/** 季节 → 月份（3–5 春 / 6–8 夏 / 9–11 秋 / 12–2 冬） */
export const SEASON_MONTHS: Record<Season, readonly number[]> = {
  spring: [3, 4, 5],
  summer: [6, 7, 8],
  autumn: [9, 10, 11],
  winter: [12, 1, 2],
}

export interface SeasonSummary {
  season: Season
  photoCount: number
}

export function isSeason(value: string | null | undefined): value is Season {
  return typeof value === 'string' && (SEASONS as readonly string[]).includes(value)
}

/** 月（1–12）→ 季节；非法月份返回 null */
export function seasonOfMonth(month: number): Season | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (month >= 3 && month <= 5) return 'spring'
  if (month >= 6 && month <= 8) return 'summer'
  if (month >= 9 && month <= 11) return 'autumn'
  return 'winter'
}

/**
 * 时间 → 季节。用 UTC 解析：shot_at 以 ISO 字符串存储（后端 timestamptz），
 * 本地时区换算会让「12 月最后一天」在东西半球落到不同季节，这里统一按 UTC 月。
 */
export function seasonOfDate(iso: string | null | undefined): Season | null {
  if (!iso) return null
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return null
  return seasonOfMonth(new Date(time).getUTCMonth() + 1)
}

/** 作品季节：优先拍摄时间，缺失时回落到发布时间（演示数据都有 shotAt） */
export function photoSeason(photo: Photo): Season | null {
  return (
    seasonOfDate(photo.shotAt) ??
    seasonOfDate(photo.publishedAt) ??
    seasonOfDate(photo.createdAt)
  )
}

/** 按季节过滤在架作品（顺序保持传入顺序，调用方负责排序/分页） */
export function photosInSeason(photos: readonly Photo[], season: Season): Photo[] {
  return photos.filter((photo) => isPublicPhoto(photo) && photoSeason(photo) === season)
}

/** 季节计数：四个季节都给出来（0 也保留，chips 的槽位才不会跳动） */
export function buildSeasonSummary(photos: readonly Photo[]): SeasonSummary[] {
  const counts = new Map<Season, number>(SEASONS.map((season) => [season, 0]))
  for (const photo of photos) {
    if (!isPublicPhoto(photo)) continue
    const season = photoSeason(photo)
    if (!season) continue
    counts.set(season, (counts.get(season) ?? 0) + 1)
  }
  return SEASONS.map((season) => ({ season, photoCount: counts.get(season) ?? 0 }))
}

/** 季节 URL 名（chips 的 aria-label / 标题文案） */
export function seasonLabel(season: Season): string {
  return SEASON_LABELS[season]
}

// ===== EXIF 隐私 =====

export const EXIF_VISIBILITY_OPTIONS: ReadonlyArray<{
  value: ExifVisibility
  label: string
  description: string
}> = [
  {
    value: 'public',
    label: '公开拍摄参数',
    description: '作品详情页显示相机、镜头、光圈、快门等白名单参数，方便同好参考。',
  },
  {
    value: 'hidden',
    label: '隐藏拍摄参数',
    description: '作品详情页不显示相机、镜头、曝光参数，只提示「作者未公开拍摄参数」。',
  },
]

export function isExifVisibility(value: string): value is ExifVisibility {
  return value === 'public' || value === 'hidden'
}

/**
 * 有效可见性 = 作品级开关 OR 作者级默认。
 *
 * 作者级为 hidden 时逐张的 public 不起作用（账户级是「兜底关」），
 * 与后端 `exif_hidden or exif_visibility = 'hidden'` 一致。
 */
export function isExifHidden(
  photo: Pick<Photo, 'exifHidden'>,
  authorVisibility: ExifVisibility | null | undefined,
): boolean {
  return photo.exifHidden === true || authorVisibility === 'hidden'
}

/**
 * 按隐私口径重建作品载荷：隐藏时 `exif = {}` 且 `exifHidden = true`。
 *
 * 与后端投影一致：前端不再自己拼「要不要藏」，只读 exifHidden 决定渲染分支，
 * 于是「有 exif 但被隐藏」不会退化成一张空表格。
 */
export function withExifPrivacy(photo: Photo, authorVisibility: ExifVisibility | null | undefined): Photo {
  // 可见时**原样返回同一个对象**：mock 列表被大量既有用例按引用/深比较断言，
  // 这里多塞一个 exifHidden:false 会让「没改数据」的读取也变成一次对象改写。
  if (!isExifHidden(photo, authorVisibility)) return photo
  return { ...photo, exif: {}, exifHidden: true }
}

/** 批量掩码（mock 仓储读列表时用同一份口径） */
export function withExifPrivacyAll(
  photos: readonly Photo[],
  visibilityOfAuthor: (authorId: string) => ExifVisibility | null | undefined,
): Photo[] {
  return photos.map((photo) => withExifPrivacy(photo, visibilityOfAuthor(photo.authorId)))
}

/** 作者级默认（未设置时按公开处理，与列默认值 'public' 一致） */
export function exifVisibilityOf(profile: Pick<Profile, 'exifVisibility'> | null | undefined): ExifVisibility {
  return profile?.exifVisibility === 'hidden' ? 'hidden' : 'public'
}

// ===== 主页代表作 =====

export interface PinnedPhotosResult {
  pinnedPhotoIds: string[]
  pinned: PinnedPhoto[]
}

/** 去重 + 去空白，保持顺序（前端先夹一道，后端仍会再校验一次） */
export function normalizePinnedIds(ids: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids ?? []) {
    const value = String(id ?? '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
    if (out.length >= PINNED_MAX) break
  }
  return out
}

/** 加入 / 移出代表作；已满 3 件时返回 null（调用方据此提示，而不是静默丢弃） */
export function togglePinned(ids: readonly string[], photoId: string): string[] | null {
  const value = String(photoId ?? '').trim()
  if (!value) return [...ids]
  if (ids.includes(value)) return ids.filter((id) => id !== value)
  if (ids.length >= PINNED_MAX) return null
  return [...ids, value]
}

/**
 * 上移 / 下移一位。越界时原样返回（不交换到别人身上），
 * 这样按钮 disabled 与函数行为一致，键盘连点时不会出现意外重排。
 */
export function movePinned(ids: readonly string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return [...ids]
  const next = [...ids]
  const [moved] = next.splice(index, 1)
  if (moved === undefined) return [...ids]
  next.splice(target, 0, moved)
  return next
}

/** 从作品数组里取出代表作摘要（顺序跟随 ids；找不到的跳过，避免整块消失） */
export function pinnedPhotosFrom(ids: readonly string[], photos: readonly Photo[]): PinnedPhoto[] {
  const byId = new Map(photos.map((photo) => [photo.id, photo]))
  return ids.flatMap((id) => {
    const photo = byId.get(id)
    return photo ? [{ id: photo.id, title: photo.title, thumbKey: photo.thumbKey }] : []
  })
}

/**
 * 按代表作顺序重排作品（公开主页置顶展示用）。
 *
 * 只保留在架且确实出现在 ids 里的作品；其余作品由调用方接在后面。
 */
export function orderPinnedPhotos(ids: readonly string[], photos: readonly Photo[]): Photo[] {
  const byId = new Map(photos.map((photo) => [photo.id, photo]))
  return ids.flatMap((id) => {
    const photo = byId.get(id)
    return photo && isPublicPhoto(photo) ? [photo] : []
  })
}

/** 未置顶的作品（置顶区之后继续展示） */
export function photosWithoutIds(photos: readonly Photo[], ids: readonly string[]): Photo[] {
  const pinned = new Set(ids)
  return photos.filter((photo) => !pinned.has(photo.id))
}

// ===== 内部 =====

function clampLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), 1), max)
}
