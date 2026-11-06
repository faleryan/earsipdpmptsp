import { Link } from 'react-router-dom'
import * as Popover from '@radix-ui/react-popover'
import { Bell, CalendarClock } from 'lucide-react'
import { useExpirySummary, daysLeftLabel } from '@/hooks/useExpiry'
import { formatDate, formatNumber } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function ExpiryBell() {
  const { data } = useExpirySummary()
  const max = data?.buckets.at(-1)
  const count = (max?.count ?? 0) + (data?.expired ?? 0)
  const urgent = data?.buckets.find((b) => b.months === Math.min(...(data?.thresholds ?? [1])))?.count ?? 0
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifikasi masa berlaku izin: ${count}`}>
          <Bell />
          {count > 0 && (
            <span className={cn('absolute -right-0.5 -top-0.5 min-w-5 rounded-full px-1 text-center text-[11px] font-bold leading-5 text-white tabular', urgent ? 'bg-destructive' : 'bg-warning')}>
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-[22rem] rounded-xl border bg-popover p-0 shadow-xl">
          <div className="border-b px-4 py-3">
            <p className="font-semibold">Masa berlaku izin</p>
            <p className="text-xs text-muted-foreground">Izin aktif yang belum diajukan perpanjangan</p>
          </div>
          {data ? (
            <>
              <div className="grid grid-cols-4 gap-1 border-b px-3 py-3 text-center">
                {[...data.buckets].sort((a, b) => a.months - b.months).map((b) => (
                  <Link key={b.months} to={`/masa-berlaku?dalam=${b.months}`} className="rounded-md px-1 py-1.5 hover:bg-accent">
                    <p className={cn('text-lg font-bold tabular', b.months <= 1 && b.count ? 'text-destructive' : b.months <= 3 && b.count ? 'text-[#8a5a12]' : '')}>{formatNumber(b.count)}</p>
                    <p className="text-[11px] text-muted-foreground">≤ {b.months} bln</p>
                  </Link>
                ))}
                <Link to="/masa-berlaku?dalam=lewat" className="rounded-md px-1 py-1.5 hover:bg-accent">
                  <p className="text-lg font-bold tabular">{formatNumber(data.expired)}</p>
                  <p className="text-[11px] text-muted-foreground">Berakhir</p>
                </Link>
              </div>
              {data.nearest.length ? (
                <ul className="max-h-72 divide-y overflow-y-auto">
                  {data.nearest.map((n) => (
                    <li key={n.permit_id}>
                      <Link to={`/permohonan/${n.application_id}`} className="flex gap-3 px-4 py-2.5 hover:bg-accent">
                        <CalendarClock className={cn('mt-0.5 size-4 shrink-0', n.days_left < 0 ? 'text-muted-foreground' : n.days_left <= 31 ? 'text-destructive' : 'text-warning')} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{n.applicant_name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{n.permit_type_name}</span>
                          <span className="block text-xs">{formatDate(n.valid_until)} · {daysLeftLabel(n.days_left)}{n.renewal_notified_at ? ' · sudah diingatkan' : ''}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">Tidak ada izin yang segera berakhir.</p>
              )}
              {data.without_validity > 0 && (
                <p className="border-t px-4 py-2 text-xs text-muted-foreground">{formatNumber(data.without_validity)} izin aktif belum memiliki tanggal berakhir.</p>
              )}
              <div className="border-t p-2"><Button asChild variant="ghost" className="w-full"><Link to="/masa-berlaku">Buka daftar masa berlaku</Link></Button></div>
            </>
          ) : <p className="px-4 py-6 text-sm text-muted-foreground">Memuat…</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
