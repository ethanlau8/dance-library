import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { Role } from '../types'

interface UserRow {
  id: string
  email: string
  display_name: string | null
  role_id: string | null
  role_name: string | null
  created_at: string
}

const PERMISSION_FLAGS = [
  'view_media',
  'upload_media',
  'edit_metadata',
  'delete_media',
  'manage_roles',
  'create_tags',
  'manage_folders',
] as const

export default function AdminPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'users' | 'roles'>('users')
  const [users, setUsers] = useState<UserRow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    const [usersRes, rolesRes] = await Promise.all([
      supabase.rpc('get_users_with_emails'),
      supabase.from('roles').select('*').order('name'),
    ])

    if (usersRes.data) setUsers(usersRes.data as UserRow[])
    if (rolesRes.data) setRoles(rolesRes.data)
    setLoading(false)
  }

  const pendingUsers = useMemo(() => users.filter((u) => !u.role_id), [users])
  const activeUsers = useMemo(() => users.filter((u) => u.role_id), [users])

  const ownerCount = useMemo(() => {
    const ownerRole = roles.find((r) => r.name === 'Owner')
    if (!ownerRole) return 0
    return activeUsers.filter((u) => u.role_id === ownerRole.id).length
  }, [activeUsers, roles])

  async function handleRoleChange(profileId: string, newRoleId: string) {
    setUpdatingId(profileId)
    const { error } = await supabase
      .from('profiles')
      .update({ role_id: newRoleId })
      .eq('id', profileId)

    if (error) {
      console.error('Failed to update role:', error)
    } else {
      const roleName = roles.find((r) => r.id === newRoleId)?.name ?? null
      setUsers((prev) =>
        prev.map((u) =>
          u.id === profileId ? { ...u, role_id: newRoleId, role_name: roleName } : u
        )
      )
    }
    setUpdatingId(null)
  }

  function isLastOwner(userRow: UserRow): boolean {
    const ownerRole = roles.find((r) => r.name === 'Owner')
    if (!ownerRole) return false
    return userRow.role_id === ownerRole.id && ownerCount <= 1
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      </div>
    )
  }

  return (
    <div className="pb-8">
      {/* Tabs */}
      <div className="sticky top-14 z-20 flex border-b border-gray-200 bg-white">
        <button
          onClick={() => setTab('users')}
          className={`flex-1 py-3 text-center text-sm font-medium transition-colors ${
            tab === 'users'
              ? 'border-b-2 border-gray-900 text-gray-900'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          Users
        </button>
        <button
          onClick={() => setTab('roles')}
          className={`flex-1 py-3 text-center text-sm font-medium transition-colors ${
            tab === 'roles'
              ? 'border-b-2 border-gray-900 text-gray-900'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          Roles
        </button>
      </div>

      {tab === 'users' ? (
        <div className="px-4 pt-4">
          {/* Pending section */}
          {pendingUsers.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-amber-600">
                Pending ({pendingUsers.length})
              </h2>
              <div className="space-y-2">
                {pendingUsers.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {u.email}
                      </p>
                      <p className="text-xs text-gray-500">
                        Signed up {formatDate(u.created_at)}
                      </p>
                    </div>
                    <select
                      value=""
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      disabled={updatingId === u.id}
                      className="ml-3 shrink-0 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 disabled:opacity-50"
                    >
                      <option value="" disabled>
                        Assign role…
                      </option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Active section */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
              Active ({activeUsers.length})
            </h2>
            {activeUsers.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">No active users</p>
            ) : (
              <div className="space-y-2">
                {activeUsers.map((u) => {
                  const isSelf = u.id === user?.id
                  const lastOwner = isLastOwner(u)

                  return (
                    <div
                      key={u.id}
                      className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {u.email}
                          {isSelf && (
                            <span className="ml-2 text-xs text-gray-400">(you)</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">
                          {u.role_name} · Joined {formatDate(u.created_at)}
                        </p>
                      </div>
                      {isSelf ? (
                        <span className="ml-3 shrink-0 rounded bg-gray-100 px-2 py-1 text-xs text-gray-500">
                          {u.role_name}
                        </span>
                      ) : (
                        <div className="relative ml-3 shrink-0">
                          <select
                            value={u.role_id ?? ''}
                            onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            disabled={updatingId === u.id || lastOwner}
                            title={lastOwner ? 'Cannot change — last Owner' : undefined}
                            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      ) : (
        /* Roles tab */
        <div className="px-4 pt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Permission
                  </th>
                  {roles
                    .sort((a, b) => {
                      // Owner first, then Editor, then Viewer
                      const order: Record<string, number> = { Owner: 0, Editor: 1, Viewer: 2 }
                      return (order[a.name] ?? 3) - (order[b.name] ?? 3)
                    })
                    .map((r) => (
                      <th
                        key={r.id}
                        className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider text-gray-500"
                      >
                        {r.name}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_FLAGS.map((flag) => (
                  <tr key={flag} className="border-b border-gray-100">
                    <td className="py-2.5 pr-4 text-gray-700">{flag}</td>
                    {roles
                      .sort((a, b) => {
                        const order: Record<string, number> = { Owner: 0, Editor: 1, Viewer: 2 }
                        return (order[a.name] ?? 3) - (order[b.name] ?? 3)
                      })
                      .map((r) => (
                        <td key={r.id} className="px-3 py-2.5 text-center">
                          {r[flag] ? (
                            <span className="text-green-600">&#10003;</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
