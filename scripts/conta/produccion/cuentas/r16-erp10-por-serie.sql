-- scripts/conta/produccion/cuentas/r16-erp10-por-serie.sql
--
-- R16 · El día del TPV sale a ERP10 como su libro de IVA · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por cuenta y empresa (regla 9: agrupa por account_id y company_id; los ids cortados a 8, sin nombres ni NIF):
--   1. La medida antes de cambiar la salida: los días del TPV contabilizados, cuántos han salido ya a ERP10 por la
--      conexión (conta_erp10_envio, «en_erp10») y cuántos por el fichero (conta_erp10_salida_partida, «salida»). Si
--      alguno ha salido, habría que volver a mandarlo.
--   2. Regla 31, DÍA A DÍA: el total del día en el fichero de ERP10 antes (una factura: lo que la factura del día carga a
--      Clientes de contado) y después (lo que suman sus facturas: las filas de su libro de IVA), y en cuántas facturas
--      sale. Tiene que dar el mismo total.
--   3. Las facturas con NIF de esos días y cuántos clientes distintos (los que la salida dará de alta si no tienen 430).
-- La tanda solo añade funciones: todo da igual antes, con la tanda y después de deshacerla.
-- Corte fijo: lo subido antes del 23/11/2026 a las 00:00 de Madrid.
with d as (
  select d.account_id, d.company_id, d.id, d.dia, d.entry_id
    from public.conta_tpv_dia d join public.journal_entry e on e.id = d.entry_id and e.account_id = d.account_id
   where d.estado = 'contabilizado' and e.status = 'validado' and d.subido_en < timestamptz '2026-11-23 00:00:00+01'
), pre as (
  select 'cuenta ' || left(account_id::text, 8) || ' · empresa ' || left(company_id::text, 8) as k, * from d
), antes as (
  -- La factura del día, como sale hoy: lo que carga a su cuenta de Clientes de contado (la de «La factura del día va a»).
  select d.entry_id, sum(l.debit - l.credit) as total
    from d join public.journal_line l on l.entry_id = d.entry_id and l.account_id = d.account_id
    join public.conta_tpv_factura_cuenta f on f.company_id = d.company_id and f.account_id = d.account_id and f.company_account_id = l.company_account_id
   group by d.entry_id
), despues as (
  select d.entry_id, sum(v.total) as total,
         count(distinct v.invoice_type || '|' || coalesce(v.series, '') || '|' || coalesce(v.number, '') || '|' || coalesce(v.number_to, '')) as facturas,
         count(*) filter (where v.invoice_type = 'F1') as con_nif
    from d join public.vat_book_entry v on v.entry_id = d.entry_id and v.account_id = d.account_id and v.book = 'issued' and v.voided_at is null
                                    and v.created_at < timestamptz '2026-11-23 00:00:00+01'
   group by d.entry_id
)
select clave, valor from (
  select 1 o, k || ' · días del TPV contabilizados' clave, count(*)::text valor from pre group by k
  union all
  select 1, k || ' · de ellos, ya salidos a ERP10 por la conexión',
         count(*) filter (where exists (select 1 from public.conta_erp10_envio x where x.entry_id = pre.entry_id and x.account_id = pre.account_id
                                          and x.estado = 'en_erp10' and x.creado_en < timestamptz '2026-11-23 00:00:00+01'))::text
    from pre group by k
  union all
  select 1, k || ' · de ellos, ya salidos a ERP10 por el fichero',
         count(*) filter (where exists (select 1 from public.conta_erp10_salida_partida s where s.entry_id = pre.entry_id and s.account_id = pre.account_id
                                          and s.estado = 'salida' and s.creado_en < timestamptz '2026-11-23 00:00:00+01'))::text
    from pre group by k
  union all
  select 2, pre.k || ' · día ' || to_char(pre.dia, 'YYYY-MM-DD') || ' · total en ERP10 antes y después (regla 31)',
         'antes ' || to_char(a.total, 'FM9999990.00') || ' (1 factura) · después ' || to_char(x.total, 'FM9999990.00') || ' (' || x.facturas || ' facturas)'
    from pre left join antes a on a.entry_id = pre.entry_id left join despues x on x.entry_id = pre.entry_id
  union all
  select 3, k || ' · facturas con NIF en esos días', coalesce(sum(x.con_nif), 0)::text
    from pre left join despues x on x.entry_id = pre.entry_id group by k
  union all
  select 3, 'cuenta ' || left(d.account_id::text, 8) || ' · empresa ' || left(d.company_id::text, 8) || ' · clientes distintos con NIF',
         count(distinct upper(regexp_replace(v.counterpart_tax_id, '[^0-9A-Za-z]', '', 'g')))::text
    from d join public.vat_book_entry v on v.entry_id = d.entry_id and v.account_id = d.account_id and v.book = 'issued' and v.voided_at is null and v.invoice_type = 'F1'
                                    and v.created_at < timestamptz '2026-11-23 00:00:00+01'
   group by d.account_id, d.company_id
  union all
  select 4, 'tabla entera · días del TPV contabilizados', count(*)::text from d
) t order by o, clave;
