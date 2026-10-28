import type { PhotoPatch } from '@/data/contracts'
import { CATEGORIES } from '@/domain/constants'
import { LICENSE_DESCRIPTORS } from '@/domain/licenses'
import type { Photo, PhotoLicense } from '@/domain/types'
import { parseTags } from '@/lib/search/normalize'

export interface PhotoEditValues {
  title: string
  description: string
  categorySlug: string
  tags: string
  locationName: string
  license: PhotoLicense
}

export type PhotoEditErrors = Partial<Record<keyof PhotoEditValues, string>>

export const PHOTO_LICENSE_OPTIONS = (Object.entries(LICENSE_DESCRIPTORS) as Array<
  [PhotoLicense, (typeof LICENSE_DESCRIPTORS)[PhotoLicense]]
>).map(([value, descriptor]) => ({ value, label: descriptor.label }))

export function photoToEditValues(photo: Photo): PhotoEditValues {
  return {
    title: photo.title,
    description: photo.description,
    categorySlug: photo.categorySlug,
    tags: photo.tags.join(' '),
    locationName: photo.locationName,
    license: photo.license,
  }
}

function rawTags(value: string): string[] {
  return [...new Set(value.split(/[\s,，]+/u).map((tag) => tag.trim()).filter(Boolean))]
}

export function validatePhotoEdit(values: PhotoEditValues): PhotoEditErrors {
  const errors: PhotoEditErrors = {}
  const title = values.title.trim()
  const tags = rawTags(values.tags)

  if (!title) errors.title = '请填写标题'
  else if (title.length > 60) errors.title = '标题最多 60 字'
  if (values.description.length > 2000) errors.description = '心得最多 2000 字'
  if (!CATEGORIES.some((category) => category.slug === values.categorySlug)) {
    errors.categorySlug = '请选择有效分类'
  }
  if (tags.length > 5) errors.tags = '标签最多 5 个'
  else if (tags.some((tag) => tag.length < 2 || tag.length > 20)) errors.tags = '每个标签需为 2–20 字'
  if (values.locationName.length > 80) errors.locationName = '地点最多 80 字'
  if (!(values.license in LICENSE_DESCRIPTORS)) errors.license = '请选择有效许可'

  return errors
}

export function photoEditPatch(values: PhotoEditValues): PhotoPatch {
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    categorySlug: values.categorySlug,
    tags: parseTags(values.tags),
    locationName: values.locationName.trim(),
    license: values.license,
  }
}
