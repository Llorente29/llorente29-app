-- scripts/conta/produccion/cuentas/x33b-un-cobro-por-factura.sql
--
-- X33b · Una factura con cobro nunca lleva dos asientos de cobro · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 1320 cambia tres funciones de los asientos de GoCardless y añade dos columnas que admiten nulos y una función: no
-- escribe en ninguna fila (lo que prepara lo prepara una persona con el botón). Se mide que no se mueve nada: los cobros
-- apuntados en las facturas, los asientos y lo preparado de GoCardless; por cuenta (regla 9), y siempre una fila con
-- todas las cuentas juntas. Corte fijo: lo creado antes del 25/11/2026 a las 14:00 de Madrid.
select clave, valor from (
  select 0 o, null::uuid account_id, 'todas las cuentas · cobros de facturas: filas · huella' clave,
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', p.account_id, p.id, p.invoice_id, p.amount, p.entry_id), ';' order by p.account_id, p.id)), 12), 'ninguna') valor
    from public.customer_invoice_payment p where p.created_at < timestamptz '2026-11-25 14:00:00+01'
  union all
  select 0, null, 'todas las cuentas · asientos: filas · huella (estado, origen, número)',
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', e.account_id, e.id, e.status, e.source_type, e.number), ';' order by e.account_id, e.id)), 12), 'ninguna')
    from public.journal_entry e where e.created_at < timestamptz '2026-11-25 14:00:00+01'
  union all
  select 0, null, 'todas las cuentas · asientos de GoCardless preparados: filas',
         count(*)::text from public.conta_gc_asiento g where g.preparado_en < timestamptz '2026-11-25 14:00:00+01'
  union all
  select 1, p.account_id, 'cuenta ' || p.account_id || ' · cobros de facturas: filas · huella',
         count(*) || ' · ' || left(md5(string_agg(concat_ws('|', p.id, p.invoice_id, p.amount, p.entry_id), ';' order by p.id)), 12)
    from public.customer_invoice_payment p where p.created_at < timestamptz '2026-11-25 14:00:00+01'
   group by p.account_id
) t order by o, account_id, clave;
