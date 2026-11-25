-- scripts/conta/produccion/cuentas/x33c-varios-cobros-por-factura.sql
--
-- X33c · Una factura, varios cobros · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 1810 quita la restricción única de la factura en conta_gc_cobro_factura y cambia conta_gc_asientos_preparar; no
-- escribe en ninguna fila. Se mide que no se mueve nada: los enlaces cobro-factura, los cobros apuntados en las facturas
-- y lo preparado de GoCardless; siempre con todas las cuentas juntas, y los enlaces por cuenta (regla 9). Corte fijo: lo
-- creado antes del 25/11/2026 a las 19:00 de Madrid.
select clave, valor from (
  select 0 o, null::uuid account_id, 'todas las cuentas · cobros atados a su factura: filas · huella' clave,
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', f.company_id, f.gc_id, f.invoice_id), ';' order by f.company_id, f.gc_id)), 12), 'ninguna') valor
    from public.conta_gc_cobro_factura f where f.creado_en < timestamptz '2026-11-25 19:00:00+01'
  union all
  select 0, null, 'todas las cuentas · cobros de facturas: filas · huella',
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', p.account_id, p.id, p.invoice_id, p.amount, p.entry_id), ';' order by p.account_id, p.id)), 12), 'ninguna')
    from public.customer_invoice_payment p where p.created_at < timestamptz '2026-11-25 19:00:00+01'
  union all
  select 0, null, 'todas las cuentas · asientos de GoCardless preparados: filas',
         count(*)::text from public.conta_gc_asiento g where g.preparado_en < timestamptz '2026-11-25 19:00:00+01'
  union all
  select 1, f.account_id, 'cuenta ' || f.account_id || ' · cobros atados a su factura: filas',
         count(*)::text from public.conta_gc_cobro_factura f where f.creado_en < timestamptz '2026-11-25 19:00:00+01'
   group by f.account_id
) t order by o, account_id, clave;
