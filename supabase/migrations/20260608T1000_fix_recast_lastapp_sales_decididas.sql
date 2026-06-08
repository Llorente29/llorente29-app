-- 20260608T1000_fix_recast_lastapp_sales_decididas.sql
-- Aplicada: 2026-06-08
--
-- Arregla recast_lastapp_sales: el error en ejecución
--   ERROR: relation "decididas" does not exist
-- venía de que el bloque CTE (elementos…decididas) estaba ligado SOLO al primer
-- UPDATE (sale_line). Las CTEs no sobreviven entre sentencias, así que el segundo
-- UPDATE (sale.brand_id) referenciaba una relación inexistente. CREATE FUNCTION no
-- lo detecta porque plpgsql parsea el cuerpo al ejecutar, no al crear.
--
-- Fix: materializar las decisiones por (sale_id, norm_name) en una temp table
-- (_recast_decididas) una sola vez; ambos UPDATE leen de ella. Lógica de casado
-- IDÉNTICA a la versión previa (normalización exacta del webhook, exclusión FOODINT,
-- respeto a 'manual'/'ignored'/'delisted', métricas de salida). Sin duplicar lógica.
--
-- SECURITY DEFINER: no probar dentro de esta transacción (auth.uid() null en SQL
-- Editor revienta el guard). Aplicar (BEGIN/CREATE/COMMIT, sin test dentro) y
-- verificar aparte desde la app (con sesión) vía scripts/recast-sales.mjs.

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

  -- 0) Materializar las decisiones en una temp table. Las CTEs no sobreviven entre
  --    sentencias y tanto el UPDATE de sale_line como el de sale las necesitan.
  drop table if exists _recast_decididas;
  create temp table _recast_decididas as
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
      when pn.n_menu_items = 1            then null::text       -- casa
      when pn.n_menu_items > 1            then 'ambiguous'::text
      when pn.recipe_item_id is not null  then 'no_menu_item'::text -- hay receta, no hay plato en carta
      else 'no_recipe'::text                                    -- ni receta
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
    -- RESPETAR trabajo humano: no pisar manual ni estados deliberados
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
