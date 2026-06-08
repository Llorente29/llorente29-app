-- 20260608T1900_recast_autopropagacion_multimarca.sql
-- Aplicada: 2026-06-08
--
-- Capa 2 del frente "modelo de producto": vinculación automática multi-marca.
-- Un producto (recipe_item) es ÚNICO pero se vende en N marcas, cada una con su
-- catalogProductId y su precio. Hoy el menu_item se crea marca a marca a mano; si
-- falta en una marca, la venta cae en 'no_menu_item' (dinero ciego). Eso es trabajo
-- manual que el sistema puede evitar: si el recipe_item TIENE COSTE conocido y está
-- mapeado a esa marca en el catálogo, no hay nada que decidir → se pone en carta solo.
--
-- Diseño: un PASO NUEVO al inicio del recast (antes de construir las decisiones),
-- que INSERTA los menu_item que faltan para productos con coste. Tras ese paso, esos
-- productos ya tienen menu_item y casan en el flujo normal. Los productos SIN coste
-- (reventa pendiente, platos sin escandallo) NO se tocan: siguen en 'no_menu_item'
-- para que el humano los clasifique en excepciones (anti-invención).
--
-- No inventa: solo actúa cuando (a) hay coste conocido y (b) el mapeo
-- organizationProductId→recipe_item ya existe para esa marca en el catálogo.
-- El resto de la función es IDÉNTICO al original.

BEGIN;

