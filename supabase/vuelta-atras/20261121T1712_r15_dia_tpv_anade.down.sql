-- supabase/vuelta-atras/20261121T1712_r15_dia_tpv_anade.down.sql
--
-- R15 · Vuelta atrás de la 1712: fuera lo que añadió. Los días guardados y sus asientos
-- se quedan; solo pierden su subida.
drop function if exists public.conta_tpv_emitidas(uuid, date, date);
drop function if exists public.conta_tpv_dia_ficha(uuid);
drop function if exists public.conta_tpv_subida_apuntar(uuid, uuid[], text, text);
drop index if exists public.idx_conta_tpv_dia_subida;
alter table public.conta_tpv_dia drop column if exists subida_id;
drop table if exists public.conta_tpv_subida;
