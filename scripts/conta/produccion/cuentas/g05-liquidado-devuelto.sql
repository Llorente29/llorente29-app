-- scripts/conta/produccion/cuentas/g05-liquidado-devuelto.sql
--
-- G05 · El cobro liquidado que llega ya devuelto o reclamado (nº 79) · LO QUE
-- CUENTA LA TANDA, antes y después. SOLO LEE. La misma vara a los dos lados.
-- Medido antes el 10/11 a las 11:19 UTC. Lo que tiene que pasar:
--   1. conta_cobro_seguir factura los liquidados devueltos: false → true.
--   2. _conta_cobro_facturar acepta un cobro liquidado: false → true.
--   3. Recibos facturados (todas las cuentas, hasta el corte): quieta (21).
select clave, valor from (
  select 1 o, 'conta_cobro_seguir factura los liquidados devueltos' clave,
    (position('liquidado' in pg_get_functiondef('public.conta_cobro_seguir(uuid)'::regprocedure)) > 0)::text valor union all
  select 2, '_conta_cobro_facturar acepta un cobro liquidado',
    (position('payout_gc_id' in pg_get_functiondef('public._conta_cobro_facturar(uuid)'::regprocedure)) > 0)::text union all
  select 3, 'Recibos facturados (todas las cuentas, hasta el corte)',
    (select count(*)::text from public.conta_recibo where invoice_id is not null and preparado_at < timestamptz '2026-11-10 11:00:00+00')
) q order by o;
