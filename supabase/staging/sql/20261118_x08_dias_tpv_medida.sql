-- supabase/staging/sql/20261118_x08_dias_tpv_medida.sql
--
-- SOLO STAGING. X08 · Cómo son hoy los días del TPV que no salen a ERP10, antes de
-- escribir (encargo X08, 2.3: «antes de escribir, contesta en el PR, con los días de
-- staging delante»). Solo lee, y acaba en ROLLBACK.
--
-- Mide, de los asientos de día de ventas (source_type = 'sales_day') validados de 2026:
--   1. de dónde vienen: un día de un TPV de fuera (conta_tpv_dia, Revo) o un día de
--      Folvy (sales_day_summary), y si guardan un número de cierre (no: guardan el
--      rango de facturas) y cuántos contadores (series del TPV) lleva un día;
--   2. a qué cobran: cuántas cuentas de cliente (430) por día, si cobran algo en caja
--      o banco (57) y cuántos tipos de I.V.A. y cuentas de ventas (7) lleva cada uno;
--   3. si el plan de la empresa tiene una cuenta de clientes de contado;
--   4. en Revo, las órdenes pagadas a más de una cuenta (su I.V.A. no es de un solo
--      cliente);
--   5. las cuentas que hoy quedan en «todavía no salen por aquí» y de qué hoja son.
-- Tabla entera, a propósito, y dicho en cada línea (regla 9). Ningún dato: recuentos.
-- sin usuario: solo lee recuentos de la tabla entera, como el postgres de staging.

