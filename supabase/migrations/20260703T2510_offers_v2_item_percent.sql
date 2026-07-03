-- 20260703T2510_offers_v2_item_percent.sql
-- Aplicada: (pendiente)
--
-- G2a+ Ofertas v2 — LOTE 1, SECCIÓN 2 (MOTOR item_percent). Requiere 20260703T2500.
-- Base = texto VIVO (pg_get_functiondef) de _shop_reprice_line, place_shop_order,
-- shop_brand_menu_by_slug, customer_coupons, list_campaigns. Cambios QUIRÚRGICOS.
--
--   _shop_item_offer(account, item, price) [NUEVO]: resuelve la campaña item_percent
--     más específica (plato > categoría > marca) activa, en ventana + franja
--     (Europe/Madrid) + canal 'shop' + presupuesto no agotado, y devuelve la oferta
--     {campaignId, pct, discountedPrice, discountUnit, wasPrice}. wasPrice = ref
--     Ómnibus (min 30d) SOLO si ref > precio con dto. (tachado legal); si no, NULL.
--   _shop_reprice_line: tras resolver el precio vigente, aplica la oferta y la
--     devuelve en el jsonb de línea.
--   place_shop_order: acumula el descuento item_percent por campaña y registra UN
--     canje POR VENTA (is_cycle=true, exento del único por cliente) para el
--     presupuesto. NO toca sale.total/discount_amount (ya viene en el precio de línea).
--   shop_brand_menu_by_slug: devuelve offer por producto (para el escaparate).
--   customer_coupons: excluye item_percent del tarjetero (es oferta de carta).
--   list_campaigns: estado 'exhausted' si budget_max alcanzado + expone budget/franja.
--
-- No se prueba en la tx que la crea.

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- _shop_item_offer  (resolución + Ómnibus; fuente única para carta y checkout)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._shop_item_offer(p_account uuid, p_menu_item_id uuid, p_price numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_cat    uuid;
  v_brand  uuid;
  v_camp   coupon%rowtype;
  v_disc   numeric;
  v_ref    numeric;
  v_nowmad timestamp;
begin
  if p_price is null or p_price <= 0 then return null; end if;

  select menu_category_id, brand_id into v_cat, v_brand from menu_item where id = p_menu_item_id;
  v_nowmad := (now() at time zone 'Europe/Madrid');

  select c.* into v_camp
  from coupon c
  where c.account_id = p_account and c.active and c.kind = 'item_percent' and c.paused_at is null
    and (c.starts_at is null or c.starts_at <= now())
    and (c.ends_at   is null or c.ends_at   >  now())
    and 'shop' = any(c.channels)
    and (c.weekdays  is null or extract(isodow from v_nowmad)::smallint = any(c.weekdays))
    and (c.time_from is null or v_nowmad::time >= c.time_from)
    and (c.time_to   is null or v_nowmad::time <= c.time_to)
    and (c.budget_max is null or (
          select coalesce(sum(cr.discount_amount), 0) from coupon_redemption cr
          join sale s on s.id = cr.sale_id
          where cr.coupon_id = c.id and coalesce(s.status,'') <> 'cancelled'
        ) < c.budget_max)
    and exists (
      select 1 from campaign_scope sc
      where sc.coupon_id = c.id
        and (sc.menu_item_id = p_menu_item_id or sc.menu_category_id = v_cat or sc.brand_id = v_brand)
    )
  order by (
    case
      when exists (select 1 from campaign_scope sc where sc.coupon_id = c.id and sc.menu_item_id = p_menu_item_id) then 3
      when exists (select 1 from campaign_scope sc where sc.coupon_id = c.id and sc.menu_category_id = v_cat) then 2
      else 1
    end) desc, c.value desc
  limit 1;

  if v_camp.id is null then return null; end if;

  v_disc := round(p_price * (1 - v_camp.value / 100.0), 2);
  v_ref  := public.omnibus_ref_price(p_menu_item_id);

  return jsonb_build_object(
    'campaignId',      v_camp.id,
    'pct',             v_camp.value,
    'discountedPrice', v_disc,
    'discountUnit',    round(p_price - v_disc, 2),
    'wasPrice',        case when v_ref is not null and v_ref > v_disc then v_ref else null end
  );
end;
$fn$;

grant execute on function public._shop_item_offer(uuid, uuid, numeric) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- _shop_reprice_line  (+ oferta item_percent sobre el precio vigente)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._shop_reprice_line(p_account_id uuid, p_line jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mi          menu_item%rowtype;
  v_unit        numeric;
  v_qty         numeric;
  v_m           jsonb;
  v_c           jsonb;
  v_opt_impact  numeric;
  v_cso_impact  numeric;
  v_offer       jsonb;              -- G2a: oferta item_percent (o NULL)
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

  -- G2a: oferta item_percent sobre el precio vigente (base + mods). Fuente única.
  v_offer := public._shop_item_offer(p_account_id, v_mi.id, v_unit);
  if v_offer is not null then
    v_unit := (v_offer->>'discountedPrice')::numeric;
  end if;

  return jsonb_build_object(
    'menuItemId', v_mi.id,
    'name', v_mi.name,
    'brandId', v_mi.brand_id,
    'valid', true,
    'unitPrice', round(v_unit, 2),
    'quantity', v_qty,
    'lineTotal', round(v_unit * v_qty, 2),
    'offer', v_offer
  );
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- place_shop_order  (+ registro de presupuesto item_percent por VENTA)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.place_shop_order(p_slug text, p_payload jsonb, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- G2a: presupuesto item_percent
  v_item_promo   jsonb := '{}'::jsonb;   -- campaignId(text) -> € descontado en esta venta
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

  -- ── Reprecio + coste + acumulación de presupuesto item_percent ─────────
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

    -- G2a: acumular el descuento item_percent por campaña (para el presupuesto).
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

  -- ── Cupón: resolución + validación + guardarraíl ───────────────────────
  v_coupon_code := nullif(p_payload#>>'{coupon,code}','');
  v_email := lower(nullif(btrim(p_payload#>>'{customer,email}'), ''));
  v_phone := nullif(btrim(p_payload#>>'{customer,phone}'), '');
  v_consent := coalesce((p_payload#>>'{consent,marketing}')::boolean, false);

  select * into v_coupon
  from coupon
  where account_id = v_acc and active
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

  -- ── F4·T3: cupón por FRECUENCIA (aditivo; solo sin código) ─────────────
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

  v_total := v_subtotal - v_discount + v_delivery;

  -- ── Dry-run: previsualización (no persiste) ───────────────────────────
  if p_dry_run then
    return jsonb_build_object(
      'ok', true, 'dryRun', true,
      'subtotal', round(v_subtotal,2),
      'deliveryFee', round(v_delivery,2),
      'discount', round(v_discount,2),
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
          now(), round(v_total,2), round(v_delivery,2), round(v_discount,2), v_service,
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

  -- ── Customer + consentimiento ─────────────────────────────────────────
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

  -- ── F4·T1: SIEMBRA SILENCIOSA de dirección ────────────────────────────
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

  -- ── Canje del cupón ───────────────────────────────────────────────────
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
        update sale set discount_amount = 0, total = round(v_subtotal + v_delivery, 2)
        where id = v_sale_id;
        v_discount := 0;
        v_total := v_subtotal + v_delivery;
        v_coupon_json := jsonb_build_object('applied', false, 'reason', 'per_customer');
      end;
    end if;
  end if;

  -- ── G2a: presupuesto item_percent — UN canje POR VENTA por campaña ──────
  -- No toca sale.total/discount_amount (el precio de línea ya viene rebajado). Es
  -- solo contabilidad de presupuesto. is_cycle=true → exento del único por cliente.
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
          round(v_promo_du,2), round(v_subtotal,2), null, true);
      exception when others then null;
      end;
    end if;
  end loop;

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
    'discount', round(v_discount,2),
    'total', round(v_total,2),
    'coupon', v_coupon_json
  );
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- shop_brand_menu_by_slug  (+ offer por producto para el escaparate)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.shop_brand_menu_by_slug(p_slug text, p_brand_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id uuid;
  v_brand record;
  v_cats jsonb;
  v_is_open boolean;
  v_location_ids jsonb;
begin
  select id into v_account_id from accounts where slug = p_slug;
  if v_account_id is null then
    return null;
  end if;
  select b.id, b.name, b.logo_url, b.cuisine_code,
         st.accent_color, st.hero_url, st.seed_rating, st.seed_rating_count
    into v_brand
  from brand b
  join shop_theme st on st.brand_id = b.id
  where b.id = p_brand_id
    and b.account_id = v_account_id
    and st.hub_visible = true
    and st.is_published = true;
  if v_brand.id is null then
    return null;
  end if;
  select coalesce(jsonb_agg(distinct bla.location_id), '[]'::jsonb)
    into v_location_ids
  from brand_location_availability bla
  where bla.brand_id = p_brand_id and bla.is_active = true;
  select exists (
    select 1 from brand_location_availability bla
    where bla.brand_id = p_brand_id
      and bla.is_active = true
      and is_brand_open(bla.location_id, p_brand_id)
  ) into v_is_open;
  select coalesce(jsonb_agg(cat order by cat.position nulls last, cat.name), '[]'::jsonb)
  into v_cats
  from (
    select c.id, c.name, c.emoji, c.position,
           coalesce(jsonb_agg(
             jsonb_build_object(
               'id', mi.id,
               'name', mi.name,
               'description', mi.description,
               'photo_url', mi.photo_url,
               'price', mi.price,
               'product_type', mi.product_type,
               'offer', public._shop_item_offer(v_account_id, mi.id, mi.price)
             ) order by mi.position nulls last, mi.name
           ) filter (where mi.id is not null), '[]'::jsonb) as products
    from menu_category c
    join menu_item mi
      on mi.menu_category_id = c.id
     and mi.account_id = v_account_id
     and mi.brand_id = p_brand_id
     and mi.is_active is not false
     and mi.is_available is not false
     and mi.archived_at is null
    where c.account_id = v_account_id
      and c.brand_id = p_brand_id
    group by c.id, c.name, c.emoji, c.position
    having count(mi.id) > 0
  ) cat;
  return jsonb_build_object(
    'brand_id', v_brand.id,
    'name', v_brand.name,
    'logo_url', v_brand.logo_url,
    'accent_color', v_brand.accent_color,
    'hero_url', v_brand.hero_url,
    'cuisine_code', v_brand.cuisine_code,
    'rating', v_brand.seed_rating,
    'rating_count', v_brand.seed_rating_count,
    'is_open', v_is_open,
    'location_ids', v_location_ids,
    'categories', v_cats
  );
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- customer_coupons  (excluir item_percent del tarjetero)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.customer_coupons(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_customer    uuid;
  v_acc         uuid;
  v_has_consent boolean;
  v_freq        coupon%rowtype;
  v_progress    integer := 0;
  v_available   jsonb;
  v_progress_json jsonb;
begin
  select customer_id, account_id into v_customer, v_acc
  from customer_session
  where token = nullif(btrim(p_token),'') and revoked_at is null and expires_at > now()
  limit 1;
  if v_customer is null then
    return jsonb_build_object('ok', false, 'reason', 'session');
  end if;

  select marketing_email into v_has_consent from customer_consent where customer_id = v_customer;
  v_has_consent := coalesce(v_has_consent, false);

  select * into v_freq
  from coupon
  where account_id = v_acc and active and kind = 'frequency'
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >  now())
  limit 1;

  if v_freq.id is not null and v_freq.frequency_threshold is not null then
    select count(*) into v_progress
    from sale s
    where s.customer_id = v_customer and s.source = 'folvy_shop'
      and coalesce(s.status,'') <> 'cancelled'
      and s.created_at > coalesce((
        select max(cr.ts) from coupon_redemption cr
        join sale cs on cs.id = cr.sale_id
        where cr.coupon_id = v_freq.id and cr.customer_id = v_customer
          and coalesce(cs.status,'') <> 'cancelled'
      ), '-infinity'::timestamptz);
  end if;

  -- Disponibles: cascada estándar. Se EXCLUYEN frecuencia (tarjeta propia) e
  -- item_percent (es oferta de CARTA, no un bono de tarjetero).
  v_available := coalesce((
    select jsonb_agg(jsonb_build_object(
             'couponId',      c.id,
             'name',          c.name,
             'code',          c.code,
             'discountType',  c.discount_type,
             'discountValue', c.value,
             'minSubtotal',   c.min_subtotal,
             'endsAt',        c.ends_at,
             'autoApply',     c.auto_apply,
             'isWelcome',     (c.first_order_only or c.auto_apply),
             'isFrequency',   false,
             'eligible',      (r.reason is null),
             'reason',        r.reason)
           order by (r.reason is null) desc, c.created_at)
    from coupon c
    cross join lateral (
      select case
        when (c.first_order_only or c.auto_apply) and not v_has_consent
          then 'needs_consent'
        when c.first_order_only and exists (
               select 1 from sale s
               where s.customer_id = v_customer and coalesce(s.status,'') <> 'cancelled'
             )
          then 'not_first'
        when c.max_redemptions is not null and (
               select count(*) from coupon_redemption cr
               join sale s on s.id = cr.sale_id
               where cr.coupon_id = c.id and coalesce(s.status,'') <> 'cancelled'
             ) >= c.max_redemptions
          then 'exhausted'
        when (
               select count(*) from coupon_redemption cr
               join sale s on s.id = cr.sale_id
               where cr.coupon_id = c.id and cr.customer_id = v_customer
                 and coalesce(s.status,'') <> 'cancelled'
             ) >= c.max_per_customer
          then 'per_customer'
        else null
      end as reason
    ) r
    where c.account_id = v_acc and c.active and c.kind not in ('frequency','item_percent')
      and (c.starts_at is null or c.starts_at <= now())
      and (c.ends_at   is null or c.ends_at   >  now())
      and r.reason is distinct from 'per_customer'
  ), '[]'::jsonb);

  if v_freq.id is not null and v_freq.frequency_threshold is not null
     and v_progress >= v_freq.frequency_threshold then
    v_available := jsonb_build_array(jsonb_build_object(
      'couponId',      v_freq.id,
      'name',          v_freq.name,
      'code',          v_freq.code,
      'discountType',  v_freq.discount_type,
      'discountValue', v_freq.value,
      'minSubtotal',   v_freq.min_subtotal,
      'endsAt',        v_freq.ends_at,
      'autoApply',     false,
      'isWelcome',     false,
      'isFrequency',   true,
      'eligible',      true,
      'reason',        null
    )) || v_available;
  end if;

  v_progress_json := case
    when v_freq.id is null or v_freq.frequency_threshold is null then jsonb_build_object('active', false)
    else jsonb_build_object(
      'active',    true,
      'threshold', v_freq.frequency_threshold,
      'current',   least(v_progress, v_freq.frequency_threshold),
      'reward',    jsonb_build_object('discountType', v_freq.discount_type, 'discountValue', v_freq.value, 'name', v_freq.name),
      'earned',    v_progress >= v_freq.frequency_threshold)
  end;

  return jsonb_build_object(
    'ok', true,
    'used', coalesce((
      select jsonb_agg(jsonb_build_object(
               'couponId',       c.id,
               'name',           c.name,
               'code',           c.code,
               'discountType',   c.discount_type,
               'discountValue',  c.value,
               'discountAmount', cr.discount_amount,
               'ts',             cr.ts)
             order by cr.ts desc)
      from coupon_redemption cr
      join coupon c on c.id = cr.coupon_id
      join sale s on s.id = cr.sale_id
      where cr.customer_id = v_customer and coalesce(s.status,'') <> 'cancelled'
        and c.kind not in ('item_percent')
    ), '[]'::jsonb),
    'available', v_available,
    'progress', v_progress_json
  );
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- list_campaigns  (+ estado 'exhausted' por presupuesto + franja/budget en salida)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.list_campaigns(p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (p_account = any(current_user_account_ids())) then
    raise exception 'forbidden';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',                 c.id,
             'name',               c.name,
             'code',               c.code,
             'kind',               c.kind,
             'discountType',       c.discount_type,
             'value',              c.value,
             'minSubtotal',        c.min_subtotal,
             'firstOrderOnly',     c.first_order_only,
             'autoApply',          c.auto_apply,
             'frequencyThreshold', c.frequency_threshold,
             'startsAt',           c.starts_at,
             'endsAt',             c.ends_at,
             'maxRedemptions',     c.max_redemptions,
             'maxPerCustomer',     c.max_per_customer,
             'active',             c.active,
             'pausedAt',           c.paused_at,
             'origin',             c.origin,
             'budgetMax',          c.budget_max,
             'weekdays',           c.weekdays,
             'timeFrom',           c.time_from,
             'timeTo',             c.time_to,
             'channels',           c.channels,
             'status', case
               when c.paused_at is not null then 'paused'
               when not c.active then 'paused'
               when c.ends_at is not null and c.ends_at <= now() then 'expired'
               when c.budget_max is not null and coalesce(p.sum_disc, 0) >= c.budget_max then 'exhausted'
               when c.starts_at is not null and c.starts_at > now() then 'scheduled'
               else 'active' end,
             'isSystem', (c.kind = 'frequency' or c.auto_apply or c.first_order_only),
             'redemptions',  coalesce(p.n, 0),
             'discounted',   coalesce(p.sum_disc, 0),
             'avgMarginPct', p.avg_margin_pct
           )
           order by (c.kind = 'frequency' or c.auto_apply or c.first_order_only) desc, c.created_at desc)
    from coupon c
    cross join lateral (
      select count(*) as n,
             sum(cr.discount_amount) as sum_disc,
             round(avg(cr.margin_after / nullif(cr.reference_subtotal - cr.discount_amount, 0))
                     filter (where cr.margin_after is not null) * 100, 1) as avg_margin_pct
      from coupon_redemption cr
      join sale s on s.id = cr.sale_id
      where cr.coupon_id = c.id and coalesce(s.status,'') <> 'cancelled'
    ) p
    where c.account_id = p_account
  ), '[]'::jsonb);
end;
$function$;

commit;
