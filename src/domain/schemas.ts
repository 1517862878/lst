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

/**
 * 用户名：2–20 位，可用中文、字母、数字、下划线、连字符。
 *
 * ⚠️ 这条规则必须与数据库约束 ck_profiles_username_format 一致
 *    （`^[a-zA-Z0-9_\-\u4e00-\u9fa5]{2,20}$`），也与后端 routes/auth.ts 的校验一致。
 *    前端比数据库严：用户怎么填都提交不了，且报错说不清原因；
 *    前端比数据库松：填完提交才报错，体验差。三处必须同改。
 *
 * 另注：username 列是 citext（大小写不敏感），"Abc" 与 "abc" 视为同一个用户名。
 */
export const usernameSchema = z
  .string()
  .min(2, '用户名至少 2 位')
  .max(20, '用户名最多 20 位')
  .regex(/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/, '仅限中文、字母、数字、下划线、连字符')

/**
 * 密码规则：**统一 8–64 位**（2026-11 统一）。
 *
 * 曾经三条入口各写一套（注册 6 位 / 改密 8 位 / 重置 6 位），同一个账号
 * 换个入口就被不同规则拦下 —— 用户看到的是「刚才注册说 6 位就行，改密码又要 8 位」。
 * 现在只保留这一份，前端表单、后端 assertPassword、数据库层都以它为准。
 *
 * ⚠️ 但**登录不计入**这三条（见 loginSchema 的注释）：老用户里存在 6 位密码，
 * 对登录也套 8 位等于把他们锁在门外。收紧规则只作用于「设置新密码」的那三条路径。
 */
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 64

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 位`)
  .max(PASSWORD_MAX_LENGTH, `密码最多 ${PASSWORD_MAX_LENGTH} 位`)

/**
 * 登录表单：**不校验密码长度与格式**。
 *
 * 为什么与注册分开：登录是「验证既有凭据」，不是「设置新密码」。
 * 给登录加长度下限会让所有 6 位老密码的账号直接登不进来，
 * 而且长度不对时应由服务端统一回「用户名或密码错误」——
 * 前端提前报「密码至少 8 位」反而泄露了「这个长度的密码不可能是对的」。
 */
export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, '请填写密码'),
})

export const registerSchema = z.object({
  username: usernameSchema,
  displayName: z.string().min(1, '请填写昵称').max(30, '昵称最多 30 字'),
  phone: z.string().regex(/^1\d{10}$/, '请输入有效的 11 位手机号'),
  code: z.string().regex(/^\d{6}$/, '验证码为 6 位数字'),
  password: passwordSchema,
  termsAccepted: z.literal(true, { errorMap: () => ({ message: '必须同意用户协议' }) }),
  privacyAccepted: z.literal(true, { errorMap: () => ({ message: '必须同意隐私政策' }) }),
})

export const photoPublishSchema = z.object({
  title: z.string().min(1, '请填写标题').max(60, '标题最多 60 字'),
  description: z.string().max(2000, '心得最多 2000 字'),
  categorySlug: z.string().refine((s) => CATEGORIES.some((c) => c.slug === s), '无效分类'),
  tags: z.array(z.string().min(1).max(20)).max(5, '标签最多 5 个'),
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
