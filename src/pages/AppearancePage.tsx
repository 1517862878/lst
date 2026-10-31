/**
 * 外观设置页（/appearance）。
 *
 * 三项能力（对应 docs/视觉规格-背景系统与字体体系.md）：
 *   1. 内置主体（含「像素星空」= 现有主体，作为内置 #1）
 *   2. 四套经典配色 + 「自动（跟随明暗主题）」
 *   3. 背景：用户上传自己的照片（自动采样亮度 → 自动压暗/提亮，保证正文可读）
 *   4. 四款热门字体 + 字号调节（按像素体/非像素体给不同的可调范围）
 *
 * 为什么不放在 /settings：外观是「设备级」偏好（localStorage + IndexedDB），
 * 与账号无关，游客也应能改；/settings 全部页面都有 RequireAuth。
 */
import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router'
import { ImagePlus, Palette, RotateCcw, Trash2 } from 'lucide-react'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/useToast'
import {
  BG_PHOTO_LIMITS,
  FONTS,
  PALETTES,
  SUBJECTS,
  clampInt,
  fontOf,
  resolveAppearance,
  scrimPlan,
  textScaleFor,
  type FontId,
  type PaletteId,
  type SubjectId,
} from '@/domain/appearance'
import { fontSizeLevels, nearestLevelIndex } from '@/lib/appearanceFontSize'
import { useAppearanceSettings, useAppearanceStore } from '@/lib/appearanceStore'
import {
  deleteBackgroundPhoto,
  describeLuma,
  lumaSwatch,
  prepareBackgroundPhoto,
  saveBackgroundPhoto,
  useBackgroundPhotoUrl,
} from '@/lib/appearancePhoto'

