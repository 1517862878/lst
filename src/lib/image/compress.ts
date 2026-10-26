/**
 * 图片压缩（FRONTEND-WORK §4.2 / ROADMAP §5.2）。
 * 输入仅 JPG/JPEG（用户拍板）；输出统一 WebP：
 *   display：长边 ≤2400px，q0.82
 *   thumb：长边 ≤640px，q0.75
 */
export interface CompressOptions {
  /** 目标长边像素 */
  maxEdge: number
  quality: number
}

export interface CompressResult {
  blob: Blob
  width: number
  height: number
}

/** 读取文件为压缩后的 WebP（不解析 EXIF，另见 exif.ts） */
export async function compressImage(file: File, opts: CompressOptions): Promise<CompressResult> {
  const bitmap = await createImageBitmap(file).catch(() => null)
  const img = await loadImage(bitmap, file)

  const scale = Math.min(1, opts.maxEdge / Math.max(img.width, img.height))
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 Canvas 上下文')

  ctx.imageSmoothingQuality = 'high'
  if (bitmap) {
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
  } else {
    ctx.drawImage(img, 0, 0, width, height)
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片压缩失败'))), 'image/webp', opts.quality)
  })

  return { blob, width, height }
}

async function loadImage(bitmap: ImageBitmap | null, file: File): Promise<HTMLImageElement> {
  if (bitmap) {
    // 从 bitmap 拿尺寸即可，不再创建 HTMLImageElement
    return { width: bitmap.width, height: bitmap.height } as HTMLImageElement
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 校验文件：仅 image/jpeg（用户拍板：只收 JPG），≤20MB */
export function validateImageFile(file: File): { ok: true } | { ok: false; reason: string } {
  if (file.type !== 'image/jpeg' && !/\.jpe?g$/i.test(file.name)) {
    return { ok: false, reason: '仅支持 JPG/JPEG 图片' }
  }
  if (file.size > 20 * 1024 * 1024) {
    return { ok: false, reason: '图片不能超过 20MB' }
  }
  return { ok: true }
}
