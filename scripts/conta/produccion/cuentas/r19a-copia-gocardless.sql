-- scripts/conta/produccion/cuentas/r19a-copia-gocardless.sql
--
-- R19 · paso 0 · La copia de GoCardless · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por cuenta (regla 9: los ids cortados a 8): lo leído de GoCardless (clientes, mandatos, suscripciones y cobros), que
-- la tanda NO toca, y cuántas copias y filas copiadas hay (antes de la tanda las tablas no existen: 0; después, 0 hasta
-- la primera lectura). Corte fijo: lo leído antes del 26/11/2026 a las 00:00 de Madrid.
with corte as (select timestamptz '2026-11-26 00:00:00+01' t),
leido as (
  select 'cliente' tipo, account_id from public.conta_gc_cliente, corte where leido_at < corte.t
  union all select 'mandato', account_id from public.conta_gc_mandato, corte where leido_at < corte.t
  union all select 'suscripcion', account_id from public.conta_gc_suscripcion, corte where leido_at < corte.t
  union all select 'cobro', account_id from public.conta_gc_cobro, corte where leido_at < corte.t
)
select clave, valor from (
  select 1 o, 'cuenta ' || left(account_id::text, 8) || ' · leído de GoCardless · ' || tipo clave, count(*)::text valor from leido group by account_id, tipo
  union all
  select 2, 'tabla entera · copias de GoCardless',
         case when to_regclass('public.conta_gc_copia') is null then '0'
              else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.conta_gc_copia', false, true, '')))[1]::text end
  union all
  select 3, 'tabla entera · filas copiadas',
         case when to_regclass('public.conta_gc_copia_fila') is null then '0'
              else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.conta_gc_copia_fila', false, true, '')))[1]::text end
) t order by o, clave;
