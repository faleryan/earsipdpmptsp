import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { LogOut, Menu, Search, UserRound, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ROLE_LABELS } from '@/lib/constants'
import { BrandMark, SidebarNav } from './Sidebar'

export function Topbar() {
  const { profile, role, signOut } = useAuth()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const initials = (profile?.full_name || profile?.email || '?').split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur md:px-6">
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Trigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Buka menu"><Menu /></Button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[#0b2240]/50 lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-navy data-[state=open]:animate-in data-[state=open]:slide-in-from-left lg:hidden">
            <DialogPrimitive.Title className="sr-only">Menu navigasi</DialogPrimitive.Title>
            <div className="flex items-center justify-between px-5 py-5">
              <BrandMark />
              <DialogPrimitive.Close className="rounded p-1 text-navy-text hover:text-white" aria-label="Tutup menu"><X className="size-5" /></DialogPrimitive.Close>
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <form
        role="search"
        className="relative max-w-xl flex-1"
        onSubmit={(e) => {
          e.preventDefault()
          navigate(`/pencarian?q=${encodeURIComponent(q.trim())}`)
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari nomor permohonan, nama pemohon, NIK, atau nomor izin"
          aria-label="Pencarian arsip cepat"
          className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground/80 focus-visible:bg-card focus-visible:outline-2 focus-visible:outline-ring"
        />
      </form>

      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted" aria-label="Menu akun">
              <span className="flex size-9 items-center justify-center rounded-full bg-navy text-sm font-bold text-white">{initials}</span>
              <span className="hidden leading-tight md:block">
                <span className="block max-w-44 truncate text-sm font-semibold">{profile?.full_name || profile?.email}</span>
                <span className="block text-xs text-muted-foreground">{role ? ROLE_LABELS[role] : '—'}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">{profile?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link to="/profil"><UserRound /> Profil & kata sandi</Link></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void signOut()}><LogOut /> Keluar</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
