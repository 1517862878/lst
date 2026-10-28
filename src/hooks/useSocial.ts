/**
 * 社交关系 hooks（二期：关注 / 关注动态 / 站内通知）。
 *
 * 约定与其它 hooks 一致：页面只调这里，不直接碰 createRepositories()；
 * 查询键一律走 queryKeys（FRONTEND-WORK §6.3：禁止硬编码字符串数组）。
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createRepositories } from '@/data'
import { queryKeys, type FollowListKind } from './queryKeys'

const repos = () => createRepositories()

/** 我是否关注了此人（未登录恒为 false，按钮据此显示「关注」） */
export function useFollowState(username: string) {
  return useQuery({
    queryKey: queryKeys.followState(username),
    queryFn: () => repos().social.isFollowing(username),
    enabled: Boolean(username),
    // 关注状态变化都由 useToggleFollow 主动失效，自己不需要频繁重取
    staleTime: 60_000,
  })
}

/** 粉丝数 / 关注数（个人主页头部） */
export function useFollowCounts(username: string) {
  return useQuery({
    queryKey: queryKeys.followCounts(username),
    queryFn: () => repos().social.counts(username),
    enabled: Boolean(username),
    staleTime: 30_000,
  })
}

/** 粉丝 / 关注列表（游标分页；展开时才取，enabled=false 时不发请求） */
export function useFollowList(username: string, kind: FollowListKind, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.followList(username, kind),
    queryFn: ({ pageParam }) =>
      kind === 'followers'
        ? repos().social.listFollowers(username, pageParam)
        : repos().social.listFollowing(username, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(username) && enabled,
    staleTime: 30_000,
  })
}

/**
 * 关注 / 取关。
 * 成功后**先本地写回状态**再失效计数：按钮要立刻变成「已关注」，
 * 不能等一个网络往返（用户会以为没点上而反复点）。
 */
export function useToggleFollow(username: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (next: boolean) =>
      next ? repos().social.follow(username) : repos().social.unfollow(username),
    onSuccess: (_data, next) => {
      queryClient.setQueryData(queryKeys.followState(username), next)
      void queryClient.invalidateQueries({ queryKey: queryKeys.followCounts(username) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.followList(username, 'followers') })
      void queryClient.invalidateQueries({ queryKey: queryKeys.followList(username, 'following') })
      // 关注关系变了 → 「关注动态」与「通知未读数」都可能随之变化
      void queryClient.invalidateQueries({ queryKey: queryKeys.feed() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount() })
    },
  })
}

/** 关注动态（游标分页） */
export function useBlockUser(username: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => repos().social.blockUser(username),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.followState(username), false)
      void queryClient.invalidateQueries({ queryKey: queryKeys.profileByUsername(username) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.followCounts(username) })
      void queryClient.invalidateQueries({ queryKey: ['social'] })
      void queryClient.invalidateQueries({ queryKey: ['search'] })
    },
  })
}

export function useBlockedUsers() {
  return useInfiniteQuery({
    queryKey: queryKeys.blockedUsers(),
    queryFn: ({ pageParam }) => repos().social.listBlocked(pageParam ? { cursor: pageParam } : undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
}

export function useUnblockUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (username: string) => repos().social.unblockUser(username),
    onSuccess: (_data, username) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.blockedUsers() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.profileByUsername(username) })
      void queryClient.invalidateQueries({ queryKey: ['search'] })
    },
  })
}

export function useFeed() {
  return useInfiniteQuery({
    queryKey: queryKeys.feed(),
    queryFn: ({ pageParam }) => repos().social.feed(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  })
}

/** 我的通知（游标分页） */
export function useNotifications(enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.notifications(),
    queryFn: ({ pageParam }) => repos().social.notifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    staleTime: 15_000,
  })
}

/**
 * 未读通知数（铃铛红点）。
 * enabled=false 时完全不发请求 —— 游客态没有会话，请求只会拿到 401。
 */
export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: queryKeys.unreadCount(),
    queryFn: () => repos().social.unreadCount(),
    enabled,
    staleTime: 30_000,
    // 铃铛是常驻 UI：定期轻量轮询，否则用户长时间停在页面上永远看不到新通知
    refetchInterval: 60_000,
  })
}

/**
 * 标记已读（不传 ids = 全部）。
 *
 * 只失效未读数，**不失效通知列表**：列表里已经渲染的「未读」标记要留在屏幕上，
 * 用户才能看清这次进来之前哪些是新的。重取列表会把标记冲掉（readAt 都变成非空）。
 */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids?: string[]) => repos().social.markRead(ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount() })
    },
  })
}