export function AppearancePage() {
  const settings = useAppearanceSettings()
  const resolved = resolveAppearance(settings)
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')
  const { url: photoUrl, missing } = useBackgroundPhotoUrl(settings.photo?.key ?? null, resolved.photoActive)

  const store = useAppearanceStore

  const pickFile = () => {
    setLocalError('')
    fileRef.current?.click()
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // 同一个文件再次选择时不会触发 change，立刻清空 value 以允许重选
    event.target.value = ''
    if (!file) return

    setBusy(true)
    setLocalError('')
    try {
      const prepared = await prepareBackgroundPhoto(file)
      if (!prepared.ok) {
        setLocalError(prepared.reason)
        toast.show('error', prepared.reason)
        return
      }
      await saveBackgroundPhoto(prepared.photo.blob)
      const plan = scrimPlan(prepared.photo.luma, resolved.scheme)
      store.getState().setPhoto({
        key: BG_PHOTO_LIMITS.key,
        width: prepared.photo.width,
        height: prepared.photo.height,
        luma: prepared.photo.luma,
        scrim: plan.alphas[2] ?? 0.62,
        contrast: plan.worstContrast,
        // 默认轻模糊：用户照片通常是构图完整的作品，不该被默认糊掉
        blur: 2,
        // 默认按规格强度 1（保证 AA）；想更清楚地看到自己的照片可以往下调
        strength: 1,
        focusX: 50,
        focusY: 50,
        createdAt: new Date().toISOString(),
      })
      toast.show('success', '背景照片已应用（压暗强度已按照片亮度自动计算）')
    } catch (error) {
      const reason = error instanceof Error ? error.message : '照片处理失败'
      setLocalError(`照片保存失败：${reason}。可能是浏览器存储空间不足，请换一张更小的照片。`)
      toast.show('error', '照片保存失败，请换一张再试')
    } finally {
      setBusy(false)
    }
  }

  const removePhoto = async () => {
    setBusy(true)
    setLocalError('')
    try {
      await deleteBackgroundPhoto()
      store.getState().setPhoto(null)
      toast.show('info', '背景照片已移除，已回落到内置主体')
    } catch {
      // 二进制删不掉也要把元数据清掉，否则界面会一直显示「图片丢失」
      store.getState().setPhoto(null)
      toast.show('info', '背景照片已关闭')
    } finally {
      setBusy(false)
    }
  }

  const resetAll = () => {
    store.getState().reset()
    setLocalError('')
    toast.show('info', '外观已恢复默认')
  }

  const font = fontOf(settings.font)
  const levels = useMemo(() => fontSizeLevels(font.integerMultiple, font.range), [font])
  const levelIndex = nearestLevelIndex(levels, settings.baseFontSize)

  return (
    <Container size="lg">
      <PageHeader
        title="外观设置"
        description="背景主体、经典配色、自己的照片与字体字号。设置只保存在这台设备的浏览器里。"
      />

      <div className="g-appearance">
        {/* ── 1. 内置主体 ── */}
        <section className="g-appearance-section" aria-labelledby="appearance-subject-title">
          <h2 id="appearance-subject-title" className="g-appearance-legend">
            内置主体
          </h2>
          <p className="g-appearance-hint">
            「像素星空」就是现在全站用的主体，已作为内置主体 #1 保留。上传背景照片后主体会自动让位，
            避免星点叠在照片上形成双重噪点。
          </p>
          <div className="g-opt-grid">
            {SUBJECTS.map((item) => (
              <label key={item.id} className="g-opt-card">
                <input
                  className="g-opt-radio"
                  type="radio"
                  name="subject"
                  value={item.id}
                  checked={settings.subject === item.id}
                  onChange={() => store.getState().setSubject(item.id as SubjectId)}
                />
                <span className="g-opt-body">
                  <div className="g-subject-preview" data-subject={item.id} aria-hidden="true" />
                  <span className="g-opt-name">{item.name}</span>
                  <span className="g-opt-desc">{item.description}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* ── 2. 经典配色 ── */}
        <section className="g-appearance-section" aria-labelledby="appearance-palette-title">
          <h2 id="appearance-palette-title" className="g-appearance-legend">
            经典配色
          </h2>
          <p className="g-appearance-hint">
            四套配色均按 WCAG AA 校验（最差项 ≥4.79:1）。选「自动」则沿用现有的随明暗主题切换；
            选 P1–P4 会固定为那套色板，不再随系统深浅变化。
          </p>
          <div className="g-opt-grid">
            {PALETTES.map((item) => (
              <label key={item.id} className="g-opt-card">
                <input
                  className="g-opt-radio"
                  type="radio"
                  name="palette"
                  value={item.id}
                  checked={settings.palette === item.id}
                  onChange={() => store.getState().setPalette(item.id as PaletteId)}
                />
                <span className="g-opt-body">
                  <span className="g-swatch-row" aria-hidden="true">
                    <span className="g-swatch" style={{ color: item.preview.bg }} />
                    <span className="g-swatch" style={{ color: item.preview.surface }} />
                    <span className="g-swatch" style={{ color: item.preview.brand }} />
                    <span className="g-swatch" style={{ color: item.preview.accent }} />
                    <span
                      className="g-swatch-ink"
                      style={{ background: item.preview.ink, color: item.preview.bg }}
                    >
                      Aa
                    </span>
                  </span>
                  <span className="g-opt-name">
                    {item.name}
                    {item.scheme === 'light' && <span className="g-opt-code">浅底</span>}
                  </span>
                  <span className="g-opt-desc">{item.tagline}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* ── 3. 背景照片 ── */}
        <section className="g-appearance-section" aria-labelledby="appearance-photo-title">
          <h2 id="appearance-photo-title" className="g-appearance-legend">
            我的背景照片
          </h2>
          <p className="g-appearance-hint">
            支持 JPG / PNG / WebP，长边 ≥ {BG_PHOTO_LIMITS.minLongEdge}px。上传后会采样文字安全区的平均亮度，
            自动算出压暗强度，保证正文仍然可读，不需要你手动调。
          </p>

          <div className="g-photo-grid">
            <div className="g-photo-thumb">
              {photoUrl ? (
                <img src={photoUrl} alt="当前背景照片预览" decoding="async" />
              ) : (
                <div className="g-photo-thumb-empty">
                  {missing ? '照片文件已丢失（浏览器存储被清理），请重新上传' : '还没有背景照片'}
                </div>
              )}
            </div>

            <div className="g-photo-controls">
              {settings.photo ? (
                <>
                  <ul className="g-photo-meta">
                    <li>
                      尺寸 <b>{settings.photo.width}×{settings.photo.height}</b>
                    </li>
                    <li>
                      平均亮度 <b>{settings.photo.luma.toFixed(2)}</b>
                      <span
                        className="g-swatch"
                        style={{ color: lumaSwatch(settings.photo.luma), width: 14, height: 14, flex: '0 0 auto' }}
                        aria-hidden="true"
                      />
                      {describeLuma(settings.photo.luma)}
                    </li>
                    <li>
                      自动压暗 <b>{Math.round((resolved.scrim.alphas[2] ?? 0.62) * 100)}%</b>
                      {resolved.scrim.boost > 0 && <span>（已自动加档）</span>}
                    </li>
                    <li>
                      最坏情况对比度{' '}
                      <b
                        className={
                          resolved.scrim.worstContrast >= 4.5
                            ? 'g-photo-status-ok'
                            : resolved.scrim.worstContrast >= 3
                              ? 'g-photo-status-warn'
                              : 'g-photo-status-bad'
                        }
                      >
                        {resolved.scrim.worstContrast.toFixed(2)}:1
                      </b>
                    </li>
                  </ul>

                  {resolved.scrim.needsPanel && (
                    <p className="g-appearance-hint g-photo-status-warn" role="note">
                      这张照片在浅色配色下偏暗：按规格不再无上限提亮，文字会改用实色浅面板承字。
                      想让它作为背景更明显，可以换一张更亮的照片，或改用 P1/P3/P4 深色配色。
                    </p>
                  )}

                  <Slider
                    label="照片可见度"
                    value={Math.round(settings.photo.strength * 100)}
                    min={40}
                    max={140}
                    step={5}
                    suffix="%"
                    hint="100% 为按亮度自动计算的安全压暗；调低照片更清楚但正文对比度会下降，右侧数值会实时变化。"
                    onChange={(v) => store.getState().updatePhoto({ strength: v / 100 })}
                  />

                  {/* 主动把照片调亮会让正文掉出 AA：必须明说，不能只留一个数字 */}
                  {resolved.scrim.worstContrast < 4.5 && (
                    <p
                      className={`g-appearance-note ${
                        resolved.scrim.worstContrast >= 3 ? 'g-photo-status-warn' : 'g-photo-status-bad'
                      }`}
                      role="alert"
                    >
                      当前照片可见度过低，正文对比度只有 {resolved.scrim.worstContrast.toFixed(2)}:1
                      {resolved.scrim.worstContrast >= 3
                        ? '（低于无障碍 AA 要求的 4.5:1，长段正文会吃力）'
                        : '（已低于 3:1，正文基本读不清）'}
                      。把滑块往右拉回 100% 即可恢复到自动安全值。
                    </p>
                  )}

                  <Slider
                    label="氛围模糊"
                    value={settings.photo.blur}
                    min={0}
                    max={BG_PHOTO_LIMITS.maxBlur}
                    step={1}
                    suffix="px"
                    hint="0 = 完全清晰；8px 以上只剩色块氛围。移动端建议 ≤8px。"
                    onChange={(v) => store.getState().updatePhoto({ blur: v })}
                  />

                  <div className="g-photo-focus-grid">
                    <Slider
                      label="焦点横向"
                      value={settings.photo.focusX}
                      min={0}
                      max={100}
                      step={1}
                      suffix="%"
                      onChange={(v) => store.getState().updatePhoto({ focusX: v })}
                    />
                    <Slider
                      label="焦点纵向"
                      value={settings.photo.focusY}
                      min={0}
                      max={100}
                      step={1}
                      suffix="%"
                      onChange={(v) => store.getState().updatePhoto({ focusY: v })}
                    />
                  </div>

                  <label className="g-settings-check">
                    <input
                      type="checkbox"
                      checked={settings.photoEnabled}
                      onChange={(event) => store.getState().setPhotoEnabled(event.target.checked)}
                    />
                    <span>
                      <strong>启用这张照片作为背景</strong>
                      <small>关掉后回落到内置主体，照片本身不会被删除。</small>
                    </span>
                  </label>
                </>
              ) : (
                <p className="g-appearance-note">
                  上传一张你喜欢的照片，它会成为整站背景。照片只存在本机浏览器（IndexedDB），
                  不会上传到服务器，也不会进入你的作品集。
                </p>
              )}

              {localError && (
                <p className="g-auth-error" role="alert">
                  {localError}
                </p>
              )}

              <div className="g-appearance-actions">
                <Button
                  variant={settings.photo ? 'secondary' : 'primary'}
                  icon={<ImagePlus aria-hidden="true" />}
                  loading={busy}
                  onClick={pickFile}
                >
                  {settings.photo ? '更换照片' : '上传照片'}
                </Button>
                {settings.photo && (
                  <Button variant="danger" icon={<Trash2 aria-hidden="true" />} onClick={() => void removePhoto()}>
                    移除照片
                  </Button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="g-visually-hidden"
                  onChange={(event) => void onFile(event)}
                  tabIndex={-1}
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── 4. 字体与字号 ── */}
        <section className="g-appearance-section" aria-labelledby="appearance-font-title">
          <h2 id="appearance-font-title" className="g-appearance-legend">
            字体
          </h2>
          <p className="g-appearance-hint">
            四款方案全部使用 OFL-1.1 开源可商用字体。像素体只有 400 一档字重，标题靠字号与硬投影造层级；
            黑体/衬线会自动启用系统抗锯齿。
          </p>
          <div className="g-opt-grid">
            {FONTS.map((item) => (
              <label key={item.id} className="g-opt-card">
                <input
                  className="g-opt-radio"
                  type="radio"
                  name="font"
                  value={item.id}
                  checked={settings.font === item.id}
                  onChange={() => store.getState().setFont(item.id as FontId)}
                />
                <span className="g-opt-body">
                  <span className="g-font-sample" style={{ fontFamily: item.previewFamily }} aria-hidden="true">
                    工科影展 Aa 2026
                  </span>
                  <span className="g-opt-name">
                    {item.name}
                    <span className="g-opt-code">{item.code}</span>
                  </span>
                  <span className="g-opt-desc">{item.description}</span>
                </span>
              </label>
            ))}
          </div>

          <div style={{ marginTop: 'var(--g-space-5)' }}>
            <div className="g-slider-head">
              <span id="appearance-fontsize-label">正文字号</span>
              <span className="g-slider-value">
                {settings.baseFontSize}px（标题自动等比到 {textScaleFor(settings.baseFontSize)['2xl']}px）
              </span>
            </div>
            <div className="g-fontsize-row">
              <Button
                variant="secondary"
                size="sm"
                aria-label="减小正文字号"
                disabled={levelIndex <= 0}
                onClick={() => {
                  const next = levels[Math.max(0, levelIndex - 1)] ?? settings.baseFontSize
                  store.getState().setBaseFontSize(next)
                }}
              >
                A−
              </Button>
              <input
                type="range"
                aria-labelledby="appearance-fontsize-label"
                min={0}
                max={levels.length - 1}
                step={1}
                value={levelIndex}
                onChange={(event) => store.getState().setBaseFontSize(levels[Number(event.target.value)] ?? settings.baseFontSize)}
              />
              <Button
                variant="secondary"
                size="sm"
                aria-label="增大正文字号"
                disabled={levelIndex >= levels.length - 1}
                onClick={() => {
                  const next = levels[Math.min(levels.length - 1, levelIndex + 1)] ?? settings.baseFontSize
                  store.getState().setBaseFontSize(next)
                }}
              >
                A+
              </Button>
              <span className="g-fontsize-readout">{settings.baseFontSize}px</span>
            </div>
            <p className="g-appearance-note">
              可调范围 {font.range.min}–{font.range.max}px，共 {levels.length} 档。
              {font.integerMultiple
                ? '像素字体为保证字形锐利，只提供 12 / 14 / 16 / 24px 这几档整数倍或既有令牌值。'
                : '当前字体不受整数倍限制，可逐 1px 调节。'}
            </p>

            <div className="g-fontsize-preview" aria-live="polite">
              <p style={{ fontSize: `var(--g-text-lg)` }}>工科影展 · 把快门之外的部分也拍下来</p>
              <p style={{ fontSize: `var(--g-text-base)` }}>
                这是正文样本：上传你的照片、选择配色，然后看看这段字在背景上是否还清楚。
              </p>
              <p style={{ fontSize: `var(--g-text-xs)`, color: 'var(--g-ink-3)' }}>
                小字样本 · EXIF f/2.8 1/125s ISO 200
              </p>
            </div>
          </div>
        </section>

        <div className="g-appearance-actions">
          <Button variant="secondary" icon={<RotateCcw aria-hidden="true" />} onClick={resetAll}>
            恢复默认外观
          </Button>
        </div>

        <p className="g-appearance-note" role="note">
          <Palette aria-hidden="true" size={14} className="g-appearance-note-icon" />
          设置保存在本机（<code>gy:appearance</code> + IndexedDB 照片），不上传服务器。
          清理浏览器数据会一并清除，详见
          {/* 必须用 Link：HashRouter 下原生 <a href> 会跳出 SPA，落到 404 */}
          <Link to="/privacy">隐私政策</Link>。
        </p>
      </div>
    </Container>
  )
}

/* ─────────────────────────── 子组件 ─────────────────────────── */

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  hint?: string
  onChange: (value: number) => void
}

/** 受控滑杆：键盘可达（range 原生支持方向键），值同时以文本显示 */
function Slider({ label, value, min, max, step = 1, suffix = '', hint, onChange }: SliderProps) {
  const id = `slider-${label}`
  return (
    <div className="g-slider">
      <div className="g-slider-head">
        <label htmlFor={id}>{label}</label>
        <span className="g-slider-value">
          {value}
          {suffix}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(clampInt(Number(event.target.value), min, max))}
      />
      {hint && (
        <span id={`${id}-hint`} className="g-appearance-note">
          {hint}
        </span>
      )}
    </div>
  )
}

