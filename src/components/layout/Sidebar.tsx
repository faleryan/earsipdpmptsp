import { NavLink } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import { NAV } from './nav'

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 64 64" className="size-9 shrink-0" aria-hidden>
        <rect width="64" height="64" rx="14" fill="#1F6FD1" />
        <path d="M14 22h14l4 4h18v24a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2z" fill="#0B2240" opacity=".35" />
        <path d="M14 18a2 2 0 0 1 2-2h10l4 4h18a2 2 0 0 1 2 2v4H14z" fill="#fff" />
        <rect x="22" y="34" width="20" height="3" rx="1.5" fill="#fff" />
        <rect x="22" y="41" width="13" height="3" rx="1.5" fill="#fff" />
      </svg>
      {!compact && (
        <div className="leading-tight">
          <p className="text-[15px] font-bold text-white">E-Arsip Perizinan</p>
          <p className="text-xs text-navy-text">DPMPTSP Kabupaten Belu</p>
        </div>
      )}
    </div>
  )
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth()
  return (
    <nav aria-label="Navigasi utama" className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.permission || can(i.permission))
        if (!items.length) return null
        return (
          <div key={group.label}>
            <p className="px-3 pb-1.5 text-xs font-medium text-[#7f95b5]">{group.label}</p>
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-navy-soft text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-[#5aa2ff]'
                          : 'text-navy-text hover:bg-navy-soft/60 hover:text-white',
                      )
                    }
                  >
                    <item.icon className="size-[18px] shrink-0" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-navy-line bg-navy lg:flex">
      <div className="px-5 py-5"><BrandMark /></div>
      <SidebarNav />
      <div className="border-t border-navy-line px-5 py-3 text-[11px] leading-snug text-[#7f95b5]">
        Sumber data layanan: SiCANTIK Cloud.<br />Arsip ini hanya untuk penggunaan internal.
      </div>
    </aside>
  )
}
