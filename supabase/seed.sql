-- =============================================================================
-- Data awal (aman dijalankan ulang)
-- =============================================================================

insert into public.roles (code, name, description, permissions, is_system) values
  ('super_admin', 'Super Admin', 'Akses seluruh fitur, termasuk pengguna, pengaturan, cadangan, dan pemulihan data.',
   '{"dashboard":true,"archive_read":true,"archive_write":true,"archive_delete":true,"documents_upload":true,"documents_download":true,"import":true,"reports":true,"master_data":true,"users":true,"audit":true,"settings":true,"backup":true}', true),
  ('admin_arsip', 'Admin Arsip', 'Mengelola impor SiCANTIK, metadata arsip, dokumen, klasifikasi, dan laporan.',
   '{"dashboard":true,"archive_read":true,"archive_write":true,"archive_delete":true,"documents_upload":true,"documents_download":true,"import":true,"reports":true,"master_data":true,"users":false,"audit":true,"settings":false,"backup":false}', true),
  ('operator', 'Operator', 'Menginput data permohonan dan mengunggah dokumen. Mengubah data yang ia buat sendiri.',
   '{"dashboard":true,"archive_read":true,"archive_write":true,"archive_delete":false,"documents_upload":true,"documents_download":false,"import":false,"reports":false,"master_data":false,"users":false,"audit":false,"settings":false,"backup":false}', true),
  ('pimpinan', 'Pimpinan', 'Melihat dashboard, laporan, dan arsip sesuai hak akses (termasuk arsip terbatas & rahasia).',
   '{"dashboard":true,"archive_read":true,"archive_write":false,"archive_delete":false,"documents_upload":false,"documents_download":true,"import":false,"reports":true,"master_data":false,"users":false,"audit":true,"settings":false,"backup":false}', true)
on conflict (code) do update
  set name = excluded.name, description = excluded.description, permissions = excluded.permissions, is_system = true;

-- Klasifikasi contoh. SESUAIKAN kode & retensi dengan Klasifikasi Arsip dan
-- Jadwal Retensi Arsip (JRA) resmi Pemerintah Kabupaten Belu.
insert into public.classifications (code, name, description, retention_active_years, retention_inactive_years, final_disposition, security_level) values
  ('PRZ',    'Perizinan',                       'Induk klasifikasi arsip perizinan DPMPTSP', 2, 5, 'dinilai_kembali', 'biasa')
on conflict (code) do nothing;

insert into public.classifications (code, name, description, parent_id, retention_active_years, retention_inactive_years, final_disposition, security_level)
select v.code, v.name, v.description, p.id, v.ra, v.ri, v.fd, v.sl
  from (values
    ('PRZ.01', 'Perizinan Kesehatan',          'Surat Izin Praktik tenaga kesehatan',               5, 5,  'dinilai_kembali', 'terbatas'),
    ('PRZ.02', 'Perizinan Tata Ruang',         'KKPR / PKKPR kegiatan pemanfaatan ruang',           5, 10, 'permanen',        'biasa'),
    ('PRZ.03', 'Perizinan Pendidikan',         'Izin pendirian & operasional satuan pendidikan',    5, 10, 'permanen',        'biasa'),
    ('PRZ.04', 'Perizinan Sosial',             'Tanda daftar lembaga kesejahteraan sosial',         5, 5,  'dinilai_kembali', 'biasa'),
    ('PRZ.05', 'Perizinan Aset Daerah',        'Izin penggunaan kekayaan daerah',                   3, 5,  'dinilai_kembali', 'biasa'),
    ('PRZ.06', 'Perizinan Penelitian',         'Surat keterangan penelitian',                       1, 2,  'musnah',          'biasa'),
    ('PRZ.99', 'Perizinan Lainnya',            'Jenis perizinan yang belum dikelompokkan',          2, 5,  'dinilai_kembali', 'biasa')
  ) as v(code, name, description, ra, ri, fd, sl)
  cross join (select id from public.classifications where code = 'PRZ') p
on conflict (code) do nothing;

insert into public.system_settings (key, value, description, is_public) values
  ('app.identity', jsonb_build_object(
      'app_name', 'E-Arsip Perizinan',
      'agency_name', 'Dinas Penanaman Modal dan Pelayanan Terpadu Satu Pintu Kabupaten Belu',
      'agency_short', 'DPMPTSP Kabupaten Belu',
      'address', 'Atambua, Kabupaten Belu, Nusa Tenggara Timur',
      'phone', '', 'email', ''),
   'Identitas instansi untuk kop laporan', true),
  ('documents.max_file_size_mb', '25'::jsonb, 'Ukuran maksimum satu file PDF (MB). Batas bucket: 25 MB.', true),
  ('documents.signed_url_ttl_seconds', '300'::jsonb, 'Masa berlaku tautan akses file (detik)', true),
  ('documents.download_roles', '["super_admin","admin_arsip","pimpinan"]'::jsonb,
   'Peran yang boleh mengunduh file PDF. Peran lain hanya dapat pratinjau.', true),
  ('import.chunk_size', '200'::jsonb, 'Jumlah baris per transaksi impor', true),
  ('import.sector_rules', '[
      {"pattern": "praktik|apotek|klinik|kesehatan|farmasi|dokter|bidan|perawat", "sector": "Kesehatan"},
      {"pattern": "kkpr|pemanfaatan ruang|tata ruang|pbg|bangunan", "sector": "Tata Ruang"},
      {"pattern": "paud|pendidikan|sekolah|kursus", "sector": "Pendidikan"},
      {"pattern": "kesejahteraan sosial|lks|sosial", "sector": "Sosial"},
      {"pattern": "kekayaan daerah|ipkd|aset", "sector": "Aset Daerah"},
      {"pattern": "penelitian|riset", "sector": "Penelitian"},
      {"pattern": "usaha|perdagangan|industri|nib|oss", "sector": "Usaha"}
   ]'::jsonb, 'Aturan regex (tanpa membedakan huruf besar) untuk menentukan sektor jenis izin baru', true),
  ('import.sector_classification', '{
      "Kesehatan": "PRZ.01", "Tata Ruang": "PRZ.02", "Pendidikan": "PRZ.03", "Sosial": "PRZ.04",
      "Aset Daerah": "PRZ.05", "Penelitian": "PRZ.06", "Usaha": "PRZ.99", "Lainnya": "PRZ.99"
   }'::jsonb, 'Klasifikasi arsip default per sektor', true),
  ('import.mapping_templates', '[]'::jsonb, 'Template pemetaan kolom impor yang disimpan', true),
  ('security.idle_timeout_minutes', '60'::jsonb, 'Keluar otomatis setelah tidak aktif (menit)', true)
on conflict (key) do nothing;
