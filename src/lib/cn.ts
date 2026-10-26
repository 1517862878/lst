/** 极简 className 合并（不引第三方库，满足 §6.11 依赖纪律） */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
