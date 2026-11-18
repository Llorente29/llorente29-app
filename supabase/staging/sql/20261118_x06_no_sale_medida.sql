-- supabase/staging/sql/20261118_x06_no_sale_medida.sql
--
-- SOLO STAGING. X06 · En cuántas cuentas la diferencia con ERP10 se explicaría
-- ENTERA por lo que hoy no sale por la salida (encargo X06, punto 3: «antes de
-- escribir, contesta en el PR con los datos de staging»). Solo lee, y acaba en
-- ROLLBACK.
--
-- Supuesto de la medida: todo lo que sale ha salido y ERP10 lo ha cogido. Entonces
-- la diferencia de cada cuenta es justo lo que no sale. Cada asiento validado del
-- ejercicio 2026 que no es traído se clasifica con las mismas reglas que
-- conta_erp10_por_salir y la pantalla:
--   · sale: recibida (libro de recibidas) o emitida (libro de expedidas) que no es
--     rectificativa (R1 a R5) ni resumen (F4) ni día del TPV;
--   · no sale todavía: asiento sin libro de IVA (nóminas, bancos, traspasos,
--     aperturas…), día del TPV (sales_day) y emitida rectificativa o resumen.
-- Tabla entera, a propósito, y dicho en cada línea (regla 9): todas las cuentas de
-- prueba de staging, no una empresa.

begin;
do $$
declare r record;
begin
  for r in
    with e as (
      select e.id, e.company_id, e.account_id,
             case
               when exists (select 1 from public.vat_book_entry v where v.entry_id = e.id and v.account_id = e.account_id and v.voided_at is null and v.book in ('received', 'investment')) then 'sale'
               when e.source_type = 'sales_day' then 'tpv'
               when exists (select 1 from public.vat_book_entry v where v.entry_id = e.id and v.account_id = e.account_id and v.voided_at is null and v.book = 'issued'
                              and (v.invoice_type like 'R%' or v.invoice_type = 'F4')) then 'emitida_a_mano'
               when exists (select 1 from public.vat_book_entry v where v.entry_id = e.id and v.account_id = e.account_id and v.voided_at is null and v.book = 'issued') then 'sale'
               else 'asiento' end as clase
        from public.journal_entry e
       where e.status in ('validado', 'anulado') and e.entry_date between '2026-01-01' and '2026-12-31'
         and e.external_program is null and e.import_run_id is null
    ),
    c as (
      select l.company_id, l.company_account_id,
             sum(l.debit - l.credit) filter (where e.clase = 'sale') as sale,
             sum(l.debit - l.credit) filter (where e.clase <> 'sale') as no_sale,
             bool_or(e.clase = 'sale') as hay_sale, bool_or(e.clase <> 'sale') as hay_no_sale,
             bool_or(e.clase = 'asiento') as hay_asiento, bool_or(e.clase = 'tpv') as hay_tpv, bool_or(e.clase = 'emitida_a_mano') as hay_a_mano
        from public.journal_line l join e on e.id = l.entry_id and e.account_id = l.account_id
       group by 1, 2
    )
    select count(distinct company_id) empresas, count(*) cuentas,
           count(*) filter (where hay_no_sale and coalesce(no_sale, 0) <> 0) con_diferencia,
           count(*) filter (where hay_no_sale and coalesce(no_sale, 0) <> 0 and not hay_sale) solo_no_sale,
           count(*) filter (where hay_no_sale and coalesce(no_sale, 0) <> 0 and hay_sale) mezcladas,
           count(*) filter (where hay_no_sale and coalesce(no_sale, 0) = 0) no_sale_que_se_anula,
           count(*) filter (where not hay_no_sale) solo_sale,
           count(*) filter (where hay_asiento and coalesce(no_sale, 0) <> 0) por_asientos,
           count(*) filter (where hay_tpv and coalesce(no_sale, 0) <> 0) por_tpv,
           count(*) filter (where hay_a_mano and coalesce(no_sale, 0) <> 0) por_emitidas_a_mano,
           coalesce(sum(abs(no_sale)) filter (where hay_no_sale), 0) importe
      from c
  loop
    raise notice 'MEDIDA X06 · tabla entera · ejercicio 2026 · % empresas, % cuentas con movimiento: % solo con lo que sale (quedarían igual); % con diferencia por lo que no sale todavía (% solo eso, % mezcladas con lo que sale); % con cosas que no salen pero que se anulan entre sí (quedarían igual)',
      r.empresas, r.cuentas, r.solo_sale, r.con_diferencia, r.solo_no_sale, r.mezcladas, r.no_sale_que_se_anula;
    raise notice 'MEDIDA X06 · tabla entera · de las cuentas con diferencia, llevan asientos %, días del TPV %, emitidas a mano %; suma de las diferencias (en valor absoluto) %',
      r.por_asientos, r.por_tpv, r.por_emitidas_a_mano, r.importe;
  end loop;
  -- Por empresa, las diez con más cuentas con diferencia (sin nombres: solo cifras).
  for r in
    with e as (
      select e.id, e.company_id, e.account_id,
             case when exists (select 1 from public.vat_book_entry v where v.entry_id = e.id and v.account_id = e.account_id and v.voided_at is null and v.book in ('received', 'investment', 'issued')
                                and not (v.book = 'issued' and (v.invoice_type like 'R%' or v.invoice_type = 'F4'))) and e.source_type <> 'sales_day'
                  then 'sale' else 'no' end as clase
        from public.journal_entry e
       where e.status in ('validado', 'anulado') and e.entry_date between '2026-01-01' and '2026-12-31'
         and e.external_program is null and e.import_run_id is null
    ),
    c as (
      select l.company_id, l.company_account_id, sum(l.debit - l.credit) filter (where e.clase = 'no') no_sale, bool_or(e.clase = 'sale') hay_sale
        from public.journal_line l join e on e.id = l.entry_id and e.account_id = l.account_id group by 1, 2
    )
    select row_number() over (order by count(*) filter (where coalesce(no_sale, 0) <> 0) desc) n, count(*) cuentas,
           count(*) filter (where coalesce(no_sale, 0) <> 0) dif, count(*) filter (where coalesce(no_sale, 0) <> 0 and hay_sale) mezcladas
      from c group by company_id order by dif desc limit 10
  loop
    raise notice 'MEDIDA X06 · empresa %: % cuentas con movimiento, % con diferencia por lo que no sale (% mezcladas con lo que sale)', r.n, r.cuentas, r.dif, r.mezcladas;
  end loop;
end $$;
rollback;
