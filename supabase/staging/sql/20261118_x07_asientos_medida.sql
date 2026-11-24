-- supabase/staging/sql/20261118_x07_asientos_medida.sql
--
-- SOLO STAGING. X07 · Qué asientos hay hoy en «todavía no sale» y cuáles pasan a
-- salir con la regla del X07 (encargo X07, 2.2: «antes de escribir, contesta en el
-- PR con los datos de staging»). Solo lee, y acaba en ROLLBACK.
--
-- La regla: sale como asiento lo que no tiene ninguna línea en el libro de I.V.A.
-- (nóminas, pagos y cobros, bancos, traspasos, regularizaciones, a mano sin
-- I.V.A.). No sale nada que lleve I.V.A. y no sea una factura que ya sale por lo
-- suyo; los días del TPV siguen sin salir (X08). Lo que conta_erp10_por_salir deja
-- fuera siempre (aperturas, cierres, contraasientos, traído, anulado) tampoco.
-- Tabla entera, a propósito, y dicho en cada línea (regla 9).

begin;
do $$
declare r record;
begin
  for r in
    with e as (
      select e.id, e.company_id, e.account_id, e.source_type, e.status,
             exists (select 1 from public.vat_book_entry v where v.entry_id = e.id and v.account_id = e.account_id and v.voided_at is null) as libro,
             exists (select 1 from public.vat_book_entry v where v.entry_id = e.id and v.account_id = e.account_id and v.voided_at is null and v.book in ('received', 'investment', 'issued')) as factura,
             (select count(*) from public.journal_line l where l.entry_id = e.id and l.account_id = e.account_id) as apuntes
        from public.journal_entry e
       where e.status in ('validado', 'anulado') and e.entry_date between '2026-01-01' and '2026-12-31'
         and e.external_program is null and e.import_run_id is null
    )
    select case
             when status = 'anulado' then '0 · anulado (no sale nunca)'
             when source_type in ('opening', 'closing', 'template', 'reversal', 'migrated') then '0 · ' || source_type || ' (no sale nunca)'
             when source_type = 'sales_day' then '2 · día del TPV (sigue sin salir: X08)'
             when factura then '1 · factura (ya sale por lo suyo)'
             when libro then '3 · lleva I.V.A. y no es factura (no sale: a mano)'
             else '4 · asiento sin I.V.A. (' || source_type || '): pasa a salir'
           end as clase,
           count(*) n, count(*) filter (where apuntes = 2) dos, count(*) filter (where apuntes > 2) mas, max(apuntes) maximo
      from e group by 1 order by 1
  loop
    raise notice 'MEDIDA X07 · tabla entera · ejercicio 2026 · % = % asientos (de 2 apuntes %, de más de 2 %, como mucho % apuntes)', r.clase, r.n, r.dos, r.mas, r.maximo;
  end loop;

  -- Las cuentas que hoy quedan en «todavía no salen por aquí» (la medida del X06) y las que quedarían con los asientos fuera.
  for r in
    with e as (
      select e.id, e.account_id,
             case when e.source_type = 'sales_day' then 'tpv'
                  when exists (select 1 from public.vat_book_entry v where v.entry_id = e.id and v.account_id = e.account_id and v.voided_at is null and v.book = 'issued'
                                 and (v.invoice_type like 'R%' or v.invoice_type = 'F4')) then 'a_mano'
                  when exists (select 1 from public.vat_book_entry v where v.entry_id = e.id and v.account_id = e.account_id and v.voided_at is null and v.book in ('received', 'investment', 'issued')) then 'sale'
                  when exists (select 1 from public.vat_book_entry v where v.entry_id = e.id and v.account_id = e.account_id and v.voided_at is null) then 'con_iva'
                  else 'asiento' end as clase
        from public.journal_entry e
       where e.status in ('validado', 'anulado') and e.entry_date between '2026-01-01' and '2026-12-31'
         and e.external_program is null and e.import_run_id is null
    ),
    c as (
      select l.company_id, l.company_account_id,
             coalesce(sum(l.debit - l.credit) filter (where e.clase <> 'sale'), 0) as antes,
             coalesce(sum(l.debit - l.credit) filter (where e.clase not in ('sale', 'asiento')), 0) as despues,
             bool_or(e.clase = 'tpv') tpv, bool_or(e.clase in ('a_mano', 'con_iva')) iva
        from public.journal_line l join e on e.id = l.entry_id and e.account_id = l.account_id
       group by 1, 2
    )
    select count(*) cuentas, count(*) filter (where antes <> 0) antes, count(*) filter (where despues <> 0) despues,
           count(*) filter (where despues <> 0 and tpv) por_tpv, count(*) filter (where despues <> 0 and iva) por_iva
      from c
  loop
    raise notice 'MEDIDA X07 · tabla entera · ejercicio 2026 · de % cuentas con movimiento, en «todavía no salen por aquí»: antes del X07 %, con los asientos fuera % (por días del TPV %, por lo que lleva I.V.A. %)',
      r.cuentas, r.antes, r.despues, r.por_tpv, r.por_iva;
  end loop;
end $$;
rollback;
