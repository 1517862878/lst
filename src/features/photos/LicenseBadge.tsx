import { LICENSE_DESCRIPTORS } from '@/domain/licenses'
import type { PhotoLicense } from '@/domain/types'

export function LicenseBadge({ license }: { license: PhotoLicense }) {
  const descriptor = LICENSE_DESCRIPTORS[license]
  const content = (
    <>
      <strong>{descriptor.shortLabel}</strong>
      <span>{descriptor.summary}</span>
    </>
  )

  return (
    <div className="g-license-card" aria-label={`作品许可：${descriptor.label}`}>
      {descriptor.url ? (
        <a href={descriptor.url} rel="license noopener noreferrer" target="_blank">
          {content}
          <span aria-hidden="true">↗</span>
        </a>
      ) : (
        <div>{content}</div>
      )}
    </div>
  )
}
