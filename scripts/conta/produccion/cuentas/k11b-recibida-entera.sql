-- scripts/conta/produccion/cuentas/k11b-recibida-entera.sql
--
-- K11b · Los datos de cada línea, por clave (1750) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 1750 solo cambia cómo guarda conta_recibida_otros_datos las líneas que se le mandan a partir de ahora: no escribe
-- en ninguna fila. Se mide que lo guardado no se mueve: por cuenta (regla 9), cuántas líneas con sus datos hay, cuántas
-- con marca y cuántas con plataforma, y la huella de todas (factura, posición, concepto, marca y plataforma).
-- Corte fijo: lo escrito antes del 23/11/2026 a las 18:00 de Madrid. Y siempre una fila con todas las cuentas juntas,
-- aunque no haya ninguna línea (staging, 23/11: sin filas, el comparador no tiene «antes» y para).
select clave, valor from (
  select 0 o, null::uuid account_id,
         'todas las cuentas · datos de las líneas de las recibidas: filas · con marca · con plataforma · huella' clave,
         count(*) || ' · ' || count(d.brand_id) || ' · ' || count(d.channel_id) || ' · '
           || coalesce(left(md5(string_agg(concat_ws('|', d.account_id, d.supplier_invoice_id, d.position, d.concept, d.brand_id, d.channel_id), ';'
                                  order by d.account_id, d.supplier_invoice_id, d.position)), 12), 'ninguna') valor
    from public.supplier_invoice_expense_dato d
   where d.updated_at < timestamptz '2026-11-23 18:00:00+01'
  union all
  select 1, d.account_id,
         'cuenta ' || d.account_id || ' · datos de las líneas de las recibidas: filas · con marca · con plataforma · huella' clave,
         count(*) || ' · ' || count(d.brand_id) || ' · ' || count(d.channel_id) || ' · '
           || left(md5(string_agg(concat_ws('|', d.supplier_invoice_id, d.position, d.concept, d.brand_id, d.channel_id), ';'
                                  order by d.supplier_invoice_id, d.position)), 12) valor
    from public.supplier_invoice_expense_dato d
   where d.updated_at < timestamptz '2026-11-23 18:00:00+01'
   group by d.account_id
) t order by o, account_id;
