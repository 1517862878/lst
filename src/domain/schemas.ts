/**
 * zod 校验 schema（ROADMAP S2 / FRONTEND-WORK §6.4）。
 * 规则：schema 与 domain/types 同源（z.infer）；长度上限与 DB check 约束写同一个数字；
 * 表单页不本地另写校验规则。
 */
import { z } from 'zod'
import { CATEGORIES, EXIF_WHITELIST } from './constants'

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), '无效时间格式')

// ===== 枚举 =====

export const userRoleSchema = z.enum(['user', 'editor', 'admin'])
export const photoStatusSchema = z.enum(['draft', 'published', 'hidden', 'removed'])
export const photoLicenseSchema = z.enum([
  'all_rights_reserved',
  'cc_by',
  'cc_by_nc',
  'cc_by_nc_nd',
  'cc0',
])
export const locationPrecisionSchema = z.enum(['exact', 'district', 'city', 'hidden'])
export const commentStatusSchema = z.enum(['visible', 'hidden', 'removed'])
export const articleDifficultySchema = z.enum(['beginner', 'intermediate', 'advanced'])

// ===== 表单 =====

export const usernameSchema = z
  .string()
  .min(3, '用户名至少 3 位')
  .max(20, '用户名最多 20 位')
  .regex(/^[a-z0-9_-]+$/, '仅小写字母、数字、下划线、连字符')

export const passwordSchema = z
  .string()
  .min(6, '密码至少 6 位')
  .max(64, '密码最多 64 位')

export const loginSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
})

export const registerSchema = z.object({
  username: usernameSchema,
  displayName: z.string().min(1, '请填写昵称').max(30, '昵称最多 30 字'),
  password: passwordSchema,
  agreeTerms: z.literal(true, { errorMap: () => ({ message: '必须同意用户协议' }) }),
})

export const photoPublishSchema = z.object({
  title: z.string().min(1, '请填写标题').max(60, '标题最多 60 字'),
  description: z.string().max(2000, '心得最多 2000 字'),
  categorySlug: z.string().refine((s) => CATEGORIES.some((c) => c.slug === s), '无效分类'),
  tags: z.array(z.string().max(20)).max(5, '标签最多 5 个'),
  locationName: z.string().max(80, '地点最多 80 字'),
  locationPrecision: locationPrecisionSchema,
  license: photoLicenseSchema,
  shotAt: isoDate.nullable(),
  exif: z
    .record(z.unknown())
    .nullable()
    .refine((exif) => {
      // EXIF 白名单校验：只允许白名单键（DATA-MODEL §10）
      if (!exif) return true
      return Object.keys(exif).every((k) => (EXIF_WHITELIST as readonly string[]).includes(k))
    }, 'EXIF 含白名单之外的字段'),
})

export const commentSchema = z.object({
  body: z.string().min(1, '评论不能为空').max(500, '评论最多 500 字'),
  parentId: z.string().nullable(),
})

export const profileSchema = z.object({
  displayName: z.string().min(1, '请填写昵称').max(30, '昵称最多 30 字'),
  bio: z.string().max(160, '简介最多 160 字'),
  links: z
    .array(z.object({ label: z.string().max(20), url: z.string().url('无效链接') }))
    .max(3, '链接最多 3 条'),
  licensePreference: photoLicenseSchema,
})

// ===== 类型导出（与 domain/types 一致，供表单 z.infer）=====

export type LoginFormValues = z.infer<typeof loginSchema>
export type RegisterFormValues = z.infer<typeof registerSchema>
export type PhotoPublishFormValues = z.infer<typeof photoPublishSchema>
export type CommentFormValues = z.infer<typeof commentSchema>
export type ProfileFormValues = z.infer<typeof profileSchema>
