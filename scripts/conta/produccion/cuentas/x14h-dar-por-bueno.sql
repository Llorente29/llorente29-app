-- scripts/conta/produccion/cuentas/x14h-dar-por-bueno.sql
--
-- X14 · 2 · «Darlo por bueno» del 2024 de QBO desde «Aplicar SQL en producción» · LO QUE CUENTA LA TANDA, antes y después.
-- SOLO LEE. SOLO NÚMEROS: ni cuentas, ni importes, ni nombres (T11). La carga empezó antes del 25/11/2026 a las 22:00 de
-- Madrid (corte fijo, W06). Cada medida sale siempre, también donde la carga no existe (staging): lo esperado se cumple en
-- los dos sitios, en producción porque la tanda lo hace y en staging porque no hay nada que hacer.
--   · Lo que tiene que quedar: ninguna carga en prueba, ningún asiento traído sin validar, ninguna emitida sin crear, y las
--     marcadas «repetida en ERP10», exactamente las que el libro de expedidas trae repetidas (X14h, 26/11).
--   · Lo demás, para ver qué hay (como antes).
with r as (
  select * from public.import_run   -- quieta: la carga es fija, de antes del corte
   where id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and started_at < timestamptz '2026-11-25 22:00:00+01'
), em as (
  select x from r, jsonb_array_elements(coalesce(r.detail->'emitidas', '[]')) x where x->>'marca' is distinct from 'fuera'
), rep as (   -- las claves que el libro trae más de una vez
  select x->>'serie' s, x->>'ejercicio' y, x->>'numero' n, count(*) veces, max((x->>'fecha')::date) hasta,
         count(distinct (x->>'fecha', x->'cliente', x->>'base', x->>'cuota', x->>'retencion', x->>'total')) variantes,
         bool_or((x->>'total')::numeric < 0) negativa
    from em group by 1, 2, 3 having count(*) > 1
), ci as (
  select c.* from public.customer_invoice c join r on c.import_run_id = r.id   -- quieta: solo las crea darla por buena
)
select clave, valor from (
  select 1 o, 'carga del 2024 de QBO · en prueba' clave, (select count(*) from r where status = 'en_prueba')::text valor
  union all
  select 2, 'carga del 2024 de QBO · asientos traídos sin validar',
         (select count(*) from public.journal_entry e join r on e.import_run_id = r.id   -- quieta: solo los cambian darla por buena y deshacerla
           where e.source_type = 'migrated' and e.status <> 'validado')::text
  union all
  select 3, 'carga del 2024 de QBO · emitidas de la carga sin crear', ((select count(*) from em) - (select count(*) from ci))::text
  union all
  select 4, 'carga del 2024 de QBO · marcadas repetida en ERP10, menos las que el libro trae repetidas',
         ((select count(*) from ci where coalesce((to_jsonb(ci)->>'import_repeated')::boolean, false))   -- to_jsonb: antes de la 0710 la columna no existe
          - (select coalesce(sum(veces), 0) from rep))::text
  union all
  select 5, 'carga del 2024 de QBO · emitidas que el libro trae repetidas', (select coalesce(sum(veces), 0) from rep)::text
  union all
  select 6, 'carga del 2024 de QBO · emitidas repetidas: grupos', (select count(*) from rep)::text
  union all
  select 7, 'carga del 2024 de QBO · emitidas repetidas: grupos con alguna diferencia (fecha, cliente o importes)', (select count(*) from rep where variantes > 1)::text
  union all
  select 8, 'carga del 2024 de QBO · emitidas repetidas: grupos con un importe en negativo', (select count(*) from rep where negativa)::text
  union all
  select 9, 'carga del 2024 de QBO · emitidas repetidas: grupos del día de inicio o después',
         (select count(*) from rep, r where rep.hasta >= public.conta_dia_de_inicio(r.company_id))::text
  union all
  select 10, 'carga del 2024 de QBO · emitidas que ya estaban en Sumied fuera de la carga',
         (select count(*) from em, r where exists (select 1 from public.customer_invoice c   -- quieta: la empresa no factura en Sumied (lleva la contabilidad en ERP10)
            where c.company_id = r.company_id and c.series_code = em.x->>'serie' and c.fiscal_year = (em.x->>'ejercicio')::int
              and c.number = (em.x->>'numero')::int and c.import_run_id is distinct from r.id))::text
  union all
  select 11, 'carga del 2024 de QBO · día de inicio de la empresa',   -- quieta: lo fija Julio, a mano
         coalesce((select to_char(public.conta_dia_de_inicio(r.company_id), 'YYYY-MM-DD') from r), 'sin fijar')
) t order by o, clave;
