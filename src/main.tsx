import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { Providers } from './app/providers'
import { router } from './app/router'
import { ensureSeeded } from './data/mock/seedInit'
import './styles/index.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('找不到 #root 挂载点')

// 首次访问灌入演示数据（幂等）；失败不阻塞渲染，页面会显示空态
void ensureSeeded().catch((e) => {
  console.error('[seed] 初始化失败', e)
})

createRoot(rootEl).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
)
