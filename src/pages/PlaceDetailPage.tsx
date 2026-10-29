/**
 * 某地点的作品流 /places/:label（8.4a ③）。
 *
 * 隐私口径写在这里的要求里：页面只按「地点名」聚合，从不读取 locationLat/locationLng，
 * 也不给外链地图。精度说明取自该地作品自己的 location_precision，把作者的选择
 * 如实转述给访客（exact/district/city/hidden 四档文案在 domain/photography 里统一）。
 */
import { useParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { PhotoFeed } from '@/features/photography/PhotoFeed'
import { locationPrecisionNote } from '@/domain/photography'
import { usePlacePhotos } from '@/hooks/usePhotography'

export function PlaceDetailPage() {
  const { label: rawLabel } = useParams()
  // 路径参数由 react-router 解码；再 trim 一次，抵消「复制链接时多带的空格」
  const label = (rawLabel ?? '').trim()
  const source = usePlacePhotos(label)

  const first = source.data?.pages[0]?.items[0]
  const precisionNote = locationPrecisionNote(first?.locationPrecision ?? 'city')

  if (label === '') {
    return (
      <Container>
        <PageHeader title="地点" breadcrumbs={[{ label: '地点', to: '/places' }, { label: '未指定' }]} />
        <EmptyState
          title="没有指定地点"
          description="请从地点列表点选一个拍摄地点"
          actions={[{ label: '返回地点列表', to: '/places' }]}
        />
      </Container>
    )
  }

  return (
    <Container>
      <PageHeader
        title={label}
        description={`地点 · 公开作品`}
        breadcrumbs={[{ label: '地点', to: '/places' }, { label }]}
      />
      {/* aria-live 让精度说明随结果变化被读屏读出，而不是只做视觉提示 */}
      <p className="g-photography-note" aria-live="polite">
        {precisionNote}
      </p>
      <PhotoFeed source={source} emptyTitle={`还没有在「${label}」公开的作品`} showAuthor />
    </Container>
  )
}
