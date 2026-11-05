# Panduan impor data SiCANTIK (Admin Arsip)

1. **Ekspor dari SiCANTIK Cloud** daftar permohonan/izin ke Excel atau CSV. Sertakan kolom ID bila
   tersedia — ID adalah kunci paling akurat untuk mengenali data yang sama pada impor berikutnya.
2. Buka **Impor data** → tarik file ke kotak unggah. Periksa jumlah baris dan cuplikan data.
   Bila baris judul bukan baris pertama (ada judul laporan di atasnya), pilih baris judul yang benar.
3. **Pemetaan kolom**: kolom yang dikenali sudah terisi. Periksa contoh nilai di kanan setiap baris.
   - Kunci pencocokan: *ID SiCANTIK* (disarankan) atau *Nomor permohonan*.
   - Format tanggal teks: pilih Hari/Bulan/Tahun untuk format Indonesia.
   - Simpan sebagai template (ikon disket) agar impor berikutnya cukup memilih template.
4. **Validasi & pratinjau**: belum ada data yang disimpan. Periksa setiap kelompok:
   - *Baru* — akan ditambahkan.
   - *Berubah* — perubahan ditampilkan per kolom (lama → baru).
   - *Konflik data manual* — data diubah di SiCANTIK **dan** pernah diubah petugas di E-Arsip.
     Centang baris yang ingin ditimpa dengan data SiCANTIK.
   - *Tidak berubah* — dilewati otomatis.
   - *Gagal validasi* / *Duplikat dalam file* — tidak diproses; tercatat di laporan.
5. **Proses impor**: pilih *Perbarui* atau *Lewati* untuk data berubah, tambahkan catatan, lalu
   *Mulai impor*. Jangan menutup halaman sampai progres 100%.
6. **Hasil**: unduh *laporan kesalahan* (sheet Galat, Dilewati, Peringatan beserta data asli tiap
   baris), perbaiki di sumber bila perlu, lalu impor ulang — baris yang sudah benar tidak terduplikasi.

Setiap batch tersimpan di **Riwayat impor** lengkap dengan pengimpor, waktu, hash file, pemetaan
kolom, dan tautan "Arsip dari batch ini".
