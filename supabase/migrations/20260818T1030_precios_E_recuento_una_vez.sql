-- ============================================================================
-- ENCARGO CODE "Rejilla: de donde salen los segundos" (18/08/2026)
-- ============================================================================
-- ADITIVO en efecto: no cambia ningun numero de la rejilla.
--
-- menu_item_channel_economics NO SE TOCA. Su md5 sigue siendo
-- a3600331debb4402709f2f05e43ac173. Es la funcion certificada: la usan el modal
-- y el agente de ofertas, y ese md5 lleva todo el dia siendo la prueba de que no
-- hemos roto nada.
--
-- DOS COSAS, Y CONVIENE NO CONFUNDIRLAS:
--
-- 1. CORRECCION (esta migracion la arregla de verdad).
--    Dentro de menu_item_channel_economics, el CTE usage_30d cuenta ventas
--    filtrando SOLO por cuenta y fecha: no menciona p_menu_item_id. El numero
--    que sale es el trafico del CANAL, identico para los 27 productos de la
--    marca. Se devolvia en una columna llamada `orders_30d`, colocada junto a
--    los datos del producto, donde cualquiera la lee como "pedidos de este
--    producto". Medido en Scandal Burgers / Alcala: 297 filas y solo 10 valores
--    distintos. Aqui se calcula UNA vez para la cuenta y se devuelve con el
--    nombre que le corresponde: channel_orders_30d.
--
--    Lo que NO se hace: cambiarlo para que cuente ESE producto. Seria mas util
--    para decidir precios, pero es un cambio de significado y se decide antes
--    de tocarlo, no sobre la marcha. Queda pendiente.
--
-- 2. VELOCIDAD (esta migracion NO la arregla, y hay que decirlo).
--    Sacar el recuento del bucle en brand_price_grid NO evita que
--    menu_item_channel_economics lo rehaga 27 veces: es LANGUAGE plpgsql, asi
--    que no se puede inlinear y su cuerpo se ejecuta ENTERO en cada llamada,
--    lea el llamador la columna o no. Ignorar la salida no ahorra el trabajo.
--    Medido como `authenticated` con un uid real, no como superusuario:
--
--      usage_30d suelto, 2.632 filas    sin RLS   4,05 ms
--      usage_30d suelto, 2.632 filas    con RLS  46,20 ms   <- x11
--      brand_price_grid entera          con RLS   3.530 ms
--
--    27 x 46,2 ms ~ 1.247 ms, un tercio del total, y el 91 % de ese nodo es la
--    RLS, no el recuento. Quitarlo de verdad exige una de dos: tocar la funcion
--    certificada (prohibido hoy) o separar las politicas FOR ALL de sale para
--    que current_user_is_admin_of(account_id) salga del camino de lectura
--    (Fase 0, su propio encargo). Esta migracion deja la correccion hecha y el
--    diagnostico medido; la velocidad se ataca donde esta, no donde parecia.
--
-- EL INDICE: sale no tenia indice por (account_id, created_at), asi que el
-- recuento recorria 6.727 filas para quedarse con 2.632. Con el indice la fecha
-- pasa a Index Cond y desaparecen las 4.095 descartadas. Gana poco en tiempo
-- (49,3 -> 46,2 ms) porque el filtro de fecha ya era barato y se evaluaba antes
-- que la RLS, pero es correcto, es aditivo y beneficia a cualquier lectura de
-- ventas por cuenta y ventana. Se crea CONCURRENTLY para no bloquear escrituras.
--
-- CERO tráfico saliente. Ninguna comision dividida entre 1,21.

-- ── E.1 indice ───
-- CONCURRENTLY no puede ir dentro de un bloque de transaccion: va suelto y
-- antes del resto. IF NOT EXISTS lo hace reejecutable.
create index concurrently if not exists idx_sale_account_created_at
  on public.sale using btree (account_id, created_at);

comment on index public.idx_sale_account_created_at is
  'Recuentos de ventas por cuenta y ventana temporal (usage_30d de menu_item_channel_economics). Antes se recorrian 6.727 filas para quedarse con 2.632.';

-- ── E.2 brand_price_grid: el recuento, UNA vez ───
-- DROP + CREATE y no CREATE OR REPLACE: cambia el NOMBRE de una columna de
-- salida (orders_30d -> channel_orders_30d) y eso Postgres no lo permite
-- reemplazando. Va en transaccion para que no exista un instante sin funcion.
begin;

drop function if exists public.brand_price_grid(uuid, uuid, jsonb);

