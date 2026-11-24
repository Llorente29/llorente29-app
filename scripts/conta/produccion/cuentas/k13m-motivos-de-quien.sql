-- scripts/conta/produccion/cuentas/k13m-motivos-de-quien.sql
--
-- K13m · conta_motivos_para_validar llama a conta_de_quien_es (0720) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 0720 solo cambia cómo lee una función a nombre de quién va una recibida: no escribe en ninguna fila. Se mide que
-- los asientos y las recibidas no se mueven: por cuenta (regla 9), cuántos asientos hay en cada estado y su huella, y
-- cuántas recibidas en cada estado. Corte fijo: lo creado antes del 24/11/2026 a las 09:00 de Madrid. Y siempre una fila
-- con todas las cuentas juntas, aunque no haya filas.
select clave, valor from (
  select 0 o, null::uuid account_id,
         'todas las cuentas · asientos: filas · huella (estado, origen, número)' clave,
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', e.account_id, e.id, e.status, e.source_type, e.series, e.number), ';' order by e.account_id, e.id)), 12), 'ninguna') valor
    from public.journal_entry e
   where e.created_at < timestamptz '2026-11-24 09:00:00+01'
  union all
  select 0, null, 'todas las cuentas · recibidas: filas · huella (estado)',
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', i.account_id, i.id, i.status), ';' order by i.account_id, i.id)), 12), 'ninguna')
    from public.supplier_invoice i
   where i.created_at < timestamptz '2026-11-24 09:00:00+01'
  union all
  select 1, e.account_id, 'cuenta ' || e.account_id || ' · asientos ' || e.status || ': filas · huella',
         count(*) || ' · ' || left(md5(string_agg(concat_ws('|', e.id, e.source_type, e.series, e.number), ';' order by e.id)), 12)
    from public.journal_entry e
   where e.created_at < timestamptz '2026-11-24 09:00:00+01'
   group by e.account_id, e.status
) t order by o, account_id, clave;
