-- 0003: kullanılmayan yön kolonu kaldırıldı
-- 0001 ve 0002'den sonra çalıştırın.
alter table buildings drop column if exists direction_status;
