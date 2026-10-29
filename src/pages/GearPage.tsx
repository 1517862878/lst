/**
 * 器材总览 /gear（8.4a ②）。
 *
 * 机身、镜头两组分别列出，每组按作品数排序。数据全部由「公开作品的 EXIF」
 * 读时聚合得到（domain/photography.buildGearSummary），所以这里不维护任何
 * 器材字典：作者改了 EXIF，列表下次加载就变。
 */
import { useMemo } from 'react'
import { Link } from 'react-router'
import { Camera, Aperture } from 'lucide-react'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { GEAR_KINDS, GEAR_KIND_DESCRIPTIONS, GEAR_KIND_LABELS } from '@/domain/photography'
import type { GearKind, GearSummary } from '@/domain/photography'
import { useGearList } from '@/hooks/usePhotography'

const GROUP_ICONS = { body: Camera, lens: Aperture } as const

export function GearPage() {
  const { data, isLoading, error, refetch } = useGearList()

  const groups = useMemo(() => {
    const list = data ?? []
    const byKind: Record<GearKind, GearSummary[]> = { body: [], lens: [] }
    for (const item of list) byKind[item.kind].push(item)
    return byKind
  }, [data])

  return (
    <Container>
      <PageHeader
        title="器材"
        description="按机身与镜头浏览公开作品；器材名来自作者公开的拍摄参数"
        breadcrumbs={[{ label: '首页', to: '/' }, { label: '器材' }]}
      />

      {error ? (
        <ErrorState title="无法加载器材列表" error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          {GEAR_KINDS.map((kind) => {
            const Icon = GROUP_ICONS[kind]
            const items = groups[kind]
            return (
              <section key={kind} className="g-gear-section" aria-labelledby={`gear-${kind}-title`}>
                <div className="g-gear-section-head">
                  <h2 className="g-section-title" id={`gear-${kind}-title`}>
                    <Icon className="g-gear-section-icon" aria-hidden="true" />
                    {GEAR_KIND_LABELS[kind]}
                  </h2>
                  <p className="g-gear-section-desc">{GEAR_KIND_DESCRIPTIONS[kind]}</p>
                </div>

                {isLoading ? (
                  <div className="g-gear-grid" aria-hidden="true">
                    {Array.from({ length: 4 }, (_, i) => (
                      <Skeleton key={i} variant="rect" height={64} />
                    ))}
                  </div>
                ) : items.length === 0 ? (
                  <EmptyState
                    title={`还没有公开的${GEAR_KIND_LABELS[kind]}信息`}
                    description={
                      kind === 'body'
                        ? '作品的 EXIF 里带机身后，机身会自动出现在这里'
                        : '作品的 EXIF 里带镜头后，镜头会自动出现在这里（不是每台相机都会写入镜头型号）'
                    }
                    actions={[{ label: '去作品墙看看', to: '/gallery' }]}
                  />
                ) : (
                  <ul className="g-gear-grid">
                    {items.map((item) => (
                      <li key={item.label}>
                        {/* 器材名进 query 而不是路径段：机身名里有空格与斜杠（如 "NIKON Z 6_2"），路径段要额外转义一次 */}
                        <Link
                          className="g-gear-card"
                          to={`/gear/${kind}?label=${encodeURIComponent(item.label)}`}
                        >
                          <span className="g-gear-label">{item.label}</span>
                          <span className="g-gear-meta">
                            {item.photoCount} 件作品 · {item.authorCount} 位作者
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </>
      )}
    </Container>
  )
}
