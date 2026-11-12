-- scripts/conta/produccion/cuentas/g01b-mapa-confirmado.sql
--
-- G01b · El mapa confirmado · LO QUE CUENTA LA TANDA, antes y después. SOLO
-- LEE. La misma vara a los dos lados (regla 31). Medido antes el 07/11. Lo que
-- tiene que pasar con la tanda (y volver a como estaba con su vuelta atrás):
--   1. El CHECK de la situación: sin «sin_clasificar» → con él.
--   2. La función que confirma el mapa: 0 → 1.
--   3. Fichas de la gestoría de antes del 07/11 09:00 UTC, de todas las cuentas a propósito: 1.437 → 1.437 (la tanda no lee Bitrix24).
--   4. Fichas con situación, de todas las cuentas: 0 → 0 (sin confirmar, no se guarda la de nadie).
--   5. Mapas de Bitrix24 confirmados, de todas las cuentas: 0 → 0 (lo confirma una persona, después).
select clave, valor from (
  select 1 o, 'conta_gestoria_cliente · situaciones que admite' clave,
    (select pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c where c.conname = 'conta_gestoria_cliente_situacion_check') valor union all
  select 2, 'La función que confirma el mapa de Bitrix24',
    (select count(*)::text from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.conta_bitrix_confirmar_mapa(uuid,jsonb)')) union all
  select 3, 'Fichas de la gestoría (todas las cuentas, antes del 07/11 09:00 UTC)',
    (select count(*)::text from public.conta_gestoria_cliente where created_at < timestamptz '2026-11-07 09:00+00') union all
  select 4, 'Fichas con situación (todas las cuentas)',
    -- quieta: sin un mapa confirmado la lectura deja la situación vacía, y confirmarlo solo se puede con la función que trae esta tanda
    (select count(*)::text from public.conta_gestoria_cliente where situacion is not null) union all
  select 5, 'Mapas de Bitrix24 confirmados (todas las cuentas)',
    -- quieta: solo los confirma conta_bitrix_confirmar_mapa, que trae esta tanda y nadie llama en el ensayo
    (select count(*)::text from public.conta_crm_bitrix where mapa ? 'confirmado' and mapa->'confirmado' <> 'null'::jsonb)
) q order by o;
