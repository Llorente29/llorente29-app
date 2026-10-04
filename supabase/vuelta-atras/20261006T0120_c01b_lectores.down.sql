-- ============================================================================
-- VUELTA ATRÁS de 20261006T0120_c01b_lectores.sql
-- Devuelve compliance_docs_due y migrate_kitchen_core a como estaban en
-- PRODUCCIÓN el 04/10/2026 (pg_get_functiondef, solo lectura):
--   compliance_docs_due   md5 64fec3b5acecb3948e7fbf334a66a7e0
--   migrate_kitchen_core  md5 5dca6db9b000003a8d5ce97f16d42fda
-- Mientras no se aplique la eliminación de columnas (C01b · 0200), las
-- columnas viejas existen y estas definiciones funcionan.
-- ============================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'supplier' and column_name = 'email') then
    raise exception 'C01b 0120 vuelta atrás: supplier.email ya no existe (se aplicó la eliminación). Primero la vuelta atrás de la eliminación.';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.compliance_docs_due(p_days integer DEFAULT 30)
 RETURNS TABLE(id uuid, account_id uuid, title text, reference text, expires_at date, review_due_at date, last_reminder_at timestamp with time zone, supplier_id uuid, supplier_name text, supplier_email text, account_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select cd.id, cd.account_id, cd.title, cd.reference,
         cd.expires_at, cd.review_due_at, cd.last_reminder_at,
         cd.supplier_id, s.name, s.email, a.name
  from compliance_document cd
  left join supplier s on s.id = cd.supplier_id
  left join accounts a on a.id = cd.account_id
  where cd.status <> 'superseded'
    and (
      (cd.expires_at    is not null and cd.expires_at    <= current_date + p_days) or
      (cd.review_due_at is not null and cd.review_due_at <= current_date + p_days)
    )
    and (cd.last_reminder_at is null or cd.last_reminder_at < now() - interval '25 days');
$function$
;

CREATE OR REPLACE FUNCTION public.migrate_kitchen_core(p_source uuid, p_dest uuid, p_run boolean DEFAULT false)
 RETURNS TABLE(paso text, n bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing int;
begin
  select count(*) into v_existing from recipe_item where account_id = p_dest;
  if v_existing > 0 and p_run then
    raise exception 'DESTINO NO VACÍO: % ya tiene % recipe_item. Aborto.', p_dest, v_existing;
  end if;

  -- NÚCLEO: platos con escandallo + ingredientes/subrecetas usados
  create temp table _nucleo on commit drop as
  select distinct id from (
    select ri.id from recipe_item ri
      join recipe_line rl on rl.parent_item_id = ri.id
     where ri.account_id = p_source and ri.type = 'dish'
    union
    select rl.child_item_id from recipe_line rl where rl.account_id = p_source
  ) x;

  create temp table _map_family   (old_id uuid primary key, new_id uuid default gen_random_uuid()) on commit drop;
  create temp table _map_supplier (old_id uuid primary key, new_id uuid default gen_random_uuid()) on commit drop;
  create temp table _map_item     (old_id uuid primary key, new_id uuid default gen_random_uuid()) on commit drop;

  insert into _map_family(old_id)
    select distinct family_id from recipe_item
     where id in (select id from _nucleo) and family_id is not null;
  insert into _map_supplier(old_id)
    select distinct supplier_id from article_supplier
     where recipe_item_id in (select id from _nucleo);
  insert into _map_item(old_id) select id from _nucleo;

  if not p_run then
    return query
      select 'familias',     count(*)::bigint from _map_family   union all
      select 'proveedores',  count(*)::bigint from _map_supplier union all
      select 'items',        count(*)::bigint from _map_item     union all
      select 'lineas',       count(*)::bigint from recipe_line where parent_item_id in (select old_id from _map_item) union all
      select 'article_supp', count(*)::bigint from article_supplier where recipe_item_id in (select old_id from _map_item) union all
      select 'conversiones', count(*)::bigint from recipe_item_unit_conversion where item_id in (select old_id from _map_item);
    return;
  end if;

  -- ════════ EJECUCIÓN: triggers OFF durante toda la copia ════════
  set local session_replication_role = replica;

  -- 1) FAMILIAS
  insert into recipe_family (id, account_id, template_id, name, color, icon, position,
                             is_active, created_at, scope, parent_family_id, accounting_category, code)
  select m.new_id, p_dest, f.template_id, f.name, f.color, f.icon, f.position,
         f.is_active, now(), f.scope,
         (select mp.new_id from _map_family mp where mp.old_id = f.parent_family_id),
         f.accounting_category, f.code
    from recipe_family f join _map_family m on m.old_id = f.id;

  -- 2) PROVEEDORES
  insert into supplier (id, account_id, name, tax_id, email, phone, address, notes,
                        is_active, created_at, health_registry_no)
  select m.new_id, p_dest, s.name, s.tax_id, s.email, s.phone, s.address, s.notes,
         s.is_active, now(), s.health_registry_no
    from supplier s join _map_supplier m on m.old_id = s.id;

  -- 3) RECIPE_ITEM — computed_cost/cost_updated_at SÍ se copian (nace con coste correcto)
  insert into recipe_item (
    id, account_id, type, name, alt_name, code, base_unit_id, cost_strategy, fixed_cost,
    computed_cost, cost_updated_at, notes, is_active, archived_at, created_at, updated_at,
    created_by, created_by_name, cost_window_days, indirect_cost_pct, prep_time_minutes,
    cook_time_minutes, procedure_text, plating_notes, kitchen_photo_url, yield_portions,
    conservation_type, service_temp_c, source, ai_confidence, needs_review, family_id,
    is_stockable, completeness, chef_notes, prep_notes, finishing_notes, steps_auto_split,
    season_start, season_end, recyclable_packaging, supplier_codes, shelf_life_days,
    label_override, label_simplified, category, supplier_name, supplier_url,
    last_purchase_date, current_stock, current_stock_unit_id, review_notes, folvy_code,
    external_codes, alt_names, purchase_unit_id, stock_unit_id, is_purchasable, is_sellable,
    nutrition, media, vat_category_id, vat_category_source, default_waste_pct, origin,
    template_code, template_version, menu_tags, is_operational_critical, operational_min_qty
  )
  select
    mi.new_id, p_dest, ri.type, ri.name, ri.alt_name, ri.code, ri.base_unit_id, ri.cost_strategy, ri.fixed_cost,
    ri.computed_cost, ri.cost_updated_at, ri.notes, ri.is_active, ri.archived_at, now(), now(),
    ri.created_by, ri.created_by_name, ri.cost_window_days, ri.indirect_cost_pct, ri.prep_time_minutes,
    ri.cook_time_minutes, ri.procedure_text, ri.plating_notes, ri.kitchen_photo_url, ri.yield_portions,
    ri.conservation_type, ri.service_temp_c, ri.source, ri.ai_confidence, ri.needs_review,
    (select mf.new_id from _map_family mf where mf.old_id = ri.family_id),
    ri.is_stockable, ri.completeness, ri.chef_notes, ri.prep_notes, ri.finishing_notes, ri.steps_auto_split,
    ri.season_start, ri.season_end, ri.recyclable_packaging, ri.supplier_codes, ri.shelf_life_days,
    ri.label_override, ri.label_simplified, ri.category, ri.supplier_name, ri.supplier_url,
    ri.last_purchase_date, ri.current_stock, ri.current_stock_unit_id, ri.review_notes, ri.folvy_code,
    ri.external_codes, ri.alt_names, ri.purchase_unit_id, ri.stock_unit_id, ri.is_purchasable, ri.is_sellable,
    ri.nutrition, ri.media, ri.vat_category_id, ri.vat_category_source, ri.default_waste_pct, ri.origin,
    ri.template_code, ri.template_version, ri.menu_tags, ri.is_operational_critical, ri.operational_min_qty
  from recipe_item ri join _map_item mi on mi.old_id = ri.id;

  -- 4) RECIPE_LINE
  insert into recipe_line (id, account_id, parent_item_id, child_item_id, quantity_net,
                           quantity_gross, unit_id, cut_type_id, comment, position, created_at, updated_at)
  select gen_random_uuid(), p_dest, mp.new_id, mc.new_id, rl.quantity_net, rl.quantity_gross,
         rl.unit_id, rl.cut_type_id, rl.comment, rl.position, now(), now()
    from recipe_line rl
    join _map_item mp on mp.old_id = rl.parent_item_id
    join _map_item mc on mc.old_id = rl.child_item_id
   where rl.account_id = p_source;

  -- 5) ARTICLE_SUPPLIER (purchase_format_id NO migra -> null; formatos son Fase posterior)
  insert into article_supplier (id, account_id, recipe_item_id, supplier_id, supplier_code,
                                last_price, is_preferred, is_active, created_at, updated_at,
                                purchase_format_id, supplier_item_name)
  select gen_random_uuid(), p_dest, mi.new_id, ms.new_id, as_.supplier_code,
         as_.last_price, as_.is_preferred, as_.is_active, now(), now(),
         null, as_.supplier_item_name
    from article_supplier as_
    join _map_item     mi on mi.old_id = as_.recipe_item_id
    join _map_supplier ms on ms.old_id = as_.supplier_id;

  -- 6) CONVERSIONES (0 filas hoy, inofensivo)
  insert into recipe_item_unit_conversion (id, account_id, item_id, from_unit_id, qty_in_base,
                                           source, ai_confidence, needs_review, is_active,
                                           archived_at, created_at, updated_at, created_by, created_by_name)
  select gen_random_uuid(), p_dest, mi.new_id, c.from_unit_id, c.qty_in_base,
         c.source, c.ai_confidence, c.needs_review, c.is_active,
         c.archived_at, now(), now(), c.created_by, c.created_by_name
    from recipe_item_unit_conversion c
    join _map_item mi on mi.old_id = c.item_id;

  set local session_replication_role = default;

  return query
    select 'familias',     count(*)::bigint from recipe_family where account_id = p_dest union all
    select 'proveedores',  count(*)::bigint from supplier where account_id = p_dest union all
    select 'items',        count(*)::bigint from recipe_item where account_id = p_dest union all
    select 'lineas',       count(*)::bigint from recipe_line where account_id = p_dest union all
    select 'article_supp', count(*)::bigint from article_supplier where account_id = p_dest union all
    select 'conversiones', count(*)::bigint from recipe_item_unit_conversion where account_id = p_dest;
end;
$function$
;
