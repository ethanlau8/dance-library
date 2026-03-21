import { useAuth } from '../contexts/AuthContext'
import type { Permissions } from '../types'

export function usePermissions() {
  const { permissions } = useAuth()

  function can(flag: keyof Permissions): boolean {
    if (!permissions) return false
    return permissions[flag]
  }

  return { permissions, can }
}
