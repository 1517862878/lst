/**
 * 像素星空背景（来源：像素背景.txt · Background Pixel Stars，MIT）。
 * 全屏 fixed canvas：复古像素闪烁星 + 周期性像素化流星。
 * - 铺满整个网页屏幕（fixed inset-0，滚动时保持铺满）
 * - 浅色主题下由 CSS 隐藏（见 layout.css）
 * - prefers-reduced-motion 时只绘制静态星场，不跑动画循环
 */
import { useEffect, useRef } from 'react'

/** 组件规格中的 10px 像素网格贴图（编译产物提取） */
const PIXEL_GRID =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIElEQVR42mIUEhJiwAbevXuHVZyJgUQ0qmEUDB0AEGAADd8DEPTX6ksAAAAASUVORK5CYII="

interface Star {
  x: number
  y: number
  size: number
  phase: number
  speed: number
  base: number
  amp: number
  gold: boolean
}

interface Shooting {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
}

export function PixelStarsBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    const context = canvasEl.getContext('2d')
    if (!context) return
    // 函数声明会提升，闭包内不保留窄化；用带类型的常量固定下来
    const canvas: HTMLCanvasElement = canvasEl
    const ctx: CanvasRenderingContext2D = context

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let width = 0
    let height = 0
    let stars: Star[] = []
    let shooting: Shooting[] = []
    let raf = 0
    let nextShotAt = 0
    let last = 0

    const rand = (min: number, max: number) => min + Math.random() * (max - min)

    /** 星点按 2px 像素网格对齐，保持 8-bit 质感 */
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
        gold: Math.random() < 0.12,
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
        ctx.fillStyle = s.gold ? '#d4af6a' : '#e8e6f0'
        ctx.fillRect(s.x, s.y, s.size, s.size)
      }
      ctx.globalAlpha = 1
    }

    /** 像素化流星：头部亮点 + 方形像素拖尾 */
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
          ctx.fillStyle = i === 0 ? '#ffffff' : '#d4af6a'
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

    resize()
    window.addEventListener('resize', resize)

    if (reduced) {
      // 减弱动效：只画一帧静态星场
      ctx.clearRect(0, 0, width, height)
      drawStars(1000)
    } else {
      nextShotAt = performance.now() + 1200
      raf = window.requestAnimationFrame(frame)
    }

    return () => {
      window.removeEventListener('resize', resize)
      window.cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div
      className="g-pixel-stars"
      style={{ '--g-pixel-grid': `url("${PIXEL_GRID}")` } as React.CSSProperties}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="g-pixel-stars-canvas" />
    </div>
  )
}
