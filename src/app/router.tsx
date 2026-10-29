/// <reference types="vite/client" />

declare const __USE_HASH_ROUTER__: boolean

import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { createBrowserRouter, createHashRouter } from 'react-router'
import { Shell } from '@/components/layout/Shell'
import { HomePage } from '@/pages/HomePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { RouteErrorBoundary } from '@/pages/RouteErrorPage'
import { Skeleton } from '@/components/ui/Skeleton'

/**
 * 路由表（FRONTEND-WORK §1.3）。
 * S8：除首页与 404 外全部 lazy 分包，控制首屏 JS ≤ 200KB gzip（ROADMAP G-6）。
 */

interface PageModule {
  [key: string]: ComponentType
}

/** 懒加载命名导出页面：加载中显示骨架（避免白屏） */
function lazyNamed(loader: () => Promise<PageModule>, name: string): () => ReactNode {
  const C = lazy(async () => {
    const mod = await loader()
    const Comp = mod[name]
    if (!Comp) throw new Error(`模块缺少导出 ${name}`)
    return { default: Comp }
  })
  return function LazyPage() {
    return (
      <Suspense
        fallback={
          <div className="g-page-center" aria-hidden="true">
            <Skeleton variant="rect" height={240} />
          </div>
        }
      >
        <C />
      </Suspense>
    )
  }
}

const GalleryPage = lazyNamed(() => import('@/pages/GalleryPage'), 'GalleryPage')
const WorkDetailPage = lazyNamed(() => import('@/pages/WorkDetailPage'), 'WorkDetailPage')
const WorkEditPage = lazyNamed(() => import('@/pages/WorkEditPage'), 'WorkEditPage')
const CategoriesPage = lazyNamed(() => import('@/pages/CategoriesPage'), 'CategoriesPage')
const CategoryPage = lazyNamed(() => import('@/pages/CategoryPage'), 'CategoryPage')
const LoginPage = lazyNamed(() => import('@/pages/LoginPage'), 'LoginPage')
const RegisterPage = lazyNamed(() => import('@/pages/RegisterPage'), 'RegisterPage')
const PublishPage = lazyNamed(() => import('@/pages/PublishPage'), 'PublishPage')
const ProfilePage = lazyNamed(() => import('@/pages/ProfilePage'), 'ProfilePage')
const SettingsPage = lazyNamed(() => import('@/pages/SettingsPage'), 'SettingsPage')
const MePage = lazyNamed(() => import('@/pages/MePage'), 'MePage')
const MeModerationPage = lazyNamed(() => import('@/pages/MeModerationPage'), 'MeModerationPage')
const AdminPage = lazyNamed(() => import('@/pages/AdminPage'), 'AdminPage')
const SearchPage = lazyNamed(() => import('@/pages/SearchPage'), 'SearchPage')
const RankingPage = lazyNamed(() => import('@/pages/RankingPage'), 'RankingPage')
const LearnHomePage = lazyNamed(() => import('@/pages/LearnHomePage'), 'LearnHomePage')
const LearnTopicPage = lazyNamed(() => import('@/pages/LearnTopicPage'), 'LearnTopicPage')
const ArticlePage = lazyNamed(() => import('@/pages/ArticlePage'), 'ArticlePage')
const FeedPage = lazyNamed(() => import('@/pages/FeedPage'), 'FeedPage')
const NotificationsPage = lazyNamed(() => import('@/pages/NotificationsPage'), 'NotificationsPage')

// 法律页七合一打包（内容静态且相关，一次加载）
const AboutPage = lazyNamed(() => import('@/pages/LegalPages'), 'AboutPage')
const TermsPage = lazyNamed(() => import('@/pages/LegalPages'), 'TermsPage')
const PrivacyPage = lazyNamed(() => import('@/pages/LegalPages'), 'PrivacyPage')
const CopyrightPage = lazyNamed(() => import('@/pages/LegalPages'), 'CopyrightPage')
const DmcaPage = lazyNamed(() => import('@/pages/LegalPages'), 'DmcaPage')
const LicensesPage = lazyNamed(() => import('@/pages/LegalPages'), 'LicensesPage')
const CommunityPage = lazyNamed(() => import('@/pages/LegalPages'), 'CommunityPage')

