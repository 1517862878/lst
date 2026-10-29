/**
 * 某器材的作品流 /gear/:kind?label=…（8.4a ②）。
 *
 * kind 走路径（body/lens 两组固定），label 走 query：机身与镜头名里普遍带空格，
 * 放进路径段既难读也容易被浏览器/代理做二次转义。
 */
import { useParams, useSearchParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { PhotoFeed } from '@/features/photography/PhotoFeed'
import { GEAR_KIND_LABELS, isGearKind } from '@/domain/photography'
import { useGearPhotos } from '@/hooks/usePhotography'

export function GearDetailPage() {
  const { kind: rawKind } = useParams()
  const [searchParams] = useSearchParams()
  const label = (searchParams.get('label') ?? '').trim()
  const kind = rawKind !== undefined && isGearKind(rawKind) ? rawKind : 'body'
  const source = useGearPhotos(kind, label)


  if (rawKind === undefined || !isGearKind(rawKind)) {
    return (
      <Container>
        <PageHeader title="器材" breadcrumbs={[{ label: '器材', to: '/gear' }, { label: '未知分类' }]} />
        <EmptyState
          title="未知的器材分类"
          description="地址里的分类只能是 body（机身）或 lens（镜头）"
          actions={[{ label: '返回器材列表', to: '/gear' }]}
        />
      </Container>
    )
  }

  if (label === '') {
    return (
      <Container>
        <PageHeader title={GEAR_KIND_LABELS[kind]} breadcrumbs={[{ label: '器材', to: '/gear' }, { label: GEAR_KIND_LABELS[kind] }]} />
        <EmptyState
          title="没有指定器材"
          description="请从器材列表点选一台机身或一支镜头"
          actions={[{ label: '返回器材列表', to: '/gear' }]}
        />
      </Container>
    )
  }

  return (
    <Container>
      <PageHeader
        title={label}
        description={`${GEAR_KIND_LABELS[kind]} · 公开作品`}
        breadcrumbs={[
          { label: '器材', to: '/gear' },
          // 不带 label 的 /gear/:kind 只是空态兜底，不做成链接，免得面包屑指向死页
          { label: GEAR_KIND_LABELS[kind] },
          { label },
        ]}
      />
      <PhotoFeed source={source} emptyTitle={`还没有用这台${GEAR_KIND_LABELS[kind]}公开的作品`} showAuthor />
    </Container>
  )
}
