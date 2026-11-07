-- scripts/conta/produccion/cuentas/g01c-union-aplicada.sql
--
-- G01c · La unión aplicada · LO QUE CUENTA LA TANDA, antes y después. SOLO
-- LEE. La misma vara a los dos lados (regla 31). Medido antes el 07/11. Lo que
-- tiene que pasar con la tanda (y volver con su vuelta atrás):
--   1. Conexiones con un CRM de antes del 07/11 19:00 UTC: 1 → 1.
--   2. Conexiones con la unión aplicada en el mapa: 0 → 1 (la repuesta).
select clave, valor from (
  select 1 o, 'Conexiones con un CRM (todas las cuentas, antes del 07/11 19:00 UTC)' clave,
    (select count(*)::text from public.conta_crm where created_at < timestamptz '2026-11-07 19:00+00') valor union all
  select 2, 'Conexiones con la unión aplicada en el mapa (todas las cuentas)',
    -- quieta: la ponen aplicar la unión (una persona, en Ajustes) y esta tanda; nadie la pulsa durante el ensayo
    (select count(*)::text from public.conta_crm where jsonb_typeof(mapa->'union') = 'object')
) q order by o;
