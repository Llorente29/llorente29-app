-- scripts/conta/produccion/cuentas/r15b-libro-del-dia.sql
--
-- R15b · El día del TPV en el libro de IVA · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por cuenta y empresa (regla 9: agrupa por account_id y company_id; los ids cortados a 8, sin
-- nombres ni NIF):
--   1. La medida antes de rehacer: los días contabilizados, y cuántos han salido ya a ERP10 (esos
--      habrá que volver a mandarlos con su libro nuevo).
--   2. Regla 31, DÍA A DÍA: del libro de IVA de cada día contabilizado, la base y la cuota por tipo
--      y el total. Tiene que dar igual antes, con la tanda y después de deshacerla.
--   3. Las filas del libro de esos días por tipo de factura (F4, F2, F1, R5): esto SÍ cambia con la
--      tanda (es lo que hace), y vuelve con la vuelta atrás.
-- Corte fijo: lo subido antes del 22/11/2026 a las 00:00 de Madrid.
with d as (
  select d.account_id, d.company_id, d.id, d.dia, d.entry_id
    from public.conta_tpv_dia d join public.journal_entry e on e.id = d.entry_id and e.account_id = d.account_id
   where d.estado = 'contabilizado' and e.status = 'validado' and d.subido_en < timestamptz '2026-11-22 00:00:00+01'
), l as (
  select d.account_id, d.company_id, d.dia, v.invoice_type, v.tax_rate, v.tax_base, v.tax_amount, v.total
    from d join public.vat_book_entry v on v.entry_id = d.entry_id and v.account_id = d.account_id and v.book = 'issued' and v.voided_at is null
), pre as (
  select 'cuenta ' || left(account_id::text, 8) || ' · empresa ' || left(company_id::text, 8) as k, * from d
)
select clave, valor from (
  select 1 o, k || ' · días del TPV contabilizados' clave, count(*)::text valor from pre group by k
  union all
  select 1, k || ' · de ellos, ya salidos a ERP10',
         count(*) filter (where exists (select 1 from public.conta_erp10_salida_partida s
                                          where s.entry_id = pre.entry_id and s.account_id = pre.account_id and s.estado = 'salida'))::text
    from pre group by k
  union all
  select 2, 'cuenta ' || left(account_id::text, 8) || ' · empresa ' || left(company_id::text, 8) || ' · día ' || to_char(dia, 'YYYY-MM-DD') || ' · libro de IVA (regla 31)',
         string_agg(t, ' · ' order by t) || ' · total ' || to_char(sum(tot), 'FM9999990.00')
    from (select account_id, company_id, dia, tax_rate,
                 to_char(tax_rate, 'FM990.00') || ' %: ' || to_char(sum(tax_base), 'FM9999990.00') || ' + ' || to_char(sum(tax_amount), 'FM9999990.00') t,
                 sum(total) tot
            from l group by account_id, company_id, dia, tax_rate) x
   group by account_id, company_id, dia
  union all
  select 3, 'cuenta ' || left(account_id::text, 8) || ' · empresa ' || left(company_id::text, 8) || ' · filas del libro (cambian con la tanda)',
         string_agg(invoice_type || ' ' || n, ' · ' order by invoice_type)
    from (select account_id, company_id, invoice_type, count(*) n from l group by 1, 2, 3) y group by account_id, company_id
  union all
  select 4, 'tabla entera · días del TPV contabilizados', count(*)::text from d
) t order by o, clave;
