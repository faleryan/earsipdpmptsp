# Arsitektur E-Arsip Perizinan

## 1. Gambaran umum

```
 SiCANTIK Cloud ──(ekspor XLSX/XLS/CSV, manual)──┐
                                                 ▼
 Browser petugas ── React SPA (Vercel) ──HTTPS──► Supabase
   • parser & pemetaan kolom (SheetJS/Papa)         ├─ Auth (email + sandi, JWT)
   • pratinjau PDF (pdf.js)                         ├─ PostgREST → PostgreSQL 15 (RLS di semua tabel)
   • ekspor Excel/PDF                               │     ├─ RPC impor (preview / commit / finalize)
                                                    │     ├─ RPC dashboard, laporan, backup/restore
                                                    │     └─ trigger audit, versi dokumen, edit manual
                                                    ├─ Storage: bucket privat "arsip-dokumen" (signed URL)
                                                    └─ Edge Function "admin-users" (service role, Super Admin saja)
```

Tidak ada server aplikasi tersendiri: logika yang harus dipercaya (hak akses, impor, audit,
penomoran versi) berjalan di PostgreSQL sebagai fungsi dan trigger, sehingga tidak dapat
dilewati dari browser.

## 2. Model data

| Tabel | Isi | Catatan |
| --- | --- | --- |
| `roles` | 4 peran sistem | kode tidak dapat diubah |
| `profiles` | akun petugas (1:1 `auth.users`) | peran/aktif hanya diubah Super Admin |
| `applicants` | pemohon | NIK unik (16 digit) bila ada |
| `companies` | badan usaha | NIB unik bila ada |
| `permit_types` | jenis izin | dibuat otomatis saat impor; sektor, klasifikasi default, dokumen wajib |
| `classifications` | klasifikasi & retensi arsip | hierarkis (`parent_id`) |
| `applications` | permohonan = satu berkas arsip | `source_system + source_id` unik; metadata arsip (kode, lokasi fisik, akses) |
| `permits` | izin terbit | maks. satu per permohonan; nomor izin unik |
| `archive_documents` | metadata PDF | berversi (`document_group_id`, `version`, `is_latest`), soft delete |
| `import_batches` | riwayat impor | file, hash SHA-256, pemetaan, opsi, hitungan hasil |
| `import_errors` | galat/peringatan/dilewati per baris | data mentah baris disimpan untuk laporan |
| `activity_logs` | audit trail | hanya dapat ditulis lewat fungsi SECURITY DEFINER |
| `system_settings` | konfigurasi | identitas instansi, aturan sektor, batas file, template pemetaan |

Semua primary key `uuid`. ID SiCANTIK disimpan terpisah di `applications.source_id`.

View `v_archive_list` dan `v_document_list` (`security_invoker = true`, RLS tetap berlaku)
menggabungkan permohonan, pemohon, jenis izin, izin, klasifikasi, dan status kelengkapan berkas
untuk pencarian, daftar, dan ekspor.

## 3. Temuan dari data contoh SiCANTIK

File contoh (857 baris, Januari–November 2026, 13 kolom) menunjukkan:

- **`ID` unik, `No Permohonan` tidak** — tiga nomor permohonan dipakai dua ID berbeda (satu resi
  untuk dua izin). Karena itu kunci pencocokan bawaan adalah *ID SiCANTIK*.
- `No KTP` diawali apostrof (`'5304…`) dan 52 baris memiliki NIK yang bukan 16 digit → NIK
  dikosongkan dengan peringatan; baris tetap diimpor.
- `-` berarti kosong (162 permohonan belum memiliki nomor izin / tanggal penetapan).
- Telepon memiliki spasi (`082 338 529 663`) → dinormalisasi menjadi digit.
- Kolom `Lokasi` dan `Lokasi Izin` identik pada contoh, tetapi tetap dipetakan terpisah.

