# E-Arsip Perizinan — DPMPTSP Kabupaten Belu

Sistem manajemen arsip digital dokumen perizinan. Data permohonan dan izin terbit diterima dari
**SiCANTIK Cloud** melalui impor Excel/CSV, lalu dilengkapi dokumen PDF, klasifikasi arsip,
pencarian, laporan, dan audit trail. SiCANTIK tetap sistem utama pelayanan; aplikasi ini tidak
menyimpan kredensial SiCANTIK dan tidak terhubung langsung ke SiCANTIK.

| Lapisan | Teknologi |
| --- | --- |
| Frontend | React 19 + TypeScript + Vite 7, Tailwind CSS 4, komponen gaya shadcn/ui (Radix), Recharts |
| Backend | Supabase: PostgreSQL 15+, Auth, Storage (bucket privat), Edge Function, Row Level Security |
| Ekspor | SheetJS (Excel), jsPDF + AutoTable (PDF), pratinjau PDF dengan pdf.js (react-pdf) |
| Hosting | Vercel (frontend statis) + Supabase Cloud |

Dokumentasi lanjutan:

- [`docs/ARSITEKTUR.md`](docs/ARSITEKTUR.md) — arsitektur, model data, alur impor, keputusan desain
- [`docs/KEAMANAN-DAN-CADANGAN.md`](docs/KEAMANAN-DAN-CADANGAN.md) — peran & RLS, perlindungan data pribadi, backup & pemulihan
- [`docs/PANDUAN-IMPOR.md`](docs/PANDUAN-IMPOR.md) — langkah impor SiCANTIK untuk Admin Arsip

---

## 1. Struktur proyek

```
├── src/
│   ├── pages/               Halaman (dashboard, permohonan, impor, laporan, pengguna, …)
│   ├── components/          ui/ (primitif), common/, archive/, documents/, layout/
│   ├── lib/                 supabase, api & filter, ekspor, dokumen, import/ (parser + normalisasi)
│   └── hooks/               auth, pengaturan, daftar berhalaman, filter di URL
├── supabase/
│   ├── migrations/          001 skema · 002 keamanan/RLS/audit · 003 mesin impor · 004 laporan/backup · 005 storage · 006 rekap & masa berlaku · 007 data OSS · 008 dokumen OSS
│   ├── seed.sql             Peran, klasifikasi contoh, pengaturan sistem
│   ├── functions/admin-users  Edge Function manajemen akun (Super Admin)
│   └── tests/               Uji integrasi database (PostgreSQL + stub Supabase)
├── scripts/                 Cadangan & pemulihan file PDF di Storage
└── vercel.json              SPA rewrite + header keamanan
```

## 2. Menyiapkan Supabase

1. Buat proyek di <https://supabase.com/dashboard> (region terdekat, mis. Singapore). Catat
   **Project URL**, **anon key**, dan **service_role key** (Project Settings → API).
2. Pasang Supabase CLI, lalu dari folder proyek:

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push                 # menjalankan supabase/migrations/*
   # data awal: tempel isi supabase/seed.sql di SQL Editor, atau dengan psql
   # (connection string: Project Settings → Database → Connection string)
   psql "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres" -f supabase/seed.sql
   ```

   Tanpa CLI: buka **SQL Editor**, jalankan berurutan kedelapan file di `supabase/migrations/`, lalu `supabase/seed.sql`.
   Sudah memasang versi sebelumnya? Jalankan file migration yang belum ada (006 rekap & masa berlaku, 007 data OSS, 008 dokumen OSS).
3. **Authentication → Providers → Email**: matikan *Allow new users to sign up* (akun dibuat Super Admin).
   Atur *Site URL* ke alamat Vercel Anda dan tambahkan `https://<domain>/atur-sandi` pada *Redirect URLs*.
4. **Super Admin pertama**: Authentication → Users → *Add user* (centang *Auto Confirm*).
   Akun pertama di sistem otomatis menjadi **Super Admin aktif**. Akun berikutnya yang dibuat di luar
   aplikasi menjadi Operator nonaktif sampai diaktifkan.
