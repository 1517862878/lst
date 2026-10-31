/**
 * 全站背景层（内置主体 / 四套配色底 / 用户照片）。
 *
 * 层次（自下而上，与规格 §1.7 的 z-index 栈一致）：
 *   -4  .g-bg-base      配色底（纯色 + 极淡渐变）
 *   -3  .g-bg-subject   内置主体（网格/网点/扫描线，CSS 绘制）
 *    0  .g-pixel-stars  像素星空（canvas，当前主体，保留原有层级）
 *   -2  .g-bg-photo     用户照片 + 压暗/提亮渐变 + 纹理
 *   -1  .g-bg-grid      8px 网格（永远独立的固定层）
 *
 * 为什么照片生效时主体「让位」：两者都是大面积底纹，叠在一起会把照片压成噪点。
 * 用户关掉照片开关就自动回落（photoEnabled=false），照片元数据不会丢。
 */
import { GRADIENT_ANCHOR_STOPS, resolveAppearance } from '@/domain/appearance'
import { useAppearanceSettings } from '@/lib/appearanceStore'
import { useBackgroundPhotoUrl } from '@/lib/appearancePhoto'
import { PixelStarsBackground } from './PixelStarsBackground'

export function SiteBackground() {
  const settings = useAppearanceSettings()
  const resolved = resolveAppearance(settings)
  const { url } = useBackgroundPhotoUrl(settings.photo?.key ?? null, resolved.photoActive)

  const scrim = resolved.scrim
  // 渐变由数据驱动（亮度采样 → 自动加档），只能内联，不能写死在 CSS 里
  const gradient = `linear-gradient(180deg, ${scrim.alphas
    .map((a, i) => `${withAlpha(scrim.color, a)} ${GRADIENT_ANCHOR_STOPS[i]}%`)
    .join(', ')})`

  return (
    <>
      <div className="g-bg-base" aria-hidden="true" />

      {resolved.effectiveSubject === 'px-stars' && <PixelStarsBackground />}

      {resolved.effectiveSubject !== 'px-stars' && resolved.effectiveSubject !== 'px-none' && (
        <div className={`g-bg-subject g-bg-subject-${resolved.effectiveSubject}`} aria-hidden="true" />
      )}

      {resolved.photoActive && (
        <div className="g-bg-photo" aria-hidden="true">
          {url && <img className="g-bg-photo-img" src={url} alt="" decoding="async" />}
          <div className="g-bg-photo-scrim" style={{ background: gradient }} />
          <div className="g-bg-photo-texture" />
          {/* 高对比偏好/兜底加档：CSS 控制透明度，不重复计算 */}
          <div className="g-bg-photo-boost" />
        </div>
      )}

      {/* 网格永远是独立层：原先它挂在 body 的 background-image 上，
          新增的配色底（不透明，z-index -4）会把它整片盖掉（实测回归），
          所以按规格 §1.7 提为固定层，再用 html[data-bg-photo] 调淡避免弄脏照片。 */}
      <div className="g-bg-grid" aria-hidden="true" />
    </>
  )
}

/** #RRGGBB + alpha → rgba()，避免 CSS 颜色函数在不同浏览器上的解析差异 */
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = Number.parseInt(full.slice(0, 6), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`
}
