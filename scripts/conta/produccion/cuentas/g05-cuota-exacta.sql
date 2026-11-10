-- scripts/conta/produccion/cuentas/g05-cuota-exacta.sql
--
-- G05 · Cuota exacta (nº 62) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La misma vara a los dos lados (regla 31). Todas las cuentas a propósito (la
-- tanda es de la estructura). Medido antes el 09/11 a las 21:05 UTC. Lo que tiene que pasar:
--   1. _conta_cobro_cuota_exacta existe: false → true.
--   2. _conta_cobro_facturar llama a la cuota exacta: false → true.
--   3. _conta_cobro_facturar_portal llama a la cuota exacta: false → true.
--   4. Facturas de recibos (todas las cuentas): quieta.
select clave, valor from (
  select 1 o, '_conta_cobro_cuota_exacta existe' clave,
    (to_regprocedure('public._conta_cobro_cuota_exacta(uuid,jsonb,numeric)') is not null)::text valor union all
  select 2, '_conta_cobro_facturar llama a la cuota exacta',
    coalesce((select prosrc like '%_conta_cobro_cuota_exacta%' from pg_proc where oid = to_regprocedure('public._conta_cobro_facturar(uuid)')), false)::text union all
  select 3, '_conta_cobro_facturar_portal llama a la cuota exacta',
    coalesce((select prosrc like '%_conta_cobro_cuota_exacta%' from pg_proc where oid = to_regprocedure('public._conta_cobro_facturar_portal(uuid,date,text,text,text)')), false)::text union all
  select 4, 'Facturas de recibos (todas las cuentas)',
    -- quieta: las emite el cobro al confirmarse (hoy, ninguno en curso); la tanda no las toca
    (select count(*)::text from public.conta_recibo where invoice_id is not null)
) q order by o;
