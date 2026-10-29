/**
 * 摄影专业化领域函数单测（src/domain/photography.ts，8.4a）。
 *
 * 这一层是 api/mock 两套仓储共用的「同一份口径」，所以先把纯函数锁死：
 *   · 器材标签归一（Make 已含在 Model 里时不重复拼）；
 *   · 地点聚合遵守 location_precision（hidden 不进列表）；
 *   · 季节按拍摄时间推，缺拍摄时间退到发布时间；
 *   · 拍摄参数可见性是「账户隐藏 OR 单张隐藏」，隐藏时对象里真的没有参数；
 *   · 代表作最多 3 件、上移下移越界不改顺序。
 */
import { describe, expect, it } from 'vitest'
import {
  PINNED_MAX,
  SEASONS,
  buildGearSummary,
  buildPlaceSummary,
  buildSeasonSummary,
  exifVisibilityOf,
  gearLabel,
  gearPhotos,
  isGearKind,
  isSeason,
  locationPrecisionNote,
  movePinned,
  normalizePinnedIds,
  orderPinnedPhotos,
  photoGear,
  photoSeason,
  photosInSeason,
  pinnedPhotosFrom,
  placePhotos,
  seasonOfDate,
  togglePinned,
  withExifPrivacy,
  withExifPrivacyAll,
} from '@/domain/photography'
import type { Photo, Profile } from '@/domain/types'
import { makePhoto } from './fixtures'

function photo(id: string, overrides: Partial<Photo> = {}): Photo {
  return makePhoto(id, { authorUsername: 'a1', locationName: '杭州·西湖', ...overrides })
}

describe('器材', () => {
  it('机身名：Make 已含在 Model 里就不重复拼', () => {
    expect(gearLabel({ Make: 'Canon', Model: 'Canon EOS R5' }, 'body')).toBe('Canon EOS R5')
    expect(gearLabel({ Make: 'Nikon', Model: 'Z6 II' }, 'body')).toBe('Nikon Z6 II')
    expect(gearLabel({ Model: 'X-T5' }, 'body')).toBe('X-T5')
    // 只有厂商没有型号不算一台机身：宁可不出现在列表里，也不要「Canon」这种无用条目
    expect(gearLabel({ Make: 'Canon' }, 'body')).toBeNull()
    expect(gearLabel({ Make: 'Canon', Model: 'EOS R5' }, 'lens')).toBeNull()
    expect(gearLabel({ LensModel: 'RF 24-70mm F2.8' }, 'lens')).toBe('RF 24-70mm F2.8')
    expect(gearLabel(null, 'body')).toBeNull()
  })

  it('photoGear 同时给出机身与镜头', () => {
    expect(photoGear(photo('p1', { exif: { Make: 'Sony', Model: 'A7 IV', LensModel: 'FE 35mm' } }))).toEqual({
      body: 'Sony A7 IV',
      lens: 'FE 35mm',
    })
    expect(photoGear(photo('p2'))).toEqual({ body: null, lens: null })
  })

  it('聚合只算公开作品，按作品数降序、同数按名称，且不带作者 UUID', () => {
    const photos = [
      photo('p1', { exif: { Make: 'Canon', Model: 'EOS R5' } }),
      photo('p2', { authorId: 'u2', exif: { Make: 'Canon', Model: 'EOS R5' } }),
      photo('p3', { authorId: 'u3', exif: { Make: 'Nikon', Model: 'Z6 II' } }),
      photo('p4', { status: 'draft', exif: { Make: 'Sony', Model: 'A7 IV' } }),
      photo('p5', { deletedAt: '2026-03-02T00:00:00.000Z', exif: { Make: 'Sony', Model: 'A7 IV' } }),
    ]
    const summary = buildGearSummary(photos, 10)
    expect(summary.map((item) => [item.kind, item.label, item.photoCount, item.authorCount])).toEqual([
      ['body', 'Canon EOS R5', 2, 2],
      ['body', 'Nikon Z6 II', 1, 1],
    ])
    for (const item of summary) expect(Object.keys(item)).not.toContain('authorId')
  })

  it('器材作品流按发布时间倒序，且只含该器材的公开作品', () => {
    const photos = [
      photo('a', { publishedAt: '2026-01-01T00:00:00.000Z', exif: { Make: 'Canon', Model: 'EOS R5' } }),
      photo('b', { publishedAt: '2026-05-01T00:00:00.000Z', exif: { Make: 'Canon', Model: 'EOS R5' } }),
      photo('c', { publishedAt: '2026-06-01T00:00:00.000Z', exif: { Make: 'Nikon', Model: 'Z6 II' } }),
    ]
    expect(gearPhotos(photos, 'body', 'Canon EOS R5').map((item) => item.id)).toEqual(['b', 'a'])
  })

  it('isGearKind 只认 body/lens', () => {
    expect(isGearKind('body')).toBe(true)
    expect(isGearKind('lens')).toBe(true)
    expect(isGearKind('tripod')).toBe(false)
    expect(isGearKind(undefined)).toBe(false)
  })
})

