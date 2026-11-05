import { Suspense, useCallback } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { FullPageLoader } from '@/components/common/States'
import { useAuth } from '@/hooks/useAuth'
import { useSettings } from '@/hooks/useSettings'
import { useIdleLogout } from '@/hooks/useIdleLogout'

export function AppLayout() {
  const { signOut, session } = useAuth()
  const { data: settings } = useSettings()
  const onIdle = useCallback(() => void signOut(), [signOut])
  useIdleLogout(settings?.idleTimeoutMinutes ?? 60, Boolean(session), onIdle)

  return (
    <div className="flex min-h-screen">
      <a href="#konten" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2">
        Lewati ke konten
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="konten" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-6 lg:px-8">
          <Suspense fallback={<FullPageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
