import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ExpirySummary } from '@/types'

/** Ringkasan izin yang mendekati akhir masa berlaku (diperbarui tiap 5 menit). */
export function useExpirySummary(enabled = true) {
  return useQuery({
    queryKey: ['expiry', 'summary'],
    enabled,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_expiry_summary')
      if (error) throw error
      return data as ExpirySummary
    },
  })
}

export function daysLeftLabel(days: number) {
  if (days < 0) return `Berakhir ${Math.abs(days)} hari lalu`
  if (days === 0) return 'Berakhir hari ini'
  if (days < 31) return `${days} hari lagi`
  const months = Math.floor(days / 30.44)
  return `± ${months} bulan lagi`
}

export function daysLeftTone(days: number): 'danger' | 'warning' | 'default' | 'muted' {
  if (days < 0) return 'muted'
  if (days <= 31) return 'danger'
  if (days <= 92) return 'warning'
  return 'default'
}

/** Ubah nomor HP Indonesia ke format wa.me (62…) */
export function waNumber(phone: string | null) {
  if (!phone) return null
  let d = phone.replace(/\D/g, '')
  if (d.startsWith('0')) d = `62${d.slice(1)}`
  else if (d.startsWith('8')) d = `62${d}`
  return /^62\d{8,13}$/.test(d) ? d : null
}
