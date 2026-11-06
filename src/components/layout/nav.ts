import {
  Archive, BarChart3, CalendarClock, Table2, Building2, ClipboardList, FileBadge2, FileSearch, FileStack, FileUp, FolderTree,
  History, LayoutDashboard, ScrollText, Settings, Tags, Users, UserSquare2,
} from 'lucide-react'
import type { Permission } from '@/lib/permissions'

export interface NavItem {
  to: string
  label: string
  icon: typeof Archive
  permission?: Permission
  end?: boolean
}
export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV: NavGroup[] = [
  {
    label: 'Ringkasan',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/pencarian', label: 'Pencarian arsip', icon: FileSearch },
    ],
  },
  {
    label: 'Arsip perizinan',
    items: [
      { to: '/permohonan', label: 'Data permohonan', icon: ClipboardList },
      { to: '/izin', label: 'Izin terbit', icon: FileBadge2 },
      { to: '/dokumen', label: 'Dokumen PDF', icon: FileStack },
      { to: '/masa-berlaku', label: 'Masa berlaku izin', icon: CalendarClock },
    ],
  },
  {
    label: 'Data induk',
    items: [
      { to: '/pemohon', label: 'Pemohon', icon: UserSquare2 },
      { to: '/badan-usaha', label: 'Badan usaha', icon: Building2 },
      { to: '/jenis-izin', label: 'Jenis perizinan', icon: Tags },
      { to: '/klasifikasi', label: 'Klasifikasi arsip', icon: FolderTree },
    ],
  },
  {
    label: 'SiCANTIK',
    items: [
      { to: '/impor', label: 'Impor data', icon: FileUp, permission: 'import.run', end: true },
      { to: '/impor/riwayat', label: 'Riwayat impor', icon: History },
    ],
  },
  {
    label: 'Laporan & kontrol',
    items: [
      { to: '/laporan/rekap', label: 'Rekap izin', icon: Table2, permission: 'reports.view' },
      { to: '/laporan', label: 'Laporan', icon: BarChart3, permission: 'reports.view', end: true },
      { to: '/audit', label: 'Audit trail', icon: ScrollText, permission: 'audit.view' },
    ],
  },
  {
    label: 'Administrasi',
    items: [
      { to: '/pengguna', label: 'Pengguna & peran', icon: Users, permission: 'users.manage' },
      { to: '/pengaturan', label: 'Pengaturan & cadangan', icon: Settings, permission: 'settings.manage' },
    ],
  },
]

