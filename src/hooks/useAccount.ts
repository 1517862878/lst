import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { accountApi } from '@/data/api/account'
import type { AccountSettings } from '@/data/api/account'
import { queryKeys } from './queryKeys'

export const accountKeys = {
  all: ['account-center'] as const,
  settings: () => [...accountKeys.all, 'settings'] as const,
  sessions: () => [...accountKeys.all, 'sessions'] as const,
}

export const useAccount = () => useQuery({ queryKey: accountKeys.settings(), queryFn: accountApi.get })
export const useAccountSessions = () => useQuery({ queryKey: accountKeys.sessions(), queryFn: accountApi.listSessions })

export function useUpdateAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: accountApi.updateProfile,
    onSuccess: (data) => {
      queryClient.setQueryData(accountKeys.settings(), data)
      void queryClient.invalidateQueries({ queryKey: queryKeys.session() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(data.id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.profileByUsername(data.username) })
    },
  })
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: accountApi.updatePreferences,
    onSuccess: (data: AccountSettings) => {
      queryClient.setQueryData(accountKeys.settings(), data)
      void queryClient.invalidateQueries({ queryKey: queryKeys.profileByUsername(data.username) })
    },
  })
}

export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: accountApi.revokeSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.sessions() }),
  })
}

export function useChangePassword() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ oldPassword, newPassword }: { oldPassword: string; newPassword: string }) => accountApi.changePassword(oldPassword, newPassword),
    onSuccess: () => queryClient.setQueryData(queryKeys.session(), null),
  })
}

export function useDeleteAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ password, reason }: { password: string; reason: string }) => accountApi.deleteAccount(password, reason),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.session(), null)
      queryClient.removeQueries({ queryKey: accountKeys.all })
    },
  })
}
