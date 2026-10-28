const TAG_DECORATION = /^[#＃]+|[#＃]+$/gu

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
}

export function normalizeTag(value: string): string {
  return normalizeSearchText(value).replace(TAG_DECORATION, '').replace(/\s+/gu, '')
}

export function parseTags(value: string, limit = 5): string[] {
  const tags = value
    .split(/[\s,，]+/u)
    .map(normalizeTag)
    .filter((tag) => tag.length >= 2 && tag.length <= 20)
  return [...new Set(tags)].slice(0, limit)
}
