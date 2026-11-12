-- scripts/conta/produccion/cuentas/gbd-plan-b.sql
--
-- GBd · el plan B, en pruebas · LO QUE CUENTA LA TANDA, antes y después. SOLO
-- LEE. La misma vara a los dos lados (regla 31). Lo que tiene que pasar:
--   1. La tabla de la red: false → true.
--   2. Sus dos funciones: false → true.
--   3. Las conexiones con un CRM NO cambian (la migración no llama a nada).
select clave, valor from (
  select 1 o, 'conta_bitrix_red' clave, (to_regclass('public.conta_bitrix_red') is not null)::text valor union all
  select 2, 'conta_bitrix_red_leer y conta_bitrix_red_apuntar',
    (to_regprocedure('public.conta_bitrix_red_leer(uuid,text)') is not null and to_regprocedure('public.conta_bitrix_red_apuntar(uuid,jsonb)') is not null)::text union all
  select 3, 'Conexiones con un CRM (tabla entera, todas las cuentas, con corte de fecha)',
    (select count(*) from public.conta_crm where created_at < timestamptz '2026-11-12 09:00:00+00')::text
) q order by o;