CREATE OR REPLACE FUNCTION public.recast_lastapp_sales(p_account_id uuid)
 RETURNS TABLE(ventas_procesadas integer, lineas_total integer, lineas_casadas integer, lineas_no_brand integer, lineas_no_recipe integer, lineas_no_menu_item integer, lineas_ambiguous integer, lineas_respetadas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ventas   integer := 0;
  v_total    integer := 0;
  v_ok       integer := 0;
  v_nb       integer := 0;
  v_nr       integer := 0;
  v_nm       integer := 0;
  v_amb      integer := 0;
  v_resp     integer := 0;
begin
  -- Guard de tenancy (SECURITY DEFINER salta RLS): admin de plataforma o de la cuenta.
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'recast_lastapp_sales: sin acceso a la cuenta %', p_account_id;
  end if;

  -- 1.5) AUTO-PROPAGACIÓN MULTI-MARCA (capa 2): crear los menu_item que faltan para
  --      productos cuyo recipe_item TIENE COSTE conocido y se venden en esa marca.
  --      Un producto único, presente en todas sus marcas. Solo con coste: los sin
  --      coste siguen en excepciones (decisión humana, anti-invención).
  insert into menu_item (account_id, brand_id, recipe_item_id, name, price, product_type, source, needs_review)
  select distinct
    p_account_id,
    cand.brand_id,
    cand.recipe_item_id,
    coalesce(nullif(btrim(cand.prod_name),''), cand.recipe_name) as name,
    coalesce(cand.price_cents, 0)::numeric / 100.0 as price,
    'item', 'auto', false
  from (
    select
      b.id as brand_id,
      lpm.recipe_item_id,
      max(lcp.product_name)  as prod_name,
      max(lcp.price_cents)   as price_cents,
      max(ri.name)           as recipe_name
    from lastapp_catalog_product lcp
    join lastapp_product_map lpm
      on lpm.account_id = lcp.account_id
     and lpm.organization_product_id = lcp.organization_product_id
    join recipe_item ri
      on ri.id = lpm.recipe_item_id
     and ri.account_id = p_account_id
     -- SOLO con coste conocido (escandallo calculado o coste fijo)
     and (ri.computed_cost is not null or ri.fixed_cost is not null)
    join brand b
      on b.account_id = lcp.account_id
     and b.is_active is not false
     and upper(coalesce(b.name,'')) <> 'FOODINT'
     and lower(public.unaccent(b.name)) = lower(public.unaccent(lcp.lastapp_brand_name))
    where lcp.account_id = p_account_id
    group by b.id, lpm.recipe_item_id
  ) cand
  where not exists (
    select 1 from menu_item mi
    where mi.account_id = p_account_id
      and mi.brand_id = cand.brand_id
      and mi.recipe_item_id = cand.recipe_item_id
      and mi.archived_at is null
  );

  -- 0) Materializar las decisiones en una temp table. Las CTEs no sobreviven entre
  --    sentencias y tanto el UPDATE de sale_line como el de sale las necesitan.
  drop table if exists _recast_decididas;
  create temp table _recast_decididas as
  with elementos as (
    select
      s.id as sale_id,
      regexp_replace(
        regexp_replace(btrim(lower(public.unaccent(coalesce(rp.elem->>'name','')))), '\.$', ''),
        '\s+', ' ', 'g'
      ) as norm_name,
      (rp.elem->>'catalogProductId')::uuid       as cat_prod_id,
      nullif(rp.elem->>'organizationProductId','')::uuid as org_prod_id
    from sale s,
         lateral jsonb_array_elements(s.raw_products::jsonb) as rp(elem)
    where s.account_id = p_account_id
      and s.source = 'lastapp'
      and s.raw_products is not null
  ),
  resueltas as (
    select
      e.sale_id,
      e.norm_name,
      b.id as brand_id,
      lpm.recipe_item_id,
      mi.id as menu_item_id
    from elementos e
    left join lastapp_catalog_product lcp
      on lcp.account_id = p_account_id and lcp.catalog_product_id = e.cat_prod_id
    left join brand b
      on b.account_id = p_account_id
     and b.is_active is not false
     and upper(coalesce(b.name,'')) <> 'FOODINT'
     and lower(public.unaccent(b.name)) = lower(public.unaccent(lcp.lastapp_brand_name))
    left join lastapp_product_map lpm
      on lpm.account_id = p_account_id
     and lpm.organization_product_id = coalesce(e.org_prod_id, lcp.organization_product_id)
    left join menu_item mi
      on mi.account_id = p_account_id
     and mi.brand_id = b.id
     and mi.recipe_item_id = lpm.recipe_item_id
     and mi.archived_at is null
  ),
  por_nombre as (
    select
      sale_id,
      norm_name,
      max(brand_id::text)::uuid     as brand_id,
      max(recipe_item_id::text)::uuid as recipe_item_id,
      count(distinct menu_item_id)  as n_menu_items,
      max(menu_item_id::text)::uuid as menu_item_id
    from resueltas
    group by sale_id, norm_name
  )
  select
    pn.sale_id,
    pn.norm_name,
    pn.brand_id,
    case
      when pn.brand_id is null            then null::uuid
      when pn.n_menu_items = 1            then pn.menu_item_id
      else null::uuid
    end as final_menu_item_id,
    case
      when pn.brand_id is null            then 'no_brand'::text
      when pn.n_menu_items = 1            then null::text
      when pn.n_menu_items > 1            then 'ambiguous'::text
      when pn.recipe_item_id is not null  then 'no_menu_item'::text
      else 'no_recipe'::text
    end as reason
  from por_nombre pn;

  -- 2) Escribir en sale_line por nombre normalizado, respetando lo humano.
  update sale_line sl
  set
    menu_item_id     = d.final_menu_item_id,
    map_source       = case when d.final_menu_item_id is not null then 'pos' else 'unmapped' end,
    map_needs_review = case when d.final_menu_item_id is not null then false else true end,
    unmapped_reason  = case when d.final_menu_item_id is not null then null else d.reason end,
    updated_at       = now()
  from _recast_decididas d
  where sl.account_id = p_account_id
    and sl.sale_id = d.sale_id
    and regexp_replace(
          regexp_replace(btrim(lower(public.unaccent(coalesce(sl.product_name,'')))), '\.$', ''),
          '\s+', ' ', 'g'
        ) = d.norm_name
    and sl.map_source <> 'manual'
    and coalesce(sl.unmapped_reason, '') not in ('ignored','delisted');

  -- 3) Poblar sale.brand_id = marca de la venta (única por ticket de plataforma).
  update sale s
  set brand_id = sub.brand_id,
      updated_at = now()
  from (
    select sale_id, max(brand_id::text)::uuid as brand_id
    from _recast_decididas
    where brand_id is not null
    group by sale_id
    having count(distinct brand_id) = 1
  ) sub
  where s.id = sub.sale_id
    and s.account_id = p_account_id
    and s.brand_id is distinct from sub.brand_id;

  -- 4) Métricas de salida (recuento real tras el update).
  select
    count(distinct sl.sale_id),
    count(*),
    count(*) filter (where sl.menu_item_id is not null),
    count(*) filter (where sl.unmapped_reason = 'no_brand'),
    count(*) filter (where sl.unmapped_reason = 'no_recipe'),
    count(*) filter (where sl.unmapped_reason = 'no_menu_item'),
    count(*) filter (where sl.unmapped_reason = 'ambiguous'),
    count(*) filter (where sl.map_source = 'manual'
                        or coalesce(sl.unmapped_reason,'') in ('ignored','delisted'))
  into v_ventas, v_total, v_ok, v_nb, v_nr, v_nm, v_amb, v_resp
  from sale_line sl
  join sale s on s.id = sl.sale_id
  where sl.account_id = p_account_id and s.source = 'lastapp';

  drop table if exists _recast_decididas;

  return query select v_ventas, v_total, v_ok, v_nb, v_nr, v_nm, v_amb, v_resp;
end;
$function$;

COMMIT;
