import type { RoleCode } from '@/types'

/**
 * Matriks hak akses di sisi antarmuka. Ini HANYA mengatur tampilan tombol/menu;
 * penegakan sebenarnya ada pada Row Level Security di database.
 */
export type Permission =
  | 'archive.write'
  | 'archive.delete'
  | 'archive.edit_all'
  | 'documents.upload'
  | 'documents.manage'
  | 'documents.secret'
  | 'master.manage'
  | 'import.run'
  | 'reports.view'
  | 'audit.view'
  | 'users.manage'
  | 'settings.manage'
  | 'backup.manage'
  | 'pii.view'

const MATRIX: Record<RoleCode, Permission[]> = {
  super_admin: [
    'archive.write', 'archive.delete', 'archive.edit_all', 'documents.upload', 'documents.manage', 'documents.secret',
    'master.manage', 'import.run', 'reports.view', 'audit.view', 'users.manage', 'settings.manage', 'backup.manage', 'pii.view',
  ],
  admin_arsip: [
    'archive.write', 'archive.delete', 'archive.edit_all', 'documents.upload', 'documents.manage', 'documents.secret',
    'master.manage', 'import.run', 'reports.view', 'audit.view', 'pii.view',
  ],
  operator: ['archive.write', 'documents.upload'],
  pimpinan: ['reports.view', 'audit.view'],
}

export function can(role: RoleCode | null | undefined, permission: Permission) {
  if (!role) return false
  return MATRIX[role]?.includes(permission) ?? false
}
