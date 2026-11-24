-- scripts/conta/produccion/cuentas/r07-dias-tpv.sql
--
-- R07 · El día del TPV en dos asientos · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por cuenta y empresa (regla 9: agrupa por account_id y company_id, sin anclar por nombre;
-- los ids van cortados a 8, sin nombres):
--   1. los días del TPV (conta_tpv_dia) contabilizados con su asiento;
--   2. de ellos, los que ya salieron a ERP10 (conta_erp10_salida_partida viva) y los que no;
--   3. de cada clase, los que caen en un periodo con el IVA presentado (conta_iva_presentado)
--      o en un mes cerrado (conta_mes_cerrado);
--   4. lo mismo para los días del TPV de Folvy (sales_day_summary) con asiento validado,
--      que no son de conta_tpv_dia, contados por asiento.
--   5. los cobros del día (origen sales_day_payment) en el diario: la tanda no rehace
--      ningún día, así que tiene que dar 0 antes y después.
-- Corte fijo: lo creado antes del 20/11/2026 a las 00:00 de Madrid.
with d as (
  select d.account_id, d.company_id, d.dia fecha, d.entry_id,
         exists (select 1 from public.conta_erp10_salida_partida p where p.entry_id = d.entry_id and p.estado = 'salida') salido,
         public.conta_iva_presentado(d.company_id, d.dia) is not null iva,
         public.conta_mes_cerrado(d.company_id, d.dia) mes
    from public.conta_tpv_dia d
    join public.journal_entry e on e.id = d.entry_id and e.account_id = d.account_id
   where d.estado = 'contabilizado' and d.entry_id is not null and e.status = 'validado'
     and d.subido_en < timestamptz '2026-11-20 00:00:00+01'
),
-- Los días del TPV de Folvy (sales_day_summary): un asiento puede llevar varios locales.
f as (
  select e.account_id, e.company_id, e.entry_date fecha, e.id,
         exists (select 1 from public.conta_erp10_salida_partida p where p.entry_id = e.id and p.estado = 'salida') salido,
         public.conta_iva_presentado(e.company_id, e.entry_date) is not null iva,
         public.conta_mes_cerrado(e.company_id, e.entry_date) mes
    from public.journal_entry e
   where e.status = 'validado'
     and exists (select 1 from public.sales_day_summary s where s.entry_id = e.id and s.account_id = e.account_id
                    and s.created_at < timestamptz '2026-11-20 00:00:00+01')
)
select clave, valor from (
  select 1 o, 'cuenta ' || left(account_id::text, 8) || ' · empresa ' || left(company_id::text, 8) || ' · días validados · '
         || case when salido then 'salidos a ERP10' else 'no salidos' end clave,
         count(*) || ' (del ' || to_char(min(fecha), 'DD/MM/YYYY') || ' al ' || to_char(max(fecha), 'DD/MM/YYYY') || ')'
         || ' · con el IVA presentado ' || count(*) filter (where iva)
         || ' · en mes cerrado ' || count(*) filter (where mes) valor
    from d group by account_id, company_id, salido
  union all
  select 2, 'tabla entera · días del TPV contabilizados', count(*)::text from d
  union all
  select 3, 'cuenta ' || left(f.account_id::text, 8) || ' · empresa ' || left(f.company_id::text, 8) || ' · días del TPV de Folvy validados · '
         || case when f.salido then 'salidos a ERP10' else 'no salidos' end,
         count(*) || ' asientos (del ' || to_char(min(f.fecha), 'DD/MM/YYYY') || ' al ' || to_char(max(f.fecha), 'DD/MM/YYYY') || ')'
         || ' · con el IVA presentado ' || count(*) filter (where f.iva)
         || ' · en mes cerrado ' || count(*) filter (where f.mes) valor
    from f group by f.account_id, f.company_id, f.salido
  union all
  select 4, 'tabla entera · cobros del día en el diario', count(*)::text
    from public.journal_entry e where e.source_type = 'sales_day_payment' and e.created_at < timestamptz '2026-11-20 00:00:00+01'
) t order by o, clave;
