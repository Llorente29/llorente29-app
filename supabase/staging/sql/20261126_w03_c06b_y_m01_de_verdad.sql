-- supabase/staging/sql/20261126_w03_c06b_y_m01_de_verdad.sql
--
-- SOLO STAGING. W03 (Julio, 20/10): «Staging sin la m01: alinéalo con
-- producción de forma definitiva, con su tanda de staging, no dentro de cada
-- prueba». Va la PRIMERA del manifiesto.
--
-- Producción tiene desde el 16/10 y el 17/10 la tanda de C (C06b,
-- 20261116T0100: promociones y envíos, el freno de los envíos por aclarar) y
-- «Esperan» (M01, 20261117T0100: journal_entry_validar llama a
-- conta_motivos_para_validar). Staging nunca las tuvo de verdad: cada prueba
-- las cargaba dentro de su transacción, y la validación de staging no era la
-- de producción. Medido el 20/10 (md5 de prosrc, los dos lados):
--   · solo en producción: conta_cargos_de_pedidos, conta_envio_aclarar,
--     tg_journal_entry_envio_por_aclarar (C06b) y conta_esperan (M01);
--   · distintas: journal_entry_validar (prod 87e0ba8d, staging 798e4c43, la de
--     antes de la M01), conta_propuesta_ventas_unidad (dfd76826 / 32bb2645) y
--     conta_resumen_ventas (62ba30b9 / c99b05cd), las dos de antes de la C06b.
--
-- Lo que hace, y se puede volver a pasar (el manifiesto se pasa entero):
--   1. Si falta la C06b (no está su disparador), la aplica, la misma de
--      producción. Si está, nada.
--   2. Si la M01 no está de verdad (journal_entry_validar no llama a
--      conta_motivos_para_validar), quita las dos funciones que la M01 crea
--      con «create function» (la de los motivos la dejó huérfana la 0180 o la
--      0300 de verdad) y aplica la M01, la misma de producción. Si está, nada.
--   3. Comprueba que las dos están: si no, para y no entra nada.
-- Las versiones que vinieron después (la 0180 y la 0300 cambian los motivos)
-- las vuelve a poner el último fichero del manifiesto,
-- 20261126_w03_como_produccion.sql, que además lo comprueba contra las huellas
-- de producción.

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'W03: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;

-- 1 · La C06b.
select not exists (select 1 from pg_proc where proname = 'tg_journal_entry_envio_por_aclarar' and pronamespace = 'public'::regnamespace) as falta_c06b \gset
\if :falta_c06b
\echo '>>> W03: staging no tiene la tanda de C (C06b): se aplica de verdad.'
\i supabase/migrations/20261116T0100_c06b_promociones_envios.sql
\else
\echo '>>> W03: la C06b ya está de verdad.'
\endif

-- 2 · La M01.
select coalesce((select position('conta_motivos_para_validar' in p.prosrc) = 0
                   from pg_proc p where p.oid = to_regprocedure('public.journal_entry_validar(uuid,text)')), true) as falta_m01 \gset
\if :falta_m01
\echo '>>> W03: journal_entry_validar no llama a los motivos (sin la M01): se aplica de verdad.'
drop function if exists public.conta_esperan(uuid, date, date);
drop function if exists public.conta_motivos_para_validar(uuid);
\i supabase/migrations/20261117T0100_m01_motivos_para_validar.sql
\else
\echo '>>> W03: la M01 ya está de verdad.'
\endif

-- 3 · Las dos, de verdad.
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc where oid = to_regprocedure('public.journal_entry_validar(uuid,text)');
  if v_src is null or position('conta_motivos_para_validar' in v_src) = 0 then
    raise exception 'W03: journal_entry_validar sigue sin llamar a conta_motivos_para_validar.';
  end if;
  if to_regprocedure('public.conta_esperan(uuid,date,date)') is null or to_regprocedure('public.conta_motivos_para_validar(uuid)') is null then
    raise exception 'W03: faltan las funciones de la M01.';
  end if;
  if to_regprocedure('public.conta_cargos_de_pedidos(uuid,uuid[])') is null or to_regprocedure('public.conta_envio_aclarar(uuid,text,text,text)') is null
     or not exists (select 1 from pg_trigger where tgname = 'trg_journal_entry_envio_por_aclarar' and not tgisinternal) then
    raise exception 'W03: faltan las funciones o el disparador de la C06b.';
  end if;
  raise notice 'W03: la C06b y la M01 están de verdad en staging.';
end $$;
