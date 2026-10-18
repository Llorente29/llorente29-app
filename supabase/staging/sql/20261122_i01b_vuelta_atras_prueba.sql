-- supabase/staging/sql/20261122_i01b_vuelta_atras_prueba.sql
--
-- SOLO STAGING. La vuelta atrás de 20261122T0160_i01b_asiento_303, con \i
-- dentro de la transacción y ROLLBACK: staging no cambia.
--   1. Hacia delante hasta la 0150, y la huella de conta_motivos_para_validar,
--      conta_impuesto_estado_vale y el CHECK de bank_match_item.
--   2. La 0160 y su vuelta atrás: no queda nada suyo (funciones, disparadores,
--      columna, índice) y las tres huellas son las de antes.
--   3. Otra vez la 0160: se puede volver a aplicar.
-- Lo que hace parar a la vuelta atrás (un asiento de liquidación o un pago
-- casado con una declaración) no se ensaya aquí: un raise para el workflow.
-- sin usuario: la tanda y su vuelta atrás las aplica el workflow como postgres, y así se prueban aquí.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA vuelta atrás I01b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

\i supabase/migrations/20261122T0100_i01_plazos.sql
\i supabase/migrations/20261122T0110_i01_modelo_datos.sql
\i supabase/migrations/20261122T0120_i01_obligaciones.sql
\i supabase/migrations/20261122T0130_i01_certificados.sql
\i supabase/migrations/20261122T0140_i01_calculo_303.sql
\i supabase/migrations/20261122T0150_i01_presentar.sql

-- Lo que staging no tiene y la 0160 cambia (como en la prueba del S01): la
-- tanda de C, la M01 y la 0140 del S01, dentro de la transacción si faltan.
select not exists (select 1 from pg_proc where proname = 'tg_journal_entry_envio_por_aclarar' and pronamespace = 'public'::regnamespace) as falta_c06b \gset
\if :falta_c06b
\echo '>>> Staging aún no tiene la tanda de C: se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261116T0100_c06b_promociones_envios.sql
\endif
select to_regprocedure('public.conta_motivos_para_validar(uuid)') is null as falta_m01 \gset
\if :falta_m01
\echo '>>> Staging aún no tiene «Esperan» (M01): se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261117T0100_m01_motivos_para_validar.sql
\endif
select to_regclass('public.conta_eje_analitico') is null as falta_s01_0130 \gset
\if :falta_s01_0130
\i supabase/migrations/20261121T0130_s01_ejes_analiticos.sql
\endif
\i supabase/migrations/20261121T0140_s01_regla5_eje_local.sql


create temporary table _h (k text primary key, antes text, despues text) on commit drop;
insert into _h (k, antes) values
  ('motivos', md5(pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure))),
  ('estado_vale', md5(pg_get_functiondef('public.conta_impuesto_estado_vale(text,text)'::regprocedure))),
  ('check', (select md5(pg_get_constraintdef(oid)) from pg_constraint where conname = 'bank_match_item_uno' and conrelid = 'public.bank_match_item'::regclass));

\i supabase/migrations/20261122T0160_i01b_asiento_303.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_303_contabilizar(uuid)') is null
     or (select md5(pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure))) = (select antes from _h where k = 'motivos') then
    raise exception 'PRUEBA vuelta atrás I01b: la 0160 no se ha aplicado.';
  end if;
end $$;

\i supabase/vuelta-atras/20261122T0160_i01b_asiento_303.down.sql
update _h set despues = case k
  when 'motivos' then md5(pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure))
  when 'estado_vale' then md5(pg_get_functiondef('public.conta_impuesto_estado_vale(text,text)'::regprocedure))
  when 'check' then (select md5(pg_get_constraintdef(oid)) from pg_constraint where conname = 'bank_match_item_uno' and conrelid = 'public.bank_match_item'::regclass) end;
do $$
declare v_mal text;
begin
  select string_agg(k, ', ') into v_mal from _h where antes is distinct from despues;
  if v_mal is not null then raise exception 'PRUEBA vuelta atrás I01b: no vuelve como estaba: %.', v_mal; end if;
  if to_regprocedure('public.conta_impuesto_303_contabilizar(uuid)') is not null
     or to_regprocedure('public.conta_impuesto_cargos_posibles(uuid)') is not null
     or to_regprocedure('public.conta_impuesto_casar_cargo(uuid,uuid)') is not null
     or to_regprocedure('public.conta_impuesto_euros(numeric)') is not null
     or to_regprocedure('public.tg_bank_match_deshecho_impuesto()') is not null
     or to_regprocedure('public.tg_journal_entry_liquidacion_anulada()') is not null
     or exists (select 1 from pg_trigger where tgname in ('bank_match_deshecho_impuesto', 'journal_entry_liquidacion_anulada'))
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bank_match_item' and column_name = 'tax_return_id')
     or to_regclass('public.bank_match_item_impuesto') is not null then
    raise exception 'PRUEBA vuelta atrás I01b: queda algo de la 0160.';
  end if;
  raise notice 'PRUEBA vuelta atrás I01b: fuera la 0160; las tres huellas, como antes.';
end $$;

\i supabase/migrations/20261122T0160_i01b_asiento_303.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_303_contabilizar(uuid)') is null then
    raise exception 'PRUEBA vuelta atrás I01b: no se vuelve a aplicar.';
  end if;
  raise notice 'PRUEBA vuelta atrás I01b: y se vuelve a aplicar.';
end $$;

rollback;
