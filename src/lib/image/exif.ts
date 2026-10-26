/**
 * EXIF 解析（FRONTEND-WORK §4.2 / DATA-MODEL §10）。
 * 只取白名单 7 键；GPS 与设备序列号永不入 exif（用户拍板：白名单）。
 * 轻量解析 JPEG APP1 段，不引第三方库（exifr 需登记许可，这里自己解析保证零风险）。
 */
import { EXIF_WHITELIST } from '@/domain/constants'

/** 解析结果：白名单内的键值对（缺失的键不出现）；GPS 等一律丢弃 */
export async function parseExifWhitelist(file: File): Promise<Record<string, unknown> | null> {
  const buffer = await file.arrayBuffer()
  const view = new DataView(buffer)
  const entries = parseJpegApp1(view)
  if (!entries) return null

  const out: Record<string, unknown> = {}
  for (const key of EXIF_WHITELIST) {
    const v = entries.get(key)
    if (v !== undefined) out[key] = v
  }
  return Object.keys(out).length > 0 ? out : null
}

/** 断言：输出不含任何 gps 相关键（白名单天然排除，这里做防御性断言） */
export function assertNoGps(exif: Record<string, unknown> | null): boolean {
  if (!exif) return true
  return Object.keys(exif).every((k) => !/gps/i.test(k))
}

/**
 * 极简 JPEG APP1 解析：只处理 TIFF 头的 ASCII/SHORT/RATIONAL/LONG 标签。
 * 厂商分段 EXIF 解析失败静默降级为空（FRONTEND-WORK §4.2 易错点②）。
 */
function parseJpegApp1(view: DataView): Map<string, unknown> | null {
  try {
    if (view.byteLength < 4) return null
    if (view.getUint16(0) !== 0xffd8) return null // 不是 JPEG

    let offset = 2
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) return null
      const marker = view.getUint8(offset + 1)
      const size = view.getUint16(offset + 2)
      if (marker === 0xe1) {
        // APP1：检查是否 Exif
        const ascii = String.fromCharCode(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7))
        if (ascii === 'Exif') {
          return parseTiff(view, offset + 10)
        }
      }
      if (size < 2) return null
      offset += 2 + size
      if (marker === 0xda) break // SOS，数据开始
    }
    return null
  } catch {
    return null
  }
}

const TAG_NAMES: Record<number, string> = {
  0x010f: 'Make', // 相机厂商
  0x0110: 'Model', // 相机型号
  0xa434: 'LensModel', // 镜头型号
  0x829d: 'FNumber', // 光圈
  0x829a: 'ExposureTime', // 快门
  0x8827: 'ISO', // ISO
  0x920a: 'FocalLength', // 焦距
  0x9003: 'DateTimeOriginal', // 拍摄时间
}

function parseTiff(view: DataView, tiffStart: number): Map<string, unknown> {
  const result = new Map<string, unknown>()
  const little = view.getUint16(tiffStart) === 0x4949 // II = little endian
  const get16 = (o: number) => view.getUint16(o, little)
  const get32 = (o: number) => view.getUint32(o, little)

  const ifd0 = tiffStart + get32(tiffStart + 4)
  if (ifd0 + 2 > view.byteLength) return result
  const count = get16(ifd0)
  for (let i = 0; i < count && ifd0 + 2 + i * 12 + 12 <= view.byteLength; i++) {
    const entry = ifd0 + 2 + i * 12
    const tag = get16(entry)
    const type = get16(entry + 2)
    const name = TAG_NAMES[tag]
    if (!name) continue
    const value = readTiffValue(view, entry + 8, type, little, tiffStart)
    if (value !== undefined) result.set(name, value)
  }
  return result
}

function readTiffValue(
  view: DataView,
  pos: number,
  type: number,
  little: boolean,
  tiffStart: number,
): unknown {
  // 2 = ASCII 字符串；3 = SHORT；4 = LONG；5 = RATIONAL（分子/分母）
  if (type === 2) {
    const count = view.getUint32(pos, little)
    if (count > 64) return undefined
    const offset = tiffStart + view.getUint32(pos + 4, little)
    let s = ''
    for (let i = 0; i < count - 1; i++) {
      s += String.fromCharCode(view.getUint8(offset + i))
    }
    return s.trim()
  }
  if (type === 3) return view.getUint16(pos, little)
  if (type === 4) return view.getUint32(pos, little)
  if (type === 5) {
    const num = view.getUint32(tiffStart + view.getUint32(pos, little), little)
    const den = view.getUint32(tiffStart + view.getUint32(pos + 4, little), little)
    if (den === 0) return undefined
    return num / den
  }
  return undefined
}
