-- supabase/staging/sql/20261119_x08_dias_que_salen_medida.sql
--
-- SOLO STAGING. X08 · Para el parte (respuesta X08 · 3, 5): cuántos días del TPV saldrían con
-- la regla de la X08 · 3 y cuántos se quedan fuera, por cada motivo, y cuántas cuentas quedan en
-- «todavía no salen por aquí» antes y después. Solo lee, y acaba en ROLLBACK.
--
-- La regla (la misma que prepararDiasTpv, src/modules/conta/erp10/ficheros.ts), en este orden,
-- el primer motivo que cumple: el mismo día y local en varios asientos; sin rango de facturas;
-- dos contadores del TPV; sin «Clientes de contado» (una 430 que lo dice en su nombre); más de
-- una. Lo que no cabe en la configuración (más de 4 tipos o cuentas de ventas) se cuenta aparte.
-- Tabla entera, a propósito, y dicho en cada línea (regla 9). Recuentos, ningún dato.
-- sin usuario: solo lee recuentos de la tabla entera, como el postgres de staging.

begin;
do $$
declare r record;
begin
  create temp table x08_d on commit drop as
    with e as (
      select e.id, e.company_id, e.account_id, e.entry_date
        from public.journal_entry e
       where e.status = 'validado' and e.source_type = 'sales_day' and e.entry_date between '2026-01-01' and '2026-12-31'
         and e.external_program is null and e.import_run_id is null
    )
    select e.*,
           case when d.entry_id is not null then 'revo' when s.entry_id is not null then 'folvy' else 'ninguno' end as origen,
           coalesce(d.primer_numero::text, s.first_invoice) as primero,
           (select count(distinct o.contador) from public.conta_tpv_documento o where o.dia_id = d.id) as contadores,
           coalesce(s.location_id::text, d.programa) as donde,
           (select count(*) from public.company_account a where a.company_id = e.company_id and a.account_id = e.account_id and a.code like '430%'
               and (a.name ilike '%contado%' or a.plain_name ilike '%contado%') and a.status is distinct from 'cerrada') as contados,
           (select count(distinct l.tax_rate_id) from public.journal_line l where l.entry_id = e.id and l.account_id = e.account_id and l.vat_book = 'issued') as tipos,
           (select count(distinct a.code) from public.journal_line l join public.company_account a on a.id = l.company_account_id
             where l.entry_id = e.id and l.account_id = e.account_id and a.code like '7%' and l.credit > 0) as ventas
      from e
      left join public.conta_tpv_dia d on d.entry_id = e.id
      left join lateral (select z.* from public.sales_day_summary z where z.entry_id = e.id order by z.id limit 1) s on true;

  for r in
    with m as (
      select x.*, count(*) over (partition by company_id, entry_date, origen, donde) as veces from x08_d x
    )
    select case
             when veces > 1 then '1 · el mismo día y local en varios asientos'
             when primero is null then '2 · falta el rango de facturas del día'
             when contadores > 1 then '3 · dos contadores del TPV'
             when contados = 0 then '4 · falta la cuenta de Clientes de contado'
             when contados > 1 then '5 · más de una cuenta de Clientes de contado'
             when tipos > 4 or ventas > 4 then '6 · no cabe (más de 4 tipos o cuentas de ventas)'
             else '0 · sale' end as motivo,
           origen, count(*) n, count(distinct company_id) empresas
      from m group by 1, 2 order by 1, 2
  loop
    raise notice 'MEDIDA X08c · tabla entera · 2026 · días del TPV validados · % · % = % (en % empresas)', r.motivo, r.origen, r.n, r.empresas;
  end loop;
  select count(*) filter (where contados > 0) con, count(*) sin into r
    from (select distinct company_id, contados from x08_d) z;
  raise notice 'MEDIDA X08c · tabla entera · empresas con días validados que tienen «Clientes de contado» = % de %', r.con, r.sin;
end $$;
rollback;
