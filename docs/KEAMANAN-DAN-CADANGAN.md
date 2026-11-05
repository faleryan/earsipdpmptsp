# Keamanan, hak akses, dan cadangan data

## 1. Peran

| Hak | Super Admin | Admin Arsip | Operator | Pimpinan |
| --- | :-: | :-: | :-: | :-: |
| Lihat dashboard & arsip | ✓ | ✓ | ✓ | ✓ |
| Tambah permohonan/pemohon/badan usaha | ✓ | ✓ | ✓ | – |
| Ubah data arsip | semua | semua | hanya yang ia buat | – |
| Hapus data arsip | ✓ | ✓ | – | – |
| Unggah dokumen | ✓ | ✓ | ✓ (bukan rahasia) | – |
| Unduh PDF (dapat diatur) | ✓ | ✓ | – | ✓ |
| Impor SiCANTIK, data induk, klasifikasi | ✓ | ✓ | – | – |
| Laporan & audit trail | ✓ | ✓ | log sendiri | ✓ |
| Pengguna, pengaturan, cadangan/pemulihan | ✓ | – | – | – |

Tingkat akses dokumen/arsip: **biasa** (semua pengguna aktif), **terbatas** (Super Admin, Admin
Arsip, Pimpinan, dan pengunggah), **rahasia** (Super Admin, Admin Arsip, Pimpinan).

## 2. Penegakan

- **RLS aktif di 13 tabel.** Peran `anon` dicabut seluruh haknya. Akun nonaktif tidak melihat data apa pun.
- Fungsi helper `current_role_code()`, `has_any_role()`, `can_access_level()` bersifat
  `SECURITY DEFINER` dengan `search_path` terkunci.
- Peran, status aktif, dan email profil hanya dapat diubah Super Admin (trigger). Super Admin aktif
  terakhir tidak dapat dinonaktifkan atau diturunkan.
- Akun pertama otomatis Super Admin; peran dari metadata pendaftaran **diabaikan**.
- Pendaftaran mandiri dimatikan; akun dibuat lewat Edge Function `admin-users` yang memverifikasi
  JWT pemanggil dan peran Super Admin sebelum memakai service role. Kata sandi minimal 10 karakter
  dengan huruf besar, huruf kecil, dan angka.
- Storage: bucket privat; baca file hanya bila pengguna berhak melihat baris dokumennya; unggah
  hanya ke path permohonan yang ada; tidak ada izin UPDATE (file immutable).
- Audit trail append-only: tidak ada policy INSERT/UPDATE/DELETE untuk klien — bahkan Super Admin
  tidak dapat menghapus log dari aplikasi. Perubahan data dicatat trigger (kolom lama → baru);
  login, pratinjau, unduhan, ekspor, impor, cadangan, dan manajemen akun dicatat lewat fungsi.
- Header keamanan Vercel: `X-Frame-Options: DENY`, `nosniff`, HSTS, `noindex`.

### Batasan yang perlu diketahui

- Pembedaan **pratinjau vs unduh** ditegakkan di antarmuka. Siapa pun yang berhak *melihat*
  dokumen secara teknis dapat menyimpan file selama signed URL berlaku. Akses tetap tercatat.
  Bila diperlukan pembatasan keras, tambahkan watermark sisi server atau layanan streaming khusus.
- **Penyamaran NIK** untuk Operator dan Pimpinan dilakukan di antarmuka; API tetap mengembalikan
  NIK lengkap kepada pengguna aktif. Untuk penyamaran di level database, buat view khusus dan cabut
  akses langsung ke kolom `nik`.
- Tabel `import_errors` menyimpan data mentah baris (termasuk NIK) dan hanya dapat dibaca Admin Arsip/Super Admin.

## 3. Cadangan & pemulihan

Lakukan **ketiganya**:

1. **Cadangan bawaan Supabase** — paket Pro ke atas: backup harian otomatis; aktifkan
   *Point-in-Time Recovery* bila tersedia (Database → Backups).
2. **Cadangan data dari aplikasi** — *Pengaturan & cadangan → Cadangan & pemulihan → Unduh
   cadangan data (JSON)*. Berisi 13 tabel. Simpan di media terpisah (mis. server arsip dinas).
   *Pemulihan* menguji file terlebih dahulu (dry run), lalu meng-upsert per ID dalam satu
   transaksi; data yang dibuat setelah cadangan tidak dihapus. Profil yang akunnya tidak ada
   dilewati; referensi pengguna yang hilang dikosongkan.
3. **Cadangan file PDF** — dari komputer admin (Node.js 20+), isi `SUPABASE_URL` dan
   `SUPABASE_SERVICE_ROLE_KEY` di `.env.local` (jangan di-commit, jangan di Vercel):

   ```bash
   npm run backup:storage                          # → backups/storage-YYYYMMDDHHMM/ + manifest.json (SHA-256)
   npm run restore:storage -- backups/storage-…    # unggah ulang, verifikasi checksum, tidak menimpa
   ```

   Opsi tambahan: `pg_dump` lengkap memakai connection string database
   (`pg_dump "$DATABASE_URL" -Fc -f e-arsip.dump`).

Jadwal yang disarankan: cadangan JSON mingguan + setelah setiap impor besar; cadangan PDF mingguan;
uji pemulihan ke proyek Supabase cadangan tiap 3 bulan.

## 4. Daftar periksa sebelum produksi

- [ ] *Allow new users to sign up* dimatikan; Site URL & Redirect URL berisi domain produksi
- [ ] Bucket `arsip-dokumen` *Private*
- [ ] Super Admin kedua dibuat (cadangan bila satu akun terkunci)
- [ ] `ALLOWED_ORIGIN` Edge Function diisi domain produksi
- [ ] Klasifikasi & retensi disesuaikan dengan JRA daerah
- [ ] SMTP kustom diatur di Supabase (Auth → SMTP) agar email atur ulang sandi terkirim dari domain dinas
- [ ] Cadangan pertama dibuat dan disimpan di luar Supabase
