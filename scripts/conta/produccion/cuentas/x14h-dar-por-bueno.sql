-- scripts/conta/produccion/cuentas/x14h-dar-por-bueno.sql
--
-- X14 · 2 · «Darlo por bueno» del 2024 de QBO desde «Aplicar SQL en producción» · LO QUE CUENTA LA TANDA, antes y después.
-- SOLO LEE. SOLO NÚMEROS: ni cuentas, ni importes, ni nombres (T11). La carga empezó antes del 25/11/2026 a las 22:00 de
-- Madrid (corte fijo, W06). Lo que tiene que quedar (los «esperado:» de la tanda): la carga, dada por buena; ningún asiento
-- traído sin validar; ninguna emitida de la carga sin crear.
select clave, valor from (
  select 1 o, 'carga del 2024 de QBO · estado' clave, r.status valor
    from public.import_run r where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.started_at < timestamptz '2026-11-25 22:00:00+01'
  union all
  select 2, 'carga del 2024 de QBO · asientos traídos sin validar',
         (select count(*) from public.journal_entry e   -- quieta: los asientos de una carga en prueba solo los cambian darla por buena y deshacerla
           where e.import_run_id = r.id and e.source_type = 'migrated' and e.status <> 'validado')::text
    from public.import_run r where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.started_at < timestamptz '2026-11-25 22:00:00+01'
  union all
  select 3, 'carga del 2024 de QBO · emitidas de la carga sin crear',
         ((select count(*) from jsonb_array_elements(coalesce(r.detail->'emitidas', '[]')) x where x->>'marca' is distinct from 'fuera')
          - (select count(*) from public.customer_invoice c where c.import_run_id = r.id))::text   -- quieta: solo las crea darla por buena
    from public.import_run r where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.started_at < timestamptz '2026-11-25 22:00:00+01'
) t order by o, clave;
