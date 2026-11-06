-- =============================================================================
-- Migration 008: Dokumen PDF untuk data OSS (file NIB, PKKPR, SPPL, SS, ...)
-- =============================================================================
-- Path storage: oss/{nib}/{uuid}.pdf di bucket privat "arsip-dokumen".
-- Dokumen terikat ke NIB; opsional ditautkan ke satu izin OSS (oss_permits).
-- =============================================================================

create table public.oss_documents (
  id                 uuid primary key default gen_random_uuid(),
  nib                text not null check (nib ~ '^[0-9]{13}$'),
  oss_permit_id      uuid references public.oss_permits(id) on delete set null,
  category           text not null check (category in ('nib','sertifikat_standar','pkkpr','sppl','pernyataan_mandiri',
                                                       'izin','persetujuan_lingkungan','dokumen_pendukung')),
  title              text not null check (length(btrim(title)) between 2 and 250),
  description        text,
  document_number    text check (length(document_number) <= 150),
  document_date      date,
  storage_bucket     text not null default 'arsip-dokumen',
  storage_path       text not null unique check (storage_path ~ '^oss/[0-9]{13}/[0-9a-f-]{36}\.pdf$'),
  file_name          text not null check (length(file_name) <= 255),
  file_size          bigint not null check (file_size > 0),
  mime_type          text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  checksum_sha256    text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  page_count         integer check (page_count is null or page_count > 0),
  document_group_id  uuid not null,
  version            integer not null default 1 check (version >= 1),
  is_latest          boolean not null default true,
  change_note        text,
  access_level       text not null default 'biasa' check (access_level in ('biasa','terbatas','rahasia')),
  uploaded_by        uuid references public.profiles(id) on delete set null default auth.uid(),
  deleted_at         timestamptz,
  deleted_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (document_group_id, version),
  check (storage_path like 'oss/' || nib || '/%')
);
create unique index oss_documents_latest_key on public.oss_documents(document_group_id) where is_latest and deleted_at is null;
create index oss_documents_nib_idx on public.oss_documents(nib) where deleted_at is null;
create index oss_documents_permit_idx on public.oss_documents(oss_permit_id);
create index oss_documents_checksum_idx on public.oss_documents(checksum_sha256);

create trigger oss_documents_set_updated_at before update on public.oss_documents
for each row execute function public.set_updated_at();

-- NIB dikenal bila ada di salah satu dari tiga ekspor OSS
create or replace function public.oss_nib_exists(p_nib text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.oss_businesses where nib = p_nib)
      or exists (select 1 from public.oss_projects where nib = p_nib)
      or exists (select 1 from public.oss_permits where nib = p_nib)
$$;
revoke all on function public.oss_nib_exists(text) from public, anon;
grant execute on function public.oss_nib_exists(text) to authenticated;

-- Versi otomatis + kunci kolom file (sama seperti archive_documents)
create or replace function public.oss_documents_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer;
  v_nib text;