create function public.brand_price_grid(
  p_brand_id    uuid,
  p_location_id uuid  default null,
  p_overrides   jsonb default null   -- { "<menu_item_id>": { "<channel_id>": precio } }
)
returns table (
  menu_item_id     uuid,
  menu_item_name   text,
  category_id      uuid,
  category_name    text,
  product_type     text,
  base_price       numeric,
  channel_id       uuid,
  channel_name     text,
  channel_type     text,
  service_type     text,
  price            numeric,
  price_source     text,
  is_location_override boolean,
  is_available     boolean,
  vat_rate         numeric,
  cost_available   boolean,
  net_margin       numeric,
  net_margin_pct   numeric,
  contribution_margin_pct numeric,
  -- Antes `orders_30d`. Mismo numero, nombre honesto: son los pedidos del
  -- CANAL en 30 dias, no los de este producto.
  channel_orders_30d integer,
  policy_allowed   boolean,
  policy_reason    text
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with marca as (
    select b.id, b.account_id, coalesce(b.ownership_type, 'own') as ownership_type
    from brand b where b.id = p_brand_id
  ),
  productos as (
    select mi.id, mi.name, mi.menu_category_id, mi.product_type, mi.price
    from menu_item mi, marca m
    where mi.brand_id = m.id
      and mi.account_id = m.account_id
      and mi.is_active is not false
  ),
  -- UNA vez por llamada, no una por producto. Mismo filtro exacto que el CTE
  -- usage_30d de menu_item_channel_economics (cuenta y ventana de 30 dias), asi
  -- que da exactamente los mismos numeros.
  uso_30d as (
    select s.channel_id, s.service_type, count(*)::integer as n
    from sale s, marca m
    where s.account_id = m.account_id
      and s.created_at >= now() - interval '30 days'
    group by s.channel_id, s.service_type
  )
  select
    p.id, p.name, p.menu_category_id, mc.name, p.product_type, p.price,
    e.channel_id, e.channel_name, e.channel_type, e.service_type,
    e.price, e.price_source, e.is_location_override, e.is_available, e.vat_rate,
    e.cost_available, e.net_margin, e.net_margin_pct, e.contribution_margin_pct,
    -- El de AQUI, calculado una vez. e.orders_30d ya no se lee.
    -- `is not distinct from` y no `=`: service_type es nulo en mostrador y con
    -- `=` esas filas se quedarian sin recuento. Es el mismo join que hace la
    -- funcion de economia por dentro.
    coalesce(u.n, 0),
    -- ── policy_allowed ───
    case
      when e.channel_type <> 'delivery' then true
      when e.service_type is null or e.service_type = 'pickup' then true
      else exists (
        select 1
        from channel_delivery_policy pol
        join sales_channel sc
          on sc.slug = pol.channel_slug and sc.account_id = pol.account_id
        where pol.account_id = m.account_id
          and sc.id = e.channel_id
          and pol.ownership_type = m.ownership_type
          and pol.service_type = e.service_type)
    end,
    case
      when e.channel_type <> 'delivery' then null
      when e.service_type is null or e.service_type = 'pickup' then null
      when exists (
        select 1 from channel_delivery_policy pol
        join sales_channel sc on sc.slug = pol.channel_slug and sc.account_id = pol.account_id
        where pol.account_id = m.account_id and sc.id = e.channel_id
          and pol.ownership_type = m.ownership_type and pol.service_type = e.service_type)
        then null
      when exists (
        select 1 from channel_delivery_policy pol
        join sales_channel sc on sc.slug = pol.channel_slug and sc.account_id = pol.account_id
        where pol.account_id = m.account_id and sc.id = e.channel_id
          and pol.ownership_type = m.ownership_type)
        then 'La politica de reparto de este canal dice otra modalidad para marcas '
             || m.ownership_type || '.'
      else 'Sin politica de reparto declarada para este canal y tipo de marca. No se adivina.'
    end
  from productos p
  cross join marca m
  left join menu_category mc on mc.id = p.menu_category_id
  cross join lateral menu_item_channel_economics(
    p.id,
    case when p_overrides is null then null else p_overrides -> (p.id::text) end,
    p_location_id) e
  left join uso_30d u
    on u.channel_id = e.channel_id
   and u.service_type is not distinct from e.service_type;
$$;

comment on function public.brand_price_grid(uuid, uuid, jsonb) is
  'Rejilla de precios de una marca en UNA llamada. Envuelve menu_item_channel_economics (no la modifica) y marca con policy_allowed las combinaciones canal x modalidad que channel_delivery_policy no permite -- p.ej. uber/own_delivery, que da el mejor margen de la pantalla y es imposible. channel_orders_30d son los pedidos del CANAL en 30 dias, calculados una vez por llamada; NO son los pedidos de ese producto.';

revoke all on function public.brand_price_grid(uuid, uuid, jsonb) from anon;
grant execute on function public.brand_price_grid(uuid, uuid, jsonb) to authenticated;

commit;
