-- ============================================================================
-- C01b · 0120 · LECTORES: lo que leía las columnas viejas pasa a la fuente nueva
-- ----------------------------------------------------------------------------
-- Respuesta 1 de Julio, decisiones 3 y 4. Va después de la 0110.
--
-- 1. compliance_docs_due: el aviso de ficha técnica caducada va al contacto de
--    administración y, si no hay, al principal. Misma firma y mismas columnas
--    de salida (supplier_email): la función de borde compliance-doc-notify no
--    cambia. Si no hay contacto con email, no se manda nada.
-- 2. migrate_kitchen_core: al clonar la plantilla en una cuenta nueva, deja de
--    copiar supplier.email / phone / address y copia los datos fiscales
--    estructurados, los contactos y la dirección por confirmar. El resto de la
--    función es la de producción del 04/10 (md5 5dca6db9…), sin tocar.
--
-- PARA en el analizador a propósito (reemplaza dos funciones existentes): va
-- en «autorizo». Ninguna de las dos está en el camino del pedido: la primera
-- la llama un cron diario y la segunda el alta de cuentas.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compliance_docs_due(p_days integer DEFAULT 30)
 RETURNS TABLE(id uuid, account_id uuid, title text, reference text, expires_at date, review_due_at date, last_reminder_at timestamp with time zone, supplier_id uuid, supplier_name text, supplier_email text, account_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select cd.id, cd.account_id, cd.title, cd.reference,
         cd.expires_at, cd.review_due_at, cd.last_reminder_at,
         cd.supplier_id, s.name, dest.email, a.name
  from compliance_document cd
  left join supplier s on s.id = cd.supplier_id
  -- C01b: al contacto de ADMINISTRACIÓN; si no hay, al PRINCIPAL; si no hay
  -- ninguno con email, supplier_email sale null y no se manda nada (la ficha
  -- lo enseña en «Falta: contacto de administración»).
  left join lateral (
    select c.email from supplier_contact c
     where c.supplier_id = s.id and nullif(btrim(c.email), '') is not null
       and (c.role = 'admin' or c.is_primary)
     order by (c.role = 'admin') desc, c.is_primary desc, c.created_at
     limit 1
  ) dest on true
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

  -- 2) PROVEEDORES. C01b: ni email, ni teléfono, ni dirección en supplier;
  -- se clonan los datos fiscales estructurados, los contactos y la dirección
  -- por confirmar (propuesta pendiente), que es donde viven ahora.
  insert into supplier (id, account_id, name, tax_id, notes,
                        is_active, created_at, health_registry_no,
                        legal_name, tax_id_type, country_code, entity_kind,
                        fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province)
  select m.new_id, p_dest, s.name, s.tax_id, s.notes,
         s.is_active, now(), s.health_registry_no,
         s.legal_name, s.tax_id_type, s.country_code, s.entity_kind,
         s.fiscal_street, s.fiscal_postal_code, s.fiscal_city, s.fiscal_province
    from supplier s join _map_supplier m on m.old_id = s.id;

  insert into supplier_contact (account_id, supplier_id, name, role, phone, email, is_primary, notes, created_at, created_by_name)
  select p_dest, m.new_id, c.name, c.role, c.phone, c.email, c.is_primary, c.notes, now(), 'Clonado de la plantilla'
    from supplier_contact c join _map_supplier m on m.old_id = c.supplier_id;

  insert into supplier_proposal (account_id, supplier_id, field, value, source, source_label)
  select p_dest, m.new_id, p.field, p.value, p.source, p.source_label
    from supplier_proposal p join _map_supplier m on m.old_id = p.supplier_id
   where p.status = 'pending' and p.field = 'fiscal_address';

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
