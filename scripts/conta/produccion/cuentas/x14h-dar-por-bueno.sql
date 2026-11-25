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
  union all
  -- Por qué para en las emitidas (XH004): cuántas de la carga repiten serie, número y ejercicio dentro de la propia carga, y
  -- cuántas ya están en Sumied fuera de ella (traídas de otra carga o hechas en Sumied). Solo números.
  select 4, 'carga del 2024 de QBO · emitidas repetidas dentro de la carga',
         (select count(*) - count(distinct (x->>'serie', x->>'ejercicio', x->>'numero')) from jsonb_array_elements(coalesce(r.detail->'emitidas', '[]')) x where x->>'marca' is distinct from 'fuera')::text   -- quieta: el detalle de una carga en prueba no cambia
    from public.import_run r where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.started_at < timestamptz '2026-11-25 22:00:00+01'
  union all
  select 5, 'carga del 2024 de QBO · emitidas repetidas dentro de la carga con distinto número escrito',
         (select count(*) from (select x->>'serie' s, x->>'ejercicio' y, x->>'numero' n from jsonb_array_elements(coalesce(r.detail->'emitidas', '[]')) x where x->>'marca' is distinct from 'fuera'
                                 group by 1, 2, 3 having count(distinct x->>'numero_texto') > 1) d)::text   -- quieta: el detalle de una carga en prueba no cambia
    from public.import_run r where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.started_at < timestamptz '2026-11-25 22:00:00+01'
  union all
  select 6, 'carga del 2024 de QBO · emitidas sin número',
         (select count(*) from jsonb_array_elements(coalesce(r.detail->'emitidas', '[]')) x where x->>'marca' is distinct from 'fuera' and nullif(x->>'numero', '') is null)::text   -- quieta: el detalle de una carga en prueba no cambia
    from public.import_run r where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.started_at < timestamptz '2026-11-25 22:00:00+01'
  union all
  select 7, 'carga del 2024 de QBO · emitidas que ya están en Sumied, traídas de otra carga',
         (select count(*) from jsonb_array_elements(coalesce(r.detail->'emitidas', '[]')) x where x->>'marca' is distinct from 'fuera' and exists (select 1 from public.customer_invoice c   -- quieta: la empresa no factura en Sumied (lleva la contabilidad en ERP10)
            where c.company_id = r.company_id and c.series_code = x->>'serie' and c.fiscal_year = (x->>'ejercicio')::int
              and c.number = (x->>'numero')::int and c.import_run_id is not null and c.import_run_id <> r.id))::text
    from public.import_run r where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.started_at < timestamptz '2026-11-25 22:00:00+01'
  union all
  select 8, 'carga del 2024 de QBO · emitidas que ya están en Sumied, hechas en Sumied',
         (select count(*) from jsonb_array_elements(coalesce(r.detail->'emitidas', '[]')) x where x->>'marca' is distinct from 'fuera' and exists (select 1 from public.customer_invoice c   -- quieta: la empresa no factura en Sumied (lleva la contabilidad en ERP10)
            where c.company_id = r.company_id and c.series_code = x->>'serie' and c.fiscal_year = (x->>'ejercicio')::int
              and c.number = (x->>'numero')::int and c.import_run_id is null))::text
    from public.import_run r where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.started_at < timestamptz '2026-11-25 22:00:00+01'
  union all
  select 9, 'carga del 2024 de QBO · emitidas repetidas: grupos',
         (select count(*) from (select 1 from jsonb_array_elements(coalesce(r.detail->'emitidas', '[]')) x where x->>'marca' is distinct from 'fuera' group by x->>'serie', x->>'ejercicio', x->>'numero'
                                 having count(*) > 1 and true) d)::text   -- quieta: el detalle de una carga en prueba no cambia
    from public.import_run r where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.started_at < timestamptz '2026-11-25 22:00:00+01'
  union all
  select 10, 'carga del 2024 de QBO · emitidas repetidas: grupos idénticos (fecha, cliente e importes)',
         (select count(*) from (select 1 from jsonb_array_elements(coalesce(r.detail->'emitidas', '[]')) x where x->>'marca' is distinct from 'fuera' group by x->>'serie', x->>'ejercicio', x->>'numero'
                                 having count(*) > 1 and count(distinct (x->>'fecha', x->'cliente', x->>'base', x->>'cuota', x->>'retencion', x->>'total')) = 1) d)::text   -- quieta: el detalle de una carga en prueba no cambia
    from public.import_run r where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.started_at < timestamptz '2026-11-25 22:00:00+01'
  union all
  select 11, 'carga del 2024 de QBO · emitidas repetidas: grupos con la misma fecha y cliente e importes distintos',
         (select count(*) from (select 1 from jsonb_array_elements(coalesce(r.detail->'emitidas', '[]')) x where x->>'marca' is distinct from 'fuera' group by x->>'serie', x->>'ejercicio', x->>'numero'
                                 having count(*) > 1 and count(distinct (x->>'fecha', x->'cliente')) = 1 and count(distinct (x->>'base', x->>'cuota', x->>'total')) > 1) d)::text   -- quieta: el detalle de una carga en prueba no cambia
    from public.import_run r where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.started_at < timestamptz '2026-11-25 22:00:00+01'
  union all
  select 12, 'carga del 2024 de QBO · emitidas repetidas: grupos con distinta fecha',
         (select count(*) from (select 1 from jsonb_array_elements(coalesce(r.detail->'emitidas', '[]')) x where x->>'marca' is distinct from 'fuera' group by x->>'serie', x->>'ejercicio', x->>'numero'
                                 having count(*) > 1 and count(distinct x->>'fecha') > 1) d)::text   -- quieta: el detalle de una carga en prueba no cambia
    from public.import_run r where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.started_at < timestamptz '2026-11-25 22:00:00+01'
  union all
  select 13, 'carga del 2024 de QBO · emitidas repetidas: grupos con distinto cliente',
         (select count(*) from (select 1 from jsonb_array_elements(coalesce(r.detail->'emitidas', '[]')) x where x->>'marca' is distinct from 'fuera' group by x->>'serie', x->>'ejercicio', x->>'numero'
                                 having count(*) > 1 and count(distinct x->'cliente') > 1) d)::text   -- quieta: el detalle de una carga en prueba no cambia
    from public.import_run r where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.started_at < timestamptz '2026-11-25 22:00:00+01'
  union all
  select 14, 'carga del 2024 de QBO · emitidas repetidas: grupos con el mismo asiento',
         (select count(*) from (select 1 from jsonb_array_elements(coalesce(r.detail->'emitidas', '[]')) x where x->>'marca' is distinct from 'fuera' group by x->>'serie', x->>'ejercicio', x->>'numero'
                                 having count(*) > 1 and count(distinct x->>'asiento') = 1 and bool_and(nullif(x->>'asiento', '') is not null)) d)::text   -- quieta: el detalle de una carga en prueba no cambia
    from public.import_run r where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.started_at < timestamptz '2026-11-25 22:00:00+01'
  union all
  select 15, 'carga del 2024 de QBO · emitidas repetidas: grupos con un importe en negativo',
         (select count(*) from (select 1 from jsonb_array_elements(coalesce(r.detail->'emitidas', '[]')) x where x->>'marca' is distinct from 'fuera' group by x->>'serie', x->>'ejercicio', x->>'numero'
                                 having count(*) > 1 and bool_or((x->>'total')::numeric < 0)) d)::text   -- quieta: el detalle de una carga en prueba no cambia
    from public.import_run r where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.started_at < timestamptz '2026-11-25 22:00:00+01'
) t order by o, clave;
