-- ============================================================================
-- Vuelta atrás de C05 · 3 · lo que cambia: quita el disparador del libro
-- registro y devuelve conta_resultado_por_local a la versión del C04 (que
-- contaba la regularización como resultado del periodo). Las filas de
-- vat_book_entry se quedan: las quita la vuelta atrás de la 0100.
-- ============================================================================
drop trigger if exists trg_journal_entry_libro_registro on public.journal_entry;
drop function if exists public.journal_entry_libro_registro();

create or replace function public.conta_resultado_por_local(p_company uuid, p_desde date, p_hasta date, p_repartir boolean default false)
returns table (location_id uuid, brand_id uuid, ingresos numeric, gastos numeric, resultado numeric, nota text)
language plpgsql security invoker set search_path = public as $$
-- Las columnas de salida (location_id, ingresos, gastos…) se llaman igual que
-- las de _c04_res: dentro de las consultas manda la columna. Sin esto, la rama
-- del reparto fallaba con 42702 «ingresos is ambiguous» (e2e 123, 07/10).
#variable_conflict use_column
declare v_suma numeric;
begin
  create temp table if not exists _c04_res (location_id uuid, brand_id uuid, ingresos numeric, gastos numeric) on commit drop;
  truncate _c04_res;
  insert into _c04_res
  select l.location_id, l.brand_id,
         sum(case when l.template_code like '7%' then l.credit - l.debit else 0 end),
         sum(case when l.template_code like '6%' then l.debit - l.credit else 0 end)
    from public.journal_ledger l
   where l.company_id = p_company and l.entry_date between p_desde and p_hasta
     and (l.template_code like '6%' or l.template_code like '7%')
   group by l.location_id, l.brand_id;

  if p_repartir then
    select sum(r.pct) into v_suma from public.allocation_rule r
     where r.company_id = p_company and p_hasta between r.valid_from and coalesce(r.valid_to, p_hasta);
    if v_suma = 100 then
      -- Lo común (sin local) se reparte por la regla; el último local se lleva el
      -- redondeo para que la suma sea exacta.
      insert into _c04_res
      select x.location_id, null, x.ing, x.gas from (
        select r.location_id,
               case when row_number() over (order by r.pct, r.location_id desc) = count(*) over ()
                    then c.ingresos - coalesce(sum(round(c.ingresos * r.pct / 100, 2)) over (order by r.pct, r.location_id desc rows between unbounded preceding and 1 preceding), 0)
                    else round(c.ingresos * r.pct / 100, 2) end as ing,
               case when row_number() over (order by r.pct, r.location_id desc) = count(*) over ()
                    then c.gastos - coalesce(sum(round(c.gastos * r.pct / 100, 2)) over (order by r.pct, r.location_id desc rows between unbounded preceding and 1 preceding), 0)
                    else round(c.gastos * r.pct / 100, 2) end as gas
          from public.allocation_rule r
          cross join (select coalesce(sum(ingresos), 0) ingresos, coalesce(sum(gastos), 0) gastos from _c04_res where location_id is null) c
         where r.company_id = p_company and p_hasta between r.valid_from and coalesce(r.valid_to, p_hasta)) x;
      delete from _c04_res where location_id is null;
    end if;
  end if;

  return query
  select r.location_id, r.brand_id, sum(r.ingresos), sum(r.gastos), sum(r.ingresos) - sum(r.gastos),
         case when r.location_id is null and p_repartir then 'Común sin repartir: la regla de reparto no suma 100 % en esas fechas.'
              when r.location_id is null then 'Común: el informe puede repartirlo con tu regla de reparto.' end
    from _c04_res r
   group by r.location_id, r.brand_id
   order by r.location_id nulls last, r.brand_id nulls last;
end $$;