Sistem **tidak mengasumsikan format ini**: setiap impor melewati pemetaan kolom; nama kolom yang
dikenali (sinonim di `src/lib/import/fields.ts`) dipetakan otomatis, sisanya dipilih pengguna,
dan pemetaan dapat disimpan sebagai template.

## 4. Alur impor

1. **Baca file di browser** — XLSX/XLS (SheetJS) atau CSV (deteksi `,` `;` tab `|`, UTF-8/Windows-1252).
   Hash SHA-256 dihitung untuk mendeteksi file yang pernah diimpor.
2. **Pemetaan kolom** — 21 kolom target (permohonan, pemohon, izin, badan usaha). Kolom wajib:
   ID SiCANTIK (bila menjadi kunci), nomor permohonan, jenis izin, tanggal, nama pemohon.
3. **Normalisasi klien** — tanggal serial Excel, `YYYY-MM-DD`, `DD/MM/YYYY` atau `MM/DD/YYYY`
   (pilihan pengguna), `3 November 2026`; angka besar (NIK) tidak menjadi notasi ilmiah;
   duplikat di dalam file ditandai.
4. **`import_preview`** (read-only) — server menormalkan ulang dan mengklasifikasikan tiap baris:
   - `new` — belum ada;
   - `unchanged` — hash data sama dengan impor terakhir;
   - `changed` — berubah sejak impor terakhir (ditampilkan per kolom: lama → baru);
   - `conflict` — kolom yang berubah pernah **diedit manual** di E-Arsip, atau arsip dibuat manual;
   - `error` — data wajib kosong / tanggal tidak valid.
5. **Pilihan pengguna** — data berubah: *perbarui* atau *lewati*; konflik: dilewati kecuali dipilih
   per baris (atau "timpa semua" dengan konfirmasi).
6. **`import_commit_rows`** per potongan (bawaan 200 baris). Setiap panggilan = satu transaksi,
   setiap baris = subtransaksi (satu baris gagal tidak membatalkan lainnya). Status dihitung
   ulang saat commit. Kunci advisory mencegah dua impor berjalan bersamaan.
7. **`import_finalize_batch`** — menghitung status akhir, menulis satu entri audit ringkas.
   Laporan kesalahan (Galat / Dilewati / Peringatan + data asli baris) dapat diunduh kapan saja.

### Perlindungan data manual

Trigger `track_record_changes` pada `applicants`, `companies`, `applications`, `permits` mencatat
kolom sumber SiCANTIK yang diubah pengguna ke `manually_edited_fields`. Saat impor ulang:

- kolom yang diedit manual **tidak pernah ditimpa** tanpa konfirmasi;
- kolom lain tetap diperbarui bila sumbernya berubah;
- metadata arsip (klasifikasi, kode arsip, lokasi fisik, tingkat akses, catatan, dokumen) tidak
  disentuh impor sama sekali;
- pemohon yang dibuat manual hanya ditautkan, datanya tidak ditimpa;
- data kontak pemohon tidak diturunkan ke versi yang lebih lama (dibandingkan tanggal permohonan).

Kolom pelacak impor (`data_source`, `source_hash`, `source_data`, `*_import_batch_id`) hanya dapat
diubah oleh fungsi impor (`app.importing = on`, variabel transaksi yang tidak dapat diset dari API).

### Pemetaan ke tabel

- Jenis izin dicocokkan per nama (tanpa beda huruf besar). Jenis baru → sektor dari aturan regex,
  klasifikasi dari peta sektor.
- Pemohon dicocokkan dengan NIK; tanpa NIK, dengan nama + telepon.
- Badan usaha (bila kolomnya dipetakan) dicocokkan dengan NIB, lalu nama.
- Nomor izin terisi → baris `permits` dibuat/diperbarui dan status permohonan `terbit`.
  Masa berlaku dihitung dari `validity_years` jenis izin bila kolom berlaku sampai tidak ada.

## 5. Dokumen PDF

