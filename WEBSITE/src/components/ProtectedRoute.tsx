import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { Permissions } from '../types'
import EmptyState from './EmptyState'
import type { ReactNode } from 'react'

interface ProtectedRouteProps {
  children: ReactNode
  requiredPermission?: keyof Permissions
}

export default function ProtectedRoute({ children, requiredPermission }: ProtectedRouteProps) {
  const { user, profile, permissions, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-gray-900" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!profile?.role_id) {
    return <EmptyState />
  }

  if (requiredPermission && (!permissions || !permissions[requiredPermission])) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
