-- 0002: sıcak su seri numarası
-- 0001'den sonra çalıştırın.
alter table apartments add column if not exists water_serial text not null default '';
