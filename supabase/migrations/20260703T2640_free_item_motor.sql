-- 20260703T2640_free_item_motor.sql
-- Aplicada: (pendiente)
--
-- G2c sub-lote B2 — MOTOR free_item (plato de regalo) en place_shop_order.
-- CONFIRMADO por Julio: el regalo es una LÍNEA A 0€ (la cocina la ve y la prepara;
-- un regalo que la cocina no ve = cliente enfadado). Requiere 2630 (gestor) + 2600.
--
-- Vía FIEL sin transcribir la función de cobro de 23k: la migración REGENERA
-- place_shop_order desde su texto VIVO (pg_get_functiondef) e inserta la lane con
-- replace() anclados en strings únicos (verificados count=1). Guardas: si un ancla
-- no aparece, ABORTA (no hace un merge silencioso a medias). Idempotente: si la
-- lane ya está, no hace nada.
--
-- Qué añade la lane free_item (patrón free_delivery + item_promo):
--   * Resuelve el cupón free_item (auto, ventana/franja) y su plato regalado (scope
--     = 1 item) y precio de hoy.
--   * Aplica si v_subtotal (sin el regalo) >= min + presupuesto + max_redemptions +
--     per_customer. Corre antes del return de dry-run -> el preview lleva la línea
--     del regalo a 0€ (el checkout la pinta).
--   * En la venta real: inserta la sale_line del regalo a 0€ (line_type='product',
--     "· Regalo") tras adapt_folvy_shop_order, para que compute_sale_line_cost y la
--     cocina la vean.
--   * Canje: coupon_redemption is_cycle, discount_amount = precio del regalo ->
--     presupuesto por suma de canjes vivos.
--   * coupon_json.giftItem {name, value, min, applied, reason} para el front (barrita).
--   El TOTAL no cambia (la línea del regalo es 0€).
--
-- No se prueba en la tx que la crea.

begin;

do $mig$
declare
  v_def text;
  v_b   text;
begin
  v_def := pg_get_functiondef('public.place_shop_order(text, jsonb, boolean)'::regprocedure);

  if position('G2c B2: PLATO DE REGALO' in v_def) > 0 then
    raise notice 'B2: la lane free_item ya está presente; nada que hacer.';
    return;
  end if;

  -- (1) Declaraciones.
  v_b := v_def;
  v_def := replace(v_def,
$a1$  v_fd_discount  numeric := 0;$a1$,
$r1$  v_fd_discount  numeric := 0;
  v_gi           coupon%rowtype;
  v_gift_id      uuid;
  v_gift_price   numeric := 0;
  v_gift_name    text;
  v_gift_reason  text;
  v_gift_applied boolean := false;$r1$);
  if v_def = v_b then raise exception 'B2: ancla 1 (declaraciones) no encontrada'; end if;

  -- (2) Lane free_item (antes del coupon_json; corre en dry-run y real).
  v_b := v_def;
  v_def := replace(v_def,
$a2$  -- coupon_json: refleja el cupón de subtotal + la marca de envío gratis.$a2$,
$r2$  -- ── G2c B2: PLATO DE REGALO (free_item) en lane propio (línea a 0€) ──────────
  select * into v_gi
  from coupon
  where account_id = v_acc and active and kind = 'free_item' and paused_at is null and auto_apply
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >  now())
    and 'shop' = any(channels)
    and (weekdays  is null or extract(isodow from (now() at time zone 'Europe/Madrid'))::smallint = any(weekdays))
    and (time_from is null or (now() at time zone 'Europe/Madrid')::time >= time_from)
    and (time_to   is null or (now() at time zone 'Europe/Madrid')::time <= time_to)
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

  -- coupon_json: refleja el cupón de subtotal + la marca de envío gratis.$r2$);
  if v_def = v_b then raise exception 'B2: ancla 2 (lane) no encontrada'; end if;

  -- (3) Marca del regalo en coupon_json (para el front / barrita), aplique o no.
  v_b := v_def;
  v_def := replace(v_def,
$a3$  -- Total: subtotal - descuento subtotal - envío gratis + envío.$a3$,
$r3$  if v_gi.id is not null and v_gift_name is not null then
    v_coupon_json := v_coupon_json || jsonb_build_object('giftItem', jsonb_build_object(
      'name', v_gift_name, 'value', round(v_gift_price, 2),
      'min', v_gi.min_subtotal, 'applied', v_gift_applied, 'reason', v_gift_reason));
  end if;

  -- Total: subtotal - descuento subtotal - envío gratis + envío.$r3$);
  if v_def = v_b then raise exception 'B2: ancla 3 (coupon_json) no encontrada'; end if;

  -- (4) Venta real: línea del regalo a 0€ tras adapt (la cocina la prepara).
  v_b := v_def;
  v_def := replace(v_def,
$a4$  perform public.adapt_folvy_shop_order(v_sale_id);$a4$,
$r4$  perform public.adapt_folvy_shop_order(v_sale_id);

  if v_gift_applied then
    insert into sale_line (account_id, sale_id, product_name, raw_text, line_type,
                           quantity, unit_price, line_total, menu_item_id,
                           map_source, map_needs_review, unmapped_reason,
                           external_source, external_product_id, external_brand_id)
    values (v_acc, v_sale_id, v_gift_name || ' · Regalo', v_gift_name || ' · Regalo', 'product',
            1, 0, 0, v_gift_id, 'pos', false, null,
            'folvy_shop', v_gift_id::text, (select brand_id::text from menu_item where id = v_gift_id));
  end if;$r4$);
  if v_def = v_b then raise exception 'B2: ancla 4 (sale_line del regalo) no encontrada'; end if;

  -- (5) Canje del regalo (is_cycle; discount_amount = precio del regalo -> presupuesto).
  v_b := v_def;
  v_def := replace(v_def,
$a5$  if v_is_cash then$a5$,
$r5$  if v_gift_applied then
    begin
      insert into coupon_redemption (coupon_id, account_id, sale_id, customer_id, customer_email, customer_phone,
        discount_amount, reference_subtotal, margin_after, is_cycle)
      values (v_gi.id, v_acc, v_sale_id, v_customer, v_email, v_phone,
        round(v_gift_price, 2), round(v_subtotal, 2), null, true);
    exception when others then null;
    end;
  end if;

  if v_is_cash then$r5$);
  if v_def = v_b then raise exception 'B2: ancla 5 (canje del regalo) no encontrada'; end if;

  execute v_def;
  raise notice 'B2: lane free_item insertada en place_shop_order.';
end
$mig$;

commit;
