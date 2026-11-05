import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

/** Keluar otomatis bila tidak ada aktivitas selama `minutes` menit. */
export function useIdleLogout(minutes: number, enabled: boolean, onIdle: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!enabled || !minutes) return
    const reset = () => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        toast.info('Sesi diakhiri karena tidak ada aktivitas.')
        onIdle()
      }, minutes * 60_000)
    }
    const events = ['mousemove', 'keydown', 'pointerdown', 'scroll', 'visibilitychange']
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => {
      clearTimeout(timer.current)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [minutes, enabled, onIdle])
}
