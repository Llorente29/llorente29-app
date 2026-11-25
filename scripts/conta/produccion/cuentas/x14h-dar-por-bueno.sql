-- scripts/conta/produccion/cuentas/x14h-dar-por-bueno.sql
--
-- X14 · 2 · «Darlo por bueno» del 2024 de QBO desde «Aplicar SQL en producción» · LO QUE CUENTA LA TANDA, antes y después.
-- SOLO LEE. SOLO NÚMEROS: ni cuentas, ni importes, ni nombres (T11). Corte fijo (W06): la carga y lo suyo, de antes del
-- 25/11/2026 a las 22:00 de Madrid (la carga empezó antes).
--   1. La carga: su estado.
--   2. Sus asientos traídos, por estado (borrador · validado), y sus facturas emitidas ya creadas y recibidas.
select clave, valor from (
  select 1 o, 'carga ' || r.id || ' · estado' clave, r.status valor
    from public.import_run r where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.started_at < timestamptz '2026-11-25 22:00:00+01'
  union all
  select 2, 'carga ' || e.import_run_id || ' · asientos traídos (borrador · validado)',
         count(*) filter (where e.status = 'borrador') || ' · ' || count(*) filter (where e.status = 'validado')
    from public.journal_entry e   -- quieta: los asientos de una carga en prueba solo los cambian darla por buena y deshacerla
   where e.import_run_id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and e.source_type = 'migrated' group by e.import_run_id
  union all
  select 3, 'carga e694df2e-56ff-41b0-a7f7-94be3efaa6c9 · facturas (emitidas creadas · recibidas)',
         (select count(*) from public.customer_invoice where import_run_id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9') || ' · '   -- quieta: solo las crea darla por buena
         || (select count(*) from public.supplier_invoice where import_run_id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9')       -- quieta: solo las crea la carga
) t order by o, clave;
