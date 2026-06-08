-- ============================================================================
-- Recasado de ventas lastapp existentes (capa 3 del subsistema de fiabilidad).
-- Replica EN SQL la cadena determinista del webhook:
--   catalogProductId -> lastapp_catalog_product.lastapp_brand_name -> brand
--   organizationProductId -> lastapp_product_map.recipe_item_id
--   (brand_id | recipe_item_id) -> menu_item   (único, 0 colisiones verificadas)
-- y escribe el resultado en sale_line emparejando POR NOMBRE NORMALIZADO dentro
-- del ticket (la posición NO es fiable: 37% desordenadas; el nombre repetido
-- apunta siempre al mismo catalogProductId, verificado).
--
-- Normalización: clon EXACTO del normalize() del webhook (NO usar
-- normalize_ingredient_name, que quita paréntesis y rompería el emparejamiento).
--
-- Idempotente: solo UPDATE; re-ejecutable. RESPETA el trabajo humano:
-- no toca líneas con map_source='manual' ni unmapped_reason IN ('ignored','delisted').
--
-- SECURITY DEFINER con guard de tenancy (escribe saltándose RLS). NO PROBAR EN
-- SQL EDITOR EN LA MISMA TRANSACCIÓN QUE LA CREA (auth.uid() null -> excepción).
-- ============================================================================

create or replace function public.recast_lastapp_sales(p_account_id uuid)
returns table (
  ventas_procesadas      integer,
  lineas_total           integer,
  lineas_casadas         integer,
  lineas_no_brand        integer,
  lineas_no_recipe       integer,
  lineas_no_menu_item    integer,
  lineas_ambiguous       integer,
  lineas_respetadas      integer
)
language plpgsql
security definer
set search_path = public
as $$
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

  -- 1) Por cada ELEMENTO de raw_products de cada venta lastapp de la cuenta,
  --    resolver marca/receta/menu_item/razón. Trabajamos a nivel de producto del
  --    JSON (que tiene catalogProductId), luego escribimos por nombre normalizado.
  with elementos as (
    select
      s.id as sale_id,
      -- nombre del producto del ticket, normalizado IGUAL que el webhook
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
      -- MARCA: catalogProductId -> lastapp_brand_name -> brand (normalizado, FOODINT fuera)
      b.id as brand_id,
      -- RECETA: organizationProductId directo, o vía catálogo si no viene
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
  -- Un registro por (venta, nombre normalizado): el match es idéntico para nombres
  -- repetidos (mismo catalogProductId). Tomamos uno representativo y contamos candidatos.
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
  ),
  decididas as (
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
        when pn.brand_id is null            then 'no_brand'
        when pn.n_menu_items = 1            then null            -- casa
        when pn.n_menu_items > 1            then 'ambiguous'
        when pn.recipe_item_id is not null  then 'no_menu_item'  -- hay receta, no hay plato en carta
        else 'no_recipe'                                          -- ni receta
      end as reason
    from por_nombre pn
  )
  -- 2) Escribir en sale_line por nombre normalizado, respetando lo humano.
  update sale_line sl
  set
    menu_item_id     = d.final_menu_item_id,
    map_source       = case when d.final_menu_item_id is not null then 'pos' else 'unmapped' end,
    map_needs_review = case when d.final_menu_item_id is not null then false else true end,
    unmapped_reason  = case when d.final_menu_item_id is not null then null else d.reason end,
    updated_at       = now()
  from decididas d
  where sl.account_id = p_account_id
    and sl.sale_id = d.sale_id
    and regexp_replace(
          regexp_replace(btrim(lower(public.unaccent(coalesce(sl.product_name,'')))), '\.$', ''),
          '\s+', ' ', 'g'
        ) = d.norm_name
    -- RESPETAR trabajo humano: no pisar manual ni estados deliberados
    and sl.map_source <> 'manual'
    and coalesce(sl.unmapped_reason, '') not in ('ignored','delisted');

  -- 3) Poblar sale.brand_id = marca de la venta (única por ticket de plataforma).
  update sale s
  set brand_id = sub.brand_id,
      updated_at = now()
  from (
    select sale_id, max(brand_id::text)::uuid as brand_id
    from decididas
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

  return query select v_ventas, v_total, v_ok, v_nb, v_nr, v_nm, v_amb, v_resp;
end;
$$;
