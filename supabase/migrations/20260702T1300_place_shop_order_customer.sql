-- 20260702T1300_place_shop_order_customer.sql
-- CRM Pata 2 (Paso 1a) — place_shop_order aprende a crear/vincular el cliente.
--
-- Reproduce place_shop_order ENTERA (repreciación, token, todo IGUAL que
-- 20260701T2000) y añade UN bloque nuevo tras insertar la venta:
--   - Si el payload trae email o teléfono, crea/vincula un customer (dedup por
--     email/teléfono dentro de la cuenta) y rellena sale.customer_id.
--   - Si además el cliente marcó el consentimiento de marketing, escribe
--     customer_consent (email=true) + una línea granted en customer_consent_log
--     con terms_version del payload (p.ej. 'shop-privacy-v1').
--   - Sin consentimiento: el customer se crea igual (ficha), pero SIN permiso de
--     contacto (regla de hierro).
--
-- SECURITY DEFINER -> NO probar en SQL Editor; verificar desde la app.
-- DDL: aplicar tal cual, sin BEGIN/COMMIT ni SELECT de prueba.

create or replace function public.place_shop_order(p_slug text, p_payload jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_acc        uuid;
  v_channel    uuid;
  v_location   uuid;
  v_mode       text;
  v_service    text;
  v_pay_mode   text;
  v_line       jsonb;
  v_repr       jsonb;
  v_subtotal   numeric := 0;
  v_delivery   numeric := 0;
  v_total      numeric := 0;
  v_preview    jsonb := '[]'::jsonb;
  v_sale_id    uuid;
  v_code       text;
  v_token      text;
  v_brand_arr  uuid[];
  v_expected   timestamptz;
  v_addr       text;
  v_is_cash    boolean;
  -- NUEVO (Pata 2)
  v_email      text;
  v_phone      text;
  v_name       text;
  v_consent    boolean;
  v_terms      text;
  v_customer   uuid;
begin
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
  v_pay_mode := coalesce(p_payload#>>'{payment,mode}','simulated');
  v_is_cash  := (v_pay_mode = 'cash');

  select id into v_channel
  from sales_channel
  where account_id = v_acc and slug = 'shop' and is_active and archived_at is null
  limit 1;

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

  v_addr := nullif(btrim(
              coalesce(p_payload#>>'{delivery,address}','') || ' · ' ||
              coalesce(p_payload#>>'{delivery,detail}',''),
              ' ·'), '');

  v_sale_id := gen_random_uuid();
  v_code    := 'FS' || upper(left(replace(v_sale_id::text,'-',''), 5));
  v_token   := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');

  insert into sale (id, account_id, channel_id, location_id, source,
                    sold_at, total, delivery_cost, service_type,
                    status, order_status, platform_order_code, public_token,
                    customer_name, customer_phone, delivery_address, customer_note,
                    expected_time, payment_method, payment_status, dispatch_mode, raw_tab, created_by_name)
  values (v_sale_id, v_acc, v_channel, v_location, 'folvy_shop',
          now(), round(v_total,2), round(v_delivery,2), v_service,
          'open', 'new', v_code, v_token,
          nullif(p_payload#>>'{customer,name}',''),
          nullif(p_payload#>>'{customer,phone}',''),
          v_addr,
          nullif(p_payload#>>'{delivery,note}',''),
          v_expected,
          v_pay_mode,
          case when v_is_cash then 'pending' else 'pending' end,
          'auto',
          p_payload::text,
          'Folvy Shop');

  perform public.adapt_folvy_shop_order(v_sale_id);

  perform public.compute_sale_line_cost(sl.id)
  from sale_line sl
  where sl.sale_id = v_sale_id and coalesce(sl.line_type,'product') = 'product';

  select array_agg(distinct mi.brand_id)
  into v_brand_arr
  from sale_line sl
  join menu_item mi on mi.id = sl.menu_item_id
  where sl.sale_id = v_sale_id and sl.line_type = 'product' and mi.brand_id is not null;

  update sale
  set brand_id = case when coalesce(array_length(v_brand_arr,1),0) = 1 then v_brand_arr[1] else null end
  where id = v_sale_id;

  -- ───────────────────────────────────────────────────────────────────
  -- NUEVO (Pata 2): crear/vincular customer + consentimiento
  -- Nunca aborta el pedido: si algo falla aquí, la venta ya está creada.
  -- ───────────────────────────────────────────────────────────────────
  v_name    := nullif(btrim(p_payload#>>'{customer,name}'), '');
  v_phone   := nullif(btrim(p_payload#>>'{customer,phone}'), '');
  v_email   := lower(nullif(btrim(p_payload#>>'{customer,email}'), ''));
  v_consent := coalesce((p_payload#>>'{consent,marketing}')::boolean, false);
  v_terms   := nullif(p_payload#>>'{consent,termsVersion}', '');

  if v_email is not null or v_phone is not null then
    -- Dedup: buscar por email primero, luego por teléfono (dentro de la cuenta).
    if v_email is not null then
      select id into v_customer from customer
      where account_id = v_acc and lower(email) = v_email limit 1;
    end if;
    if v_customer is null and v_phone is not null then
      select id into v_customer from customer
      where account_id = v_acc and phone = v_phone limit 1;
    end if;

    if v_customer is null then
      insert into customer (account_id, phone, email, name, first_brand_id, first_location_id)
      values (v_acc, v_phone, v_email, v_name,
              case when coalesce(array_length(v_brand_arr,1),0) = 1 then v_brand_arr[1] else null end,
              v_location)
      returning id into v_customer;
    else
      -- Enriquecer huecos sin pisar lo que ya hay.
      update customer set
        email      = coalesce(email, v_email),
        phone      = coalesce(phone, v_phone),
        name       = coalesce(name, v_name),
        last_seen_at = now(),
        updated_at   = now()
      where id = v_customer;
    end if;

    update sale set customer_id = v_customer where id = v_sale_id;

    -- Consentimiento SOLO si lo marcó y hay email (canal email).
    if v_consent and v_email is not null then
      insert into customer_consent (customer_id, account_id, marketing_email, updated_at)
      values (v_customer, v_acc, true, now())
      on conflict (customer_id) do update set marketing_email = true, updated_at = now();

      insert into customer_consent_log (customer_id, account_id, action, channel, source, terms_version)
      values (v_customer, v_acc, 'granted', 'email', 'shop', v_terms);
    end if;
  end if;
  -- ───────────────────────────────────────────────────────────────────

  if v_is_cash then
    update sale set order_status = 'accepted' where id = v_sale_id and order_status = 'new';
  end if;

  return jsonb_build_object(
    'ok', true, 'dryRun', false,
    'saleId', v_sale_id,
    'code', v_code,
    'publicToken', v_token,
    'accepted', v_is_cash,
    'subtotal', round(v_subtotal,2),
    'deliveryFee', round(v_delivery,2),
    'total', round(v_total,2)
  );
end;
$function$;
