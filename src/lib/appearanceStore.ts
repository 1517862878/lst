/**
 * 外观偏好 store（配色 / 主体 / 字体 / 字号 / 背景照片）。
 *
 * 为什么用 zustand + localStorage 而不是 Context：
 *  1. 背景层（Shell 里的固定层）与设置页相隔多层，Context 会造成整树重渲染；
 *  2. 需要在首屏之前就把值写进 <html>（见 index.html 的预涂脚本），
 *     单一 key 的 JSON 比 Context 树更容易在 React 之外读取。
 *
 * 隐私：图片二进制不进 localStorage，存 IndexedDB（见 appearancePhoto.ts）；
 * localStorage 只有 `gy:appearance`，且已在隐私政策页登记（LegalPages.tsx）。
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  DEFAULT_APPEARANCE,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  clampInt,
  fontOf,
  normalizeAppearance,
  resolveAppearance,
  textScaleFor,
  type AppearanceSettings,
  type BackgroundPhoto,
  type FontId,
  type PaletteId,
  type SubjectId,
} from '@/domain/appearance'

/** localStorage 键名（隐私政策页与 index.html 预涂脚本必须与此一致） */
export const APPEARANCE_STORAGE_KEY = 'gy:appearance'

export interface AppearanceActions {
  setPalette: (palette: PaletteId) => void
  setSubject: (subject: SubjectId) => void
  setFont: (font: FontId) => void
  setBaseFontSize: (size: number) => void
  /** 字号步进（A- / A+ 按钮），按 1px 逼近并夹在范围内 */
  nudgeBaseFontSize: (delta: number) => void
  setPhoto: (photo: BackgroundPhoto | null) => void
  updatePhoto: (patch: Partial<BackgroundPhoto>) => void
  setPhotoEnabled: (enabled: boolean) => void
  reset: () => void
}

export type AppearanceStore = AppearanceSettings & AppearanceActions

export const useAppearanceStore = create<AppearanceStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_APPEARANCE,

      setPalette: (palette) => set({ palette }),
      setSubject: (subject) => set({ subject }),
      // 换字体要同步夹紧字号：从像素体(24px)切到无衬线(17px 上限)时，
      // 不夹紧就会留下一个超出该字体区间的字号，滑杆也定位不到档位
      setFont: (font) => set((s) => ({ font, baseFontSize: clampFontSize(s.baseFontSize, font) })),
      // 字号夹紧用「当前字体」自己的区间：像素体不能选 17px，黑体不必被锁到整数倍
      setBaseFontSize: (size) => set({ baseFontSize: clampFontSize(size, get().font) }),
      nudgeBaseFontSize: (delta) =>
        set((s) => ({ baseFontSize: clampFontSize(s.baseFontSize + delta, s.font) })),
      setPhoto: (photo) => set({ photo, photoEnabled: photo ? true : false }),
      updatePhoto: (patch) => set((s) => (s.photo ? { photo: { ...s.photo, ...patch } } : {})),
      setPhotoEnabled: (photoEnabled) => set((s) => (s.photo ? { photoEnabled } : {})),
      reset: () => set({ ...DEFAULT_APPEARANCE }),
    }),
    {
      name: APPEARANCE_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // 只持久化数据字段，动作函数不落盘
      partialize: (s): AppearanceSettings => ({
        palette: s.palette,
        subject: s.subject,
        font: s.font,
        baseFontSize: s.baseFontSize,
        photo: s.photo,
        photoEnabled: s.photoEnabled,
      }),
      // 读到的可能是旧版本/被手改过的 JSON，逐项归一化，坏字段回落默认
      merge: (persisted, current) => ({ ...current, ...normalizeAppearance(persisted) }),
    },
  ),
)

/**
 * 选择器：只取设置部分，用于背景层（避免动作变更引起重渲染）。
 * 逐字段订阅而不是返回新对象 —— zustand v5 的 selector 结果会进
 * useSyncExternalStore 的快照比较，每次新建对象会被判定为「一直在变」。
 */
export function useAppearanceSettings(): AppearanceSettings {
  const palette = useAppearanceStore((s) => s.palette)
  const subject = useAppearanceStore((s) => s.subject)
  const font = useAppearanceStore((s) => s.font)
  const baseFontSize = useAppearanceStore((s) => s.baseFontSize)
  const photo = useAppearanceStore((s) => s.photo)
  const photoEnabled = useAppearanceStore((s) => s.photoEnabled)
  return { palette, subject, font, baseFontSize, photo, photoEnabled }
}

/**
 * 把设置写到 <html>：
 *  · data-palette / data-font / data-subject 供 appearance.css 的令牌覆盖选择；
 *  · --g-text-* 覆盖 tokens.css 的字阶（内联样式优先级高于 :root 声明）。
 */
export function applyAppearance(settings: AppearanceSettings): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement

  if (settings.palette === 'auto') delete root.dataset.palette
  else root.dataset.palette = settings.palette

  root.dataset.font = settings.font

  const resolved = resolveAppearance(settings)
  root.dataset.subject = resolved.effectiveSubject
  root.dataset.bgPhoto = resolved.photoActive ? 'on' : 'off'

  const scale = textScaleFor(settings.baseFontSize)
  root.style.setProperty('--g-text-xs', `${scale.xs}px`)
  root.style.setProperty('--g-text-sm', `${scale.sm}px`)
  root.style.setProperty('--g-text-base', `${scale.base}px`)
  root.style.setProperty('--g-text-lg', `${scale.lg}px`)
  root.style.setProperty('--g-text-xl', `${scale.xl}px`)
  root.style.setProperty('--g-text-2xl', `${scale['2xl']}px`)

  if (resolved.photoActive && settings.photo) {
    root.style.setProperty('--bg-photo-blur', `${settings.photo.blur}px`)

    root.style.setProperty('--bg-photo-focus-x', `${settings.photo.focusX}%`)
    root.style.setProperty('--bg-photo-focus-y', `${settings.photo.focusY}%`)
  } else {
    root.style.removeProperty('--bg-photo-blur')
    root.style.removeProperty('--bg-photo-focus-x')
    root.style.removeProperty('--bg-photo-focus-y')
  }
}

let wired = false

/**
 * 启动接线：立刻涂一次 + 订阅后续变化。
 * 必须在首屏渲染前调用（main.tsx），否则会出现「先默认配色再跳变」。
 */
export function initAppearance(): void {
  if (typeof document === 'undefined' || wired) return
  wired = true
  applyAppearance(useAppearanceStore.getState())
  useAppearanceStore.subscribe((state) => {
    applyAppearance({
      palette: state.palette,
      subject: state.subject,
      font: state.font,
      baseFontSize: state.baseFontSize,
      photo: state.photo,
      photoEnabled: state.photoEnabled,
    })
  })
}

/** 字号夹紧：字体区间 ∪ 全局硬边界 */
function clampFontSize(size: number, font: FontId): number {
  const range = fontOf(font).range
  const lo = Math.max(range.min, FONT_SIZE_MIN)
  const hi = Math.min(range.max, FONT_SIZE_MAX)
  return clampInt(size, lo, hi)
}