5. Deploy Edge Function untuk menu *Pengguna* (membuat akun, atur ulang sandi, hapus akun):

   ```bash
   npx supabase functions deploy admin-users
   # opsional, batasi CORS ke domain Anda:
   npx supabase secrets set ALLOWED_ORIGIN=https://e-arsip.belukab.go.id
   ```

6. Pastikan bucket **arsip-dokumen** muncul di Storage dengan status *Private* (dibuat oleh migration 005).

> Database dapat dicek ulang kapan saja: semua tabel memakai RLS (`Database → Tables` menampilkan ikon perisai).

## 3. Menjalankan secara lokal

Butuh Node.js 20+.

```bash
npm install
cp .env.example .env.local      # isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY
npm run dev                     # http://localhost:5173
```

Perintah lain: `npm run build` (typecheck + build produksi), `npm test` (uji parser impor),
`npm run backup:storage` (cadangkan PDF, lihat dokumen keamanan).

## 4. Deploy ke Vercel

1. Push repositori ke GitHub/GitLab, lalu **Add New → Project** di Vercel dan pilih repositori.
2. Framework terdeteksi **Vite**; biarkan *Build Command* `npm run build` dan *Output* `dist`.
3. Isi *Environment Variables* (Production & Preview):
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon key
   
   **Jangan** memasukkan `SUPABASE_SERVICE_ROLE_KEY` ke Vercel.
4. Deploy. `vercel.json` sudah mengatur rewrite SPA (refresh di `/permohonan/...` tidak 404) dan header keamanan.
5. Masukkan domain Vercel ke *Site URL* / *Redirect URLs* Supabase Auth (langkah 2.3).

## 5. Alur kerja harian

1. **Admin Arsip** mengekspor data dari SiCANTIK → menu **Impor data** → unggah file → periksa
   pemetaan kolom → pratinjau (baru / berubah / konflik / tidak berubah / gagal) → mulai impor →
   unduh laporan kesalahan bila ada.
2. **Operator** membuka permohonan → **Unggah dokumen** (banyak PDF sekaligus, kategori ditebak dari nama file).
   Penanda kelengkapan berkas menunjukkan dokumen wajib yang masih kurang.
3. **Pimpinan** memantau dashboard dan mengekspor laporan Excel/PDF berkop dinas.
4. **Super Admin** mengelola pengguna, pengaturan, dan membuat cadangan berkala.

### Rekap izin harian / mingguan / bulanan

Menu **Rekap izin** menyusun matriks seperti spreadsheet rekapan dinas: baris per jenis izin
(dikelompokkan A, B, C… per kelompok laporan/sektor dengan JUMLAH tiap kelompok dan TOTAL),
kolom per hari dengan subtotal mingguan **Mg I–V** (minggu Senin–Minggu), per minggu, atau per bulan.

- Periode bebas (pintasan: bulan ini, bulan lalu, tahun ini). Harian maks. 31 hari.
- Menghitung **izin terbit** (tanggal penetapan) atau **permohonan masuk** (tanggal permohonan).
- Baris dapat diganti **per lokasi izin** atau **per kecamatan** (aturan pola di Pengaturan), plus filter
  sektor, jenis permohonan, dan "lokasi izin memuat …".
- **Unduh PDF** (A4/F4/A3 lanskap) berkop dinas dengan blok tanda tangan *Mengetahui, Kepala Dinas* dan
  *Kepala Bidang* (nama, pangkat, NIP; kosong = titik-titik untuk ditulis tangan). Penandatangan bawaan
  diatur di *Pengaturan → Laporan & notifikasi*. Juga tersedia ekspor Excel.
- Kelompok laporan (mis. "PERIZINAN BERUSAHA BERBASIS RISIKO") dan urutan baris diatur per jenis izin.

### Data OSS RBA

Ekspor OSS dapat diimpor lewat menu **Impor data** yang sama — jenis file dikenali otomatis dari judul kolom:

