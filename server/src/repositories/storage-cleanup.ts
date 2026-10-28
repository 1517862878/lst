import { withSystem } from '../lib/db.js'

export interface StorageCleanupJob {
  id: string
  objectKey: string
  leaseToken: string
}

interface ClaimRow {
  job_id: string
  object_key: string
  lease_token: string
}

interface BoolRow {
  ok: boolean
}

/**
 * 队列的读写边界（务必理解，否则图片永远删不掉）：
 *
 * public.photo_storage_cleanup_jobs 对 app_user 是【完全不可达】的
 * （0020 收回全部表权限并自检）。应用连接的 PGUSER 就是 app_user，
 * 所以这里只能调用 0021 提供的三个 security definer 窄函数：
 *   claim_photo_storage_cleanup_jobs / complete_photo_storage_cleanup_job / retry_photo_storage_cleanup_job
 *
 * 早先这里直接 `update public.photo_storage_cleanup_jobs ...`，
 * 结果是 worker 每 30 秒报 42501 permission denied，
 * 图片永不删除、队列只增不减；单元测试注入假仓储所以看不出来。
 * 真实验证见 supabase/test-photo-storage-cleanup-app-role.sql。
 */

/** 短事务领取到期任务。租约过期后可重新领取，因此 worker 崩溃不会永久卡单。 */
export async function claimStorageCleanupJobs(
  limit: number,
  leaseSeconds: number,
): Promise<StorageCleanupJob[]> {
  return withSystem(async (client) => {
    const result = await client.query<ClaimRow>(
      `select job_id::text, object_key, lease_token::text
       from public.claim_photo_storage_cleanup_jobs($1::integer, $2::integer)`,
      [limit, leaseSeconds],
    )
    return result.rows.map((row) => ({
      id: row.job_id,
      objectKey: row.object_key,
      leaseToken: row.lease_token,
    }))
  })
}

export function completeStorageCleanupJob(job: StorageCleanupJob): Promise<boolean> {
  return callQueueFunction(
    'select public.complete_photo_storage_cleanup_job($1::bigint, $2::uuid) as ok',
    [job.id, job.leaseToken],
  )
}

export function retryStorageCleanupJob(job: StorageCleanupJob, error: unknown): Promise<boolean> {
  const message = error instanceof Error ? error.message : String(error)
  return callQueueFunction(
    'select public.retry_photo_storage_cleanup_job($1::bigint, $2::uuid, $3::text) as ok',
    [job.id, job.leaseToken, message],
  )
}

/** 函数在租约不匹配时返回 false —— 必须当作"没完成"，不能当成成功。 */
async function callQueueFunction(sql: string, values: unknown[]): Promise<boolean> {
  return withSystem(async (client) => {
    const result = await client.query<BoolRow>(sql, values)
    return result.rows[0]?.ok === true
  })
}
