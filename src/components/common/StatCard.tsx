import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

export function StatCard({
  label, value, hint, icon, to, tone = 'default',
}: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; to?: string; tone?: 'default' | 'warning' }) {
  const body = (
    <div className={cn('group h-full rounded-lg border bg-card p-4 transition-colors', to && 'hover:border-primary/50', tone === 'warning' && 'border-[#ecd3a6] bg-[#fffaf0]')}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {icon && <span className={cn('rounded-md p-1.5', tone === 'warning' ? 'bg-[#fbf0dc] text-warning' : 'bg-accent text-primary')}>{icon}</span>}
      </div>
      <p className="mt-2 text-[1.75rem] font-bold leading-none tabular text-foreground">{value}</p>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
  return to ? <Link to={to} className="block rounded-lg">{body}</Link> : body
}
