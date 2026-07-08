-- 20260708T2000_3b_paso2_place_shop_order_brand_gift.sql
--
-- v3 · 3b · PASO 2: regalo (free_item) por la MARCA DEL CARRITO en el cobro.
-- Reconstrucción VERBATIM de place_shop_order con UN ÚNICO cambio (marcado -- ⟵ 3b):
--   (1) declara v_cart_brand;
--   (2) lo resuelve tras el bucle de líneas (el Shop es per-marca: el carrito es de una marca);
--   (3) el lane del regalo (v_gi) solo coge el free_item cuyo campaign_scope pertenece a esa marca.
-- Todo lo demás es idéntico. Hoy no hay ningún free_item → cambio no-op hasta que el agente
-- cree regalos. Verificar con p_dry_run antes de tocar dinero real.

create or replace function public.place_shop_order(p_slug text, p_payload jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  v_cart_brand uuid;                      -- ⟵ 3b: marca del carrito (Shop es per-marca)
  v_expected   timestamptz;
  v_addr       text;
  v_is_cash    boolean;
  v_email      text;
  v_phone      text;
  v_name       text;
  v_consent    boolean;
  v_terms      text;
  v_customer   uuid;
  v_seed_addr  text;
  v_line_cost    numeric;
  v_line_qty     numeric;
  v_cost_known   numeric := 0;
  v_cost_has_null boolean := false;
  v_coupon_code  text;
  v_coupon       coupon%rowtype;
  v_cust_existing uuid;
  v_discount     numeric := 0;
  v_reason       text := null;
  v_neto         numeric;
  v_margin_eur   numeric;
  v_margin_pct   numeric;
  v_margin_warn  boolean := false;
  v_floor        numeric;
  v_is_welcome   boolean;
  v_coupon_json  jsonb := jsonb_build_object('applied', false);
  v_freq          coupon%rowtype;
  v_freq_discount numeric := 0;
  v_progress      integer := 0;
  v_is_frequency  boolean := false;
  v_fd           coupon%rowtype;
  v_fd_discount  numeric := 0;
  v_gi           coupon%rowtype;
  v_gift_id      uuid;
  v_gift_price   numeric := 0;
  v_gift_name    text;
  v_gift_reason  text;
  v_gift_applied boolean := false;
  v_fd_applied   boolean := false;
  v_fd_reason    text := null;
  v_item_promo   jsonb := '{}'::jsonb;
  v_promo_cid    text;
  v_promo_du     numeric;
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
      'valid', (v_repr->>'valid')::boolean,
      'offer', v_repr->'offer'
    ));

    if jsonb_typeof(v_repr->'offer') = 'object' then
      v_promo_cid := v_repr#>>'{offer,campaignId}';
      if v_promo_cid is not null then
        v_promo_du := coalesce((v_repr#>>'{offer,discountUnit}')::numeric, 0)
                    * coalesce((v_repr->>'quantity')::numeric, 0);
        if v_promo_du > 0 then
          v_item_promo := jsonb_set(v_item_promo, array[v_promo_cid],
            to_jsonb(coalesce((v_item_promo->>v_promo_cid)::numeric, 0) + v_promo_du));
        end if;
      end if;
    end if;

    v_line_qty := coalesce((v_repr->>'quantity')::numeric, 0);
    select ri.computed_cost into v_line_cost
    from menu_item mi
    left join recipe_item ri on ri.id = mi.recipe_item_id
    where mi.id = nullif(v_line->>'menuItemId','')::uuid
      and mi.account_id = v_acc
    limit 1;

    if v_line_cost is null then
      v_cost_has_null := true;
    else
      v_cost_known := v_cost_known + (v_line_cost * v_line_qty);
    end if;
  end loop;
  v_total := v_subtotal + v_delivery;

  -- ⟵ 3b: marca del carrito (el Shop es per-marca; el carrito es de una sola marca).
  select mi.brand_id into v_cart_brand
  from jsonb_array_elements(p_payload->'lines') ln
  join menu_item mi on mi.id = nullif(ln->>'menuItemId','')::uuid and mi.account_id = v_acc
  where mi.brand_id is not null
  limit 1;

  v_coupon_code := nullif(p_payload#>>'{coupon,code}','');
  v_email := lower(nullif(btrim(p_payload#>>'{customer,email}'), ''));
  v_phone := nullif(btrim(p_payload#>>'{customer,phone}'), '');
  v_consent := coalesce((p_payload#>>'{consent,marketing}')::boolean, false);

  select * into v_coupon
  from coupon
  where account_id = v_acc and active and kind <> 'free_delivery'
    and (
      (v_coupon_code is not null and lower(code) = lower(v_coupon_code))
      or (v_coupon_code is null and auto_apply)
    )
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >  now())
  order by (v_coupon_code is not null) desc
  limit 1;

  if v_coupon.id is not null then
    v_is_welcome := v_coupon.first_order_only or v_coupon.auto_apply;

    if v_email is not null then
      select id into v_cust_existing from customer
      where account_id = v_acc and lower(email) = v_email limit 1;
    end if;
    if v_cust_existing is null and v_phone is not null then
      select id into v_cust_existing from customer
      where account_id = v_acc and phone = v_phone limit 1;
    end if;

    if v_coupon.min_subtotal is not null and v_subtotal < v_coupon.min_subtotal then
      v_reason := 'min';
    elsif v_is_welcome and (v_email is null or not v_consent) then
      v_reason := 'needs_contact';
    elsif v_coupon.first_order_only and v_cust_existing is not null and exists (
            select 1 from sale
            where customer_id = v_cust_existing
              and coalesce(status,'') <> 'cancelled'
          ) then
      v_reason := 'not_first';
    elsif v_coupon.max_redemptions is not null and (
            select count(*) from coupon_redemption cr
            join sale s on s.id = cr.sale_id
            where cr.coupon_id = v_coupon.id and coalesce(s.status,'') <> 'cancelled'
          ) >= v_coupon.max_redemptions then
      v_reason := 'exhausted';
    elsif v_cust_existing is not null and (
            select count(*) from coupon_redemption cr
            join sale s on s.id = cr.sale_id
            where cr.coupon_id = v_coupon.id and cr.customer_id = v_cust_existing
              and coalesce(s.status,'') <> 'cancelled'
          ) >= v_coupon.max_per_customer then
      v_reason := 'per_customer';
    end if;

    if v_reason is null then
      v_discount := case v_coupon.discount_type
        when 'percent' then round(v_subtotal * v_coupon.value / 100, 2)
        else least(v_coupon.value, v_subtotal) end;
      if v_discount < 0 then v_discount := 0; end if;

      if v_cost_has_null then
        v_margin_warn := true;
      else
        v_neto       := v_subtotal - v_discount;
        v_margin_eur := v_neto - v_cost_known;
        v_margin_pct := case when v_neto > 0 then v_margin_eur / v_neto * 100 else null end;
        v_floor      := (select shop_coupon_margin_floor_pct from accounts where id = v_acc);

        if v_floor is not null and v_margin_pct is not null and v_margin_pct < v_floor then
          if v_is_welcome then
            v_margin_warn := true;
          else
            v_reason := 'margin';
            v_discount := 0;
          end if;
        end if;
      end if;
    end if;

    v_coupon_json := jsonb_build_object(
      'applied', (v_discount > 0),
      'code', v_coupon.code,
      'label', v_coupon.name,
      'discount', round(v_discount,2),
      'discountType', v_coupon.discount_type,
      'discountValue', v_coupon.value,
      'reason', v_reason,
      'marginWarning', v_margin_warn,
      'isWelcome', v_is_welcome,
      'isFrequency', false
    );
  end if;

  if v_coupon_code is null then
    if v_cust_existing is null and v_email is not null then
      select id into v_cust_existing from customer
      where account_id = v_acc and lower(email) = v_email limit 1;
    end if;
    if v_cust_existing is null and v_phone is not null then
      select id into v_cust_existing from customer
      where account_id = v_acc and phone = v_phone limit 1;
    end if;

    if v_cust_existing is not null then
      select * into v_freq
      from coupon
      where account_id = v_acc and active and kind = 'frequency'
        and (starts_at is null or starts_at <= now())
        and (ends_at   is null or ends_at   >  now())
      limit 1;

      if v_freq.id is not null and v_freq.frequency_threshold is not null then
        select count(*) into v_progress
        from sale s
        where s.customer_id = v_cust_existing and s.source = 'folvy_shop'
          and coalesce(s.status,'') <> 'cancelled'
          and s.created_at > coalesce((
            select max(cr.ts) from coupon_redemption cr
            join sale cs on cs.id = cr.sale_id
            where cr.coupon_id = v_freq.id and cr.customer_id = v_cust_existing
              and coalesce(cs.status,'') <> 'cancelled'
          ), '-infinity'::timestamptz);

        if v_progress >= v_freq.frequency_threshold then
          v_freq_discount := case v_freq.discount_type
            when 'percent' then round(v_subtotal * v_freq.value / 100, 2)
            else least(v_freq.value, v_subtotal) end;
          if v_freq_discount < 0 then v_freq_discount := 0; end if;

          if v_freq_discount > 0 and not v_cost_has_null then
            v_floor := (select shop_coupon_margin_floor_pct from accounts where id = v_acc);
            if v_floor is not null then
              v_neto := v_subtotal - v_freq_discount;
              v_margin_pct := case when v_neto > 0 then (v_neto - v_cost_known) / v_neto * 100 else null end;
              if v_margin_pct is not null and v_margin_pct < v_floor then
                v_freq_discount := 0;
              end if;
            end if;
          end if;

          if v_freq_discount > v_discount then
            v_coupon       := v_freq;
            v_is_frequency := true;
            v_discount     := v_freq_discount;
            v_reason       := null;
            v_margin_warn  := v_cost_has_null;
            v_coupon_json  := jsonb_build_object(
              'applied', (v_freq_discount > 0),
              'code', v_freq.code,
              'label', v_freq.name,
              'discount', round(v_freq_discount,2),
              'discountType', v_freq.discount_type,
              'discountValue', v_freq.value,
              'reason', null,
              'marginWarning', v_cost_has_null,
              'isWelcome', false,
              'isFrequency', true
            );
          end if;
        end if;
      end if;
    end if;
  end if;

  select * into v_fd
  from coupon
  where account_id = v_acc and active and kind = 'free_delivery'
    and ((v_coupon_code is not null and lower(code) = lower(v_coupon_code)) or auto_apply)
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >  now())
  order by (v_coupon_code is not null and code is not null and lower(code) = lower(v_coupon_code)) desc, created_at desc
  limit 1;

  if v_fd.id is not null then
    if v_cust_existing is null and v_email is not null then
      select id into v_cust_existing from customer where account_id = v_acc and lower(email) = v_email limit 1;
    end if;
    if v_cust_existing is null and v_phone is not null then
      select id into v_cust_existing from customer where account_id = v_acc and phone = v_phone limit 1;
    end if;

    if v_mode = 'pickup' then
      v_fd_reason := 'pickup_only';
    elsif v_fd.min_subtotal is not null and v_subtotal < v_fd.min_subtotal then
      v_fd_reason := 'min';
    elsif v_delivery <= 0 then
      v_fd_reason := 'no_delivery';
    elsif v_fd.max_redemptions is not null and (
            select count(*) from coupon_redemption cr
            join sale s on s.id = cr.sale_id
            where cr.coupon_id = v_fd.id and coalesce(s.status,'') <> 'cancelled'
          ) >= v_fd.max_redemptions then
      v_fd_reason := 'exhausted';
    elsif v_fd.budget_max is not null and (
            select coalesce(sum(cr.discount_amount), 0) from coupon_redemption cr
            join sale s on s.id = cr.sale_id
            where cr.coupon_id = v_fd.id and coalesce(s.status,'') <> 'cancelled'
          ) >= v_fd.budget_max then
      v_fd_reason := 'exhausted';
    elsif v_cust_existing is not null and (
            select count(*) from coupon_redemption cr
            join sale s on s.id = cr.sale_id
            where cr.coupon_id = v_fd.id and cr.customer_id = v_cust_existing
              and coalesce(s.status,'') <> 'cancelled'
          ) >= v_fd.max_per_customer then
      v_fd_reason := 'per_customer';
    end if;

    if v_fd_reason is null then
      v_fd_discount := round(v_delivery, 2);
      v_fd_applied  := true;
    end if;
  end if;

  -- ── PLATO DE REGALO (free_item) en lane propio (línea a 0€) ──
  select * into v_gi
  from coupon
  where account_id = v_acc and active and kind = 'free_item' and paused_at is null and auto_apply
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >  now())
    and 'shop' = any(channels)
    and (weekdays  is null or extract(isodow from (now() at time zone 'Europe/Madrid'))::smallint = any(weekdays))
    and (time_from is null or (now() at time zone 'Europe/Madrid')::time >= time_from)
    and (time_to   is null or (now() at time zone 'Europe/Madrid')::time <= time_to)
    and exists (                               -- ⟵ 3b: solo el regalo de la MARCA del carrito
      select 1 from campaign_scope csc
      join menu_item cmi on cmi.id = csc.menu_item_id
      where csc.coupon_id = coupon.id and cmi.brand_id = v_cart_brand
    )
  order by created_at desc
  limit 1;

  if v_gi.id is not null then
    if v_cust_existing is null and v_email is not null then
      select id into v_cust_existing from customer where account_id = v_acc and lower(email) = v_email limit 1;
    end if;
    if v_cust_existing is null and v_phone is not null then
      select id into v_cust_existing from customer where account_id = v_acc and phone = v_phone limit 1;
    end if;

    select sc.menu_item_id into v_gift_id
    from campaign_scope sc where sc.coupon_id = v_gi.id and sc.menu_item_id is not null limit 1;

    if v_gift_id is not null then
      select mi.name, coalesce(mi.price, 0) into v_gift_name, v_gift_price
      from menu_item mi
      where mi.id = v_gift_id and mi.account_id = v_acc
        and mi.archived_at is null and mi.is_active is not false and mi.is_available is not false;
    end if;

    if v_gift_id is null or v_gift_name is null then
      v_gift_reason := 'gift_unavailable';
    elsif v_gi.min_subtotal is not null and v_subtotal < v_gi.min_subtotal then
      v_gift_reason := 'min';
    elsif v_gi.max_redemptions is not null and (
            select count(*) from coupon_redemption cr join sale s on s.id = cr.sale_id
            where cr.coupon_id = v_gi.id and coalesce(s.status,'') <> 'cancelled'
          ) >= v_gi.max_redemptions then
      v_gift_reason := 'exhausted';
    elsif v_gi.budget_max is not null and (
            select coalesce(sum(cr.discount_amount), 0) from coupon_redemption cr join sale s on s.id = cr.sale_id
            where cr.coupon_id = v_gi.id and coalesce(s.status,'') <> 'cancelled'
          ) >= v_gi.budget_max then
      v_gift_reason := 'exhausted';
    elsif v_cust_existing is not null and (
            select count(*) from coupon_redemption cr join sale s on s.id = cr.sale_id
            where cr.coupon_id = v_gi.id and cr.customer_id = v_cust_existing and coalesce(s.status,'') <> 'cancelled'
          ) >= v_gi.max_per_customer then
      v_gift_reason := 'per_customer';
    end if;

    if v_gift_reason is null then
      v_gift_applied := true;
      v_preview := v_preview || jsonb_build_array(jsonb_build_object(
        'name', v_gift_name, 'quantity', 1, 'unitPrice', 0, 'lineTotal', 0, 'valid', true,
        'offer', jsonb_build_object('kind', 'free_item', 'giftValue', round(v_gift_price, 2))));
    end if;
  end if;

  if v_coupon.id is null and v_fd_applied then
    v_coupon_json := jsonb_build_object(
      'applied', true, 'code', v_fd.code, 'label', v_fd.name, 'discount', 0,
      'reason', null, 'isWelcome', false, 'isFrequency', false, 'freeDelivery', true);
  elsif v_coupon.id is null and v_coupon_code is not null and v_fd.id is not null
        and v_fd.code is not null and lower(v_fd.code) = lower(v_coupon_code) then
    v_coupon_json := jsonb_build_object(
      'applied', false, 'code', v_fd.code, 'label', v_fd.name,
      'reason', v_fd_reason, 'isWelcome', false, 'isFrequency', false, 'freeDelivery', false);
  else
    v_coupon_json := v_coupon_json || jsonb_build_object('freeDelivery', v_fd_applied);
  end if;

  if v_gi.id is not null and v_gift_name is not null then
    v_coupon_json := v_coupon_json || jsonb_build_object('giftItem', jsonb_build_object(
      'name', v_gift_name, 'value', round(v_gift_price, 2),
      'min', v_gi.min_subtotal, 'applied', v_gift_applied, 'reason', v_gift_reason));
  end if;

  v_total := v_subtotal - v_discount - v_fd_discount + v_delivery;

  if p_dry_run then
    return jsonb_build_object(
      'ok', true, 'dryRun', true,
      'subtotal', round(v_subtotal,2),
      'deliveryFee', round(v_delivery,2),
      'discount', round(v_discount + v_fd_discount,2),
      'total', round(v_total,2),
      'lines', v_preview,
      'coupon', v_coupon_json
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
                    sold_at, total, delivery_cost, discount_amount, service_type,
                    status, order_status, platform_order_code, public_token,
                    customer_name, customer_phone, delivery_address, customer_note,
                    expected_time, payment_method, payment_status, dispatch_mode, raw_tab, created_by_name)
  values (v_sale_id, v_acc, v_channel, v_location, 'folvy_shop',
          now(), round(v_total,2), round(v_delivery,2), round(v_discount + v_fd_discount,2), v_service,
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

  if v_gift_applied then
    insert into sale_line (account_id, sale_id, product_name, raw_text, line_type,
                           quantity, unit_price, line_total, menu_item_id,
                           map_source, map_needs_review, unmapped_reason,
                           external_source, external_product_id, external_brand_id)
    values (v_acc, v_sale_id, v_gift_name || ' · Regalo', v_gift_name || ' · Regalo', 'product',
            1, 0, 0, v_gift_id, 'pos', false, null,
            'folvy_shop', v_gift_id::text, (select brand_id::text from menu_item where id = v_gift_id));
  end if;

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

  v_name    := nullif(btrim(p_payload#>>'{customer,name}'), '');
  v_terms   := nullif(p_payload#>>'{consent,termsVersion}', '');

  if v_email is not null or v_phone is not null then
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
      update customer set
        email      = coalesce(email, v_email),
        phone      = coalesce(phone, v_phone),
        name       = coalesce(name, v_name),
        last_seen_at = now(),
        updated_at   = now()
      where id = v_customer;
    end if;

    update sale set customer_id = v_customer where id = v_sale_id;

    if v_consent and v_email is not null then
      insert into customer_consent (customer_id, account_id, marketing_email, updated_at)
      values (v_customer, v_acc, true, now())
      on conflict (customer_id) do update set marketing_email = true, updated_at = now();

      insert into customer_consent_log (customer_id, account_id, action, channel, source, terms_version)
      values (v_customer, v_acc, 'granted', 'email', 'shop', v_terms);
    end if;
  end if;

  if v_customer is not null and v_mode = 'delivery' then
    v_seed_addr := nullif(btrim(p_payload#>>'{delivery,address}'), '');
    if v_seed_addr is not null then
      begin
        update customer_address set
          detail     = coalesce(nullif(btrim(p_payload#>>'{delivery,detail}'),''), detail),
          lat        = coalesce(nullif(p_payload#>>'{delivery,lat}','')::numeric, lat),
          lng        = coalesce(nullif(p_payload#>>'{delivery,lng}','')::numeric, lng),
          updated_at = now()
        where customer_id = v_customer and lower(address) = lower(v_seed_addr);

        if not found then
          insert into customer_address (customer_id, account_id, address, detail, lat, lng, is_default)
          values (v_customer, v_acc, v_seed_addr,
                  nullif(btrim(p_payload#>>'{delivery,detail}'),''),
                  nullif(p_payload#>>'{delivery,lat}','')::numeric,
                  nullif(p_payload#>>'{delivery,lng}','')::numeric,
                  not exists (select 1 from customer_address where customer_id = v_customer));
        end if;
      exception when others then null;
      end;
    end if;
  end if;

  if v_coupon.id is not null and v_discount > 0 then
    if v_is_frequency then
      insert into coupon_redemption (
        coupon_id, account_id, sale_id, customer_id, customer_email, customer_phone,
        discount_amount, reference_subtotal, margin_after, is_cycle)
      values (
        v_coupon.id, v_acc, v_sale_id, v_customer, v_email, v_phone,
        round(v_discount,2), round(v_subtotal,2),
        case when v_cost_has_null then null else round(v_subtotal - v_discount - v_cost_known, 2) end,
        true);
    else
      if v_customer is not null then
        delete from coupon_redemption cr using sale s
        where cr.coupon_id = v_coupon.id and cr.customer_id = v_customer
          and s.id = cr.sale_id and coalesce(s.status,'') = 'cancelled';
      end if;

      begin
        insert into coupon_redemption (
          coupon_id, account_id, sale_id, customer_id, customer_email, customer_phone,
          discount_amount, reference_subtotal, margin_after)
        values (
          v_coupon.id, v_acc, v_sale_id, v_customer, v_email, v_phone,
          round(v_discount,2), round(v_subtotal,2),
          case when v_cost_has_null then null else round(v_subtotal - v_discount - v_cost_known, 2) end);
      exception when unique_violation then
        update sale set discount_amount = round(v_fd_discount,2), total = round(v_subtotal - v_fd_discount + v_delivery, 2)
        where id = v_sale_id;
        v_discount := 0;
        v_total := v_subtotal - v_fd_discount + v_delivery;
        v_coupon_json := jsonb_build_object('applied', false, 'reason', 'per_customer', 'freeDelivery', v_fd_applied);
      end;
    end if;
  end if;

  if v_fd.id is not null and v_fd_discount > 0 then
    begin
      insert into coupon_redemption (
        coupon_id, account_id, sale_id, customer_id, customer_email, customer_phone,
        discount_amount, reference_subtotal, margin_after, is_cycle)
      values (
        v_fd.id, v_acc, v_sale_id, v_customer, v_email, v_phone,
        round(v_fd_discount,2), round(v_subtotal,2), case when v_cost_has_null then null else round(v_subtotal - v_cost_known - v_fd_discount, 2) end, true);
    exception when others then null;
    end;
  end if;

  for v_promo_cid, v_promo_du in
    select key, value::numeric from jsonb_each_text(v_item_promo)
  loop
    if v_promo_du > 0 then
      begin
        insert into coupon_redemption (
          coupon_id, account_id, sale_id, customer_id, customer_email, customer_phone,
          discount_amount, reference_subtotal, margin_after, is_cycle)
        values (
          v_promo_cid::uuid, v_acc, v_sale_id, v_customer, v_email, v_phone,
          round(v_promo_du,2), round(v_subtotal,2), case when v_cost_has_null then null else round(v_subtotal - v_cost_known, 2) end, true);
      exception when others then null;
      end;
    end if;
  end loop;

  if v_gift_applied then
    begin
      insert into coupon_redemption (coupon_id, account_id, sale_id, customer_id, customer_email, customer_phone,
        discount_amount, reference_subtotal, margin_after, is_cycle)
      values (v_gi.id, v_acc, v_sale_id, v_customer, v_email, v_phone,
        round(v_gift_price, 2), round(v_subtotal, 2), case when v_cost_has_null then null else round(v_subtotal - v_cost_known - (select ri.computed_cost + coalesce(mi.packaging_cost, 0) from menu_item mi join recipe_item ri on ri.id = mi.recipe_item_id where mi.id = v_gift_id and ri.computed_cost is not null), 2) end, true);
    exception when others then null;
    end;
  end if;

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
    'discount', round(v_discount + v_fd_discount,2),
    'total', round(v_total,2),
    'coupon', v_coupon_json
  );
end;
$$;