describe('地点', () => {
  it('hidden 精度或空地点不进聚合（不暴露也不占位）', () => {
    const photos = [
      photo('p1'),
      photo('p2', { locationName: '杭州·西湖' }),
      photo('p3', { locationName: '杭州·西湖', locationPrecision: 'hidden' }),
      photo('p4', { locationName: '   ' }),
    ]
    const summary = buildPlaceSummary(photos, 10)
    expect(summary).toHaveLength(1)
    expect(summary[0]).toMatchObject({ label: '杭州·西湖', photoCount: 2, authorCount: 1 })
    expect(Object.keys(summary[0]!)).not.toContain('authorId')
  })

  it('地点作品流不因精度而换接口，只按标签过滤', () => {
    const photos = [photo('p1'), photo('p2', { locationName: '上海·外滩' })]
    expect(placePhotos(photos, '杭州·西湖').map((item) => item.id)).toEqual(['p1'])
  })

  it('精度文案逐档不同，且都不含坐标', () => {
    const notes = (['exact', 'district', 'city', 'hidden'] as const).map(locationPrecisionNote)
    expect(new Set(notes).size).toBe(4)
    for (const note of notes) expect(note).not.toMatch(/\d+\.\d+/)
    expect(locationPrecisionNote('hidden')).toContain('未公开')
  })
})

describe('季节', () => {
  it('按月份分季（北半球）', () => {
    expect(seasonOfDate('2026-03-01T00:00:00.000Z')).toBe('spring')
    expect(seasonOfDate('2026-06-15T00:00:00.000Z')).toBe('summer')
    expect(seasonOfDate('2026-09-30T00:00:00.000Z')).toBe('autumn')
    expect(seasonOfDate('2026-12-31T00:00:00.000Z')).toBe('winter')
    expect(seasonOfDate('2026-01-05T00:00:00.000Z')).toBe('winter')
  })

  it('优先取拍摄时间，缺失时退到发布时间', () => {
    expect(photoSeason(photo('p1', { shotAt: '2026-07-01T00:00:00.000Z' }))).toBe('summer')
    expect(photoSeason(photo('p2', { publishedAt: '2026-10-01T00:00:00.000Z' }))).toBe('autumn')
  })

  it('筛选只保留该季作品，聚合四季都给（0 也保留，便于展示 0 计数）', () => {
    const photos = [
      photo('p1', { shotAt: '2026-04-01T00:00:00.000Z' }),
      photo('p2', { shotAt: '2026-07-01T00:00:00.000Z' }),
      photo('p3', { status: 'draft', shotAt: '2026-04-01T00:00:00.000Z' }),
    ]
    expect(photosInSeason(photos, 'spring').map((item) => item.id)).toEqual(['p1'])
    const summary = buildSeasonSummary(photos)
    expect(summary.map((item) => item.season)).toEqual([...SEASONS])
    expect(summary.find((item) => item.season === 'spring')?.photoCount).toBe(1)
    expect(summary.find((item) => item.season === 'winter')?.photoCount).toBe(0)
  })

  it('isSeason 只认四季字符串', () => {
    expect(isSeason('winter')).toBe(true)
    expect(isSeason('rainy')).toBe(false)
  })
})

describe('拍摄参数隐私', () => {
  it('单张隐藏与账户隐藏任一成立即隐藏', () => {
    expect(withExifPrivacy(photo('p1', { exif: { ISO: 100 } }), 'public').exif).toEqual({ ISO: 100 })
    const byPhoto = withExifPrivacy(photo('p2', { exif: { ISO: 100 }, exifHidden: true }), 'public')
    expect(byPhoto.exif).toEqual({})
    expect(byPhoto.exifHidden).toBe(true)
    const byProfile = withExifPrivacy(photo('p3', { exif: { ISO: 100 } }), 'hidden')
    expect(byProfile.exif).toEqual({})
    expect(byProfile.exifHidden).toBe(true)
  })

  it('可见时返回同一对象（避免无谓复制导致引用比较失效）', () => {
    const source = photo('p1', { exif: { ISO: 200 } })
    expect(withExifPrivacy(source, 'public')).toBe(source)
  })

  it('批量掩码按作者取可见性', () => {
    const photos = [
      photo('p1', { authorId: 'u1', exif: { ISO: 100 } }),
      photo('p2', { authorId: 'u2', exif: { ISO: 200 } }),
    ]
    const masked = withExifPrivacyAll(photos, (authorId) => (authorId === 'u2' ? 'hidden' : 'public'))
    expect(masked[0]!.exif).toEqual({ ISO: 100 })
    expect(masked[1]!.exif).toEqual({})
  })

  it('exifVisibilityOf 只认 hidden，其余按 public', () => {
    expect(exifVisibilityOf({ exifVisibility: 'hidden' } as Profile)).toBe('hidden')
    expect(exifVisibilityOf({} as Profile)).toBe('public')
  })
})

describe('代表作', () => {
  const photos = [photo('a'), photo('b'), photo('c'), photo('d')]

  it('归一：去重、去空白、截到 3 件', () => {
    expect(normalizePinnedIds([' a ', 'a', 'b', '', 'c', 'd'])).toEqual(['a', 'b', 'c'])
    expect(normalizePinnedIds(undefined)).toEqual([])
    expect(PINNED_MAX).toBe(3)
  })

  it('toggle：不在就追加，在就移除，满了返回 null', () => {
    expect(togglePinned(['a'], 'b')).toEqual(['a', 'b'])
    expect(togglePinned(['a', 'b'], 'a')).toEqual(['b'])
    expect(togglePinned(['a', 'b', 'c'], 'd')).toBeNull()
  })

  it('move：越界原样返回，其余交换相邻项', () => {
    expect(movePinned(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(movePinned(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
    expect(movePinned(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(movePinned(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
  })

  it('摘要按给定顺序产出，丢失的作品被跳过', () => {
    expect(pinnedPhotosFrom(['c', 'a'], photos).map((item) => item.id)).toEqual(['c', 'a'])
    expect(pinnedPhotosFrom(['c', 'gone'], photos).map((item) => item.id)).toEqual(['c'])
    expect(orderPinnedPhotos(['b', 'a'], photos).map((item) => item.id)).toEqual(['b', 'a'])
  })
})
