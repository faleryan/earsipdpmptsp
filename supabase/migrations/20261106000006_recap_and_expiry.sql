-- =============================================================================
-- Migration 006: Rekap izin harian/mingguan/bulanan & notifikasi masa berlaku
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Pengelompokan baris laporan (seperti "A. PERIZINAN BERUSAHA BERBASIS RISIKO")
-- -----------------------------------------------------------------------------
alter table public.permit_types
  add column if not exists report_group text check (length(report_group) <= 200),
  add column if not exists report_order integer not null default 0;
create index if not exists permit_types_report_idx on public.permit_types(report_group, report_order);

-- -----------------------------------------------------------------------------
-- Hitungan per hari (bahan matriks rekap). Klien mengelompokkan menjadi
-- kolom harian, mingguan, atau bulanan dan baris per jenis izin / lokasi.
--   p_basis: 'issued'      -> tanggal penetapan izin (izin terbit)
--            'application' -> tanggal permohonan
-- -----------------------------------------------------------------------------
create or replace function public.report_daily_counts(
  p_from date,
  p_to date,
  p_basis text default 'issued'
)
returns table (
  day date,
  permit_type_id uuid,
  application_type text,
  location text,
  total bigint
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
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Rentang tanggal tidak valid' using errcode = '22023';
  end if;
  if p_to - p_from > 1100 then
    raise exception 'Rentang tanggal maksimal 3 tahun' using errcode = '22023';
  end if;
  if p_basis not in ('issued', 'application') then
    raise exception 'Dasar tanggal tidak dikenal' using errcode = '22023';
  end if;

  if p_basis = 'issued' then
    return query
      select pm.issued_date, a.permit_type_id, a.application_type,
             nullif(upper(regexp_replace(btrim(coalesce(a.permit_location, a.location, '')), '\s+', ' ', 'g')), ''),
             count(*)::bigint
        from public.permits pm
        join public.applications a on a.id = pm.application_id
       where pm.issued_date between p_from and p_to
       group by 1, 2, 3, 4;
  else
    return query
      select a.application_date, a.permit_type_id, a.application_type,
             nullif(upper(regexp_replace(btrim(coalesce(a.permit_location, a.location, '')), '\s+', ' ', 'g')), ''),
             count(*)::bigint
        from public.applications a
       where a.application_date between p_from and p_to
       group by 1, 2, 3, 4;
  end if;
end;
$$;
revoke all on function public.report_daily_counts(date, date, text) from public, anon;
grant execute on function public.report_daily_counts(date, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Masa berlaku izin
-- -----------------------------------------------------------------------------
alter table public.permits
  add column if not exists renewal_notified_at timestamptz,
  add column if not exists renewal_notified_by uuid references public.profiles(id) on delete set null,
  add column if not exists renewal_note text check (length(renewal_note) <= 1000);
create index if not exists permits_valid_until_idx on public.permits(valid_until) where valid_until is not null;

-- Tanggal hari ini menurut WITA (Kabupaten Belu)
create or replace function public.today_wita()
returns date
language sql
stable
as $$ select (now() at time zone 'Asia/Makassar')::date $$;
grant execute on function public.today_wita() to authenticated;

create or replace view public.v_permit_expiry
with (security_invoker = true) as
select
  pm.id               as permit_id,
  pm.permit_number,
  pm.issued_date,
  pm.valid_until,
  pm.status           as permit_status,
  (pm.valid_until - public.today_wita())::int as days_left,
  pm.renewal_notified_at,
  pm.renewal_note,
  rn.full_name        as renewal_notified_by_name,
  a.id                as application_id,
  a.application_number,
  a.application_type,
  coalesce(a.permit_location, a.location) as permit_location,
  a.access_level,
  ap.id               as applicant_id,
  ap.full_name        as applicant_name,
  ap.phone            as applicant_phone,
  ap.email            as applicant_email,
  co.name             as company_name,
  pt.id               as permit_type_id,
  pt.name             as permit_type_name,
  pt.sector,
  rw.id               as renewal_application_id,
  rw.application_number as renewal_application_number,
  rw.id is not null   as is_renewed
from public.permits pm
join public.applications a on a.id = pm.application_id
join public.applicants ap on ap.id = a.applicant_id
join public.permit_types pt on pt.id = a.permit_type_id
left join public.companies co on co.id = a.company_id
left join public.profiles rn on rn.id = pm.renewal_notified_by
left join lateral (
  -- Dianggap sudah diperpanjang bila ada permohonan perpanjangan/perubahan
  -- jenis izin yang sama oleh pemohon yang sama setelah izin ini terbit.
  select a2.id, a2.application_number
    from public.applications a2
   where a2.applicant_id = a.applicant_id
     and a2.permit_type_id = a.permit_type_id
     and a2.id <> a.id
     and a2.application_type in ('Perpanjangan', 'Perubahan')
     and a2.application_date >= coalesce(pm.issued_date, a.application_date)
   order by a2.application_date desc
   limit 1
) rw on true
where pm.valid_until is not null;

grant select on public.v_permit_expiry to authenticated;
revoke all on public.v_permit_expiry from anon;

-- Ringkasan untuk lonceng notifikasi & dashboard
create or replace function public.get_expiry_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_thresholds int[];
  v_max int;
  v jsonb;
begin
  if not public.is_active_user() then
    raise exception 'Akun tidak aktif' using errcode = '42501';
  end if;
  select coalesce(array_agg(x::int order by x::int desc), array[6,3,1])
    into v_thresholds
    from jsonb_array_elements_text(coalesce(
      (select value from public.system_settings where key = 'notifications.expiry_thresholds_months'), '[6,3,1]'::jsonb)) x;
  v_max := v_thresholds[1];

  with base as (
    select pm.id, pm.valid_until, pm.renewal_notified_at,
           (pm.valid_until - public.today_wita()) as days_left
      from public.permits pm
      join public.applications a on a.id = pm.application_id
     where pm.valid_until is not null
       and pm.status = 'aktif'
       and pm.valid_until <= (public.today_wita() + make_interval(months => v_max))::date
       and pm.valid_until >= public.today_wita() - 90
       and public.can_access_level(a.access_level, a.created_by)
       and not exists (
         select 1 from public.applications a2
          where a2.applicant_id = a.applicant_id and a2.permit_type_id = a.permit_type_id and a2.id <> a.id
            and a2.application_type in ('Perpanjangan', 'Perubahan')
            and a2.application_date >= coalesce(pm.issued_date, a.application_date))
  )
  select jsonb_build_object(
    'thresholds', to_jsonb(v_thresholds),
    'today', public.today_wita(),
    'expired', (select count(*) from base where days_left < 0),
    'buckets', (
      select coalesce(jsonb_agg(jsonb_build_object('months', t, 'count',
        (select count(*) from base where days_left >= 0
           and valid_until <= (public.today_wita() + make_interval(months => t))::date)) order by t), '[]'::jsonb)
        from unnest(v_thresholds) t),
    'not_notified', (select count(*) from base where renewal_notified_at is null),
    'without_validity', (select count(*) from public.permits where valid_until is null and status = 'aktif'),
    'nearest', coalesce((
      select jsonb_agg(row_to_json(s)::jsonb order by s.valid_until)
        from (
          select e.permit_id, e.application_id, e.permit_number, e.permit_type_name, e.applicant_name,
                 e.valid_until, e.days_left, e.renewal_notified_at
            from public.v_permit_expiry e
           where e.permit_id in (select id from base)
           order by e.valid_until
           limit 6
        ) s), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
revoke all on function public.get_expiry_summary() from public, anon;
grant execute on function public.get_expiry_summary() to authenticated;

-- Hitung ulang masa berlaku dari jenis izin (validity_years).
-- Tidak menandai edit manual karena merupakan perhitungan sistem; nilai yang
-- pernah diubah manual tidak disentuh.
create or replace function public.recalculate_permit_validity(p_permit_type_id uuid, p_overwrite boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_years int;
  v_name text;
  v_count int;
begin
  if not public.has_any_role('super_admin', 'admin_arsip') then
    raise exception 'Anda tidak memiliki hak untuk tindakan ini' using errcode = '42501';
  end if;
  select validity_years, name into v_years, v_name from public.permit_types where id = p_permit_type_id;
  if not found then
    raise exception 'Jenis izin tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_years is null then
    return 0;
  end if;

  perform set_config('app.importing', 'on', true);
  update public.permits pm
     set valid_until = (pm.issued_date + make_interval(years => v_years))::date,
         updated_by = auth.uid()
    from public.applications a
   where a.id = pm.application_id
     and a.permit_type_id = p_permit_type_id
     and pm.issued_date is not null
     and not ('valid_until' = any(pm.manually_edited_fields))
     and (pm.valid_until is null or p_overwrite);
  get diagnostics v_count = row_count;
  perform set_config('app.importing', 'off', true);

  perform public.write_activity_log('permit.recalculate_validity', 'permit_types', p_permit_type_id::text,
    format('Menghitung ulang masa berlaku %s izin "%s" (%s tahun)', v_count, v_name, v_years),
    null, null, jsonb_build_object('count', v_count, 'years', v_years, 'overwrite', p_overwrite));
  return v_count;
end;
$$;
revoke all on function public.recalculate_permit_validity(uuid, boolean) from public, anon;
grant execute on function public.recalculate_permit_validity(uuid, boolean) to authenticated;

-- Tandai izin sudah diingatkan ke pemegang izin (Operator juga boleh)
create or replace function public.mark_permit_reminded(p_permit_id uuid, p_note text default null, p_clear boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_no text;
begin
  if not public.has_any_role('super_admin', 'admin_arsip', 'operator') then
    raise exception 'Anda tidak memiliki hak untuk tindakan ini' using errcode = '42501';
  end if;
  select permit_number into v_no from public.permits where id = p_permit_id;
  if not found then
    raise exception 'Izin tidak ditemukan' using errcode = 'P0002';
  end if;
  update public.permits
     set renewal_notified_at = case when p_clear then null else now() end,
         renewal_notified_by = case when p_clear then null else auth.uid() end,
         renewal_note = case when p_clear then null else left(nullif(btrim(p_note), ''), 1000) end
   where id = p_permit_id;
  perform public.write_activity_log(case when p_clear then 'permit.reminder_cleared' else 'permit.reminded' end,
    'permits', p_permit_id::text,
    case when p_clear then format('Membatalkan tanda pengingat izin %s', v_no)
         else format('Mengingatkan pemegang izin %s tentang masa berlaku', v_no) end,
    null, null, jsonb_build_object('note', p_note));
end;
$$;
revoke all on function public.mark_permit_reminded(uuid, text, boolean) from public, anon;
grant execute on function public.mark_permit_reminded(uuid, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Pengaturan baru
-- -----------------------------------------------------------------------------
insert into public.system_settings (key, value, description, is_public) values
  ('notifications.expiry_thresholds_months', '[6,3,1]'::jsonb,
   'Ambang notifikasi masa berlaku izin (bulan sebelum berakhir)', true),
  ('report.signatories', jsonb_build_object(
     'city', 'Atambua',
     'approver',  jsonb_build_object('label', 'Mengetahui,', 'title', 'Kepala Dinas Penanaman Modal dan Pelayanan Terpadu Satu Pintu Kabupaten Belu', 'name', '', 'rank', '', 'nip', ''),
     'preparer', jsonb_build_object('label', '', 'title', 'Kepala Bidang Pelayanan Perizinan', 'name', '', 'rank', '', 'nip', '')),
   'Pejabat penandatangan laporan rekap (kiri: mengetahui, kanan: pembuat laporan)', true),
  ('report.location_rules', '[
      {"pattern": "atambua barat", "label": "Atambua Barat"},
      {"pattern": "atambua selatan", "label": "Atambua Selatan"},
      {"pattern": "kota atambua", "label": "Kota Atambua"},
      {"pattern": "kakuluk mesak", "label": "Kakuluk Mesak"},
      {"pattern": "lamaknen selatan", "label": "Lamaknen Selatan"},
      {"pattern": "lamaknen", "label": "Lamaknen"},
      {"pattern": "lasiolat", "label": "Lasiolat"},
      {"pattern": "nanaet duabesi", "label": "Nanaet Duabesi"},
      {"pattern": "raihat", "label": "Raihat"},
      {"pattern": "raimanuk", "label": "Raimanuk"},
      {"pattern": "tasifeto barat", "label": "Tasifeto Barat"},
      {"pattern": "tasifeto timur", "label": "Tasifeto Timur"}
   ]'::jsonb, 'Aturan pola teks lokasi izin -> kecamatan untuk rekap per kecamatan', true)
on conflict (key) do nothing;
