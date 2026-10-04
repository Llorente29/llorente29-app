-- supabase/vuelta-atras/20261006T0130_c01b_aprendizaje.down.sql
--
-- Deshace 20261006T0130_c01b_aprendizaje.sql: quita las tres funciones, las
-- tres columnas de «no es repetida» y las dos tablas de lo aprendido. Lo que
-- se pierde es solo lo que esa migración trajo (lo aprendido, su registro y
-- las decisiones «no es repetida»); nada de antes.

drop function if exists public.supplier_invoice_not_duplicate(uuid, text);
drop function if exists public.supplier_learning_fix(uuid, text, text, text, text);
drop function if exists public.supplier_learning_sync(uuid, jsonb);
alter table public.supplier_invoice
  drop column if exists not_duplicate_confirmed_at,
  drop column if exists not_duplicate_confirmed_by,
  drop column if exists not_duplicate_confirmed_by_name;
drop table if exists public.supplier_learning_log;
drop table if exists public.supplier_learning;
