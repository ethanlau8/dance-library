import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { ProfileWithRole, Permissions } from '../types'

interface AuthContextType {
  user: User | null
  profile: ProfileWithRole | null
  permissions: Permissions | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<ProfileWithRole | null>(null)
  const [permissions, setPermissions] = useState<Permissions | null>(null)
  const [loading, setLoading] = useState(true)

  async function fetchProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*, role:roles(*)')
      .eq('id', userId)
      .single()

    if (error || !data) {
      setProfile(null)
      setPermissions(null)
      return
    }

    const profileData: ProfileWithRole = {
      id: data.id,
      role_id: data.role_id,
      display_name: data.display_name,
      created_at: data.created_at,
      role: data.role,
    }
    setProfile(profileData)

    if (profileData.role) {
      setPermissions({
        view_media: profileData.role.view_media,
        upload_media: profileData.role.upload_media,
        edit_metadata: profileData.role.edit_metadata,
        delete_media: profileData.role.delete_media,
        manage_roles: profileData.role.manage_roles,
        create_tags: profileData.role.create_tags,
        manage_folders: profileData.role.manage_folders,
      })
    } else {
      setPermissions(null)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id).then(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
      } else {
        setProfile(null)
        setPermissions(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error as Error | null }
  }

  async function signUp(email: string, password: string, displayName: string) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    })
    return { error: error as Error | null }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setPermissions(null)
  }

  return (
    <AuthContext.Provider value={{ user, profile, permissions, loading, signIn, signUp, signOut: handleSignOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
