-- scripts/conta/produccion/cuentas/g01b-union-fichas.sql
--
-- G01b · La unión de las fichas · LO QUE CUENTA LA TANDA, antes y después.
-- SOLO LEE. La misma vara a los dos lados (regla 31). Medido antes el 07/11. Lo
-- que tiene que pasar con la tanda (y volver a como estaba con su vuelta atrás):
--   1. Los tipos de diferencia: sin los tres nuevos → con ellos.
--   2. La tabla de fichas: no existe → existe.
--   3. Las funciones nuevas (guardar los clientes y aplicar la unión): 0 → 2.
--   4. Fichas de la gestoría de antes del 07/11 09:00 UTC, de todas las cuentas a propósito: 1.437 → 1.437.
--   5. Mapas con la unión aplicada, de todas las cuentas: 0 → 0 (la aplica una persona, después).
select clave, valor from (
  select 1 o, 'conta_gestoria_diferencia · tipos que admite' clave,
    (select pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c where c.conname = 'conta_gestoria_diferencia_tipo_check') valor union all
  select 2, 'La tabla de fichas de Bitrix24',
    (select (to_regclass('public.conta_gestoria_ficha') is not null)::text) union all
  select 3, 'Funciones nuevas (guardar los clientes y aplicar la unión)',
    (select count(*)::text from unnest(array['public.conta_bitrix_guardar_clientes(uuid,jsonb)', 'public.conta_bitrix_aplicar_union(uuid)']) f
      where to_regprocedure(f) is not null) union all
  select 4, 'Fichas de la gestoría (todas las cuentas, antes del 07/11 09:00 UTC)',
    (select count(*)::text from public.conta_gestoria_cliente where created_at < timestamptz '2026-11-07 09:00+00') union all
  select 5, 'Mapas de Bitrix24 con la unión aplicada (todas las cuentas)',
    -- quieta: solo la aplica conta_bitrix_aplicar_union, que trae esta tanda y nadie llama en el ensayo
    (select count(*)::text from public.conta_crm_bitrix where mapa ? 'union' and mapa->'union' <> 'null'::jsonb)
) q order by o;
