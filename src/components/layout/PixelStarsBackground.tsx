/**
 * 像素星空背景组件。
 *
 * 来源：PR #1（zh060909-git / feature/ui-redesign）的 PixelStarsBackground.tsx，
 *       原始实现基于开源像素背景（MIT）。这里只取「星空 canvas」这一块，
 *       去掉 PR 同时带来的暗色高级风/鎏金配色/玻璃页头（与像素风冲突）。
 *
 * 与原实现的差异：
 *   1. 颜色不再硬编码 #d4af6a / #e8e6f0，改为读 CSS 变量
 *      （--g-stars-base / --g-stars-accent / --g-stars-head），跟随明暗主题
 *   2. 浅色主题下不渲染（读取 --g-stars-visible，0 则不启动动画循环）
 *   3. 主题切换时自动重建星场（监听 data-theme 变化）
 *   4. 页面隐藏时暂停 RAF（省电，切回标签页自动恢复）
 *
 * 性能：星点数量按面积 /9000 计算，1440×900 约 144 颗；全部 2px 方块绘制，
 *      单帧只有几百次 fillRect，开销可忽略。
 */
import { useEffect, useRef } from 'react'

interface Star {
  x: number
  y: number
  size: number
  phase: number
  speed: number
  base: number
  amp: number
  accent: boolean
}

interface Shooting {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
}

/** 读取当前主题下星空相关的 CSS 变量 */
function readStarTheme(el: HTMLElement) {
  const cs = getComputedStyle(el)
  return {
    visible: cs.getPropertyValue('--g-stars-visible').trim() !== '0',
    base: cs.getPropertyValue('--g-stars-base').trim() || '#e8e0d0',
    accent: cs.getPropertyValue('--g-stars-accent').trim() || '#e0603f',
    head: cs.getPropertyValue('--g-stars-head').trim() || '#fff8ec',
    bg: cs.getPropertyValue('--g-stars-bg').trim() || 'transparent',
  }
}

export function PixelStarsBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const canvasEl = canvasRef.current
    const wrapEl = wrapRef.current
    if (!canvasEl || !wrapEl) return
    const context = canvasEl.getContext('2d')
    if (!context) return

    const canvas: HTMLCanvasElement = canvasEl
    const ctx: CanvasRenderingContext2D = context
    const wrap: HTMLDivElement = wrapEl

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = 0
    let height = 0
    let stars: Star[] = []
    let shooting: Shooting[] = []
    let raf = 0
    let nextShotAt = 0
    let last = 0
    let theme = readStarTheme(wrap)
    let running = false

    const rand = (min: number, max: number) => min + Math.random() * (max - min)

    /** 星点按 2px 网格对齐，保持 8-bit 质感 */
    function seedStars() {
      const count = Math.round((width * height) / 9000)
      stars = Array.from({ length: count }, () => ({
        x: Math.floor(rand(0, width) / 2) * 2,
        y: Math.floor(rand(0, height) / 2) * 2,
        size: Math.random() < 0.85 ? 2 : 3,
        phase: rand(0, Math.PI * 2),
        speed: rand(0.6, 2.2),
        base: rand(0.25, 0.6),
        amp: rand(0.2, 0.4),
        // 12% 的星用强调色（砖红），其余用米白
        accent: Math.random() < 0.12,
      }))
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seedStars()
    }

    function spawnShooting() {
      const fromLeft = Math.random() < 0.5
      const speed = rand(0.5, 0.8)
      shooting.push({
        x: fromLeft ? rand(-40, width * 0.3) : rand(width * 0.5, width + 40),
        y: rand(-20, height * 0.35),
        vx: (fromLeft ? 1 : -1) * speed * rand(0.9, 1.3),
        vy: speed * rand(0.45, 0.7),
        life: 0,
        maxLife: rand(900, 1400),
      })
    }

    function drawStars(t: number) {
      for (const s of stars) {
        const a = Math.min(1, Math.max(0.05, s.base + s.amp * Math.sin(t * 0.001 * s.speed + s.phase)))
        ctx.globalAlpha = a
        ctx.fillStyle = s.accent ? theme.accent : theme.base
        ctx.fillRect(s.x, s.y, s.size, s.size)
      }
      ctx.globalAlpha = 1
    }

    /** 像素化流星：白色头部 + 强调色方形拖尾 */
    function drawShooting(dt: number) {
      shooting = shooting.filter(
        (m) => m.life < m.maxLife && m.x > -80 && m.x < width + 80 && m.y < height + 80,
      )
      for (const m of shooting) {
        m.life += dt
        m.x += m.vx * dt
        m.y += m.vy * dt
        const tail = 10
        for (let i = 0; i < tail; i++) {
          const px = Math.round((m.x - m.vx * i * 14) / 2) * 2
          const py = Math.round((m.y - m.vy * i * 14) / 2) * 2
          const fade = (1 - i / tail) * (1 - m.life / m.maxLife)
          ctx.globalAlpha = Math.max(0, fade * 0.9)
          ctx.fillStyle = i === 0 ? theme.head : theme.accent
          ctx.fillRect(px, py, 2, 2)
        }
      }
      ctx.globalAlpha = 1
    }

    function frame(t: number) {
      const dt = last ? Math.min(48, t - last) : 16
      last = t
      ctx.clearRect(0, 0, width, height)
      drawStars(t)
      if (t >= nextShotAt) {
        spawnShooting()
        nextShotAt = t + rand(3500, 7000)
      }
      drawShooting(dt)
      raf = window.requestAnimationFrame(frame)
    }

    /** 启动/停止动画循环（浅色主题、页面隐藏、减弱动效时停止） */
    function sync() {
      theme = readStarTheme(wrap)
      const shouldRun = theme.visible && !reduced && !document.hidden

      if (shouldRun && !running) {
        running = true
        resize()
        nextShotAt = performance.now() + 1200
        raf = window.requestAnimationFrame(frame)
      } else if (!shouldRun && running) {
        running = false
        window.cancelAnimationFrame(raf)
        ctx.clearRect(0, 0, width, height)
        // 减弱动效时仍画一帧静态星场
        if (theme.visible && reduced) {
          resize()
          drawStars(1000)
        }
      } else if (shouldRun && running) {
        // 主题色可能变了，重画一帧
        resize()
      }
    }

    sync()

    // 监听主题切换（html data-theme 变化）
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    const onResize = () => {
      if (running) {
        resize()
      }
    }
    const onVisibility = () => sync()

    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      window.cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div ref={wrapRef} className="g-pixel-stars" aria-hidden="true">
      <canvas ref={canvasRef} className="g-pixel-stars-canvas" />
    </div>
  )
}
