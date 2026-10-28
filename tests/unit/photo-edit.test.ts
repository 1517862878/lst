import { describe, expect, it } from 'vitest'
import { photoEditPatch, photoToEditValues, validatePhotoEdit } from '@/features/photos/photoEdit'
import type { Photo } from '@/domain/types'

const photo: Photo = {
  id: 'photo-1',
  authorId: 'user-1',
  title: '原始标题',
  description: '原始心得',
  categorySlug: 'landscape',
  tags: ['晨光', '山野'],
  locationName: '杭州',
  locationLat: null,
  locationLng: null,
  locationPrecision: 'city',
  shotAt: null,
  exif: null,
  imageKey: 'display.webp',
  thumbKey: 'thumb.webp',
  width: 1600,
  height: 900,
  blurhash: null,
  license: 'cc_by',
  credit: null,
  status: 'published',
  likeCount: 1,
  favoriteCount: 2,
  commentCount: 3,
  viewCount: 4,
  publishedAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  deletedAt: null,
}

describe('作品编辑表单', () => {
  it('把作品映射为可编辑字段', () => {
    expect(photoToEditValues(photo)).toEqual({
      title: '原始标题',
      description: '原始心得',
      categorySlug: 'landscape',
      tags: '晨光 山野',
      locationName: '杭州',
      license: 'cc_by',
    })
  })

  it('拒绝空标题、过多标签和过长地点', () => {
    const errors = validatePhotoEdit({
      title: '  ',
      description: '',
      categorySlug: 'landscape',
      tags: '一 二 三 四 五 六',
      locationName: '地'.repeat(81),
      license: 'cc0',
    })

    expect(errors.title).toBe('请填写标题')
    expect(errors.tags).toBe('标签最多 5 个')
    expect(errors.locationName).toBe('地点最多 80 字')
  })

  it('生成经过归一化且不包含状态字段的更新补丁', () => {
    expect(photoEditPatch({
      title: '  新标题  ',
      description: '  新心得  ',
      categorySlug: 'portrait',
      tags: '晨光, 人像 晨光',
      locationName: '  上海  ',
      license: 'cc_by_nc',
    })).toEqual({
      title: '新标题',
      description: '新心得',
      categorySlug: 'portrait',
      tags: ['晨光', '人像'],
      locationName: '上海',
      license: 'cc_by_nc',
    })
  })
})