| Ekspor OSS | Kunci | Isi di E-Arsip |
| --- | --- | --- |
| List izin | ID Permohonan Izin | Persyaratan dasar (PKKPR, SPPL, Pernyataan Mandiri) & sertifikat standar, risiko, status |
| DP.NIB | NIB | Profil pelaku usaha: jenis, skala, alamat, kelurahan, kecamatan |
| DP.Proyek | ID Proyek | Proyek: KBLI, risiko, skala, rencana investasi, tenaga kerja, luas tanah |

- Ketiganya tertaut melalui NIB dan ID Proyek, sehingga urutan impor bebas dan ekspor parsial tetap bisa dimuat.
- Format tanggal yang berbeda per file (DD/MM/YY, MM/DD/YYYY, "24 April 2026") dideteksi otomatis; angka format
  Indonesia (`1.035,34`), tag HTML (`<br>`), dan penulisan kecamatan (`TasifetoTimur`) dinormalisasi.
- Impor ulang hanya memproses baris yang berubah (mis. status izin); semua batch tercatat di Riwayat impor.
- Menu **Data OSS RBA**: tab Izin / Proyek / Pelaku usaha dengan filter kecamatan, risiko, dokumen, status, tanggal;
  profil per NIB; ekspor Excel. Dashboard menampilkan ringkasan investasi & tenaga kerja.
- **Rekap izin** memiliki pilihan sumber *SiCANTIK*, *OSS*, atau *Gabungan*: bagian A "Perizinan Berusaha Berbasis
  Risiko" (NIB, Sertifikat Standar MR/MT, Izin) dan B "Persyaratan Dasar", diikuti izin SiCANTIK — siap PDF bertanda tangan.
  Izin berstatus "Menunggu Verifikasi" tidak dihitung sebagai terbit.

#### Dokumen PDF OSS (file NIB, PKKPR, SPPL, Sertifikat Standar)

- Di profil NIB (**Data OSS RBA → klik pelaku usaha**) ada panel **Dokumen OSS**: unggah *file NIB*, dokumen lain
  milik pelaku usaha, dan PDF per izin OSS (tombol **Unggah** pada setiap izin; kategori ditebak dari nama dokumen,
  mis. SPPL → kategori SPPL). Pratinjau, unduh (sesuai hak peran), versi baru dengan alasan perubahan, riwayat versi,
  hapus/pulihkan (Admin) dan hapus permanen (Super Admin) — sama seperti dokumen arsip SiCANTIK.
- **Unggah file NIB massal** (tombol di halaman Data OSS RBA): pilih hingga 200 PDF sekaligus. Setiap file dicocokkan
  ke pelaku usaha melalui NIB 13 digit di **nama file** (`0220001234567.pdf`, `NIB_0220001234567_CV Maju.pdf`), atau
  bila tidak ada, dari **teks di halaman pertama PDF** (PDF unduhan OSS memuat NIB). File yang tidak cocok dapat diisi
  NIB-nya secara manual. Pilihan bila file NIB sudah ada: *lewati* atau *simpan sebagai versi baru*.
  PDF hasil pindai (gambar tanpa teks) tidak dapat dibaca isinya — beri nama file dengan NIB.
- Tab Pelaku usaha punya kolom & filter **File NIB** (ada/belum) dan kartu ringkasan "File NIB tersimpan X / Y";
  tab Izin punya kolom & filter jumlah PDF. Ekspor Excel pelaku usaha menyertakan status file NIB.
- File disimpan di bucket privat yang sama (`oss/{NIB}/{uuid}.pdf`), hanya dapat dibuka lewat signed URL berumur pendek;
  setiap unggah, pratinjau, unduh, dan perubahan tercatat di audit trail. Dokumen hanya dapat diunggah untuk NIB yang
  sudah ada di data OSS hasil impor.

### Notifikasi masa berlaku izin

- Isi **Masa berlaku (tahun)** pada jenis izin → tanggal berakhir izin dihitung dari tanggal penetapan
  (izin yang tanggalnya pernah diubah manual tidak disentuh). Kolom "berlaku sampai" dari SiCANTIK
  juga dapat dipetakan saat impor.
