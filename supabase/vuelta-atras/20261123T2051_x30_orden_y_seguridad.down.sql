-- supabase/vuelta-atras/20261123T2051_x30_orden_y_seguridad.down.sql
-- X30 · Quita los dos disparadores y deja bank_importar como estaba (su respaldo).
drop trigger if exists trg_bank_reglas_de_partida on public.treasury_account;
drop function if exists public._bank_reglas_de_partida_al_dar_de_alta();
drop trigger if exists trg_bank_match_seguridad on public.bank_match;
drop function if exists public._bank_match_seguridad();
select public._restaurar_funcion(
  'public.bank_importar(uuid,text,text,text,text,date,date,numeric,numeric,text,text,jsonb)', '20261123T2051_x30_orden_y_seguridad');
