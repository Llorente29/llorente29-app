-- scripts/conta/produccion/cuentas/s01f-interruptores.sql
--
-- S01f · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. Sin nombres.
-- Sin comas en los valores.
--
-- Lo que tiene que pasar:
--   1. la auditoría admite el tipo nuevo: de false a true;
--   2. existe la función que enciende y apaga: de false a true;
--   3. los interruptores de Sumied encendidos, de todas las cuentas: los mismos
--      (la tanda no enciende ni apaga ninguno);
--   4. los apuntes de la auditoría de antes del 31/10 17:00 UTC: los mismos.
select clave, valor from (
  select 1 o, 'la auditoría admite account_feature_changed' clave,
    (position('account_feature_changed' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'platform_audit_log_event_type_valid')) > 0)::text valor union all
  select 2, 'existe conta_interruptor_cambiar',
    (to_regprocedure('public.conta_interruptor_cambiar(uuid,text,boolean,text)') is not null)::text union all
  select 3, 'interruptores de Sumied encendidos (tabla entera: todas las cuentas)',
    -- quieta: la tanda no enciende ni apaga ninguno
    (select count(*)::text from public.feature_flags where feature_key in ('conta', 'conta_impuestos', 'conta_laboral') and enabled) union all
  select 4, 'apuntes de la auditoría de antes del 31/10 17:00 UTC (tabla entera)',
    (select count(*)::text from public.platform_audit_log where created_at < timestamptz '2026-10-31 17:00+00')
) q order by o;