- Lonceng di bilah atas dan kartu dashboard menampilkan izin aktif yang berakhir dalam **≤ 6, ≤ 3, ≤ 1 bulan**
  (ambang dapat diubah) serta yang sudah berakhir. Izin yang pemegangnya sudah mengajukan Perpanjangan/
  Perubahan jenis izin yang sama otomatis keluar dari notifikasi.
- Halaman **Masa berlaku izin**: kirim pengingat lewat **WhatsApp** (pesan sudah terisi), tandai "sudah
  diingatkan" dengan catatan, ekspor Excel/PDF. Semua tindakan tercatat di audit trail.

## 6. Pengujian yang sudah dijalankan

- `supabase/tests/db_test.py` — 126 uji integrasi pada PostgreSQL 16 dengan data ekspor SiCANTIK asli
  (857 baris): impor, impor ulang, deteksi perubahan, perlindungan edit manual, validasi, duplikat,
  RLS per peran, versi dokumen, kebijakan storage, audit trail append-only, dashboard, laporan,
  cadangan & pemulihan, rekap harian, perhitungan masa berlaku, ambang notifikasi 6/3/1 bulan,
  pengecualian izin yang sudah diperpanjang, serta impor ketiga ekspor OSS contoh (624 baris) termasuk
  impor ulang, deteksi perubahan, relasi NIB–proyek–izin, rekap OSS, serta dokumen OSS (versi, kunci path per NIB,
  izin harus milik NIB yang sama, RLS & kebijakan storage). File `oss_*.json` dibuat dengan
  `supabase/tests/oss_to_rows.py` dan diletakkan di folder yang sama dengan `rows.json`.

  ```bash
  createdb earsip_test
  psql -d earsip_test -f supabase/tests/stub_supabase.sql
  for f in supabase/migrations/*.sql supabase/seed.sql; do psql -d earsip_test -v ON_ERROR_STOP=1 -f $f; done
  python3 supabase/tests/xlsx_to_rows.py ekspor-sicantik.xlsx /tmp/rows.json
  pip install psycopg2-binary pandas openpyxl
  python3 supabase/tests/db_test.py /tmp/rows.json "dbname=earsip_test"
  ```

- `npm test` — deteksi & pemetaan ekspor OSS (dengan `OSS_DIR=<folder ekspor>`), matriks rekap (kolom hari/Mg I–V/bulan, subtotal, kecamatan) serta parser & normalisasi impor (tanggal Excel, format tanggal Indonesia, NIK panjang, CSV `;`,
  duplikat). Dengan `IMPORT_SAMPLE=/path/ekspor.xlsx npm test` hasilnya dicocokkan dengan file asli.
- Uji end-to-end antarmuka (Playwright) terhadap GoTrue + PostgREST asli: login, impor 857 baris lewat
  wizard, unggah PDF + validasi file palsu, pratinjau, unduh, versi baru, edit manual, impor ulang,
  laporan Excel/PDF, pembatasan per peran, cadangan & uji pemulihan; impor tiga ekspor OSS, rekap gabungan;
  unggah file NIB & SPPL di profil NIB, versi baru, serta unggah massal 5 PDF (pencocokan dari nama file dan dari isi PDF,
  koreksi manual, file NIB yang sudah ada dilewati).

## 7. Catatan penyesuaian

- **Klasifikasi arsip** di `seed.sql` (PRZ.01–PRZ.99) adalah contoh. Sesuaikan kode dan masa retensi
  dengan Klasifikasi Arsip dan JRA resmi Pemkab Belu melalui menu *Klasifikasi arsip*.
- **Sektor** jenis izin baru ditentukan dari aturan pola di *Pengaturan → Aturan impor*.
- **Dokumen wajib** per jenis izin diatur di *Jenis perizinan* (bawaan: surat permohonan, identitas,
  persyaratan, SK/izin).
- Paket `xlsx` memakai mirror npm `@e965/xlsx` (SheetJS 0.20.3 — versi yang sudah menambal
  kerentanan pada 0.18.5 di npm). Bila ingin sumber resmi, ganti di `package.json` menjadi
  `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`.
- Tipe TypeScript database ditulis manual di `src/types`. Untuk tipe otomatis:
  `npx supabase gen types typescript --linked > src/types/database.ts`.
