import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { SystemSetting } from '@/types'

export interface AppIdentity {
  app_name: string
  agency_name: string
  agency_short: string
  address: string
  phone: string
  email: string
}

export interface SettingsMap {
  identity: AppIdentity
  maxFileSizeMb: number
  signedUrlTtl: number
  downloadRoles: string[]
  importChunkSize: number
  idleTimeoutMinutes: number
  raw: Record<string, SystemSetting>
}

const DEFAULT_IDENTITY: AppIdentity = {
  app_name: 'E-Arsip Perizinan',
  agency_name: 'Dinas Penanaman Modal dan Pelayanan Terpadu Satu Pintu Kabupaten Belu',
  agency_short: 'DPMPTSP Kabupaten Belu',
  address: 'Atambua, Kabupaten Belu, Nusa Tenggara Timur',
  phone: '',
  email: '',
}

export function useSettings() {
  return useQuery({
    queryKey: ['system_settings'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SettingsMap> => {
      const { data, error } = await supabase.from('system_settings').select('*')
      if (error) throw error
      const raw = Object.fromEntries((data as SystemSetting[]).map((s) => [s.key, s]))
      const v = <T,>(k: string, d: T) => (raw[k]?.value as T | undefined) ?? d
      return {
        identity: { ...DEFAULT_IDENTITY, ...v<Partial<AppIdentity>>('app.identity', {}) },
        maxFileSizeMb: Number(v('documents.max_file_size_mb', 25)),
        signedUrlTtl: Number(v('documents.signed_url_ttl_seconds', 300)),
        downloadRoles: v<string[]>('documents.download_roles', ['super_admin', 'admin_arsip', 'pimpinan']),
        importChunkSize: Number(v('import.chunk_size', 200)),
        idleTimeoutMinutes: Number(v('security.idle_timeout_minutes', 60)),
        raw,
      }
    },
  })
}
