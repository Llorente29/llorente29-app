-- warehouse_reliability_queue: reestructuración de rendimiento.
--
-- PROBLEMA: la versión anterior construía `lineas` arrancando desde sale_line
-- (recorría las ~14k líneas de TODA la historia de la cuenta) y luego las juntaba
-- una a una con `sale` para filtrar por fecha, descartando el 88%. Tocaba ~255 MB
-- de buffers para devolver ~100 filas. Con caché frío eso supera el statement_timeout
-- de 15s de forma intermitente → "canceling statement due to statement timeout".
--
-- ARREGLO: se filtra `sale` por fecha PRIMERO (CTE `ventas_recientes as materialized`,
-- usa idx_sale_sold_at → ~600 ventas de 7 días) y `lineas` se deriva de ahí. Baja de
-- ~255 MB a ~43 MB de buffers (6x menos I/O). Resultado byte-idéntico verificado por
-- md5 contra la versión anterior (5a5eef2c...). El resto de la función no cambia.
create or replace function public.warehouse_reliability_queue(p_account_id uuid, p_location_id uuid default null::uuid, p_days integer default 7)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '15s'
as $function$
begin
  if not public.belongs_to_account(p_account_id) then
    raise exception 'warehouse_reliability_queue: sin acceso a la cuenta %', p_account_id;
  end if;

  return (
with rango as (
  select now() - make_interval(days => greatest(p_days, 1)) as desde
),
-- Arrancar por las ventas del rango (idx_sale_sold_at) en vez de por todas las
-- líneas históricas. `materialized` fuerza esta barrera: se resuelve primero y
-- deja un set pequeño (~600 filas) al que enganchar sale_line.
ventas_recientes as materialized (
  select s.id, s.sold_at, s.location_id
    from sale s
   cross join rango r
   where s.account_id = p_account_id
     and s.is_active
     and s.sold_at >= r.desde
     and (p_location_id is null or s.location_id = p_location_id)
),
lineas as (
  select sl.id, sl.product_name, sl.menu_item_id, sl.line_total, sl.ignored_at,
         vr.sold_at, vr.location_id, mi.recipe_item_id
    from ventas_recientes vr
    join sale_line sl on sl.sale_id = vr.id
    left join menu_item mi on mi.id = sl.menu_item_id
   where coalesce(sl.line_type,'product') = 'product'
),
carril_a as (
  select public.sales_product_norm(l.product_name) as norm,
         min(l.product_name) as product_name,
         count(*) as ventas,
         round(sum(coalesce(l.line_total,0))::numeric, 2) as eur,
         max(l.sold_at) as ultima_venta
    from lineas l
   where l.menu_item_id is null and l.ignored_at is null
   group by 1
),
carril_b as (
  select public.sales_product_norm(l.product_name) as norm,
         min(l.product_name) as product_name,
         min(l.recipe_item_id::text)::uuid as recipe_item_id,
         count(*) as ventas,
         round(sum(coalesce(l.line_total,0))::numeric, 2) as eur,
         max(l.sold_at) as ultima_venta
    from lineas l
   where l.menu_item_id is not null and l.ignored_at is null
     and (l.recipe_item_id is null
          or not exists (select 1 from recipe_line rl where rl.parent_item_id = l.recipe_item_id))
   group by 1
),
carril_c as (
  select ri.id as recipe_item_id, ri.name as product_name,
         count(*) as ventas,
         0::numeric as eur,
         max(sm.occurred_at) as ultima_venta,
         (select count(*) from recipe_line rl where rl.child_item_id = ri.id) as en_recetas
    from stock_movement sm
    join recipe_item ri on ri.id = sm.recipe_item_id
   cross join rango r
   where sm.account_id = p_account_id
     and sm.movement_type = 'consumo'
     and sm.occurred_at >= r.desde
     and sm.unit_cost is null
     and (p_location_id is null or sm.location_id = p_location_id)
   group by 1, 2
),
fixes as (
  select distinct on (product_norm) product_norm, fixed_at, recipe_item_id, method
    from sales_mapping_fix
   where account_id = p_account_id and reverted_at is null
   order by product_norm, fixed_at desc
),
verificacion as (
  select f.product_norm,
         count(*) filter (where l.sold_at > f.fixed_at) as ventas_desde,
         count(*) filter (where l.sold_at > f.fixed_at and l.menu_item_id is not null) as ok_desde
    from fixes f
    join lineas l on public.sales_product_norm(l.product_name) = f.product_norm
   group by 1
),
unidas as (
  select 'A' as carril, a.norm, a.product_name, null::uuid as recipe_item_id,
         a.ventas, a.eur, a.ultima_venta, null::bigint as en_recetas
    from carril_a a
  union all
  select 'B', b.norm, b.product_name, b.recipe_item_id, b.ventas, b.eur, b.ultima_venta, null
    from carril_b b
  union all
  select 'C', public.sales_product_norm(c.product_name), c.product_name, c.recipe_item_id,
         c.ventas, c.eur, c.ultima_venta, c.en_recetas
    from carril_c c
)
select coalesce(jsonb_agg(x order by x.carril, x.eur desc, x.ventas desc), '[]'::jsonb)
from (
  select u.carril, u.product_name, u.recipe_item_id, u.ventas, u.eur,
         u.ultima_venta, u.en_recetas,
         f.fixed_at, f.method as fix_method,
         coalesce(v.ventas_desde, 0) as ventas_desde_arreglo,
         coalesce(v.ok_desde, 0)     as ventas_ok_desde_arreglo,
         case
           when f.product_norm is null then 'pendiente'
           when coalesce(v.ventas_desde, 0) = 0 then 'esperando_confirmacion'
           else 'recaido'
         end as estado
    from unidas u
    left join fixes f on f.product_norm = u.norm
    left join verificacion v on v.product_norm = u.norm
) x
  );
end;
$function$;