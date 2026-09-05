create or replace function public.home_vendido_sin_coste(
  p_account  uuid,
  p_from     timestamptz default (now() - interval '30 days'),
  p_to       timestamptz default now(),
  p_location uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v jsonb;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'home_vendido_sin_coste: sin acceso a la cuenta %', p_account;
  end if;

  with l as (
    select sl.quantity * sl.unit_price                        as venta,
           (sl.computed_cost is not null)                     as costeada,
           coalesce(mi.name, sl.product_name, '(sin nombre)')  as nombre,
           b.name                                             as marca,
           (sl.menu_item_id is not null and exists (
              select 1 from public.combo_slot cs
               where cs.combo_item_id = sl.menu_item_id
                 and cs.is_active))                           as es_combo
      from public.sale_line sl
      join public.sale s        on s.id  = sl.sale_id
      left join public.menu_item mi on mi.id = sl.menu_item_id
      left join public.brand b      on b.id  = mi.brand_id
     where sl.account_id = p_account
       and coalesce(s.status,'') <> 'cancelled'
       and s.sold_at >= p_from
       and s.sold_at <  p_to
       and (p_location is null or s.location_id = p_location)
       and coalesce(sl.line_type, 'product') = 'product'
  ),
  sin_coste as (select * from l where not costeada),
  por_producto as (
    select nombre, marca, es_combo,
           count(*)::int             as lineas,
           round(sum(venta))::numeric as venta
      from sin_coste
     group by nombre, marca, es_combo
  )
  select jsonb_build_object(
    'lineas',           (select count(*) from l),
    'lineas_costeadas', (select count(*) filter (where costeada) from l),
    'cobertura_pct',    (select round(100.0 * count(*) filter (where costeada)
                                     / nullif(count(*),0), 1) from l),
    'venta',            (select coalesce(round(sum(venta)), 0) from l),
    'venta_sin_coste',  (select coalesce(round(sum(venta)), 0) from sin_coste),
    'platos', (select jsonb_build_object(
                 'productos', count(*),
                 'lineas',    coalesce(sum(lineas), 0),
                 'venta',     coalesce(sum(venta), 0))
                 from por_producto where not es_combo),
    'combos', (select jsonb_build_object(
                 'productos', count(*),
                 'lineas',    coalesce(sum(lineas), 0),
                 'venta',     coalesce(sum(venta), 0))
                 from por_producto where es_combo),
    'top', (select coalesce(jsonb_agg(x order by x.venta desc, x.nombre), '[]'::jsonb)
              from (select nombre, marca, lineas, venta
                      from por_producto
                     where not es_combo
                     order by venta desc, nombre
                     limit 8) x)
  ) into v;

  return v;
end;
$function$;

comment on function public.home_vendido_sin_coste(uuid, timestamptz, timestamptz, uuid) is
  'Inicio, tarjeta Platos sin escandallo. Lineas de PRODUCTO vendidas sin sale_line.computed_cost, separando los combos declarados (su coste son sus componentes) del resto. Ver 20260902T2100_home_vendido_sin_coste.sql.';

revoke all on function public.home_vendido_sin_coste(uuid, timestamptz, timestamptz, uuid) from public;
revoke all on function public.home_vendido_sin_coste(uuid, timestamptz, timestamptz, uuid) from anon;
grant execute on function public.home_vendido_sin_coste(uuid, timestamptz, timestamptz, uuid) to authenticated;