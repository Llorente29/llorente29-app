-- scripts/conta/produccion/cuentas/r07-dias-tpv.sql
--
-- R07 · El día del TPV en dos asientos · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por cuenta y empresa (regla 9: agrupa por account_id y company_id, sin anclar por nombre;
-- los ids van cortados a 8, sin nombres):
--   1. los días del TPV (conta_tpv_dia) contabilizados con su asiento;
--   2. de ellos, los que ya salieron a ERP10 (conta_erp10_salida_partida viva) y los que no;
--   3. de cada clase, los que caen en un periodo con el IVA presentado (conta_iva_presentado)
--      o en un mes cerrado (conta_mes_cerrado);
--   4. los días de ventas del TPV de Folvy (sales_day_summary) con asiento validado, que no
--      son de conta_tpv_dia: para saber si existen.
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
  select 3, 'cuenta ' || left(s.account_id::text, 8) || ' · empresa ' || left(s.company_id::text, 8) || ' · días del TPV de Folvy con asiento validado',
         count(*) || ' (del ' || to_char(min(s.sales_day), 'DD/MM/YYYY') || ' al ' || to_char(max(s.sales_day), 'DD/MM/YYYY') || ')'
    from public.sales_day_summary s join public.journal_entry e on e.id = s.entry_id and e.account_id = s.account_id
   where e.status = 'validado' and s.created_at < timestamptz '2026-11-20 00:00:00+01'
   group by s.account_id, s.company_id
) t order by o, clave;
