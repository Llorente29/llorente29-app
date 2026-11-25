-- scripts/conta/produccion/cuentas/x33-qbo-a-erp10.sql
--
-- X33 · La contabilidad de QBO a ERP10 · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 1205 y la 1207 solo añaden (tablas y funciones nuevas; la 1205 apunta el ajuste en las dos empresas de QBO, en su
-- tabla nueva). La 1206 cambia las tres funciones que eligen lo que sale a ERP10, sin escribir en ninguna fila. Ninguna
-- prepara un asiento: eso lo hace una persona con el botón. Se mide que no se mueve nada de lo que ya existe: por cuenta
-- (regla 9), los asientos (filas y huella), los envíos a ERP10 y las subcuentas; y siempre una fila con todas las
-- cuentas juntas. Corte fijo: lo creado antes del 25/11/2026 a las 12:00 de Madrid.
select clave, valor from (
  select 0 o, null::uuid account_id, 'todas las cuentas · asientos: filas · huella (estado, origen, número)' clave,
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', e.account_id, e.id, e.status, e.source_type, e.series, e.number), ';' order by e.account_id, e.id)), 12), 'ninguna') valor
    from public.journal_entry e where e.created_at < timestamptz '2026-11-25 12:00:00+01'
  union all
  select 0, null, 'todas las cuentas · envíos a ERP10: filas · huella (estado)',
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', v.account_id, v.id, v.estado), ';' order by v.account_id, v.id)), 12), 'ninguna')
    from public.conta_erp10_envio v where v.creado_en < timestamptz '2026-11-25 12:00:00+01'
  union all
  select 0, null, 'todas las cuentas · subcuentas: filas',
         count(*)::text from public.company_account ca where ca.created_at < timestamptz '2026-11-25 12:00:00+01'
  union all
  select 1, e.account_id, 'cuenta ' || e.account_id || ' · asientos: filas · huella',
         count(*) || ' · ' || left(md5(string_agg(concat_ws('|', e.id, e.status, e.source_type, e.number), ';' order by e.id)), 12)
    from public.journal_entry e where e.created_at < timestamptz '2026-11-25 12:00:00+01'
   group by e.account_id
) t order by o, account_id, clave;
