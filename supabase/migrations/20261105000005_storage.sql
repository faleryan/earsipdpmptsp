-- =============================================================================
-- Migration 005: Supabase Storage — bucket privat dokumen arsip
-- =============================================================================
-- Struktur path: permohonan/{application_id}/{uuid}.pdf
-- Akses file hanya melalui signed URL berumur pendek. Kebijakan SELECT
-- mengikuti hak lihat baris archive_documents (tingkat akses dokumen).
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('arsip-dokumen', 'arsip-dokumen', false, 26214400, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Hak baca objek storage = hak lihat dokumen terkait
create or replace function public.can_read_storage_object(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.archive_documents d
     where d.storage_path = p_path
       and public.can_access_level(d.access_level, d.uploaded_by)
       and (d.deleted_at is null or public.has_any_role('super_admin', 'admin_arsip'))
  )
$$;
revoke all on function public.can_read_storage_object(text) from public, anon;
grant execute on function public.can_read_storage_object(text) to authenticated;

-- Objek yatim: file yang terunggah tetapi belum/tidak tercatat di archive_documents
create or replace function public.is_orphan_storage_object(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.archive_documents d where d.storage_path = p_path)
$$;
revoke all on function public.is_orphan_storage_object(text) from public, anon;
grant execute on function public.is_orphan_storage_object(text) to authenticated;

create policy "arsip_dokumen_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'arsip-dokumen'
  and (
    public.can_read_storage_object(name)
    -- pengunggah boleh membaca berkasnya sendiri sesaat setelah unggah
    or (owner_id = auth.uid()::text and public.is_orphan_storage_object(name))
  )
);

create policy "arsip_dokumen_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'arsip-dokumen'
  and public.has_any_role('super_admin', 'admin_arsip', 'operator')
  and name ~ '^permohonan/[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'
  and exists (
    select 1 from public.applications a
     where a.id = ((storage.foldername(name))[2])::uuid
  )
);

-- Penghapusan: Super Admin, atau pengunggah untuk berkas yatim
-- (pembersihan bila pencatatan metadata gagal).
create policy "arsip_dokumen_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'arsip-dokumen'
  and (
    public.has_any_role('super_admin')
    or (owner_id = auth.uid()::text and public.is_orphan_storage_object(name))
  )
);
-- Tidak ada policy UPDATE: berkas bersifat immutable; perubahan = versi baru.
