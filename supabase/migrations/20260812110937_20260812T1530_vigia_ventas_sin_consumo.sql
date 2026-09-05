-- 20260812T1530_vigia_ventas_sin_consumo.sql
-- VIGIA: ventas que deberian haber descontado stock y no lo hicieron.
--
-- POR QUE: el 12/08 se descubrieron 224 ventas (5.103 EUR, desde el 12/06) que
-- nunca descontaron, y NADIE se entero en dos meses. El error se escribia en un
-- log de consola y la funcion devolvia 200. Sin vigia, vuelve a pasar.
--
-- Distingue DOS causas, porque tienen duenos distintos:
--   sin_lineas  -> la venta no tiene lineas de producto mapeadas (catalogo sin
--                  casar). No es fallo del motor: es dato que falta.
--   motor_fallo -> tiene lineas y aun asi no escribio consumo. Esto SI es un
--                  fallo del motor y es lo que debe despertar a alguien.

create or replace function public.sales_without_consumption(
  p_account_id uuid,
  p_hours integer default 4
)
returns table(
  causa text,
  ventas integer,
  importe numeric,
  mas_antigua timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with candidatas as (
    select s.id, s.total, s.sold_at,
           exists (
             select 1 from sale_line sl
              where sl.sale_id = s.id
                and coalesce(sl.line_type,'product') = 'product'
                and sl.menu_item_id is not null
                and sl.ignored_at is null
           ) as tiene_lineas
      from sale s
     where s.account_id = p_account_id
       and s.is_active
       and coalesce(s.status,'') <> 'cancelled'
       and coalesce(s.order_status,'') not in ('cancelled','rejected')
       and s.sold_at < now() - make_interval(hours => p_hours)
       and s.sold_at > now() - interval '30 days'
       and not exists (
         select 1 from stock_movement sm
          where sm.source_type = 'sale'
            and sm.source_id = s.id
            and sm.movement_type = 'consumo'
       )
  )
  select case when tiene_lineas then 'motor_fallo' else 'sin_lineas' end,
         count(*)::integer,
         round(coalesce(sum(total),0), 2),
         min(sold_at)
    from candidatas
   group by 1;
$function$;

revoke all on function public.sales_without_consumption(uuid, integer) from public, anon;
grant execute on function public.sales_without_consumption(uuid, integer) to authenticated;

do $$
begin
  if to_regprocedure('public.sales_without_consumption(uuid,integer)') is null then
    raise exception 'sales_without_consumption no quedo creada';
  end if;
end $$;

notify pgrst, 'reload schema';