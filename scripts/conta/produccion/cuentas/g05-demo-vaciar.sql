-- scripts/conta/produccion/cuentas/g05-demo-vaciar.sql
--
-- G05 · «Volver a empezar» puede vaciar la demo (nº 86) · LO QUE CUENTA LA TANDA,
-- antes y después. SOLO LEE. La misma vara a los dos lados (regla 31). Medido
-- antes el 10/11 a las 16:00 UTC. Lo que tiene que pasar:
--   1. _conta_demo_permitir_vaciar existe: false → true.
--   2. Las cuatro protecciones miran la marca de la demo: 0 → 4.
--   3. Facturas emitidas FUERA de las cuentas de demostración (hasta el corte): quieta.
--   4. Asientos validados o anulados FUERA de las cuentas de demostración (hasta el corte): quieta.
select clave, valor from (
  select 1 o, '_conta_demo_permitir_vaciar existe' clave,
    (to_regprocedure('public._conta_demo_permitir_vaciar(uuid)') is not null)::text valor union all
  select 2, 'Protecciones que miran la marca de la demo',
    (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('customer_invoice_inalterable', 'customer_invoice_line_inalterable', 'journal_entry_inalterable', 'journal_line_inalterable')
      and p.prosrc ~ '_conta_demo_vaciando') union all
  select 3, 'Facturas emitidas fuera de la demo (hasta el corte)',
    (select count(*)::text from public.customer_invoice i join public.accounts a on a.id = i.account_id
      where i.status <> 'borrador' and a.is_demo is not true and i.created_at < timestamptz '2026-11-10 16:00:00+00') union all
  select 4, 'Asientos validados fuera de la demo (hasta el corte)',
    (select count(*)::text from public.journal_entry j join public.accounts a on a.id = j.account_id
      where j.status in ('validado', 'anulado') and a.is_demo is not true and j.created_at < timestamptz '2026-11-10 16:00:00+00')
) q order by o;
