-- 20260627T2000_folvy_shop_order_ingesta.sql
-- Aplicada: (pendiente)
--
-- Ingesta del pedido de Folvy Shop por la vía canónica.
-- 1) Amplía el CHECK sale_source_valid para admitir 'folvy_shop'
--    (el trigger tg_auto_dispatch_catcher ya lo referenciaba; era deuda de esquema).
-- 2) _shop_reprice_line: reprecio server-side de UNA línea desde el catálogo
--    (base + price_impact de modificadores base + opciones de slot + modificadores
--    anidados), validando pertenencia al menu_item (anti-manipulación de precio).
--    Espejo exacto de dishConfigService.unitPrice, pero leído de las tablas.
-- 3) adapt_folvy_shop_order: crea las líneas canónicas (product → modifier →
--    combo_item → modifier anidado) leyendo raw_tab. Molde de adapt_lastapp_order,
--    de modo que compute_sale_line_cost funcione idéntico.
-- 4) place_shop_order(p_slug, p_payload, p_dry_run): frontera pública (slug→cuenta).
--    Reprecia, y si NO es dry_run inserta el sale (source='folvy_shop',
--    order_status='new'), adapta líneas, calcula coste por línea (NO consumo: ese
--    entra solo al pasar a 'completed') y fija marca (única o NULL si multimarca).
--    Agnóstica de pago: el flag payment.mode se guarda pero no condiciona nada,
--    para enchufar Stripe (payment_intent.succeeded) por encima sin rediseñar.

-- ── 1) CHECK de source ───────────────────────────────────────────────────
alter table public.sale drop constraint if exists sale_source_valid;
alter table public.sale add constraint sale_source_valid
  check (source = any (array['manual','lastapp','import','hubrise','otter','folvy_shop']));


-- ── 2) Reprecio de una línea (puro, sin insertar) ────────────────────────
create or replace function public._shop_reprice_line(p_account_id uuid, p_line jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_mi          menu_item%rowtype;
  v_unit        numeric;
  v_qty         numeric;
  v_m           jsonb;
  v_c           jsonb;
  v_opt_impact  numeric;
  v_cso_impact  numeric;
begin
  v_qty := coalesce((p_line->>'quantity')::numeric, 1);

  select * into v_mi
  from menu_item mi
  where mi.id = (p_line->>'menuItemId')::uuid
    and mi.account_id = p_account_id
    and mi.archived_at is null
    and mi.is_active is not false
    and mi.is_available is not false;

  if not found then
    return jsonb_build_object(
      'menuItemId', p_line->>'menuItemId',
      'name', coalesce(p_line->>'name','(no disponible)'),
      'valid', false, 'unitPrice', 0, 'quantity', v_qty, 'lineTotal', 0
    );
  end if;

  v_unit := coalesce(v_mi.price, 0);

  -- modificadores base (asignados a este menu_item)
  if jsonb_typeof(p_line->'modifiers') = 'array' then
    for v_m in select * from jsonb_array_elements(p_line->'modifiers')
    loop
      select mo.price_impact into v_opt_impact
      from modifier_option mo
      join modifier_group mg on mg.id = mo.modifier_group_id
      join modifier_group_assignment mga on mga.modifier_group_id = mg.id
      where mo.id = (v_m->>'optionId')::uuid
        and mga.menu_item_id = v_mi.id
        and mo.is_active and mg.is_active
      limit 1;
      if v_opt_impact is not null then
        v_unit := v_unit + v_opt_impact * coalesce((v_m->>'qty')::numeric, 1);
      end if;
      v_opt_impact := null;
    end loop;
  end if;

  -- combo: opciones de slot + modificadores anidados
  if jsonb_typeof(p_line->'combo') = 'array' then
    for v_c in select * from jsonb_array_elements(p_line->'combo')
    loop
      select cso.price_impact into v_cso_impact
      from combo_slot_option cso
      join combo_slot cs on cs.id = cso.combo_slot_id
      where cs.combo_item_id = v_mi.id
        and cs.id = (v_c->>'slotId')::uuid
        and cso.menu_item_id = (v_c->>'menuItemId')::uuid
        and cso.is_active and cs.is_active
      limit 1;
      if v_cso_impact is not null then
        v_unit := v_unit + v_cso_impact;
      end if;
      v_cso_impact := null;

      if jsonb_typeof(v_c->'modifiers') = 'array' then
        for v_m in select * from jsonb_array_elements(v_c->'modifiers')
        loop
          select mo.price_impact into v_opt_impact
          from modifier_option mo
          join modifier_group mg on mg.id = mo.modifier_group_id
          join modifier_group_assignment mga on mga.modifier_group_id = mg.id
          where mo.id = (v_m->>'optionId')::uuid
            and mga.menu_item_id = (v_c->>'menuItemId')::uuid
            and mo.is_active and mg.is_active
          limit 1;
          if v_opt_impact is not null then
            v_unit := v_unit + v_opt_impact * coalesce((v_m->>'qty')::numeric, 1);
          end if;
          v_opt_impact := null;
        end loop;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'menuItemId', v_mi.id,
    'name', v_mi.name,
    'brandId', v_mi.brand_id,
    'valid', true,
    'unitPrice', round(v_unit, 2),
    'quantity', v_qty,
    'lineTotal', round(v_unit * v_qty, 2)
  );
