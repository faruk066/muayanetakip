# Yayınlama (Vercel)

## 1. Supabase tabloları (sırayla, tek seferlik)
Supabase Dashboard → SQL Editor:
1. `supabase/migrations/0001_muayene_takip.sql` → Run
2. `supabase/migrations/0002_water_serial.sql` → Run
3. `supabase/migrations/0003_drop_direction_status.sql` → Run

## 2. Vercel environment variables
Vercel Dashboard → proje → Settings → Environment Variables:

| Key | Değer |
|---|---|
| `VITE_SUPABASE_URL` | `https://lxymsgtxzuladsqktly.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon public` anahtarı |
| `VITE_OCRSPACE_KEY` | Bulut OCR anahtarı (`helloworld` demo ile başlar, [ocr.space](https://ocr.space/ocrapi)'ten ücretsiz alın) |

Üç ortama da ekle (Production + Preview + Development), sonra **Redeploy**
(Deployments → ⋯ → Redeploy). Env'ler build anında gömülür; eklemeden yapılan
deploy localStorage-only çalışır (header'da senkron rozeti görünmez).

## 3. Sürüm çıkarma (her güncellemede)
1. `package.json` → `version` alanını yükselt (örn. `1.0.0` → `1.1.0`).
2. Commit + push → Vercel otomatik deploy eder.
3. Cihazlarda header'daki `vX.Y.Z` rozetinden doğrulayın; eski sürümde
   "Güncelle" bandı görünür, basınca yeni sürüme geçilir.
