-- 20260703T2200_coupon_redemption_ignore_cancelled.sql
-- Aplicada: (pendiente)
--
-- F4·FIX — Los canjes de ventas CANCELADAS no consumen el cupón.
--
-- BUG: coupon_redemption se inserta al CREAR el pedido y seguía contando aunque la
-- venta se cancelara luego (pago de Stripe abandonado, o el cron
-- expire_unpaid_shop_orders a los 30 min). Resultado: un comensal que no llega a
-- pagar QUEMABA su bienvenida sin disfrutarla. Regla de negocio (Julio): un canje
-- cuya venta está 'cancelled' NO consume el cupón (ni per_customer ni
-- max_redemptions). El histórico de canjes NO se borra; solo deja de contar lo no
-- cobrado.
--
-- CAMBIO QUIRÚRGICO en DOS funciones (CREATE OR REPLACE, resto IDÉNTICO al texto
-- vivo leído con pg_get_functiondef):
--   place_shop_order:
--     (a) tope total (max_redemptions): count solo de canjes con venta no cancelada.
--     (b) tope por cliente (max_per_customer): idem.
--     (c) NUEVO en el bloque de canje: ANTES del insert, si v_customer no es null,
--         borrar el canje MUERTO (venta cancelada) del mismo cliente para este
--         cupón. El índice único parcial (coupon_id, customer_id) de
--         coupon_redemption NO se toca: sigue cerrando la carrera entre canjes
--         VIVOS. Sin este borrado el fix sería papel mojado: un cliente con canje
--         cancelado previo pasaría la validación pero el INSERT chocaría con el
--         índice y el exception handler degradaría el pedido a SIN descuento. Con
--         el borrado, el canje bueno reemplaza al muerto y el índice sigue
--         protegiendo la carrera entre canjes vivos.
--   customer_coupons (el tarjetero debe contar la MISMA verdad):
--     (a) used[]: solo canjes con venta no cancelada (join sale, mismo filtro).
--     (b) contadores de la cascada (exhausted / per_customer): mismo join+filtro.
--
-- No se prueba en la tx que las crea (verificación desde la app, punto 3).

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- place_shop_order
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
  v_seed_addr  text;               -- F4·T1: dirección a sembrar en customer_address
  -- F3: coste/margen
  v_line_cost    numeric;
  v_line_qty     numeric;
  v_cost_known   numeric := 0;      -- suma de costes de líneas con coste conocido
  v_cost_has_null boolean := false; -- alguna línea sin computed_cost
  -- F3: cupón
  v_coupon_code  text;
  v_coupon       coupon%rowtype;
  v_cust_existing uuid;
  v_discount     numeric := 0;
  v_reason       text := null;      -- por qué NO se aplicó (o null si aplicó)
  v_neto         numeric;
  v_margin_eur   numeric;
  v_margin_pct   numeric;
  v_margin_warn  boolean := false;
  v_floor        numeric;
  v_is_welcome   boolean;
  v_coupon_json  jsonb := jsonb_build_object('applied', false);
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

  -- ── Reprecio + acumulación de coste por línea (F3 sub-paso 2) ──────────
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

    -- Coste de la línea: menu_item(payload) -> recipe_item.computed_cost * qty.
    -- Si el plato no tiene escandallo (computed_cost NULL) -> marca has_null y
    -- NO se suma (no se puede afirmar margen sin coste).
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

  -- ── Cupón: resolución + validación + guardarraíl (F3 sub-paso 3) ───────
  v_coupon_code := nullif(p_payload#>>'{coupon,code}','');
  v_email := lower(nullif(btrim(p_payload#>>'{customer,email}'), ''));
  v_phone := nullif(btrim(p_payload#>>'{customer,phone}'), '');
  -- A2: el consentimiento se necesita YA aquí para decidir si la bienvenida aplica.
  v_consent := coalesce((p_payload#>>'{consent,marketing}')::boolean, false);

  -- Resolver: por código, o el auto_apply activo si no viene código.
  select * into v_coupon
  from coupon
  where account_id = v_acc and active
    and (
      (v_coupon_code is not null and lower(code) = lower(v_coupon_code))
      or (v_coupon_code is null and auto_apply)
    )
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >  now())
  order by (v_coupon_code is not null) desc   -- prioriza el de código si lo hay
  limit 1;

  if v_coupon.id is not null then
    v_is_welcome := v_coupon.first_order_only or v_coupon.auto_apply;

    -- Cliente existente (para primer-pedido y topes por cliente).
    if v_email is not null then
      select id into v_cust_existing from customer
      where account_id = v_acc and lower(email) = v_email limit 1;
    end if;
    if v_cust_existing is null and v_phone is not null then
      select id into v_cust_existing from customer
      where account_id = v_acc and phone = v_phone limit 1;
    end if;

    -- Validaciones (primera que falla fija el motivo).
    if v_coupon.min_subtotal is not null and v_subtotal < v_coupon.min_subtotal then
      v_reason := 'min';
    elsif v_is_welcome and (v_email is null or not v_consent) then
      -- A2: la bienvenida COMPRA el contacto con permiso; sin email+consentimiento
      -- no aplica (cierra la fuga de margen a comensales anónimos).
      v_reason := 'needs_contact';
    elsif v_coupon.first_order_only and v_cust_existing is not null and exists (
            select 1 from sale
            where customer_id = v_cust_existing
              and coalesce(status,'') <> 'cancelled'
          ) then
      v_reason := 'not_first';
    elsif v_coupon.max_redemptions is not null and (
            -- F4·FIX: solo canjes con venta NO cancelada consumen el tope total.
            select count(*) from coupon_redemption cr
            join sale s on s.id = cr.sale_id
            where cr.coupon_id = v_coupon.id and coalesce(s.status,'') <> 'cancelled'
          ) >= v_coupon.max_redemptions then
      v_reason := 'exhausted';
    elsif v_cust_existing is not null and (
            -- F4·FIX: idem para el tope por cliente.
            select count(*) from coupon_redemption cr
            join sale s on s.id = cr.sale_id
            where cr.coupon_id = v_coupon.id and cr.customer_id = v_cust_existing
              and coalesce(s.status,'') <> 'cancelled'
          ) >= v_coupon.max_per_customer then
      v_reason := 'per_customer';
    end if;

    -- Si pasó las validaciones, calcular descuento sobre SUBTOTAL.
    if v_reason is null then
      v_discount := case v_coupon.discount_type
        when 'percent' then round(v_subtotal * v_coupon.value / 100, 2)
        else least(v_coupon.value, v_subtotal) end;
      if v_discount < 0 then v_discount := 0; end if;

      if v_cost_has_null then
        -- Coste incompleto: no se puede afirmar margen -> NO se veta el cupón,
        -- pero se avisa que el margen no es verificable.
        v_margin_warn := true;
      else
        -- Coste completo: guardarraíl de margen.
        v_neto       := v_subtotal - v_discount;         -- el cupón no toca envío
        v_margin_eur := v_neto - v_cost_known;
        v_margin_pct := case when v_neto > 0 then v_margin_eur / v_neto * 100 else null end;
        v_floor      := (select shop_coupon_margin_floor_pct from accounts where id = v_acc);

        if v_floor is not null and v_margin_pct is not null and v_margin_pct < v_floor then
          if v_is_welcome then
            v_margin_warn := true;                        -- bienvenida: avisa pero permite
          else
            v_reason := 'margin';                         -- resto: suelo duro
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
      'isWelcome', v_is_welcome
    );
  end if;

  -- Ajustar total con el descuento (nunca sobre envío).
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

  -- ── Customer + consentimiento (Pata 2) ────────────────────────────────
  -- v_consent ya se calculó arriba (A2). Aquí solo el nombre y la versión de términos.
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
  -- Aditivo y a prueba de fallos: la venta ya existe y está vinculada. Solo con
  -- cliente, modo delivery y address en el payload. Upsert por (customer_id,
  -- lower(address)); la primera dirección del cliente nace como predeterminada.
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
      exception when others then null;   -- jamás tumbar la venta
      end;
    end if;
  end if;

  -- ── Canje del cupón (F3 sub-paso 4) ───────────────────────────────────
  -- Solo si se aplicó descuento. El índice único (coupon_id, customer_id) cierra
  -- la carrera de la bienvenida: si ya existe canje de este cliente, el INSERT
  -- falla; lo capturamos y degradamos el pedido a SIN descuento (revierte total
  -- y discount_amount), nunca abortamos la venta.
  if v_coupon.id is not null and v_discount > 0 then
    -- F4·FIX: borrar el canje MUERTO (venta cancelada) del mismo cliente para
    -- este cupón ANTES del insert. El índice único (coupon_id, customer_id) no se
    -- toca (sigue cerrando la carrera entre canjes VIVOS); esto solo retira un
    -- canje que ya NO consume el cupón, para que el canje bueno pueda ocupar su
    -- lugar. Sin cliente (v_customer null) no hay choque de índice posible.
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
      -- Ya canjeó este cupón (canje VIVO): revertir el descuento en la venta.
      update sale set discount_amount = 0, total = round(v_subtotal + v_delivery, 2)
      where id = v_sale_id;
      v_discount := 0;
      v_total := v_subtotal + v_delivery;
      v_coupon_json := jsonb_build_object('applied', false, 'reason', 'per_customer');
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
    'discount', round(v_discount,2),
    'total', round(v_total,2),
    'coupon', v_coupon_json
  );
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- customer_coupons  (misma verdad en el tarjetero)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.customer_coupons(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_customer   uuid;
  v_acc        uuid;
  v_has_consent boolean;
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

  return jsonb_build_object(
    'ok', true,

    -- ── Usados ──────────────────────────────────────────────────────────
    -- F4·FIX: solo canjes con venta NO cancelada cuentan como "usado".
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
    ), '[]'::jsonb),

    -- ── Disponibles (cascada calcada de place_shop_order, sin 'min') ─────
    'available', coalesce((
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
                 -- F4·FIX: solo canjes con venta no cancelada consumen el tope.
                 select count(*) from coupon_redemption cr
                 join sale s on s.id = cr.sale_id
                 where cr.coupon_id = c.id and coalesce(s.status,'') <> 'cancelled'
               ) >= c.max_redemptions
            then 'exhausted'
          when (
                 -- F4·FIX: idem para el tope por cliente.
                 select count(*) from coupon_redemption cr
                 join sale s on s.id = cr.sale_id
                 where cr.coupon_id = c.id and cr.customer_id = v_customer
                   and coalesce(s.status,'') <> 'cancelled'
               ) >= c.max_per_customer
            then 'per_customer'
          else null
        end as reason
      ) r
      where c.account_id = v_acc and c.active
        and (c.starts_at is null or c.starts_at <= now())
        and (c.ends_at   is null or c.ends_at   >  now())
        and r.reason is distinct from 'per_customer'   -- los usados por tope viven en used[]
    ), '[]'::jsonb)
  );
end;
$function$;

commit;
