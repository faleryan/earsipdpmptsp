// Edge Function: manajemen akun oleh Super Admin (membuat akun, atur ulang kata sandi, hapus akun).
// Deploy: supabase functions deploy admin-users
// Membutuhkan secret bawaan SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (otomatis tersedia).
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*'
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const ROLES = ['super_admin', 'admin_arsip', 'operator', 'pimpinan']
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const UUID_RE = /^[0-9a-f-]{36}$/i

function validPassword(p: unknown): p is string {
  return typeof p === 'string' && p.length >= 10 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Metode tidak didukung' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Tidak terautentikasi' }, 401)

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return json({ error: 'Sesi tidak valid' }, 401)

  const { data: role, error: roleErr } = await userClient.rpc('current_role_code')
  if (roleErr || role !== 'super_admin') return json({ error: 'Hanya Super Admin yang dapat mengelola akun' }, 403)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Format permintaan tidak valid' }, 400)
  }

  const log = (action: string, entityId: string | null, description: string, metadata: Record<string, unknown> = {}) =>
    userClient.rpc('log_activity', { p_action: action, p_entity_type: 'profiles', p_entity_id: entityId, p_description: description, p_metadata: metadata })

  try {
    switch (body.action) {
      case 'create': {
        const email = String(body.email ?? '').trim().toLowerCase()
        const fullName = String(body.full_name ?? '').trim()
        const roleCode = String(body.role_code ?? '')
        if (!EMAIL_RE.test(email)) return json({ error: 'Format email tidak valid' }, 400)
        if (fullName.length < 2) return json({ error: 'Nama lengkap wajib diisi' }, 400)
        if (!ROLES.includes(roleCode)) return json({ error: 'Peran tidak dikenal' }, 400)
        if (!validPassword(body.password)) return json({ error: 'Kata sandi minimal 10 karakter dengan huruf besar, huruf kecil, dan angka' }, 400)

        const { data: created, error } = await admin.auth.admin.createUser({
          email, password: body.password, email_confirm: true, user_metadata: { full_name: fullName },
        })
        if (error) {
          const msg = /already|registered|exists/i.test(error.message) ? 'Email sudah terdaftar' : error.message
          return json({ error: msg }, 400)
        }
        const { data: roleRow } = await admin.from('roles').select('id').eq('code', roleCode).single()
        const { error: pErr } = await admin.from('profiles').update({
          full_name: fullName,
          nip: body.nip ? String(body.nip).trim() : null,
          position: body.position ? String(body.position).trim() : null,
          phone: body.phone ? String(body.phone).trim() : null,
          role_id: roleRow!.id,
          is_active: true,
        }).eq('id', created.user.id)
        if (pErr) {
          await admin.auth.admin.deleteUser(created.user.id)
          return json({ error: `Profil gagal dibuat: ${pErr.message}` }, 400)
        }
        await log('user.create', created.user.id, `Membuat akun ${email} sebagai ${roleCode}`, { email, role: roleCode })
        return json({ id: created.user.id })
      }

      case 'reset_password': {
        const id = String(body.user_id ?? '')
        if (!UUID_RE.test(id)) return json({ error: 'ID pengguna tidak valid' }, 400)
        if (!validPassword(body.password)) return json({ error: 'Kata sandi minimal 10 karakter dengan huruf besar, huruf kecil, dan angka' }, 400)
        const { error } = await admin.auth.admin.updateUserById(id, { password: body.password })
        if (error) return json({ error: error.message }, 400)
        await log('user.reset_password', id, 'Mengatur ulang kata sandi pengguna')
        return json({ ok: true })
      }

      case 'delete': {
        const id = String(body.user_id ?? '')
        if (!UUID_RE.test(id)) return json({ error: 'ID pengguna tidak valid' }, 400)
        if (id === user.id) return json({ error: 'Anda tidak dapat menghapus akun sendiri' }, 400)
        const { data: target } = await admin.from('profiles').select('email, is_active, role:roles(code)').eq('id', id).single()
        if ((target?.role as { code?: string } | null)?.code === 'super_admin' && target?.is_active) {
          const { count } = await admin.from('profiles').select('id, roles!inner(code)', { count: 'exact', head: true })
            .eq('roles.code', 'super_admin').eq('is_active', true)
          if ((count ?? 0) <= 1) return json({ error: 'Super Admin aktif terakhir tidak dapat dihapus' }, 400)
        }
        await log('user.delete', id, `Menghapus akun ${target?.email ?? id}`)
        const { error } = await admin.auth.admin.deleteUser(id)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      default:
        return json({ error: 'Aksi tidak dikenal' }, 400)
    }
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Kesalahan server' }, 500)
  }
})
