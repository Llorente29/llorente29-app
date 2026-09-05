create or replace function public._adapt_folvy_pos_order(p_sale_id uuid)
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
  if v_sale.source <> 'folvy_pos' or v_sale.raw_tab is null then return 0; end if;
  v_acc := v_sale.account_id;
  v_payload := v_sale.raw_tab::jsonb;

  delete from sale_line
  where sale_id = p_sale_id and coalesce(map_source, '') <> 'manual';

  if jsonb_typeof(v_payload->'lines') <> 'array' then return 0; end if;

  for v_line in select * from jsonb_array_elements(v_payload->'lines')
  loop
    v_repr := public._shop_reprice_line(v_acc, v_line);
    v_qty  := coalesce((v_line->>'quantity')::numeric, 1);
    v_pt   := coalesce(v_line->>'productType', 'item');

    select * into v_mi from menu_item
    where id = (v_line->>'menuItemId')::uuid and account_id = v_acc;
    if not found then v_mi := null; end if;

    insert into sale_line (account_id, sale_id, product_name, raw_text, line_type,
                           quantity, unit_price, line_total, menu_item_id, kitchen_note,
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
            nullif(btrim(v_line->>'kitchenNote'), ''),
            case when v_mi.id is not null then 'pos' else 'unmapped' end,
            (v_mi.id is null),
            case when v_mi.id is null then 'no_menu_item' else null end,
            'folvy_pos', (v_line->>'menuItemId'), v_mi.brand_id::text)
    returning id into v_parent;
    v_count := v_count + 1;

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
                'folvy_pos', (v_m->>'optionId'), v_mi.brand_id::text);
        v_count := v_count + 1;
      end loop;
    end if;

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
                'folvy_pos', (v_c->>'menuItemId'), v_comp_mi.brand_id::text)
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
                    'folvy_pos', (v_m->>'optionId'), v_comp_mi.brand_id::text);
            v_count := v_count + 1;
          end loop;
        end if;
      end loop;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public._adapt_folvy_pos_order(uuid) from public, anon;
grant execute on function public._adapt_folvy_pos_order(uuid) to authenticated;

create or replace function public.upsert_pos_sale(
  p_sale_id       uuid,
  p_account_id    uuid,
  p_location_id   uuid,
  p_brand_id      uuid,
  p_channel_kind  text,
  p_lines         jsonb,
  p_action        text,
  p_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sale_id   uuid := p_sale_id;
  v_channel   uuid;
  v_actor     text;
  v_line      jsonb;
  v_repr      jsonb;
  v_vat       numeric;
  v_ltotal    numeric;
  v_lbase     numeric;
  v_base_sum  numeric := 0;
  v_tax_sum   numeric := 0;
  v_total_sum numeric := 0;
  v_status    text;
  v_result    sale%rowtype;
begin
  if not public._pos_can_operate(p_account_id, p_location_id) then
    raise exception 'upsert_pos_sale: sin acceso a esta cuenta/local';
  end if;
  if p_action not in ('save', 'command', 'charge', 'deliver') then
    raise exception 'upsert_pos_sale: acción no válida %', p_action;
  end if;
  if p_action = 'charge' and p_payment_method not in ('cash', 'card') then
    raise exception 'upsert_pos_sale: cobrar exige payment_method cash|card';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'upsert_pos_sale: la cuenta no tiene líneas';
  end if;

  select display_name into v_actor from user_profiles
  where user_id = auth.uid() and account_id = p_account_id limit 1;

  v_channel := public._pos_channel_id(p_account_id, coalesce(p_channel_kind, 'counter'));

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_repr   := public._shop_reprice_line(p_account_id, v_line);
    v_ltotal := coalesce((v_repr->>'lineTotal')::numeric, 0);

    select vat_rate into v_vat from menu_item
    where id = (v_line->>'menuItemId')::uuid and account_id = p_account_id;
    v_vat := coalesce(v_vat, 10);

    v_lbase     := round(v_ltotal / (1 + v_vat / 100.0), 2);
    v_base_sum  := v_base_sum + v_lbase;
    v_tax_sum   := v_tax_sum + (v_ltotal - v_lbase);
    v_total_sum := v_total_sum + v_ltotal;
  end loop;

  if v_sale_id is null then
    insert into sale (
      account_id, location_id, brand_id, channel_id, source, service_type,
      status, order_status, sold_at, opened_at, total, taxable_base, tax,
      payment_method, payment_status, dispatch_mode, pos_short_code,
      raw_tab, created_by, created_by_name
    ) values (
      p_account_id, p_location_id, p_brand_id, v_channel, 'folvy_pos', 'pickup',
      'open', null, now(), now(), round(v_total_sum, 2), round(v_base_sum, 2), round(v_tax_sum, 2),
      null, null, 'auto', public._pos_next_ticket_code(p_account_id, p_location_id),
      jsonb_build_object('lines', p_lines)::text, auth.uid(), v_actor
    )
    returning id into v_sale_id;
  else
    select * into v_result from sale where id = v_sale_id
      and account_id = p_account_id and location_id = p_location_id;
    if v_result.id is null then
      raise exception 'upsert_pos_sale: venta inexistente o de otra cuenta/local';
    end if;
    if v_result.status <> 'open' then
      raise exception 'upsert_pos_sale: la cuenta ya está cerrada (status=%)', v_result.status;
    end if;

    update sale set
      brand_id      = p_brand_id,
      channel_id    = v_channel,
      total         = round(v_total_sum, 2),
      taxable_base  = round(v_base_sum, 2),
      tax           = round(v_tax_sum, 2),
      raw_tab       = jsonb_build_object('lines', p_lines)::text,
      updated_at    = now()
    where id = v_sale_id;
  end if;

  perform public._adapt_folvy_pos_order(v_sale_id);

  if p_action in ('command', 'charge') then
    update sale set order_status = coalesce(order_status, 'accepted') where id = v_sale_id;
  end if;

  if p_action = 'charge' then
    update sale set
      status         = 'closed',
      payment_method = p_payment_method,
      payment_status = 'paid',
      paid_at        = now(),
      closed_at      = now()
    where id = v_sale_id;
  end if;

  if p_action = 'deliver' then
    select status into v_status from sale where id = v_sale_id;
    if v_status <> 'closed' then
      raise exception 'upsert_pos_sale: no se puede marcar Entregado sin cobrar antes';
    end if;
    update sale set order_status = 'completed' where id = v_sale_id;
  end if;

  select * into v_result from sale where id = v_sale_id;
  return jsonb_build_object(
    'saleId', v_result.id,
    'posShortCode', v_result.pos_short_code,
    'status', v_result.status,
    'orderStatus', v_result.order_status,
    'paymentStatus', v_result.payment_status,
    'total', v_result.total,
    'taxableBase', v_result.taxable_base,
    'tax', v_result.tax
  );
end;
$$;

revoke all on function public.upsert_pos_sale(uuid, uuid, uuid, uuid, text, jsonb, text, text) from public, anon;
grant execute on function public.upsert_pos_sale(uuid, uuid, uuid, uuid, text, jsonb, text, text) to authenticated;