begin
  if coalesce(current_setting('app.restoring', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
    new.deleted_at := null;
    new.deleted_by := null;
    if new.oss_permit_id is not null and not exists (
      select 1 from public.oss_permits where id = new.oss_permit_id and nib = new.nib) then
      raise exception 'Izin OSS yang dipilih bukan milik NIB ini' using errcode = '22023';
    end if;
    if new.document_group_id is null then
      new.document_group_id := new.id;
      new.version := 1;
    else
      perform pg_advisory_xact_lock(hashtext(new.document_group_id::text));
      select max(version), max(nib) into v_max, v_nib from public.oss_documents where document_group_id = new.document_group_id;
      if v_max is null then
        raise exception 'Dokumen induk untuk versi baru tidak ditemukan' using errcode = 'P0002';
      end if;
      if v_nib <> new.nib then
        raise exception 'Versi baru harus untuk NIB yang sama' using errcode = '22023';
      end if;
      new.version := v_max + 1;
      update public.oss_documents set is_latest = false where document_group_id = new.document_group_id and is_latest;
    end if;
    new.is_latest := true;
    return new;
  end if;
  -- UPDATE: metadata file tidak dapat diubah
  new.nib := old.nib;
  new.storage_bucket := old.storage_bucket;
  new.storage_path := old.storage_path;
  new.file_name := old.file_name;
  new.file_size := old.file_size;
  new.mime_type := old.mime_type;
  new.checksum_sha256 := old.checksum_sha256;
  new.document_group_id := old.document_group_id;
  new.version := old.version;
  new.uploaded_by := old.uploaded_by;
  new.created_at := old.created_at;
  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger oss_documents_before_write before insert or update on public.oss_documents
for each row execute function public.oss_documents_before_write();

create trigger oss_documents_audit after insert or update or delete on public.oss_documents
for each row execute function public.audit_row_change();

-- RLS (sama dengan dokumen arsip)
alter table public.oss_documents enable row level security;
revoke all on public.oss_documents from anon;
create policy oss_documents_select on public.oss_documents for select to authenticated
  using (public.can_access_level(access_level, uploaded_by)
         and (deleted_at is null or public.has_any_role('super_admin', 'admin_arsip')));
create policy oss_documents_insert on public.oss_documents for insert to authenticated
  with check (public.has_any_role('super_admin', 'admin_arsip', 'operator')
              and public.oss_nib_exists(nib)
              and (access_level <> 'rahasia' or public.has_any_role('super_admin', 'admin_arsip')));
create policy oss_documents_update on public.oss_documents for update to authenticated
  using (public.has_any_role('super_admin', 'admin_arsip')
         or (public.has_any_role('operator') and uploaded_by = auth.uid() and deleted_at is null))
  with check (public.has_any_role('super_admin', 'admin_arsip')
         or (public.has_any_role('operator') and uploaded_by = auth.uid() and deleted_at is null and access_level <> 'rahasia'));
create policy oss_documents_delete on public.oss_documents for delete to authenticated
  using (public.has_any_role('super_admin'));

-- -----------------------------------------------------------------------------
-- Storage: perluas fungsi baca & yatim, tambah policy unggah path oss/
-- -----------------------------------------------------------------------------
create or replace function public.can_read_storage_object(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.archive_documents d
     where d.storage_path = p_path
       and public.can_access_level(d.access_level, d.uploaded_by)
       and (d.deleted_at is null or public.has_any_role('super_admin', 'admin_arsip'))
  ) or exists (
    select 1 from public.oss_documents d
     where d.storage_path = p_path
       and public.can_access_level(d.access_level, d.uploaded_by)
       and (d.deleted_at is null or public.has_any_role('super_admin', 'admin_arsip'))
  )
$$;

create or replace function public.is_orphan_storage_object(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.archive_documents d where d.storage_path = p_path)
     and not exists (select 1 from public.oss_documents d where d.storage_path = p_path)
$$;

create policy "arsip_dokumen_insert_oss"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'arsip-dokumen'
  and public.has_any_role('super_admin', 'admin_arsip', 'operator')
  and name ~ '^oss/[0-9]{13}/[0-9a-f-]{36}\.pdf$'
  and public.oss_nib_exists((storage.foldername(name))[2])
);

-- -----------------------------------------------------------------------------
-- View: kelengkapan dokumen per pelaku usaha & per izin
-- -----------------------------------------------------------------------------
create or replace view public.v_oss_document_list
with (security_invoker = true) as
select d.*, coalesce(b.name, p.company_name) as company_name, p.document_name as permit_document_name,
       p.permit_request_id, pr.full_name as uploaded_by_name
  from public.oss_documents d
  left join public.oss_businesses b on b.nib = d.nib
  left join public.oss_permits p on p.id = d.oss_permit_id
  left join public.profiles pr on pr.id = d.uploaded_by;
grant select on public.v_oss_document_list to authenticated;
revoke all on public.v_oss_document_list from anon;

-- Kolom tambahan pada v_oss_business (dibuat ulang)
drop view if exists public.v_oss_business;
create view public.v_oss_business
with (security_invoker = true) as
with nibs as (
  select nib from public.oss_businesses
  union select nib from public.oss_projects
  union select nib from public.oss_permits where nib is not null
),
pj as (
  select nib, count(*) as project_count, sum(investment) as investment, sum(workers) as workers,
         min(oss_issued_date) as issued, max(company_name) as company_name, max(company_type) as company_type,
         max(business_scale) as business_scale, max(kecamatan) as kecamatan, max(kelurahan) as kelurahan, max(address) as address
    from public.oss_projects group by nib
),
pm as (
  select nib, count(*) as permit_count, max(permit_date) as last_permit_date, min(oss_issued_date) as issued,
         max(company_name) as company_name, max(kecamatan) as kecamatan, max(kelurahan) as kelurahan
    from public.oss_permits group by nib
),
dc as (
  select nib, count(*) as document_count, bool_or(category = 'nib') as has_nib_document
    from public.oss_documents where is_latest and deleted_at is null group by nib
)
select
  n.nib,
  coalesce(b.name, pj.company_name, pm.company_name) as name,
  coalesce(b.oss_issued_date, pj.issued, pm.issued) as oss_issued_date,
  coalesce(b.company_type, pj.company_type) as company_type,
  coalesce(b.business_scale, pj.business_scale) as business_scale,
  b.investment_status,
  coalesce(b.address, pj.address) as address,
  coalesce(b.kecamatan, pj.kecamatan, pm.kecamatan) as kecamatan,
  coalesce(b.kelurahan, pj.kelurahan, pm.kelurahan) as kelurahan,
  b.id is not null as has_nib_record,
  coalesce(pj.project_count, 0)::int as project_count,
  coalesce(pm.permit_count, 0)::int as permit_count,
  coalesce(pj.investment, 0) as investment,
  coalesce(pj.workers, 0)::int as workers,
  pm.last_permit_date,
  coalesce(dc.document_count, 0)::int as document_count,
  coalesce(dc.has_nib_document, false) as has_nib_document
from nibs n
left join public.oss_businesses b on b.nib = n.nib
left join pj on pj.nib = n.nib
left join pm on pm.nib = n.nib
left join dc on dc.nib = n.nib;
grant select on public.v_oss_business to authenticated;
revoke all on public.v_oss_business from anon;

create or replace view public.v_oss_permit
with (security_invoker = true) as
select p.*, pr.id as project_record_id, pr.project_name, pr.kbli_title, pr.risk_level as project_risk, pr.business_scale, pr.investment,
       (select count(*) from public.oss_documents d where d.oss_permit_id = p.id and d.is_latest and d.deleted_at is null)::int as document_count
  from public.oss_permits p
  left join public.oss_projects pr on pr.project_id = p.project_id;

-- Daftar NIB ringkas untuk pencocokan unggah massal (nib + nama)
create or replace function public.oss_nib_directory()
returns table (nib text, name text, has_nib_document boolean)
language sql
stable
security definer
set search_path = public
as $$
  select b.nib, b.name, b.has_nib_document from public.v_oss_business b where public.is_active_user()
$$;
revoke all on function public.oss_nib_directory() from public, anon;
grant execute on function public.oss_nib_directory() to authenticated;

-- Ringkasan OSS: tambahkan statistik dokumen
create or replace function public.get_oss_document_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_active_user() then jsonb_build_object(
    'documents', (select count(*) from public.oss_documents where is_latest and deleted_at is null),
    'size', (select coalesce(sum(file_size), 0) from public.oss_documents where is_latest and deleted_at is null),
    'businesses', (select count(*) from public.v_oss_business),
    'with_nib_document', (select count(*) from public.v_oss_business where has_nib_document),
    'per_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'count', n) order by n desc)
       from (select category, count(*) n from public.oss_documents where is_latest and deleted_at is null group by 1) s), '[]'::jsonb)
  ) else null end
$$;
revoke all on function public.get_oss_document_stats() from public, anon;
grant execute on function public.get_oss_document_stats() to authenticated;

-- Cadangan
create or replace function public.backup_table_order()
returns text[]
language sql
immutable
as $$
  select array['roles','profiles','classifications','permit_types','applicants','companies',
               'import_batches','applications','permits','archive_documents','import_errors',
               'system_settings','activity_logs','oss_businesses','oss_projects','oss_permits','oss_documents']
$$;
