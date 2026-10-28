import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, translateDbError } from '../lib/errors.js'
import { PHOTO_LICENSES, parsePhotoPatch, publicLocation, validateExif } from './index.js'

test('photo license request contract accepts all five declared values', () => {
  assert.deepEqual(PHOTO_LICENSES, [
    'all_rights_reserved',
    'cc_by',
    'cc_by_nc',
    'cc_by_nc_nd',
    'cc0',
  ])
})

test('EXIF validation accepts only flat public whitelist fields', () => {
  const exif = { Make: 'Nikon', ISO: 400, DateTimeOriginal: null }
  assert.deepEqual(validateExif(exif), exif)
  assert.throws(() => validateExif({ GPSLatitude: 31.2 }), /白名单/)
  assert.throws(() => validateExif({ Make: { raw: 'Nikon' } }), /嵌套/)
  assert.throws(() => validateExif([]), /普通对象/)
})

test('photo patch accepts only mutable fields and normalizes values', () => {
  assert.deepEqual(parsePhotoPatch({
    title: '  新标题  ',
    tags: [' Night ', 'Night', '城市'],
    license: 'cc_by',
  }), {
    title: '新标题',
    tags: ['Night', '城市'],
    license: 'cc_by',
  })
  assert.throws(() => parsePhotoPatch({ authorId: 'other-user' }), /不可修改/)
  assert.throws(() => parsePhotoPatch({ imageKey: 'other.webp' }), /不可修改/)
  assert.throws(() => parsePhotoPatch({ status: 'published' }), /只能用于撤回/)
  assert.throws(() => parsePhotoPatch({ tags: ['bad\u0000tag'] }), /tags/)
})

test('database owner boundary errors map to stable API semantics', () => {
  const missing = Object.assign(new Error('作品不存在'), { code: 'P0002' })
  const denied = Object.assign(new Error('permission denied'), { code: '42501' })
  const translatedMissing = translateDbError(missing)
  assert.ok(translatedMissing instanceof ApiError)
  assert.equal(translatedMissing.code, 'NOT_FOUND')
  assert.equal(translatedMissing.status, 404)
  assert.equal(translateDbError(denied)?.code, 'FORBIDDEN')
})

test('location privacy strips coordinates unless precision is exact', () => {
  assert.deepEqual(publicLocation('exact', '上海', 31.2, 121.4), {
    name: '上海',
    lat: 31.2,
    lng: 121.4,
  })
  assert.deepEqual(publicLocation('city', '上海', 31.2, 121.4), {
    name: '上海',
    lat: null,
    lng: null,
  })
  assert.deepEqual(publicLocation('district', '浦东', 31.2, 121.4), {
    name: '浦东',
    lat: null,
    lng: null,
  })
  assert.deepEqual(publicLocation('hidden', '秘密地点', 31.2, 121.4), {
    name: '',
    lat: null,
    lng: null,
  })
})