/**
 * 路由表。
 *
 * basename 必须跟随 Vite 的 base：
 *   部署到 GitHub Pages 子路径（https://user.github.io/lst/）时，base = '/lst/'，
 *   浏览器地址是 /lst/gallery，而路由定义的是 gallery。
 *   不设 basename 的话，pathname 无法匹配任何路由，整站会落到 404 页
 *   （真实缺陷：本地开发 base='/' 时完全正常，部署后才暴露）。
 *
 * 归一化处理：Vite 的 base 末尾带斜杠（'/lst/'），basename 不能带尾斜杠，
 * 根路径时为空串（不是 '/'，否则 react-router 会拼成双斜杠）。
 */
const RAW_BASE = import.meta.env.BASE_URL ?? '/'
const BASENAME = RAW_BASE === '/' ? '' : RAW_BASE.replace(/\/+$/, '')

// GitHub Pages 不提供 SPA rewrite：直接刷新 /lst/login 会先返回 HTTP 404。
// 生产环境改用 hash 路由，让真实请求始终停在 /lst/，页面路径放在 # 后面；
// 本地开发仍保留干净路径，现有开发体验与主链路测试不受影响。
// 注意：HashRouter 的 hash 后路径从根开始，不应再传 /lst basename；否则 `/` 会被判定
// 为“不在 basename 内”而整站空白。BrowserRouter 才需要用 basename 剥离部署前缀。
const IS_HASH_ROUTER = __USE_HASH_ROUTER__
const createRouter = IS_HASH_ROUTER ? createHashRouter : createBrowserRouter

export const router = createRouter(
  [
    {
      path: '/',
      element: <Shell />,
      // 根路由错误边界：懒加载 chunk 拉取失败/渲染抛错时显示 RouteErrorPage，而不是整站白屏
      errorElement: <RouteErrorBoundary />,
      children: [
        { index: true, element: <HomePage /> },
        { path: 'gallery', element: <GalleryPage /> },
        { path: 'works/:id', element: <WorkDetailPage /> },
        { path: 'works/:id/edit', element: <WorkEditPage /> },
        { path: 'categories', element: <CategoriesPage /> },
        { path: 'categories/:slug', element: <CategoryPage /> },
        { path: 'login', element: <LoginPage /> },
        { path: 'register', element: <RegisterPage /> },
        { path: 'publish', element: <PublishPage /> },
        { path: 'u/:username', element: <ProfilePage /> },
        { path: 'settings', element: <SettingsPage /> },
        { path: 'settings/:section', element: <SettingsPage /> },
        { path: 'me', element: <MePage /> },
        { path: 'me/moderation', element: <MeModerationPage /> },
        { path: 'admin', element: <AdminPage /> },
        { path: 'feed', element: <FeedPage /> },
        { path: 'notifications', element: <NotificationsPage /> },
        { path: 'search', element: <SearchPage /> },
        { path: 'rankings/weekly', element: <RankingPage /> },
        { path: 'rankings/weekly/:isoWeek', element: <RankingPage /> },
        { path: 'learn', element: <LearnHomePage /> },
        { path: 'learn/topics/:topic', element: <LearnTopicPage /> },
        { path: 'learn/:slug', element: <ArticlePage /> },
        { path: 'about', element: <AboutPage /> },
        { path: 'terms', element: <TermsPage /> },
        { path: 'privacy', element: <PrivacyPage /> },
        { path: 'copyright', element: <CopyrightPage /> },
        { path: 'dmca', element: <DmcaPage /> },
        { path: 'licenses', element: <LicensesPage /> },
        { path: 'community', element: <CommunityPage /> },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ],
  IS_HASH_ROUTER ? undefined : { basename: BASENAME },
)
