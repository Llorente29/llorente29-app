-- scripts/conta/produccion/cuentas/x14f-sumas.sql
--
-- X14 · 2 · El sumas y saldos de ERP10, de su fichero (conta_traer_poner_sumas) · LO QUE CUENTA LA TANDA, antes y después.
-- SOLO LEE, y solo columnas que existen antes de la tanda. SOLO NÚMEROS: ni cuentas, ni importes, ni nombres (T11). La tanda
-- no cambia ningún dato (una función nueva y tres cambiadas). Corte fijo (W06): cargas empezadas antes del 25/11/2026 a las
-- 15:30 de Madrid.
--   1. Por cuenta y carga en prueba (regla 9): las filas de sumas que guarda y de dónde (sin marca = calculadas de los
--      asientos, por la conexión), y las cuentas traídas a su diario.
--   0. Y la tabla entera: cuántas cargas en prueba, y cuántas con un sumas y saldos de fichero.
select clave, valor from (
  select 0 o, 'tabla entera · cargas en prueba (cuántas · con el sumas y saldos de su fichero)' clave,
         count(*) || ' · ' || count(*) filter (where detail->>'sumas_de' = 'fichero') valor
    from public.import_run where kind = 'carga' and status = 'en_prueba' and started_at < timestamptz '2026-11-25 15:30:00+01'
  union all
  select 1, 'cuenta ' || r.account_id || ' · carga ' || r.id || ' · sumas guardadas (filas · de dónde) y cuentas traídas',
         jsonb_array_length(coalesce(r.detail->'sumas', '[]')) || ' · ' || coalesce(r.detail->>'sumas_de', 'sin marca') || ' · '
         || (select count(distinct l.company_account_id) from public.journal_entry e join public.journal_line l on l.entry_id = e.id
              where e.import_run_id = r.id and e.source_type = 'migrated')
    from public.import_run r where r.kind = 'carga' and r.status = 'en_prueba' and r.started_at < timestamptz '2026-11-25 15:30:00+01'
) t order by o, clave;
