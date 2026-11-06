import { lazy, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { AppLayout } from '@/components/layout/AppLayout'
import { FullPageLoader } from '@/components/common/States'
import { isSupabaseConfigured } from '@/lib/supabase'
import type { Permission } from '@/lib/permissions'
import { LoginPage, ForgotPasswordPage, UpdatePasswordPage, InactiveAccountPage, ConfigMissingPage } from '@/pages/AuthPages'

const DashboardPage = lazy(() => import('@/pages/DashboardPage'))
const ApplicationsPage = lazy(() => import('@/pages/ApplicationsPage'))
const ApplicationDetailPage = lazy(() => import('@/pages/ApplicationDetailPage'))
const PermitsPage = lazy(() => import('@/pages/PermitsPage'))
const DocumentsPage = lazy(() => import('@/pages/DocumentsPage'))
const ApplicantsPage = lazy(() => import('@/pages/ApplicantsPage'))
const CompaniesPage = lazy(() => import('@/pages/CompaniesPage'))
const PermitTypesPage = lazy(() => import('@/pages/PermitTypesPage'))
const ClassificationsPage = lazy(() => import('@/pages/ClassificationsPage'))
const SearchPage = lazy(() => import('@/pages/SearchPage'))
const ImportPage = lazy(() => import('@/pages/import/ImportPage'))
const ImportHistoryPage = lazy(() => import('@/pages/import/ImportHistoryPage'))
const ImportBatchPage = lazy(() => import('@/pages/import/ImportBatchPage'))
const ReportsPage = lazy(() => import('@/pages/ReportsPage'))
const RecapPage = lazy(() => import('@/pages/RecapPage'))
const ExpiryPage = lazy(() => import('@/pages/ExpiryPage'))
const AuditPage = lazy(() => import('@/pages/AuditPage'))
const UsersPage = lazy(() => import('@/pages/UsersPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, profile, loading, role } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageLoader label="Memeriksa sesi…" />
  if (!session) return <Navigate to="/masuk" replace state={{ from: location }} />
  if (!profile) return <FullPageLoader label="Memuat profil…" />
  if (!role) return <InactiveAccountPage />
  return <>{children}</>
}

function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth()
  if (!can(permission)) return <NotFoundPage forbidden />
  return <>{children}</>
}

export default function App() {
  if (!isSupabaseConfigured) return <ConfigMissingPage />
  return (
    <Routes>
      <Route path="/masuk" element={<LoginPage />} />
      <Route path="/lupa-sandi" element={<ForgotPasswordPage />} />
      <Route path="/atur-sandi" element={<UpdatePasswordPage />} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="pencarian" element={<SearchPage />} />
        <Route path="permohonan" element={<ApplicationsPage />} />
        <Route path="permohonan/:id" element={<ApplicationDetailPage />} />
        <Route path="izin" element={<PermitsPage />} />
        <Route path="dokumen" element={<DocumentsPage />} />
        <Route path="pemohon" element={<ApplicantsPage />} />
        <Route path="badan-usaha" element={<CompaniesPage />} />
        <Route path="jenis-izin" element={<PermitTypesPage />} />
        <Route path="klasifikasi" element={<ClassificationsPage />} />
        <Route path="impor" element={<RequirePermission permission="import.run"><ImportPage /></RequirePermission>} />
        <Route path="impor/riwayat" element={<ImportHistoryPage />} />
        <Route path="impor/:id" element={<ImportBatchPage />} />
        <Route path="laporan" element={<RequirePermission permission="reports.view"><ReportsPage /></RequirePermission>} />
        <Route path="laporan/rekap" element={<RequirePermission permission="reports.view"><RecapPage /></RequirePermission>} />
        <Route path="masa-berlaku" element={<ExpiryPage />} />
        <Route path="audit" element={<RequirePermission permission="audit.view"><AuditPage /></RequirePermission>} />
        <Route path="pengguna" element={<RequirePermission permission="users.manage"><UsersPage /></RequirePermission>} />
        <Route path="pengaturan" element={<RequirePermission permission="settings.manage"><SettingsPage /></RequirePermission>} />
        <Route path="profil" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
