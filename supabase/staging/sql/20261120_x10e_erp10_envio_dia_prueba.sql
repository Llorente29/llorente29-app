-- supabase/staging/sql/20261120_x10e_erp10_envio_dia_prueba.sql
--
-- SOLO STAGING. Prueba del X10e (20261120T1140_x10e_erp10_envio_dia), que el ensayo de staging
-- pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Nombra el objeto: public.conta_erp10_envio (solo se le añaden tres columnas que admiten nulos).
--
--   0. La forma: las tres columnas, que admiten nulos, y la comprobación del número del cobro.
--   1. Lo de antes no cambia: el índice único por asiento sigue, y conta_erp10_envio_tomar también.
--   2. La vuelta atrás (el fichero de verdad, con \i), sin días escritos, quita las tres columnas.
--
-- Sin datos reales (T11): no crea ni lee filas de nadie.
-- sin usuario: solo mira la forma de la tabla.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X10e: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

-- 0 · La forma -----------------------------------------------------------------------------------
do $$ begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'conta_erp10_envio'
       and column_name in ('dia', 'cobro_serie', 'cobro_documento') and is_nullable = 'YES') <> 3 then
    raise exception 'PRUEBA X10e · 0: faltan las tres columnas (que admiten nulos)';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conta_erp10_envio_cobro_documento_ck') then raise exception 'PRUEBA X10e · 0: falta la comprobación del número del cobro'; end if;
  raise notice 'PRUEBA X10e · 0: las tres columnas, que admiten nulos, y la comprobación del número del cobro.';
end $$;

-- 1 · Lo de antes no cambia -----------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'conta_erp10_envio_asiento_uq') then raise exception 'PRUEBA X10e · 1: falta el índice único por asiento'; end if;
  if to_regprocedure('public.conta_erp10_envio_tomar(uuid, uuid, text, text)') is null then raise exception 'PRUEBA X10e · 1: falta conta_erp10_envio_tomar'; end if;
  raise notice 'PRUEBA X10e · 1: el índice por asiento y conta_erp10_envio_tomar, como estaban.';
end $$;

-- 2 · La vuelta atrás ---------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261120T1140_x10e_erp10_envio_dia.down.sql
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_erp10_envio' and column_name in ('dia', 'cobro_serie', 'cobro_documento')) then
    raise exception 'PRUEBA X10e · 2: la vuelta atrás no ha quitado las columnas';
  end if;
  raise notice 'PRUEBA X10e · 2: sin días escritos, la vuelta atrás quita las tres columnas.';
end $$;

rollback;
