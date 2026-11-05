-- =============================================================================
-- Migration 004: View pencarian, statistik dashboard, laporan, backup/restore
-- =============================================================================

-- -----------------------------------------------------------------------------
-- View daftar arsip (security_invoker -> RLS tabel dasar tetap berlaku)
-- -----------------------------------------------------------------------------
create or replace view public.v_archive_list
with (security_invoker = true) as
select
  a.id,
  a.source_system,
  a.source_id,
  a.application_number,
  a.application_type,
  a.application_date,
  extract(year from a.application_date)::int as application_year,
  a.status,
  a.location,
  a.permit_location,
  a.archive_code,
  a.physical_location,
  a.access_level,
  a.notes,
  a.data_source,
  a.is_manually_edited,
  a.last_import_batch_id,
  a.created_by,
  a.created_at,
  a.updated_at,
  a.applicant_id,
  ap.full_name   as applicant_name,
  ap.nik         as applicant_nik,
  ap.phone       as applicant_phone,
  ap.email       as applicant_email,
  a.company_id,
  co.name        as company_name,
  a.permit_type_id,
  pt.name        as permit_type_name,
  pt.sector,
  a.classification_id,
  cl.code        as classification_code,
  cl.name        as classification_name,
  pm.id          as permit_id,
  pm.permit_number,
  pm.issued_date,
  pm.valid_until,
  pm.status      as permit_status,
  coalesce(ds.document_count, 0)::int as document_count,
  coalesce(ds.categories, '{}'::text[]) as document_categories,
  pt.required_documents,
  ms.missing as missing_documents,
  cardinality(ms.missing) = 0 as is_complete
from public.applications a
join public.applicants ap on ap.id = a.applicant_id
join public.permit_types pt on pt.id = a.permit_type_id
left join public.companies co on co.id = a.company_id
left join public.classifications cl on cl.id = a.classification_id
left join public.permits pm on pm.application_id = a.id
left join lateral (
  select count(*) as document_count, array_agg(distinct d.category) as categories
    from public.archive_documents d
   where d.application_id = a.id and d.is_latest and d.deleted_at is null
) ds on true
left join lateral (
  select coalesce(array_agg(x order by x), '{}'::text[]) as missing
    from unnest(pt.required_documents) x
   where not (x = any(coalesce(ds.categories, '{}'::text[])))
) ms on true;

-- -----------------------------------------------------------------------------
-- View daftar dokumen
-- -----------------------------------------------------------------------------
create or replace view public.v_document_list
with (security_invoker = true) as
select
  d.*,
  a.application_number,
  a.application_date,
  ap.full_name as applicant_name,
  pt.name      as permit_type_name,
  pm.permit_number,
  pr.full_name as uploaded_by_name
from public.archive_documents d
join public.applications a on a.id = d.application_id
join public.applicants ap on ap.id = a.applicant_id
join public.permit_types pt on pt.id = a.permit_type_id
left join public.permits pm on pm.application_id = a.id
left join public.profiles pr on pr.id = d.uploaded_by;

grant select on public.v_archive_list to authenticated;
grant select on public.v_document_list to authenticated;
revoke all on public.v_archive_list from anon;
revoke all on public.v_document_list from anon;