end;
$$;


-- ── 3) Adaptador: raw_tab → líneas canónicas ─────────────────────────────
create or replace function public.adapt_folvy_shop_order(p_sale_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sale     sale%rowtype;
  v_acc      uuid;
  v_payload  jsonb;
  v_line     jsonb;
  v_mi       menu_item%rowtype;
  v_comp_mi  menu_item%rowtype;
  v_repr     jsonb;
  v_qty      numeric;
  v_parent   uuid;
  v_comp     uuid;
  v_m        jsonb;
  v_c        jsonb;
  v_opt      record;
  v_count    integer := 0;
  v_pt       text;
begin
  select * into v_sale from sale where id = p_sale_id;
  if not found then return 0; end if;
  if v_sale.source <> 'folvy_shop' or v_sale.raw_tab is null then return 0; end if;
  v_acc := v_sale.account_id;
  v_payload := v_sale.raw_tab::jsonb;

  -- idempotente: limpia líneas no manuales previas
  delete from sale_line
  where sale_id = p_sale_id and coalesce(map_source,'') <> 'manual';

  if jsonb_typeof(v_payload->'lines') <> 'array' then return 0; end if;

  for v_line in select * from jsonb_array_elements(v_payload->'lines')
  loop
    v_repr := public._shop_reprice_line(v_acc, v_line);
    v_qty  := coalesce((v_line->>'quantity')::numeric, 1);
    v_pt   := coalesce(v_line->>'productType', 'item');

    select * into v_mi from menu_item
    where id = (v_line->>'menuItemId')::uuid and account_id = v_acc;
    if not found then v_mi := null; end if;

    -- línea producto (padre): unit_price = precio configurado completo (incl. mods+combo)
    insert into sale_line (account_id, sale_id, product_name, raw_text, line_type,
                           quantity, unit_price, line_total, menu_item_id,
                           map_source, map_needs_review, unmapped_reason,
                           external_source, external_product_id, external_brand_id)
    values (v_acc, p_sale_id,
            coalesce(v_mi.name, v_repr->>'name'),
            coalesce(v_mi.name, v_repr->>'name'),
            'product',
            v_qty,
            (v_repr->>'unitPrice')::numeric,
            (v_repr->>'lineTotal')::numeric,
            v_mi.id,
            case when v_mi.id is not null then 'pos' else 'unmapped' end,
            (v_mi.id is null),
            case when v_mi.id is null then 'no_menu_item' else null end,
            'folvy_shop', (v_line->>'menuItemId'), v_mi.brand_id::text)
    returning id into v_parent;
    v_count := v_count + 1;

    -- modificadores base
    if jsonb_typeof(v_line->'modifiers') = 'array' then
      for v_m in select * from jsonb_array_elements(v_line->'modifiers')
      loop
        select mo.id, mo.name, mo.price_impact into v_opt
        from modifier_option mo
        join modifier_group mg on mg.id = mo.modifier_group_id
        join modifier_group_assignment mga on mga.modifier_group_id = mg.id
        where mo.id = (v_m->>'optionId')::uuid and mga.menu_item_id = v_mi.id
          and mo.is_active and mg.is_active
        limit 1;
        if not found then v_opt := null; end if;

        insert into sale_line (account_id, sale_id, product_name, raw_text, line_type,
                               quantity, unit_price, line_total, modifier_option_id,
                               map_source, map_needs_review, parent_sale_line_id,
                               external_source, external_product_id, external_brand_id)
        values (v_acc, p_sale_id,
                coalesce(v_opt.name, 'modificador'), coalesce(v_opt.name, 'modificador'),
                'modifier',
                coalesce((v_m->>'qty')::numeric, 1),
                coalesce(v_opt.price_impact, 0),
                coalesce(v_opt.price_impact, 0) * coalesce((v_m->>'qty')::numeric, 1),
                v_opt.id,
                case when v_opt.id is not null then 'pos' else 'unmapped' end,
                (v_opt.id is null), v_parent,
                'folvy_shop', (v_m->>'optionId'), v_mi.brand_id::text);
        v_count := v_count + 1;
      end loop;
    end if;

    -- combo: combo_items + sus modificadores anidados
    if v_pt = 'combo' and jsonb_typeof(v_line->'combo') = 'array' then
      for v_c in select * from jsonb_array_elements(v_line->'combo')
      loop
        select * into v_comp_mi from menu_item
        where id = (v_c->>'menuItemId')::uuid and account_id = v_acc;
        if not found then v_comp_mi := null; end if;

        insert into sale_line (account_id, sale_id, product_name, raw_text, line_type,
                               quantity, unit_price, line_total, menu_item_id,
                               map_source, map_needs_review, unmapped_reason, parent_sale_line_id,
                               external_source, external_product_id, external_brand_id)
        values (v_acc, p_sale_id,
                coalesce(v_comp_mi.name, 'combo_item'), coalesce(v_comp_mi.name, 'combo_item'),
                'combo_item',
                1, 0, 0, v_comp_mi.id,
                case when v_comp_mi.id is not null then 'pos' else 'unmapped' end,
                (v_comp_mi.id is null),
                case when v_comp_mi.id is null then 'no_menu_item' else null end,
                v_parent,
                'folvy_shop', (v_c->>'menuItemId'), v_comp_mi.brand_id::text)
        returning id into v_comp;
        v_count := v_count + 1;

        if jsonb_typeof(v_c->'modifiers') = 'array' then
          for v_m in select * from jsonb_array_elements(v_c->'modifiers')
          loop
            select mo.id, mo.name, mo.price_impact into v_opt
            from modifier_option mo
            join modifier_group mg on mg.id = mo.modifier_group_id
            join modifier_group_assignment mga on mga.modifier_group_id = mg.id
            where mo.id = (v_m->>'optionId')::uuid and mga.menu_item_id = v_comp_mi.id
              and mo.is_active and mg.is_active
            limit 1;
            if not found then v_opt := null; end if;

            insert into sale_line (account_id, sale_id, product_name, raw_text, line_type,
                                   quantity, unit_price, line_total, modifier_option_id,
                                   map_source, map_needs_review, parent_sale_line_id,
                                   external_source, external_product_id, external_brand_id)
            values (v_acc, p_sale_id,
                    coalesce(v_opt.name, 'modificador'), coalesce(v_opt.name, 'modificador'),
                    'modifier',
                    coalesce((v_m->>'qty')::numeric, 1),
                    coalesce(v_opt.price_impact, 0),
                    coalesce(v_opt.price_impact, 0) * coalesce((v_m->>'qty')::numeric, 1),
                    v_opt.id,
                    case when v_opt.id is not null then 'pos' else 'unmapped' end,
                    (v_opt.id is null), v_comp,
                    'folvy_shop', (v_m->>'optionId'), v_comp_mi.brand_id::text);
            v_count := v_count + 1;
          end loop;
        end if;
      end loop;
    end if;
  end loop;

  return v_count;
end;
$$;


-- ── 4) RPC pública: crear el pedido del Shop ─────────────────────────────
create or replace function public.place_shop_order(p_slug text, p_payload jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_acc        uuid;
  v_channel    uuid;
  v_location   uuid;
  v_mode       text;
  v_service    text;
  v_line       jsonb;
  v_repr       jsonb;
  v_subtotal   numeric := 0;
  v_delivery   numeric := 0;
  v_total      numeric := 0;
  v_preview    jsonb := '[]'::jsonb;
  v_sale_id    uuid;
  v_code       text;
  v_brand      uuid;
  v_brand_n    integer;
  v_expected   timestamptz;
  v_addr       text;
begin
  -- Frontera: slug -> cuenta
  select id into v_acc from accounts where slug = p_slug;
  if v_acc is null then
    return jsonb_build_object('ok', false, 'reason', 'account');
  end if;

  if jsonb_typeof(p_payload->'lines') <> 'array'
     or jsonb_array_length(p_payload->'lines') = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  v_location := nullif(p_payload->>'locationId','')::uuid;
  v_mode     := coalesce(p_payload->>'mode', 'delivery');
  v_service  := case when v_mode = 'pickup' then 'pickup' else 'own_delivery' end;
  v_delivery := case when v_mode = 'pickup' then 0
                     else coalesce((p_payload#>>'{delivery,deliveryFee}')::numeric, 0) end;
  v_expected := nullif(p_payload->>'expectedTime','')::timestamptz;

  -- canal Shop de la cuenta
  select id into v_channel
  from sales_channel
  where account_id = v_acc and slug = 'shop' and is_active and archived_at is null
  limit 1;

  -- Reprecio server-side (anti-manipulación) + preview
  for v_line in select * from jsonb_array_elements(p_payload->'lines')
  loop
    v_repr := public._shop_reprice_line(v_acc, v_line);
    v_subtotal := v_subtotal + coalesce((v_repr->>'lineTotal')::numeric, 0);
    v_preview := v_preview || jsonb_build_array(jsonb_build_object(
      'name', v_repr->>'name',
      'quantity', (v_repr->>'quantity')::numeric,
      'unitPrice', (v_repr->>'unitPrice')::numeric,
      'lineTotal', (v_repr->>'lineTotal')::numeric,
      'valid', (v_repr->>'valid')::boolean
    ));
  end loop;
  v_total := v_subtotal + v_delivery;

  if p_dry_run then
    return jsonb_build_object(
      'ok', true, 'dryRun', true,
      'subtotal', round(v_subtotal,2),
      'deliveryFee', round(v_delivery,2),
      'total', round(v_total,2),
      'lines', v_preview
    );
  end if;

  -- dirección compuesta (dirección · detalle)
  v_addr := nullif(btrim(
              coalesce(p_payload#>>'{delivery,address}','') || ' · ' ||
              coalesce(p_payload#>>'{delivery,detail}',''),
              ' ·'), '');

  -- id + código propio del Shop (estable, sin colisión práctica)
  v_sale_id := gen_random_uuid();
  v_code    := 'FS' || upper(left(replace(v_sale_id::text,'-',''), 5));

  insert into sale (id, account_id, channel_id, location_id, source,
                    sold_at, total, delivery_cost, service_type,
                    status, order_status, platform_order_code,
                    customer_name, customer_phone, delivery_address, customer_note,
                    expected_time, payment_method, dispatch_mode, raw_tab, created_by_name)
  values (v_sale_id, v_acc, v_channel, v_location, 'folvy_shop',
          now(), round(v_total,2), round(v_delivery,2), v_service,
          'open', 'new', v_code,
          nullif(p_payload#>>'{customer,name}',''),
          nullif(p_payload#>>'{customer,phone}',''),
          v_addr,
          nullif(p_payload#>>'{delivery,note}',''),
          v_expected,
          coalesce(p_payload#>>'{payment,mode}','simulated'),
          'auto',
          p_payload::text,
          'Folvy Shop');

  -- líneas canónicas
  perform public.adapt_folvy_shop_order(v_sale_id);

  -- coste por línea product (NO consumo: entra al pasar a 'completed')
  perform public.compute_sale_line_cost(sl.id)
  from sale_line sl
  where sl.sale_id = v_sale_id and coalesce(sl.line_type,'product') = 'product';

  -- marca: única -> fijar; multimarca -> NULL (la marca vive por línea)
  select count(distinct mi.brand_id), min(mi.brand_id)
  into v_brand_n, v_brand
  from sale_line sl
  join menu_item mi on mi.id = sl.menu_item_id
  where sl.sale_id = v_sale_id and sl.line_type = 'product' and mi.brand_id is not null;

  -- (order_status NO cambia: este UPDATE no dispara Catcher/print/consumo)
  update sale
  set brand_id = case when coalesce(v_brand_n,0) = 1 then v_brand else null end
  where id = v_sale_id;

  return jsonb_build_object(
    'ok', true, 'dryRun', false,
    'saleId', v_sale_id,
    'code', v_code,
    'subtotal', round(v_subtotal,2),
    'deliveryFee', round(v_delivery,2),
    'total', round(v_total,2)
  );
end;
$$;

grant execute on function public.place_shop_order(text, jsonb, boolean) to anon, authenticated;
