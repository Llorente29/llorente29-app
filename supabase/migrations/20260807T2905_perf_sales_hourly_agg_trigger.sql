-- Aplicada 2026-08-07. Probado: +5 unidades en una línea -> celda del agregado pasa de 122 a 127 sola
-- (con rollback). Sin este trigger el caché va por detrás: el backfill quedó a -1 unidad porque entró
-- una venta durante la verificación (el local estaba vendiendo).
-- Mantenimiento incremental: al entrar/cambiar/borrarse una línea de venta se RECALCULA su celda concreta
-- desde la fuente (no suma incremental: evita derivas). Toca una fila, no reescanea nada.
create or replace function public.tg_sales_hourly_agg_sync()
returns trigger
language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_sale record; v_kind text; v_day date; v_hour smallint;
begin
  select s.account_id, s.location_id, s.sold_at, coalesce(s.is_active,true) as act
    into v_sale from public.sale s
   where s.id = coalesce(new.sale_id, old.sale_id);
  if v_sale is null or v_sale.sold_at is null then return coalesce(new, old); end if;

  select coalesce(mc.demand_kind,'otro') into v_kind
  from public.menu_item mi join public.menu_category mc on mc.id = mi.menu_category_id
  where mi.id = coalesce(new.menu_item_id, old.menu_item_id);
  if v_kind is null then return coalesce(new, old); end if;

  v_day  := (v_sale.sold_at at time zone 'Europe/Madrid')::date;
  v_hour := extract(hour from (v_sale.sold_at at time zone 'Europe/Madrid'))::smallint;

  delete from public.sales_hourly_agg
   where account_id=v_sale.account_id and location_id=v_sale.location_id
     and day=v_day and hour=v_hour and demand_kind=v_kind;

  insert into public.sales_hourly_agg (account_id, location_id, day, hour, demand_kind, units, tickets)
  select s.account_id, s.location_id, v_day, v_hour, v_kind,
         coalesce(sum(sl.quantity),0), count(distinct s.id)
  from public.sale s
  join public.sale_line sl on sl.sale_id = s.id
  join public.menu_item mi on mi.id = sl.menu_item_id
  join public.menu_category mc on mc.id = mi.menu_category_id
  where s.account_id = v_sale.account_id and s.location_id = v_sale.location_id
    and coalesce(s.is_active, true)
    and coalesce(mc.demand_kind,'otro') = v_kind
    and (s.sold_at at time zone 'Europe/Madrid')::date = v_day
    and extract(hour from (s.sold_at at time zone 'Europe/Madrid'))::smallint = v_hour
  group by s.account_id, s.location_id
  having coalesce(sum(sl.quantity),0) > 0;

  return coalesce(new, old);
end $function$;

drop trigger if exists trg_sales_hourly_agg_sync on public.sale_line;
create trigger trg_sales_hourly_agg_sync
  after insert or update or delete on public.sale_line
  for each row execute function public.tg_sales_hourly_agg_sync();
revoke execute on function public.tg_sales_hourly_agg_sync() from public, anon;
