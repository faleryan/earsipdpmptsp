import { format, formatDistanceToNowStrict, parseISO } from 'date-fns'
import { id } from 'date-fns/locale'

const nf = new Intl.NumberFormat('id-ID')

export const formatNumber = (n: number | null | undefined) => nf.format(n ?? 0)

export function formatDate(value: string | null | undefined, pattern = 'd MMM yyyy') {
  if (!value) return '—'
  try {
    return format(parseISO(value), pattern, { locale: id })
  } catch {
    return value
  }
}

export const formatDateTime = (value: string | null | undefined) => formatDate(value, 'd MMM yyyy, HH.mm')

export function formatRelative(value: string | null | undefined) {
  if (!value) return '—'
  try {
    return `${formatDistanceToNowStrict(parseISO(value), { locale: id })} lalu`
  } catch {
    return value
  }
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toLocaleString('id-ID', { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`
}

/** NIK disamarkan untuk peran yang tidak mengelola data pribadi */
export function maskNik(nik: string | null | undefined, reveal: boolean) {
  if (!nik) return '—'
  if (reveal) return nik
  return `${nik.slice(0, 4)}••••••••${nik.slice(-4)}`
}

export const todayIso = () => format(new Date(), 'yyyy-MM-dd')

/** Nama jenis izin ringkas untuk label grafik */
export function shortPermitName(s: string, n = 40) {
  const t = s.replace(/\s*Kab\.?\s*Belu\s*$/i, '').replace(/^Surat Izin Praktik\s*/i, 'SIP ')
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
