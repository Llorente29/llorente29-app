-- scripts/conta/produccion/cuentas/g01b-juntar-clientes.sql
--
-- G01b · Juntar los clientes ya creados · LO QUE CUENTA LA TANDA, antes y
-- después. SOLO LEE. La misma vara a los dos lados (regla 31). Medido antes el
-- 07/11. Lo que tiene que pasar con la tanda (y volver con su vuelta atrás):
--   1. La función que junta: 0 → 1.
--   2. La tabla del rastro: no existe → existe.
--   3. Clientes de la gestoría de antes del 07/11 09:00 UTC, de todas las cuentas a propósito: 1.437 → 1.437 (la tanda no junta: lo hace la próxima lectura).
--   4. Clientes archivados por la unión, de todas las cuentas: 0 → 0.
select clave, valor from (
  select 1 o, 'La función que junta dos clientes' clave,
    (select count(*)::text from pg_catalog.pg_proc p where p.oid = to_regprocedure('public._conta_gestoria_juntar(uuid,uuid,uuid,text)')) valor union all
  select 2, 'La tabla del rastro de la unión',
    (select (to_regclass('public.conta_gestoria_union') is not null)::text) union all
  select 3, 'Clientes de la gestoría (todas las cuentas, antes del 07/11 09:00 UTC)',
    (select count(*)::text from public.conta_gestoria_cliente where created_at < timestamptz '2026-11-07 09:00+00') union all
  select 4, 'Clientes archivados por la unión (todas las cuentas)',
    -- quieta: solo los archiva _conta_gestoria_juntar, que trae esta tanda y nadie llama en el ensayo
    (select count(*)::text from public.party where archived_note like 'Unido con %el mismo NIF en Bitrix24%')
) q order by o;
