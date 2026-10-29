/**
 * /me 的「数据」区（8.3d）：九格数据卡 + 作品数据表。
 *
 * 与 mock/api 仓储测试的分工：那边验「数字算得对不对」，这里验「页面怎么呈现与降级」——
 * 千分位、tabular-nums、精选标记、窄屏不靠横向滚动、以及**统计失败不拖垮整页**。
 *
 * 只把最外层仓储换成假的，hooks（useStats / usePhotosByUser）都跑真的，
 * 于是断言能落到「这一块失败时其它区块还在」这种真实分支上。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatorStats, Photo, PhotoStats, Session } from '@/domain/types'
import { MePage } from '@/pages/MePage'

const mocks = vi.hoisted(() => ({
  session: { value: null as Session | null },
  creatorStats: vi.fn(),
  photoStats: vi.fn(),
  photoList: vi.fn(),
}))

vi.mock('@/data', () => ({
  createRepositories: () => ({
    stats: { creatorStats: mocks.creatorStats, photoStats: mocks.photoStats },
    photos: { list: mocks.photoList },
  }),
}))

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ data: mocks.session.value }),
}))

const session: Session = {
  userId: 'u-me',
  username: 'me',
  displayName: '我',
  avatarKey: null,
  role: 'user',
  expiresAt: '2099-01-01T00:00:00.000Z',
}

const stats: CreatorStats = {
  photoCount: 12,
  publishedCount: 9,
  draftCount: 3,
  likeTotal: 1204,
  favoriteTotal: 87,
  commentTotal: 45,
  viewTotal: 23456,
  followerCount: 31,
  followingCount: 8,
}

const publishedRow: PhotoStats = {
  photoId: 'p-1',
  title: '晨雾',
  status: 'published',
  publishedAt: '2026-03-01T00:00:00.000Z',
  likeCount: 12,
  favoriteCount: 3,
  commentCount: 4,
  viewCount: 250,
  featuredAt: null,
}

const featuredRow: PhotoStats = {
  photoId: 'p-2',
  title: '海岸线',
  status: 'published',
  publishedAt: '2026-02-01T00:00:00.000Z',
  likeCount: 1204,
  favoriteCount: 87,
  commentCount: 45,
  viewCount: 23456,
  featuredAt: '2026-02-05T00:00:00.000Z',
}

const draftRow: PhotoStats = {
  photoId: 'p-3',
  title: '未命名草稿',
  status: 'draft',
  publishedAt: null,
  likeCount: 0,
  favoriteCount: 0,
  commentCount: 0,
  viewCount: 0,
  featuredAt: null,
}

const photo = (id: string, authorId: string): Photo =>
  ({
    id,
    authorId,
    title: id,
    description: '',
    categorySlug: 'landscape',
    tags: [],
    locationName: '',
    locationLat: null,
    locationLng: null,
    locationPrecision: 'city',
    shotAt: null,
    exif: null,
    imageKey: '',
    thumbKey: '',
    width: 1,
    height: 1,
    blurhash: null,
    license: 'all_rights_reserved',
    credit: null,
    status: 'published',
    likeCount: 0,
    favoriteCount: 0,
    commentCount: 0,
    viewCount: 0,
    publishedAt: '2026-02-01T00:00:00.000Z',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    deletedAt: null,
  }) satisfies Photo

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/me']}>
        <MePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.session.value = session
  mocks.creatorStats.mockReset().mockResolvedValue(stats)
  mocks.photoStats.mockReset().mockResolvedValue([featuredRow, publishedRow, draftRow])
  mocks.photoList.mockReset().mockResolvedValue({
    items: [photo('p-1', 'u-me')],
    nextCursor: null,
  })
})

describe('/me 数据卡', () => {
  it('九项都在，数字走千分位', async () => {
    renderPage()
    const cards = await screen.findByRole('list', { name: '创作数据' })
    expect(within(cards).getAllByRole('listitem')).toHaveLength(9)

    expect(within(cards).getByText('作品')).toBeInTheDocument()
    expect(within(cards).getByText('在架')).toBeInTheDocument()
    expect(within(cards).getByText('草稿')).toBeInTheDocument()
    expect(within(cards).getByText('获赞')).toBeInTheDocument()
    expect(within(cards).getByText('收藏')).toBeInTheDocument()
    expect(within(cards).getByText('评论')).toBeInTheDocument()
    expect(within(cards).getByText('浏览')).toBeInTheDocument()
    expect(within(cards).getByText('粉丝')).toBeInTheDocument()
    expect(within(cards).getByText('关注')).toBeInTheDocument()

    // 千分位：1204 / 23456 必须带逗号，不能是裸数字（加载态先出骨架，等数字落位）
    expect(await within(cards).findByText('1,204')).toBeInTheDocument()
    expect(within(cards).getByText('23,456')).toBeInTheDocument()
    expect(within(cards).getByText('87')).toBeInTheDocument()
  })

  it('数字用 tabular-nums：位数不同的数字按位对齐', async () => {
    renderPage()
    const cards = await screen.findByRole('list', { name: '创作数据' })
    const value = await within(cards).findByText('23,456')
    expect(value).toHaveClass('g-me-stat-value')
    // 等宽数字由样式类保证；这里锁住类名，防止有人改成内联 style 后丢掉对齐
    expect(value.className).toContain('g-me-stat-value')
  })
})

describe('/me 作品数据表', () => {
  it('每件作品一行，列头与数字齐全', async () => {
    renderPage()
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(4) // 表头 + 3 行

    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual(['作品', '状态', '发布', '获赞', '收藏', '评论', '浏览'])

    expect(within(table).getByRole('link', { name: '晨雾' })).toHaveAttribute('href', '/works/p-1')
    expect(within(table).getByText('海岸线')).toBeInTheDocument()
    expect(within(table).getByText('未命名草稿')).toBeInTheDocument()
  })

  it('精选作品在标题旁打标记，没精选的不打', async () => {
    renderPage()
    const table = await screen.findByRole('table')
    const featuredRowEl = within(table).getByText('海岸线').closest('tr')
    const plainRowEl = within(table).getByText('晨雾').closest('tr')
    expect(featuredRowEl).not.toBeNull()
    expect(within(featuredRowEl as HTMLElement).getByText('精选')).toBeInTheDocument()
    expect(within(plainRowEl as HTMLElement).queryByText('精选')).toBeNull()
  })

  it('草稿没有发布时间，显示占位符而不是空单元格', async () => {
    renderPage()
    const table = await screen.findByRole('table')
    const draftRowEl = within(table).getByText('未命名草稿').closest('tr') as HTMLElement
    expect(within(draftRowEl).getByText('—')).toBeInTheDocument()
    expect(within(draftRowEl).getByText('草稿')).toBeInTheDocument()
  })

  it('窄屏靠「一条一卡」而不是横向滚动兜底', async () => {
    renderPage()
    // 每个数字单元格都带 data-label，≤560px 时 CSS 用它当键名换成竖排
    const table = await screen.findByRole('table')
    const numericCells = table.querySelectorAll('td[data-label="获赞"]')
    expect(numericCells.length).toBe(3)
    expect(numericCells[0]?.className).toContain('g-photo-stats-num')
  })
})

describe('/me 统计失败降级', () => {
  it('数据卡失败只降级自己：快捷入口与最近作品照常在', async () => {
    mocks.creatorStats.mockRejectedValue(new Error('boom'))
    renderPage()

    expect(await screen.findByText('数据暂不可用')).toBeInTheDocument()
    // 页面骨架没被拖垮
    expect(screen.getByText('发布作品')).toBeInTheDocument()
    expect(screen.getByText('设置与隐私')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '最近作品' })).toBeInTheDocument()
  })

  it('作品数据表失败与数据卡互不影响', async () => {
    mocks.photoStats.mockRejectedValue(new Error('boom'))
    renderPage()

    expect(await screen.findByText('作品数据暂不可用')).toBeInTheDocument()
    const cards = await screen.findByRole('list', { name: '创作数据' })
    expect(within(cards).getByText('1,204')).toBeInTheDocument()
  })

  it('两个统计接口全挂时，页面其它区块仍然可用', async () => {
    mocks.creatorStats.mockRejectedValue(new Error('boom'))
    mocks.photoStats.mockRejectedValue(new Error('boom'))
    renderPage()

    expect(await screen.findByText('数据暂不可用')).toBeInTheDocument()
    expect(await screen.findByText('作品数据暂不可用')).toBeInTheDocument()
    expect(screen.getByText('我的工作台')).toBeInTheDocument()
    expect(screen.getByText('查看个人主页')).toBeInTheDocument()
  })

  it('降级提示带一个能重试的按钮', async () => {
    mocks.creatorStats.mockRejectedValueOnce(new Error('boom'))
    renderPage()

    const retry = await screen.findByRole('button', { name: '重试' })
    // 第二次调用成功 → 点重试后数字应到位
    mocks.creatorStats.mockResolvedValue(stats)
    await userEvent.click(retry)
    const cards = await screen.findByRole('list', { name: '创作数据' })
    expect(within(cards).getByText('23,456')).toBeInTheDocument()
  })
})
