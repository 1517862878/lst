import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { Providers } from './app/providers'
import { router } from './app/router'
import { ensureSeeded } from './data/mock/seedInit'
import { initAppearance } from './lib/appearanceStore'
import './styles/index.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('找不到 #root 挂载点')

/**
 * 启动顺序：先灌种子，再渲染。
 *
 * 为什么必须 await：早先是 `void ensureSeeded()` 后立刻 render，
 * 结果首次访问时页面的数据查询跑在种子写入之前，查到 0 条 →
 * 首页精选/榜单/教程全空，刷新一次才有内容（真实 bug，由 E2E 发现）。
 *
 * 兜底策略：种子失败也不能白屏 —— 记错误后照常渲染，页面会显示空态。
 */
async function bootstrap(): Promise<void> {
  // 外观设置先于渲染应用（配色/字体/字号写到 <html>），避免首屏配色跳变
  initAppearance()

  try {
    await ensureSeeded()
  } catch (e) {
    console.error('[seed] 初始化失败，将以空数据启动', e)
  }

  createRoot(rootEl!).render(
    <StrictMode>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </StrictMode>,
  )
}

void bootstrap()