begin;
do $$
declare r record;
begin
  -- 1 · De dónde vienen y qué número guardan.
  for r in
    with e as (
      select e.id, e.company_id,
             exists (select 1 from public.conta_tpv_dia d where d.entry_id = e.id) as revo,
             exists (select 1 from public.sales_day_summary s where s.entry_id = e.id) as folvy
        from public.journal_entry e
       where e.status = 'validado' and e.source_type = 'sales_day' and e.entry_date between '2026-01-01' and '2026-12-31'
         and e.external_program is null and e.import_run_id is null
    )
    select case when revo then 'revo (conta_tpv_dia)' when folvy then 'folvy (sales_day_summary)' else 'ninguno de los dos' end as origen,
           count(*) n, count(distinct company_id) empresas
      from e group by 1 order by 1
  loop
    raise notice 'MEDIDA X08 · tabla entera · 2026 · días validados de % = % (en % empresas)', r.origen, r.n, r.empresas;
  end loop;

  select count(*) n,
         count(*) filter (where (select count(distinct o.contador) from public.conta_tpv_documento o where o.dia_id = d.id) > 1) varios,
         count(*) filter (where d.primer_numero = d.ultimo_numero) una
    into r from public.conta_tpv_dia d where d.entry_id is not null;
  raise notice 'MEDIDA X08 · tabla entera · Revo · días con asiento = %; con más de un contador (serie del TPV) = %; de una sola factura = %; número de cierre guardado: ninguna columna (conta_tpv_dia guarda primer_numero, ultimo_numero y documentos)', r.n, r.varios, r.una;
  select count(*) n, count(*) filter (where s.first_invoice is not null) con_rango into r from public.sales_day_summary s where s.entry_id is not null;
  raise notice 'MEDIDA X08 · tabla entera · Folvy · días con asiento = %; con rango de facturas (first_invoice/last_invoice) = %; número de cierre guardado: ninguna columna', r.n, r.con_rango;

  -- 2 · A qué cobran, cuántos tipos de I.V.A. y cuántas cuentas de ventas.
  for r in
    with e as (
      select e.id, e.account_id,
             case when exists (select 1 from public.conta_tpv_dia d where d.entry_id = e.id) then 'revo' else 'folvy' end as origen
        from public.journal_entry e
       where e.status = 'validado' and e.source_type = 'sales_day' and e.entry_date between '2026-01-01' and '2026-12-31'
         and e.external_program is null and e.import_run_id is null
    ), l as (
      select e.id, e.origen,
             count(distinct a.code) filter (where l.debit > 0 and left(a.code, 2) = '43') as clientes,
             count(distinct a.code) filter (where l.debit > 0 and left(a.code, 2) = '57') as caja,
             count(distinct a.code) filter (where l.debit > 0 and left(a.code, 2) not in ('43', '57')) as otro_debe,
             count(distinct l.tax_rate_id) filter (where l.vat_book = 'issued') as tipos,
             count(distinct a.code) filter (where l.credit > 0 and left(a.code, 1) = '7') as ventas
        from e join public.journal_line l on l.entry_id = e.id and l.account_id = e.account_id
        join public.company_account a on a.id = l.company_account_id
       group by e.id, e.origen
    )
    select origen, clientes, caja > 0 as con_caja, otro_debe > 0 as con_otro, tipos, ventas, count(*) n
      from l group by 1, 2, 3, 4, 5, 6 order by 1, 2, 3, 4, 5, 6
  loop
    raise notice 'MEDIDA X08 · tabla entera · 2026 · % · % cuenta(s) de cliente 43, cobra en caja o banco 57: %, otro debe: %, % tipo(s) de I.V.A., % cuenta(s) de ventas 7 = % días',
      r.origen, r.clientes, r.con_caja, r.con_otro, r.tipos, r.ventas, r.n;
  end loop;

  -- 3 · La cuenta de clientes de contado, en el plan de cada empresa con días.
  for r in
    with emp as (
      select distinct e.company_id from public.journal_entry e
       where e.status = 'validado' and e.source_type = 'sales_day' and e.entry_date between '2026-01-01' and '2026-12-31'
    )
    select count(*) empresas,
           count(*) filter (where exists (select 1 from public.company_account a where a.company_id = emp.company_id and left(a.code, 2) = '43'
                                            and (a.name ilike '%contado%' or a.plain_name ilike '%contado%'))) con_contado,
           count(*) filter (where exists (select 1 from public.company_account a where a.company_id = emp.company_id and a.kind = 'template' and a.template_code like '43%'
                                            and (a.name ilike '%contado%'))) plantilla_contado
      from emp
  loop
    raise notice 'MEDIDA X08 · tabla entera · empresas con días validados = %; con una 43 que dice «contado» en su nombre = %; con la hoja de plantilla de contado = %', r.empresas, r.con_contado, r.plantilla_contado;
  end loop;
  for r in
    select a.template_code, a.kind, count(*) n from public.company_account a
     where left(a.code, 2) = '43' and (a.name ilike '%contado%' or a.plain_name ilike '%contado%') group by 1, 2 order by 1, 2
  loop
    raise notice 'MEDIDA X08 · tabla entera · cuentas 43 «de contado»: plantilla %, clase % = %', r.template_code, r.kind, r.n;
  end loop;

  -- 4 · Revo: órdenes pagadas a más de una cuenta.
  select count(*) ordenes, count(distinct dia_id) dias into r from (
    select c.dia_id, c.orden
      from public.conta_tpv_cobro c join public.conta_tpv_dia d on d.id = c.dia_id and d.entry_id is not null
      left join lateral (select coalesce((select o.canal from public.conta_tpv_documento o where o.dia_id = c.dia_id and o.orden = c.orden order by o.numero limit 1), 'local') as canal) k on true
      left join public.conta_tpv_forma_cuenta f on f.company_id = d.company_id and lower(f.forma) = lower(c.forma) and (f.canal = k.canal or f.canal is null)
     group by c.dia_id, c.orden having count(distinct f.company_account_id) > 1) z;
  raise notice 'MEDIDA X08 · tabla entera · Revo · órdenes cobradas a más de una cuenta = % (en % días)', r.ordenes, r.dias;

  -- 5 · Las cuentas en «todavía no salen por aquí» hoy (solo días del TPV) y de qué hoja.
  for r in
    with e as (
      select e.id, e.account_id from public.journal_entry e
       where e.status in ('validado', 'anulado') and e.source_type = 'sales_day' and e.entry_date between '2026-01-01' and '2026-12-31'
         and e.external_program is null and e.import_run_id is null
    ), c as (
      select l.company_id, l.company_account_id, sum(l.debit - l.credit) s
        from e join public.journal_line l on l.entry_id = e.id and l.account_id = e.account_id group by 1, 2 having sum(l.debit - l.credit) <> 0
    )
    select left(a.code, 2) hoja, count(*) n from c join public.company_account a on a.id = c.company_account_id group by 1 order by 1
  loop
    raise notice 'MEDIDA X08 · tabla entera · cuentas con saldo de días del TPV, hoja % = %', r.hoja, r.n;
  end loop;
end $$;
rollback;
