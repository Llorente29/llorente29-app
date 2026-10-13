-- Vuelta atrás de 20261020T0130. DEVUELVE los asientos del día entero desde su
-- copia (_retirado_ventas_por_plataforma), sin esperar al cierre del día
-- (R9, Julio, 13/10: «que no dependa del cierre»):
--   1. Retira los PROPUESTOS por unidad (ni validados ni borradores: si hay
--      alguno, PARA) para que la vuelta atrás de la 0120 y la 0110 puedan
--      seguir.
--   2. Restaura, de cada local×día, la copia MÁS RECIENTE (la de la última
--      retirada): el asiento con su id, sus líneas y su resumen, tal cual
--      eran. Se salta los días que ya tienen un asiento de ventas vivo y los
--      asientos cuyo id ya existe.
--   3. Comprueba: cada local×día restaurado tiene un resumen del día entero
--      con su asiento, y el mismo cobro (las 430) y las mismas líneas que la
--      copia. Si no, RAISE y no se deshace nada.
-- La copia se queda: es el rastro de lo que se retiró.
do $$
declare
  v_n     int;
  v_falta text;
begin
  if exists (select 1 from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id
              where d.unit_key is not null and (e.status <> 'propuesto' or e.number is not null)) then
    raise exception 'Vuelta atrás de la 0130: hay unidades validadas o en borrador; no se retiran solas.';
  end if;
  delete from public.journal_entry e using public.sales_day_summary d where d.entry_id = e.id and d.unit_key is not null;
  delete from public.sales_day_summary where unit_key is not null;

  if to_regclass('public._retirado_ventas_por_plataforma') is null then
    raise notice 'Vuelta atrás de la 0130: no hay copia de retirados; no hay nada que devolver.';
    return;
  end if;

  create temp table _a_devolver on commit drop as
  select distinct on (x.company_id, x.location_id, x.sales_day) x.*
    from public._retirado_ventas_por_plataforma x
   order by x.company_id, x.location_id, x.sales_day, x.retirado_at desc;
  delete from _a_devolver r
   where exists (select 1 from public.journal_entry e where e.id = r.entry_id)
      or exists (select 1 from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id
                  where d.company_id = r.company_id and d.location_id is not distinct from r.location_id and d.sales_day = r.sales_day
                    and e.status in ('propuesto', 'borrador', 'validado'));
  select count(*) into v_n from _a_devolver;

  insert into public.journal_entry select (jsonb_populate_record(null::public.journal_entry, r.asiento)).* from _a_devolver r;
  insert into public.journal_line
  select (jsonb_populate_record(null::public.journal_line, l)).*
    from _a_devolver r cross join lateral jsonb_array_elements(r.lineas) l;
  -- El resumen, sin la unidad (la copia es de antes de la regla: unit_key nulo).
  insert into public.sales_day_summary select (jsonb_populate_record(null::public.sales_day_summary, r.resumen)).* from _a_devolver r;

  select string_agg(format('%s %s', r.sales_day, r.location_id), ', ' order by r.sales_day, r.location_id)
    into v_falta
    from _a_devolver r
   where not exists (select 1 from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id
                      where d.id = (r.resumen->>'id')::uuid and e.id = r.entry_id and e.status = 'propuesto')
      or (select coalesce(sum(l.debit - l.credit) filter (where a.code like '430%'), 0)
            from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = r.entry_id)
         <> (select coalesce(sum((l->>'debit')::numeric - (l->>'credit')::numeric) filter (where a.code like '430%'), 0)
               from jsonb_array_elements(r.lineas) l join public.company_account a on a.id = (l->>'company_account_id')::uuid)
      or (select count(*) from public.journal_line l where l.entry_id = r.entry_id) <> jsonb_array_length(r.lineas);
  if v_falta is not null then
    raise exception 'Vuelta atrás de la 0130: no han vuelto enteros: %', v_falta;
  end if;
  raise notice 'Vuelta atrás de la 0130: % asiento(s) del día entero devueltos desde la copia, con sus líneas, su resumen y el mismo cobro.', v_n;
end $$;
drop function if exists public.conta_propuestos_dia_entero(uuid);