- Path: `permohonan/{application_id}/{uuid}.pdf` di bucket privat (batas 25 MB, hanya `application/pdf`).
- Validasi klien: ekstensi/tipe, *magic bytes* `%PDF-`, ukuran, PDF terkunci sandi/rusak, jumlah halaman,
  checksum SHA-256 (peringatan bila file identik sudah ada di berkas).
- Unggah → simpan metadata; bila metadata gagal, file yatim dihapus otomatis.
- Versi: unggah versi baru memakai `document_group_id` yang sama; nomor versi dan penanda
  `is_latest` diatur trigger dengan kunci advisory. Metadata file (path, ukuran, checksum,
  pengunggah) tidak dapat diubah setelah tersimpan.
- Hapus = soft delete seluruh versi (dapat dipulihkan Admin). Hapus permanen hanya Super Admin.
- Akses file hanya via signed URL berumur pendek (bawaan 300 detik); setiap pratinjau/unduhan dicatat.

## 6. Antarmuka

- Bahasa Indonesia, palet navy / putih / biru, huruf *Plus Jakarta Sans* (dibundel, tanpa CDN).
- Penanda **tab map** untuk kelengkapan berkas: satu tab per dokumen wajib — biru = ada,
  garis putus = belum ada. Dipakai konsisten di tabel, detail, dan jenis izin.
- Filter pencarian disimpan di URL sehingga hasil dapat dibagikan antarpetugas.
- Loading, empty, dan error state di setiap daftar; notifikasi toast untuk sukses/gagal;
  keluar otomatis setelah tidak aktif (bawaan 60 menit).
- Responsif desktop/laptop/tablet; tabel menggulir horizontal di layar sempit.

## 7. Data OSS RBA

Tabel `oss_businesses` (kunci NIB), `oss_projects` (ID proyek), `oss_permits` (ID permohonan izin) diisi hanya oleh
fungsi `oss_import_preview` / `oss_import_commit` (SECURITY DEFINER, peran Super Admin & Admin Arsip); tidak ada
policy tulis untuk klien sehingga data OSS bersifat referensi. Relasi memakai teks kunci, bukan foreign key, karena
ekspor OSS sering parsial (pada contoh, hanya 53% NIB di daftar izin ada di ekspor DP.NIB). View `v_oss_business`
menggabungkan NIB dari ketiga ekspor; `v_oss_permit` menautkan izin ke proyeknya. Deteksi perubahan memakai hash
baris kanonik seperti impor SiCANTIK. Validasi tanggal hasil impor contoh: seluruh 344 tanggal izin berada dalam
±3 hari dari stempel waktu yang tertanam di ID permohonan izin OSS.

### Dokumen OSS

Tabel `oss_documents` (migration 008) menyimpan metadata PDF milik pelaku usaha OSS: kategori `nib`,
`sertifikat_standar`, `pkkpr`, `sppl`, `pernyataan_mandiri`, `izin`, `persetujuan_lingkungan`, `dokumen_pendukung`.
Kunci tautan adalah `nib` (wajib ada di data OSS, dicek `oss_nib_exists`) dan opsional `oss_permit_id`
(trigger memastikan izin tersebut milik NIB yang sama). Path storage wajib `oss/{nib}/{uuid}.pdf` dan dicek terhadap
kolom `nib`, sehingga kebijakan storage (`can_read_storage_object`) dapat menurunkan hak baca dari baris metadata.
Versi, `is_latest`, soft delete, perlindungan kolom file, dan audit memakai pola yang sama dengan `archive_documents`.
View `v_oss_business` menambahkan `document_count` dan `has_nib_document`; `v_oss_permit` menambahkan `document_count`.
RPC `oss_nib_directory()` memberi daftar NIB + nama untuk pencocokan unggah massal di browser (teks PDF dibaca dengan
pdf.js di klien; file tidak pernah dikirim ke layanan lain), dan `get_oss_document_stats()` untuk kartu ringkasan.