-- -----------------------------------------------------------------------------
-- Statistik dashboard (angka agregat dari data aktual)
-- -----------------------------------------------------------------------------
create or replace function public.get_dashboard_stats(p_year integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_can_see_logs boolean := public.has_any_role('super_admin', 'admin_arsip', 'pimpinan');
begin
  if not public.is_active_user() then
    raise exception 'Akun tidak aktif' using errcode = '42501';
  end if;

  with apps as (
    select a.*, pt.name as pt_name, pt.sector, pt.required_documents
      from public.applications a
      join public.permit_types pt on pt.id = a.permit_type_id
     where p_year is null or extract(year from a.application_date) = p_year
  ),
  docs as (
    select d.* from public.archive_documents d
      join apps on apps.id = d.application_id
     where d.is_latest and d.deleted_at is null
  ),
  completeness as (
    select apps.id,
           exists (
             select 1 from unnest(apps.required_documents) x
              where not exists (select 1 from docs where docs.application_id = apps.id and docs.category = x)
           ) as incomplete
      from apps
  )
  select jsonb_build_object(
    'year', p_year,
    'totals', jsonb_build_object(
      'applications', (select count(*) from apps),
      'permits', (select count(*) from public.permits pm join apps on apps.id = pm.application_id),
      'documents', (select count(*) from docs),
      'documents_size', (select coalesce(sum(file_size), 0) from docs),
      'applicants', (select count(distinct applicant_id) from apps),
      'companies', (select count(*) from public.companies),
      'permit_types', (select count(distinct permit_type_id) from apps),
      'incomplete', (select count(*) from completeness where incomplete),
      'in_process', (select count(*) from apps where status = 'proses')
    ),
    'per_year', coalesce((
      select jsonb_agg(jsonb_build_object('year', y, 'applications', n_app, 'permits', n_pm, 'documents', n_doc) order by y)
        from (
          select extract(year from a.application_date)::int as y,
                 count(*) as n_app,
                 count(pm.id) as n_pm,
                 coalesce(sum((select count(*) from public.archive_documents d
                                where d.application_id = a.id and d.is_latest and d.deleted_at is null)), 0) as n_doc
            from public.applications a
            left join public.permits pm on pm.application_id = a.id
           group by 1
        ) s), '[]'::jsonb),
    'per_month', coalesce((
      select jsonb_agg(jsonb_build_object('month', m, 'applications', n_app, 'permits', n_pm) order by m)
        from (
          select to_char(date_trunc('month', apps.application_date), 'YYYY-MM') as m,
                 count(*) as n_app,
                 count(pm.id) as n_pm
            from apps left join public.permits pm on pm.application_id = apps.id
           where p_year is not null or apps.application_date >= (date_trunc('month', current_date) - interval '11 months')
           group by 1
        ) s), '[]'::jsonb),
    'per_permit_type', coalesce((
      select jsonb_agg(jsonb_build_object('name', pt_name, 'count', n) order by n desc)
        from (select pt_name, count(*) as n from apps group by pt_name order by n desc limit 12) s), '[]'::jsonb),
    'per_sector', coalesce((
      select jsonb_agg(jsonb_build_object('sector', sector, 'count', n) order by n desc)
        from (select sector, count(*) as n from apps group by sector) s), '[]'::jsonb),
    'per_application_type', coalesce((
      select jsonb_agg(jsonb_build_object('type', application_type, 'count', n) order by n desc)
        from (select application_type, count(*) as n from apps group by application_type) s), '[]'::jsonb),
    'per_category', coalesce((
      select jsonb_agg(jsonb_build_object('category', category, 'count', n) order by n desc)
        from (select category, count(*) as n from docs group by category) s), '[]'::jsonb),
    'recent_imports', coalesce((
      select jsonb_agg(row_to_json(s)::jsonb order by s.created_at desc)
        from (
          select b.id, b.file_name, b.status, b.total_rows, b.inserted_count, b.updated_count,
                 b.unchanged_count, b.skipped_count, b.failed_count, b.created_at, b.finished_at,
                 p.full_name as imported_by_name
            from public.import_batches b left join public.profiles p on p.id = b.imported_by
           order by b.created_at desc limit 5
        ) s), '[]'::jsonb),
    'recent_activity', coalesce((
      select jsonb_agg(row_to_json(s)::jsonb order by s.created_at desc)
        from (
          select l.id, l.action, l.entity_type, l.description, l.created_at, l.user_email,
                 p.full_name as user_name
            from public.activity_logs l left join public.profiles p on p.id = l.user_id
           where v_can_see_logs or l.user_id = auth.uid()
           order by l.created_at desc limit 10
        ) s), '[]'::jsonb)
  ) into v;

  return v;
end;
$$;
revoke all on function public.get_dashboard_stats(integer) from public, anon;
grant execute on function public.get_dashboard_stats(integer) to authenticated;

-- Daftar tahun yang tersedia (filter dashboard & laporan)
create or replace function public.get_archive_years()
returns integer[]
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_active_user() then
    coalesce(array_agg(distinct extract(year from application_date)::int order by extract(year from application_date)::int desc), '{}')
  else '{}' end
  from public.applications
$$;
revoke all on function public.get_archive_years() from public, anon;
grant execute on function public.get_archive_years() to authenticated;

-- -----------------------------------------------------------------------------
-- Laporan rekap
-- -----------------------------------------------------------------------------
create or replace function public.report_summary(
  p_from date default null,
  p_to date default null,
  p_group text default 'permit_type'
)
returns table (
  label text,
  applications bigint,
  permits bigint,
  documents bigint,
  incomplete bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_user() then
    raise exception 'Akun tidak aktif' using errcode = '42501';
  end if;
  if p_group not in ('permit_type', 'sector', 'month', 'year', 'application_type', 'status', 'classification') then
    raise exception 'Pengelompokan laporan tidak dikenal' using errcode = '22023';
  end if;

  return query
  with apps as (
    select a.*, pt.name as pt_name, pt.sector, pt.required_documents,
           coalesce(cl.code || ' — ' || cl.name, 'Belum diklasifikasi') as cl_label
      from public.applications a
      join public.permit_types pt on pt.id = a.permit_type_id
      left join public.classifications cl on cl.id = a.classification_id
     where (p_from is null or a.application_date >= p_from)
       and (p_to is null or a.application_date <= p_to)
  ),
  enriched as (
    select apps.*,
           (select count(*) from public.archive_documents d
             where d.application_id = apps.id and d.is_latest and d.deleted_at is null) as n_docs,
           exists (
             select 1 from unnest(apps.required_documents) x
              where not exists (select 1 from public.archive_documents d
                                 where d.application_id = apps.id and d.category = x
                                   and d.is_latest and d.deleted_at is null)
           ) as is_incomplete,
           exists (select 1 from public.permits pm where pm.application_id = apps.id) as has_permit
      from apps
  )
  select
    case p_group
      when 'permit_type' then e.pt_name
      when 'sector' then e.sector
      when 'month' then to_char(date_trunc('month', e.application_date), 'YYYY-MM')
      when 'year' then extract(year from e.application_date)::int::text
      when 'application_type' then e.application_type
      when 'status' then e.status
      when 'classification' then e.cl_label
    end as label,
    count(*)::bigint as applications,
    count(*) filter (where e.has_permit)::bigint as permits,
    coalesce(sum(e.n_docs), 0)::bigint as documents,
    count(*) filter (where e.is_incomplete)::bigint as incomplete
  from enriched e
  group by 1
  order by case when p_group in ('month', 'year') then 1 else 0 end,
           case when p_group in ('month', 'year') then null else count(*) end desc nulls last,
           1;
end;
$$;
revoke all on function public.report_summary(date, date, text) from public, anon;
grant execute on function public.report_summary(date, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Backup & pemulihan (data tabel; file PDF dicadangkan terpisah — lihat docs)
-- -----------------------------------------------------------------------------
create or replace function public.backup_table_order()
returns text[]
language sql
immutable
as $$
  select array['roles','profiles','classifications','permit_types','applicants','companies',
               'import_batches','applications','permits','archive_documents','import_errors',
               'system_settings','activity_logs']
$$;

create or replace function public.export_backup()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  t text;
  v_tables jsonb := '{}'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_rows jsonb;
begin
  if not public.has_any_role('super_admin') then
    raise exception 'Hanya Super Admin yang dapat membuat cadangan' using errcode = '42501';
  end if;
  foreach t in array public.backup_table_order() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into v_rows;
    v_tables := v_tables || jsonb_build_object(t, v_rows);
    v_counts := v_counts || jsonb_build_object(t, jsonb_array_length(v_rows));
  end loop;

  perform public.write_activity_log('backup.export', 'system', null, 'Membuat cadangan data', null, null,
                                    jsonb_build_object('counts', v_counts));
  return jsonb_build_object(
    'app', 'e-arsip-perizinan-belu',
    'format_version', 1,
    'generated_at', now(),
    'counts', v_counts,
    'tables', v_tables
  );
end;
$$;
revoke all on function public.export_backup() from public, anon;
grant execute on function public.export_backup() to authenticated;

-- Pemulihan: upsert per id (data yang ada diperbarui, data baru ditambahkan;
-- tidak menghapus data). Seluruh proses berjalan dalam satu transaksi.
create or replace function public.restore_backup(p_data jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  t text;
  c text;
  v_cols text;
  v_set text;
  v_user_cols text[];
  v_result jsonb := '{}'::jsonb;
  v_rows jsonb;
  v_total integer;
  v_valid integer;
begin
  if not public.has_any_role('super_admin') then
    raise exception 'Hanya Super Admin yang dapat memulihkan data' using errcode = '42501';
  end if;
  if p_data->>'app' is distinct from 'e-arsip-perizinan-belu' or (p_data->>'format_version')::int <> 1 then
    raise exception 'File cadangan tidak dikenali atau versinya tidak didukung' using errcode = '22023';
  end if;

  perform set_config('app.restoring', 'on', true);

  -- Peta id peran lama -> kode, agar profil tetap mendapat peran yang benar
  -- walaupun id peran di proyek tujuan berbeda.
  create temp table _role_map on commit drop as
    select id as old_id, code
      from jsonb_populate_recordset(null::public.roles, coalesce(p_data->'tables'->'roles', '[]'::jsonb));

  foreach t in array public.backup_table_order() loop
    v_rows := coalesce(p_data->'tables'->t, '[]'::jsonb);
    v_total := jsonb_array_length(v_rows);
    if v_total = 0 then
      v_result := v_result || jsonb_build_object(t, jsonb_build_object('rows', 0, 'restored', 0));
      continue;
    end if;

    execute format('create temp table _restore on commit drop as
                    select * from jsonb_populate_recordset(null::public.%I, $1)', t) using v_rows;

    -- Profil hanya untuk akun auth yang ada
    if t = 'profiles' then
      delete from _restore r where not exists (select 1 from auth.users u where u.id = r.id);
      update _restore r
         set role_id = coalesce((select ro.id from public.roles ro join _role_map m on m.code = ro.code
                                  where m.old_id = r.role_id),
                                (select id from public.roles where code = 'operator'));
    end if;

    -- Referensi pengguna yang tidak ada dikosongkan
    select array_agg(column_name::text) into v_user_cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t
       and column_name in ('created_by','updated_by','uploaded_by','imported_by','manually_edited_by',
                           'deleted_by','user_id');
    if v_user_cols is not null then
      foreach c in array v_user_cols loop
        execute format('update _restore set %1$I = null where %1$I is not null
                         and not exists (select 1 from public.profiles p where p.id = _restore.%1$I)', c);
      end loop;
    end if;

    select count(*) into v_valid from _restore;

    if not p_dry_run then
      select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
             string_agg(format('%1$I = excluded.%1$I', column_name), ', ' order by ordinal_position)
             filter (where column_name <> 'id')
        into v_cols, v_set
        from information_schema.columns
       where table_schema = 'public' and table_name = t;

      if t = 'activity_logs' then
        execute format('insert into public.%I (%s) select %s from _restore on conflict (id) do nothing',
                       t, v_cols, v_cols);
      elsif t = 'system_settings' then
        execute format('insert into public.%I (%s) select %s from _restore on conflict (key) do update set value = excluded.value, description = excluded.description, is_public = excluded.is_public',
                       t, v_cols, v_cols);
      elsif t = 'roles' then
        update public.roles ro
           set name = r.name, description = r.description, permissions = r.permissions
          from _restore r
         where r.code = ro.code;
        insert into public.roles (code, name, description, permissions, is_system)
        select r.code, r.name, r.description, r.permissions, r.is_system
          from _restore r
         where not exists (select 1 from public.roles ro where ro.code = r.code);
      else
        execute format('insert into public.%I (%s) select %s from _restore on conflict (id) do update set %s',
                       t, v_cols, v_cols, v_set);
      end if;
    end if;

    v_result := v_result || jsonb_build_object(t, jsonb_build_object('rows', v_total, 'restored', v_valid));
    drop table _restore;
  end loop;

  if not p_dry_run then
    perform public.write_activity_log('backup.restore', 'system', null, 'Memulihkan data dari cadangan', null, null,
                                      jsonb_build_object('generated_at', p_data->'generated_at', 'result', v_result));
  end if;

  return jsonb_build_object('dry_run', p_dry_run, 'tables', v_result);
end;
$$;
revoke all on function public.restore_backup(jsonb, boolean) from public, anon;
grant execute on function public.restore_backup(jsonb, boolean) to authenticated;
