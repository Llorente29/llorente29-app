-- supabase/staging/sql/20261118_x08_marcas_locales_medida.sql
--
-- SOLO STAGING. X08 · Respuesta X08 · 1, pregunta 2: cuando un mismo día venden
-- varias marcas o varios locales, ¿cuántas expedidas saldrían con el mismo cliente?
-- ¿El asiento del día las separa por marca o por local? Solo lee, y acaba en ROLLBACK.
--
-- Por empresa (numeradas 1, 2… por su id, sin nombre), de los asientos de día de
-- ventas de Folvy (sales_day_summary) validados de 2026:
--   1. cuántos asientos hay por día (uno por local, o uno por empresa) y cuántos
--      resúmenes (sales_day_summary) cuelgan de cada asiento, con cuántos locales,
--      marcas, canales y «unit_key» distintos;
--   2. cuántos apuntes al debe lleva cada asiento, cuántas cuentas 43 distintas, y si
--      una misma 43 sale en más de un apunte del mismo asiento (separada por marca o
--      por local);
--   3. por empresa y día, cuántas veces sale una misma 43 en asientos distintos (eso
--      serían varias expedidas el mismo día con el mismo cliente).
-- Recuentos, ningún dato. Tabla entera, a propósito, y dicho en cada línea (regla 9).
-- sin usuario: solo lee recuentos de la tabla entera, como el postgres de staging.

begin;
do $$
declare r record;
begin
  create temp table x08_e on commit drop as
    select e.id, e.company_id, e.account_id, e.entry_date,
           dense_rank() over (order by e.company_id) as empresa
      from public.journal_entry e
     where e.status = 'validado' and e.source_type = 'sales_day' and e.entry_date between '2026-01-01' and '2026-12-31'
       and e.external_program is null and e.import_run_id is null
       and exists (select 1 from public.sales_day_summary s where s.entry_id = e.id);

  -- 1 · Asientos por día y resúmenes por asiento.
  for r in
    select empresa, n_asientos, count(*) dias from (
      select empresa, entry_date, count(*) n_asientos from x08_e group by 1, 2) z
     group by 1, 2 order by 1, 2
  loop
    raise notice 'MEDIDA X08b · tabla entera · 2026 · empresa % · % asiento(s) de ventas el mismo día = % días', r.empresa, r.n_asientos, r.dias;
  end loop;
  for r in
    with a as (
      select x.empresa, x.id, count(s.*) resumenes, count(distinct s.location_id) locales, count(distinct s.brand_id) marcas,
             count(distinct s.channel_id) canales, count(distinct s.unit_key) unidades
        from x08_e x join public.sales_day_summary s on s.entry_id = x.id group by 1, 2
    )
    select empresa, resumenes, locales, marcas, canales, unidades, count(*) n from a group by 1, 2, 3, 4, 5, 6 order by 1, 2, 3, 4, 5, 6
  loop
    raise notice 'MEDIDA X08b · tabla entera · 2026 · empresa % · un asiento con % resumen(es) del día, % local(es), % marca(s), % canal(es), % unit_key = % asientos',
      r.empresa, r.resumenes, r.locales, r.marcas, r.canales, r.unidades, r.n;
  end loop;

  -- 2 · Apuntes al debe y cuentas 43 por asiento; una 43 repetida dentro del asiento.
  for r in
    with l as (
      select x.empresa, x.id, a.code, count(*) apuntes
        from x08_e x join public.journal_line l on l.entry_id = x.id and l.account_id = x.account_id and l.debit > 0
        join public.company_account a on a.id = l.company_account_id and left(a.code, 2) = '43'
       group by 1, 2, 3
    ), p as (
      select empresa, id, sum(apuntes) apuntes, count(*) cuentas, max(apuntes) max_por_cuenta from l group by 1, 2
    )
    select empresa, apuntes, cuentas, max_por_cuenta, count(*) n from p group by 1, 2, 3, 4 order by 1, 2, 3, 4
  loop
    raise notice 'MEDIDA X08b · tabla entera · 2026 · empresa % · asiento con % apunte(s) al debe en 43, a % cuenta(s) 43 distintas, una 43 como mucho en % apunte(s) = % asientos',
      r.empresa, r.apuntes, r.cuentas, r.max_por_cuenta, r.n;
  end loop;

  -- 2b · De qué va el concepto de esos apuntes (marca, local o canal), sin el texto: solo si nombra la marca o el local.
  for r in
    select x.empresa,
           count(*) apuntes,
           count(*) filter (where exists (select 1 from public.sales_day_summary s join public.brand b on b.id = s.brand_id
                                           where s.entry_id = x.id and l.concept ilike '%' || b.name || '%')) nombra_marca,
           count(*) filter (where exists (select 1 from public.sales_day_summary s join public.locations o on o.id = s.location_id
                                           where s.entry_id = x.id and l.concept ilike '%' || o.name || '%')) nombra_local
      from x08_e x join public.journal_line l on l.entry_id = x.id and l.account_id = x.account_id and l.debit > 0
      join public.company_account a on a.id = l.company_account_id and left(a.code, 2) = '43'
     group by 1 order by 1
  loop
    raise notice 'MEDIDA X08b · tabla entera · 2026 · empresa % · apuntes al debe en 43 = %; su concepto nombra la marca en %, el local en %', r.empresa, r.apuntes, r.nombra_marca, r.nombra_local;
  end loop;

  -- 3 · Por empresa y día: la misma 43 en asientos distintos (varias expedidas el mismo día, mismo cliente).
  for r in
    with l as (
      select x.empresa, x.entry_date, a.code, count(distinct x.id) asientos
        from x08_e x join public.journal_line l on l.entry_id = x.id and l.account_id = x.account_id and l.debit > 0
        join public.company_account a on a.id = l.company_account_id and left(a.code, 2) = '43'
       group by 1, 2, 3
    )
    select empresa, asientos, count(*) n from l group by 1, 2 order by 1, 2
  loop
    raise notice 'MEDIDA X08b · tabla entera · 2026 · empresa % · un mismo cliente 43 en % asiento(s) del mismo día = % (día, cliente)', r.empresa, r.asientos, r.n;
  end loop;
end $$;
rollback;
