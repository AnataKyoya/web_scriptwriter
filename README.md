# Naskah

Editor script/skenario: tulis cerita, format (margin, huruf kapital, CONT'D) diurus otomatis.
Teks disimpan sebagai **Fountain** (plain text), jadi bisa diekspor ke aplikasi lain.

## Deploy ke Vercel
Situs statis tanpa build step.
1. `npm i -g vercel` lalu jalankan `vercel` di folder ini (atau push ke GitHub dan import di vercel.com).
2. Framework preset: **Other**. Tidak ada build command. Output directory: `.`

## Kolaborasi
Memakai Yjs + WebRTC (peer-to-peer). Tautan dengan `#kode-ruang` adalah naskahnya; ruang dienkripsi dengan kode itu.
- Server signaling publik bawaan y-webrtc bersifat "best effort". Untuk produksi, jalankan signaling sendiri
  (`npx y-webrtc` / paket `y-webrtc` menyertakan `bin/server.js`) lalu buka situs dengan `?signal=wss://server-kamu`.
- Setiap orang menyimpan salinan di IndexedDB peramban, jadi naskah tetap ada saat offline.
  Karena P2P, perubahan baru tersinkron ketika dua orang online bersamaan.
- Butuh akun/izin akses dan penyimpanan di server? Ganti provider dengan Liveblocks, Hocuspocus, atau PartyKit.

## Aturan format
Scene: `INT.`/`EXT.`/`EST.`/`I/E` · Karakter: baris KAPITAL · Dialog: baris setelah karakter ·
Parenthetical: `(…)` · Transisi: `CUT TO:`, `FADE OUT.`, `>` · Paksa: `.` scene, `@` karakter, `!` aksi.

## CONT'D
Otomatis (tampilan saja, tidak masuk teks) bila karakter yang sama bicara lagi di adegan yang sama,
hanya diselingi aksi sampai batas "maks. aksi", tanpa karakter lain di antaranya. Bisa dimatikan di header.

## Impor
Klik **Impor .txt** atau seret file .txt/.fountain ke halaman. Nomor adegan dibuang, indentasi dibaca, lalu dirender ulang.

Ukuran kertas cetak: ubah `@page{size:letter}` ke `A4` di index.html bila perlu.

## Naskah baru
Tombol **+ Naskah baru** membuat ruang (tautan) baru yang kosong. Naskah lama tetap tersimpan di browser
dan bisa dibuka lagi dari daftar di jendela yang sama (daftar disimpan per perangkat).

## Database & akun (Supabase, opsional)
Tanpa langkah ini aplikasi tetap jalan seperti biasa (tersimpan di browser + kolaborasi WebRTC).

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
- Sinkronisasi langsung WebRTC tetap aktif dan masih berbasis tautan: siapa pun yang punya tautan bisa ikut
  menulis live. Kontrol akses ketat berlaku untuk data di database.
- Login tautan email memakai PKCE: buka tautannya di browser yang sama dengan tempat kamu meminta login.
- Proyek Supabase gratis di-pause bila lama tidak dipakai; aktifkan lagi dari dashboard.
