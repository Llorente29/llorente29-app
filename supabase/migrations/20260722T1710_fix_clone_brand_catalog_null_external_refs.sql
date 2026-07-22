-- 20260722T1710_fix_clone_brand_catalog_null_external_refs.sql
-- Aplicada: 2026-07-22 (en vivo por MCP; CREATE OR REPLACE idempotente)
-- Fix clone_brand_catalog: al clonar dentro de la MISMA cuenta, copiar
-- external_id/external_source chocaba con uq_combo_slot_external (y era
-- semanticamente incorrecto: la marca clon no debe heredar ids del integrador
-- de origen). Se ponen a NULL en todo el catalogo clonado.
CREATE OR REPLACE FUNCTION public.clone_brand_catalog(p_src_account uuid, p_src_brand uuid, p_dst_account uuid, p_dst_brand uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cats int; v_items int; v_groups int; v_opts int;
  v_ovr int; v_asg int; v_slots int; v_sopts int;
BEGIN
  IF p_dst_account IS NULL OR p_dst_brand IS NULL OR p_src_account IS NULL OR p_src_brand IS NULL THEN
    RAISE EXCEPTION 'Parametros nulos no permitidos';
  END IF;
  IF p_src_account = p_dst_account AND p_src_brand = p_dst_brand THEN
    RAISE EXCEPTION 'Origen y destino son la misma marca';
  END IF;
  PERFORM 1 FROM brand WHERE id = p_dst_brand AND account_id = p_dst_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'La marca destino no pertenece a la cuenta destino'; END IF;
  PERFORM 1 FROM brand WHERE id = p_src_brand AND account_id = p_src_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'La marca origen no pertenece a la cuenta origen'; END IF;

  UPDATE sale_line SET modifier_option_id = NULL
   WHERE modifier_option_id IN (
     SELECT id FROM modifier_option
      WHERE modifier_group_id IN (SELECT id FROM modifier_group WHERE account_id = p_dst_account AND brand_id = p_dst_brand));
  UPDATE sale_line SET menu_item_id = NULL
   WHERE menu_item_id IN (SELECT id FROM menu_item WHERE account_id = p_dst_account AND brand_id = p_dst_brand);

  DELETE FROM combo_slot_option
   WHERE menu_item_id IN (SELECT id FROM menu_item WHERE account_id = p_dst_account AND brand_id = p_dst_brand);
  DELETE FROM combo_slot_option
   WHERE combo_slot_id IN (
     SELECT s.id FROM combo_slot s JOIN menu_item m ON m.id = s.combo_item_id
      WHERE m.account_id = p_dst_account AND m.brand_id = p_dst_brand);
  DELETE FROM combo_slot
   WHERE combo_item_id IN (SELECT id FROM menu_item WHERE account_id = p_dst_account AND brand_id = p_dst_brand);
  DELETE FROM modifier_group_assignment
   WHERE menu_item_id IN (SELECT id FROM menu_item WHERE account_id = p_dst_account AND brand_id = p_dst_brand);
  DELETE FROM menu_item_override
   WHERE menu_item_id IN (SELECT id FROM menu_item WHERE account_id = p_dst_account AND brand_id = p_dst_brand);
  DELETE FROM modifier_option
   WHERE modifier_group_id IN (SELECT id FROM modifier_group WHERE account_id = p_dst_account AND brand_id = p_dst_brand);
  DELETE FROM modifier_group_assignment
   WHERE modifier_group_id IN (SELECT id FROM modifier_group WHERE account_id = p_dst_account AND brand_id = p_dst_brand);
  DELETE FROM modifier_group WHERE account_id = p_dst_account AND brand_id = p_dst_brand;
  DELETE FROM menu_item WHERE account_id = p_dst_account AND brand_id = p_dst_brand;
  DELETE FROM menu_category WHERE account_id = p_dst_account AND brand_id = p_dst_brand;

  CREATE TEMP TABLE _map_cat (old_id uuid, new_id uuid) ON COMMIT DROP;
  CREATE TEMP TABLE _map_grp (old_id uuid, new_id uuid) ON COMMIT DROP;
  CREATE TEMP TABLE _map_item (old_id uuid, new_id uuid) ON COMMIT DROP;
  CREATE TEMP TABLE _map_slot (old_id uuid, new_id uuid) ON COMMIT DROP;
  CREATE TEMP TABLE _map_chan (old_id uuid, new_id uuid) ON COMMIT DROP;

  INSERT INTO _map_chan(old_id, new_id)
  SELECT so.id, sd.id FROM sales_channel so
    JOIN sales_channel sd ON sd.slug = so.slug AND sd.account_id = p_dst_account
   WHERE so.account_id = p_src_account;

  INSERT INTO _map_cat(old_id, new_id)
  SELECT id, gen_random_uuid() FROM menu_category
   WHERE account_id = p_src_account AND brand_id = p_src_brand;

  INSERT INTO menu_category (id, account_id, brand_id, name, emoji, position, parent_id, is_active, created_at, updated_at)
  SELECT mc.new_id, p_dst_account, p_dst_brand, c.name, c.emoji, c.position,
         (SELECT pm.new_id FROM _map_cat pm WHERE pm.old_id = c.parent_id),
         c.is_active, now(), now()
    FROM menu_category c JOIN _map_cat mc ON mc.old_id = c.id
   WHERE c.account_id = p_src_account AND c.brand_id = p_src_brand;

  INSERT INTO _map_grp(old_id, new_id)
  SELECT g_id, gen_random_uuid()
    FROM (SELECT DISTINCT a.modifier_group_id AS g_id
            FROM modifier_group_assignment a JOIN menu_item m ON m.id = a.menu_item_id
           WHERE m.account_id = p_src_account AND m.brand_id = p_src_brand) sub;

  INSERT INTO modifier_group (id, account_id, brand_id, name, group_type, min_selections, max_selections, allow_repetition, external_id, position, is_active, created_at, updated_at)
  SELECT mg.new_id, p_dst_account, p_dst_brand, g.name, g.group_type, g.min_selections, g.max_selections, g.allow_repetition, NULL, g.position, g.is_active, now(), now()
    FROM modifier_group g JOIN _map_grp mg ON mg.old_id = g.id;

  INSERT INTO modifier_option (id, account_id, modifier_group_id, name, price_impact, is_default, external_id, recipe_item_id, position, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), p_dst_account, mg.new_id, o.name, o.price_impact, o.is_default, NULL, NULL, o.position, o.is_active, now(), now()
    FROM modifier_option o JOIN _map_grp mg ON mg.old_id = o.modifier_group_id;

  INSERT INTO _map_item(old_id, new_id)
  SELECT id, gen_random_uuid() FROM menu_item
   WHERE account_id = p_src_account AND brand_id = p_src_brand;

  INSERT INTO menu_item (id, account_id, brand_id, menu_category_id, name, short_name, description, photo_url, price, product_type, external_id, external_source, recipe_item_id, is_active, is_available, needs_review, position, created_at, updated_at)
  SELECT mi.new_id, p_dst_account, p_dst_brand,
         (SELECT cm.new_id FROM _map_cat cm WHERE cm.old_id = m.menu_category_id),
         m.name, m.short_name, m.description, m.photo_url, m.price, m.product_type,
         NULL, NULL, NULL, m.is_active, m.is_available, m.needs_review, m.position, now(), now()
    FROM menu_item m JOIN _map_item mi ON mi.old_id = m.id
   WHERE m.account_id = p_src_account AND m.brand_id = p_src_brand;

  INSERT INTO menu_item_override (id, account_id, menu_item_id, channel_id, location_id, price, is_available, name, short_name, description, category_name, photo_url, external_id, created_at, updated_at)
  SELECT gen_random_uuid(), p_dst_account, im.new_id,
         (SELECT cm.new_id FROM _map_chan cm WHERE cm.old_id = x.channel_id),
         NULL, x.price, x.is_available, x.name, x.short_name, x.description, x.category_name, x.photo_url, NULL, now(), now()
    FROM menu_item_override x JOIN _map_item im ON im.old_id = x.menu_item_id
   WHERE x.location_id IS NULL
     AND (x.channel_id IS NULL OR EXISTS (SELECT 1 FROM _map_chan cm WHERE cm.old_id = x.channel_id));

  INSERT INTO modifier_group_assignment (id, account_id, menu_item_id, modifier_group_id, position, created_at)
  SELECT gen_random_uuid(), p_dst_account, im.new_id, gm.new_id, a.position, now()
    FROM modifier_group_assignment a
    JOIN _map_item im ON im.old_id = a.menu_item_id
    JOIN _map_grp gm ON gm.old_id = a.modifier_group_id;

  INSERT INTO _map_slot(old_id, new_id)
  SELECT s.id, gen_random_uuid()
    FROM combo_slot s JOIN _map_item im ON im.old_id = s.combo_item_id;

  INSERT INTO combo_slot (id, account_id, combo_item_id, name, min_selections, max_selections, position, is_active, created_at, updated_at, external_id, external_source)
  SELECT sm.new_id, p_dst_account, im.new_id, s.name, s.min_selections, s.max_selections, s.position, s.is_active, now(), now(), NULL, NULL
    FROM combo_slot s JOIN _map_slot sm ON sm.old_id = s.id JOIN _map_item im ON im.old_id = s.combo_item_id;

  INSERT INTO combo_slot_option (id, account_id, combo_slot_id, menu_item_id, modifier_group_id, price_impact, is_default, position, is_active, created_at, external_id, external_source)
  SELECT gen_random_uuid(), p_dst_account, sm.new_id,
         (SELECT im.new_id FROM _map_item im WHERE im.old_id = opt.menu_item_id),
         (SELECT gm.new_id FROM _map_grp gm WHERE gm.old_id = opt.modifier_group_id),
         opt.price_impact, opt.is_default, opt.position, opt.is_active, now(), NULL, NULL
    FROM combo_slot_option opt JOIN _map_slot sm ON sm.old_id = opt.combo_slot_id;

  SELECT count(*) INTO v_cats  FROM menu_category WHERE account_id=p_dst_account AND brand_id=p_dst_brand;
  SELECT count(*) INTO v_items FROM menu_item     WHERE account_id=p_dst_account AND brand_id=p_dst_brand;
  SELECT count(*) INTO v_groups FROM modifier_group WHERE account_id=p_dst_account AND brand_id=p_dst_brand;
  SELECT count(*) INTO v_opts  FROM modifier_option o JOIN modifier_group g ON g.id=o.modifier_group_id WHERE g.account_id=p_dst_account AND g.brand_id=p_dst_brand;
  SELECT count(*) INTO v_ovr   FROM menu_item_override x JOIN menu_item m ON m.id=x.menu_item_id WHERE m.account_id=p_dst_account AND m.brand_id=p_dst_brand;
  SELECT count(*) INTO v_asg   FROM modifier_group_assignment a JOIN menu_item m ON m.id=a.menu_item_id WHERE m.account_id=p_dst_account AND m.brand_id=p_dst_brand;
  SELECT count(*) INTO v_slots FROM combo_slot s JOIN menu_item m ON m.id=s.combo_item_id WHERE m.account_id=p_dst_account AND m.brand_id=p_dst_brand;
  SELECT count(*) INTO v_sopts FROM combo_slot_option opt JOIN combo_slot s ON s.id=opt.combo_slot_id JOIN menu_item m ON m.id=s.combo_item_id WHERE m.account_id=p_dst_account AND m.brand_id=p_dst_brand;

  RETURN jsonb_build_object('categories',v_cats,'items',v_items,'groups',v_groups,'options',v_opts,
                            'overrides',v_ovr,'assignments',v_asg,'slots',v_slots,'slot_options',v_sopts);
END;
$function$;
