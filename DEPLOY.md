# Yayınlama (Vercel)

## 1. Supabase tabloları (sırayla, tek seferlik)
Supabase Dashboard → SQL Editor:
1. `supabase/migrations/0001_muayene_takip.sql` → Run
2. `supabase/migrations/0002_water_serial.sql` → Run

## 2. Vercel environment variables
Vercel Dashboard → proje → Settings → Environment Variables:

| Key | Değer |
|---|---|
| `VITE_SUPABASE_URL` | `https://lxymsgtxzuladsqktly.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon public` anahtarı |

Üç ortama da ekle (Production + Preview + Development), sonra **Redeploy**
(Deployments → ⋯ → Redeploy). Env'ler build anında gömülür; eklemeden yapılan
deploy localStorage-only çalışır (header'da senkron rozeti görünmez).
