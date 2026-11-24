-- scripts/conta/produccion/cuentas/x14-traer.sql
--
-- X14 · 1 · La carga por trozos (1552) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE, y solo columnas que existen
-- antes de la tanda. Corte fijo (W06): lo creado antes del 24/11/2026 a las 17:00 de Madrid. La tanda no cambia ningún dato:
--   1. Regla 31, por cuenta (regla 9): las cargas de «Traer» (cuántas · por estado · huella de su estado y sus recuentos).
--   2. Y lo traído, por cuenta: los asientos de otro programa (cuántos · en borrador · huella de su fecha, su estado y su
--      número de allí).
--   0. Y la tabla entera, etiquetada como tal (regla 9): da su fila aunque no haya ninguna carga.
select clave, valor from (
  select 0 o, 'tabla entera · cargas de Traer (cuántas · huella)' clave,
         count(*) || ' · ' || coalesce(md5(string_agg(concat_ws('|', r.id, r.status, r.counts::text), ',' order by r.id)), 'ninguna') valor
    from public.import_run r
   where r.kind = 'carga' and r.started_at < timestamptz '2026-11-24 17:00:00+01'
  union all
  select 1, 'cuenta ' || r.account_id || ' · cargas de Traer (cuántas · en prueba · dadas por buenas · deshechas · huella)',
         count(*) || ' · ' || count(*) filter (where r.status = 'en_prueba') || ' · ' || count(*) filter (where r.status = 'dada_por_buena') || ' · '
         || count(*) filter (where r.status = 'deshecha') || ' · ' || md5(string_agg(concat_ws('|', r.id, r.status, r.counts::text), ',' order by r.id))
    from public.import_run r
   where r.kind = 'carga' and r.started_at < timestamptz '2026-11-24 17:00:00+01'
   group by r.account_id
  union all
  select 2, 'cuenta ' || e.account_id || ' · asientos traídos (cuántos · en borrador · huella)',
         count(*) || ' · ' || count(*) filter (where e.status = 'borrador') || ' · '
         || md5(string_agg(concat_ws('|', e.id, e.entry_date, e.status, e.external_series, e.external_number), ',' order by e.id))
    from public.journal_entry e
   where e.source_type = 'migrated' and e.created_at < timestamptz '2026-11-24 17:00:00+01'
   group by e.account_id
) t order by o, clave;
