-- scripts/conta/produccion/cuentas/n09-pagadas-a-medias.sql
--
-- N09 · Pagos y Bancos leen lo pagado en el programa de antes (0800) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 0800 cambia una vista y dos funciones con la misma firma: no cambia ni una fila. Se mide, con corte fijo (el #241),
-- lo creado antes del 19/11/2026 a las 00:00 de Madrid. Cifras de todas las cuentas, a propósito (regla 9, excepción: la
-- huella de «esto no se ha movido»), y se etiquetan como tal.
--   · las recibidas que NO son traídas, con lo que les queda en Pagos: la misma huella antes y después (regla 31);
--   · las traídas: cuántas, y lo que les queda sumado (antes, el total menos lo pagado en Sumied; después, además
--     menos lo pagado en el programa de antes: puede bajar, y es lo que se quiere).
select clave, valor from (
  -- corte: recibidas no traídas creadas antes del 19/11 a las 00:00
  select 1 o, 'todas las cuentas · recibidas no traídas en Pagos · cuántas y su huella' clave,
         count(*) || ' · ' || md5(coalesce(string_agg(r.invoice_id || '|' || r.total || '|' || r.pagado || '|' || r.pendiente || '|' || r.estado, ',' order by r.invoice_id), '')) valor
    from public.conta_recibida_pago r join public.supplier_invoice si on si.id = r.invoice_id
   where si.source is distinct from 'traida' and si.created_at < timestamptz '2026-11-19 00:00:00+01'
  union all
  -- corte: recibidas traídas creadas antes del 19/11 a las 00:00
  select 2, 'todas las cuentas · recibidas traídas en Pagos · cuántas y lo que les queda', count(*) || ' · ' || coalesce(sum(r.pendiente), 0)
    from public.conta_recibida_pago r join public.supplier_invoice si on si.id = r.invoice_id
   where si.source = 'traida' and si.created_at < timestamptz '2026-11-19 00:00:00+01'
  union all
  -- corte: recibidas creadas antes del 19/11 a las 00:00, por origen y estado
  select 3, 'todas las cuentas · recibidas ' || source || ' · ' || status, count(*)::text
    from public.supplier_invoice where created_at < timestamptz '2026-11-19 00:00:00+01' group by source, status
) t order by o, clave;
