# Naskah

Editor script/skenario: tulis cerita, format (margin, huruf kapital, CONT'D) diurus otomatis.
Teks disimpan sebagai **Fountain** (plain text), jadi bisa diekspor ke aplikasi lain.

## Deploy ke Vercel
Situs statis tanpa build step.
1. `npm i -g vercel` lalu jalankan `vercel` di folder ini (atau push ke GitHub dan import di vercel.com).
2. Framework preset: **Other**. Tidak ada build command. Output directory: `.`

## Kolaborasi
Cara yang disarankan: **Supabase** (lihat bagian di bawah). Setelah masuk, perubahan dan daftar "online" dikirim lewat
Supabase Realtime, dan hanya orang yang diundang yang punya akses.

Opsi tanpa akun: WebRTC peer-to-peer. Server signaling publik bawaan y-webrtc (`y-webrtc-eu.fly.dev`) sudah mati,
jadi WebRTC **nonaktif** sampai kamu menyediakan server sendiri (paket y-webrtc menyertakan `bin/server.js`, jalankan dengan `PORT=4444 node node_modules/y-webrtc/bin/server.js`),
lalu isi `signaling: ['wss://server-kamu']` di `config.js` atau buka situs dengan `?signal=wss://server-kamu`.
Dengan opsi ini siapa pun yang punya tautan bisa ikut menulis, dan sinkronisasi hanya terjadi saat semua online bersamaan.

## Aturan format
Scene: `INT.`/`EXT.`/`EST.`/`I/E` · Karakter: baris KAPITAL · Dialog: baris setelah karakter ·
Parenthetical: `(…)` · Transisi: `CUT TO:`, `FADE OUT.`, `>` · Paksa: `.` scene, `@` karakter, `!` aksi.

## CONT'D
Otomatis (tampilan saja, tidak masuk teks) bila karakter yang sama bicara lagi di adegan yang sama,
hanya diselingi aksi sampai batas "maks. aksi", tanpa karakter lain di antaranya. Bisa dimatikan di header.

## Impor
Klik **Impor .txt** atau seret file .txt/.fountain ke halaman. Nomor adegan dipertahankan, indentasi dibaca, lalu dirender ulang.

Ukuran kertas cetak: ubah `@page{size:letter}` ke `A4` di index.html bila perlu.

## Naskah baru
Tombol **+ Naskah baru** membuat ruang (tautan) baru yang kosong. Naskah lama tetap tersimpan di browser
dan bisa dibuka lagi dari daftar di jendela yang sama (daftar disimpan per perangkat).

## Database & akun (Supabase, opsional)
Tanpa langkah ini aplikasi tetap jalan seperti biasa (tersimpan di browser saja, tanpa kolaborasi live).

1. Buat proyek di supabase.com. Buka **SQL Editor**, tempel isi `supabase/schema.sql`, jalankan.
2. **Authentication > URL Configuration**: isi *Site URL* dengan alamat Vercel-mu dan tambahkan alamat itu
   (serta `http://localhost:3000` bila perlu) ke *Redirect URLs*. Login memakai tautan email (Email provider, bawaan aktif).
3. **Project Settings > API**: salin *Project URL* dan *anon key* ke `config.js`. Jangan pakai `service_role`.
4. Deploy ulang ke Vercel.

Cara kerja: tiap naskah = satu "ruang". Setelah masuk, perubahan Yjs ditulis ke tabel `script_updates`
(log yang hanya ditambah, jadi dua penulis tidak saling menimpa), kolaborator menerimanya lewat Supabase Realtime,
dan log dipadatkan otomatis menjadi snapshot bila lebih dari 150 entri. Akses diatur RLS: hanya pemilik dan
orang yang diundang (tombol **Undang**, lewat email akun mereka) yang bisa membaca atau menulis di database.

Catatan:
- **Batas email**: layanan email bawaan Supabase hanya mengirim 2 email per jam untuk seluruh proyek, sehingga login bisa gagal dengan
  "email rate limit exceeded". Untuk pemakaian nyata, pasang SMTP sendiri (Resend, Brevo, dll.) di
  Authentication > SMTP Settings.
- WebRTC nonaktif secara bawaan (lihat bagian Kolaborasi). Akses ke data kolaborasi diatur RLS Supabase.
- Login tautan email memakai PKCE: buka tautannya di browser yang sama dengan tempat kamu meminta login.
- Proyek Supabase gratis di-pause bila lama tidak dipakai; aktifkan lagi dari dashboard.