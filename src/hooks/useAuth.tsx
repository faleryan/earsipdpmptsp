import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { can as canDo, type Permission } from '@/lib/permissions'
import type { Profile, RoleCode } from '@/types'

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  role: RoleCode | null
  loading: boolean
  profileError: string | null
  can: (p: Permission) => boolean
  refreshProfile: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, role:roles(*)')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data as Profile | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null)
      return
    }
    try {
      setProfile(await fetchProfile(s.user.id))
      setProfileError(null)
    } catch (e) {
      setProfileError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)
      await loadProfile(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_OUT') {
        setProfile(null)
        queryClient.clear()
      } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        // jangan await di dalam callback (hindari deadlock auth-js)
        setTimeout(() => void loadProfile(s), 0)
      }
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile, queryClient])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    await supabase.rpc('touch_last_login')
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const role = profile?.is_active ? (profile.role?.code ?? null) : null

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      role,
      loading,
      profileError,
      can: (p) => canDo(role, p),
      refreshProfile: () => loadProfile(session),
      signIn,
      signOut,
    }),
    [session, profile, role, loading, profileError, loadProfile, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth harus dipakai di dalam AuthProvider')
  return ctx
}
