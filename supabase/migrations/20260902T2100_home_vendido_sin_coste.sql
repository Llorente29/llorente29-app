-- 20260902T2100_home_vendido_sin_coste.sql
--
-- LA FUENTE DE LA TARJETA «Platos sin escandallo» DEL INICIO.
--
-- ── POR QUÉ HACE FALTA UNA RPC NUEVA Y NO VALÍA NINGUNA DE LAS DOS QUE HAY ──
--
-- 1. `list_costless_sold_products` parecía la buena. Se midió antes de
--    cablearla y DEVUELVE CERO FILAS para Foodint: exige
--    `recipe_item.computed_cost IS NULL AND fixed_cost IS NULL`, y hoy todo
--    recipe_item enlazado que se vende tiene coste. El agujero real está un
--    paso antes — en productos de carta SIN recipe_item enlazado— y esa RPC
--    los excluye por construcción (hace `JOIN recipe_item ON ri.id =
--    mi.recipe_item_id`). Una tarjeta anclada ahí habría dicho «0 platos sin
--    escandallo» teniendo 118 y 11.522 € vendidos sin poder costearlos. Es
--    exactamente el cero de la regla 7, servido por una fuente que parecía
--    correcta.
--
-- 2. `food_cost_dashboard` sí ve el agujero, pero cuenta como «línea sin
--    coste» las líneas de MODIFICADOR y de COMBO_ITEM, que no son productos y
--    llevan 1.149 € de 76.094 € (1,5 %). Por eso su cobertura sale 71,4 %
--    cuando la cobertura sobre líneas de producto es 87,9 %. Anotado como
--    frente aparte: el número de la pantalla de Margen por plato está
--    infravalorado, y se arregla ahí, no aquí.
--
-- ── DE DÓNDE SALE EL COSTE ──────────────────────────────────────────────────
-- De `sale_line.computed_cost`, que es lo que el motor dejó escrito EN LA
-- LÍNEA. No se re-deriva desde `recipe_item.computed_cost` (que es lo que hace
-- `food_cost_dashboard`) porque re-derivar es tener dos motores: el de la línea
-- ya resolvió modificadores y combos, y si mañana cambia, esta función lo sigue
-- sin enterarse de nada.
--
-- ── LOS DOS CUBOS, Y POR QUÉ SE SEPARAN ─────────────────────────────────────
-- Un COMBO declarado (tiene filas activas en `combo_slot`) no lleva escandallo
-- propio: su coste es la suma de sus componentes. Decirle a alguien «hazle el
-- escandallo al Korean Crispy Menu» sería mandarle a hacer un trabajo
-- equivocado. Así que van aparte y con su dinero: la tarjeta los cuenta, no los
-- esconde, y no los mete en la lista de lo que hay que costear a mano.
--
-- Los que NO tienen combo declarado van a `top`, ordenados por dinero. Ahí
-- salen packs y menús cuyo combo nadie declaró — y eso también es el hallazgo,
-- porque el nombre lo dice solo.
--
-- ── VENTA: `quantity * unit_price`, NO `line_total` ──────────────────────────
-- `sale_line.line_total` existe y sería más fino (recoge descuentos de línea).
-- Se usa el producto a propósito: es la misma fórmula que `food_cost_dashboard`
-- y por tanto la misma que la pantalla a la que lleva la tarjeta. Dos cifras
-- que se miran juntas y no cuadran cuestan más que un euro de descuento.
--
-- ── GUARDA ──────────────────────────────────────────────────────────────────
-- Admin de sistema o admin/manager de la cuenta, la misma que
-- `list_costless_sold_products`. La tarjeta es `requiredRole: 'manager'`, así
-- que el mosaico no se la ofrece a nadie que la RPC fuera a rechazar.

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
       -- SOLO producto. Modificadores y combo_item no son platos: meterlos
       -- hunde la cobertura sin que falte ningún escandallo.
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
    -- Solo los que NO son combo declarado: son los que alguien puede arreglar
    -- haciendo un escandallo. Los combos van contados arriba, con su dinero.
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
  'Inicio · tarjeta «Platos sin escandallo». Líneas de PRODUCTO vendidas sin '
  'sale_line.computed_cost, separando los combos declarados (su coste son sus '
  'componentes) del resto. Ver 20260902T2100_home_vendido_sin_coste.sql.';

revoke all on function public.home_vendido_sin_coste(uuid, timestamptz, timestamptz, uuid) from public;
revoke all on function public.home_vendido_sin_coste(uuid, timestamptz, timestamptz, uuid) from anon;
grant execute on function public.home_vendido_sin_coste(uuid, timestamptz, timestamptz, uuid) to authenticated;
