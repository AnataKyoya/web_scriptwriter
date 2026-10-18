// Isi dari Supabase Dashboard > Project Settings > API.
// Anon key memang publik; datanya dilindungi RLS (lihat supabase/schema.sql).
// JANGAN pernah menaruh service_role key di sini.
window.NASKAH_CONFIG = {
  supabaseUrl: 'https://dwohroqlxgobtbrtqpnn.supabase.co',      // contoh: 'https://abcdxyz.supabase.co'
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3b2hyb3FseGdvYnRicnRxcG5uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMDMyMzQsImV4cCI6MjEwNzg3OTIzNH0.pKjQPeKn_3a5EgNXJiGE-uYZ7JpX1vfi7_mGTxOthkU',   // contoh: 'eyJhbGciOi...'
  signaling: []
};
