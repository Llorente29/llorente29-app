-- scripts/conta/produccion/cuentas/s01p-recibida-fecha.sql
--
-- S01p·18.2 · punto 2 · La fecha de la recibida (0913) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
--   1. Los asientos de las facturas recibidas de Foodint: cuántos y su huella (fecha y estado), iguales
--      antes y después (la tanda no mueve ninguno; los 40 los cambia D con la DL1_23).
--   2. Los de ellos en otro mes que su factura: 40 antes y después (lo ya hecho no se toca).
select clave, valor from (
  -- corte: los asientos de recibidas de Foodint creados antes del 13/11/2026 09:00 de Madrid
  select 1 o, 'Foodint · asientos de recibidas (n · huella de fecha y estado)' clave,
    (select count(*) || ' · ' || md5(coalesce(string_agg(je.id::text || ':' || je.entry_date || ':' || je.status, '|' order by je.id), ''))
       from public.journal_entry je
      where je.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and je.source_type = 'supplier_invoice'
        and je.created_at < timestamptz '2026-11-13 09:00+01') valor
  union all
  -- corte: los mismos, en otro mes que su factura
  select 2, 'Foodint · de ellos, en otro mes que su factura',
    (select count(*)::text from public.journal_entry je join public.supplier_invoice si on si.id = je.source_id
      where je.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and je.source_type = 'supplier_invoice' and je.status <> 'anulado'
        and je.created_at < timestamptz '2026-11-13 09:00+01'
        and date_trunc('month', je.entry_date) <> date_trunc('month', si.invoice_date)) valor
) t order by o;
