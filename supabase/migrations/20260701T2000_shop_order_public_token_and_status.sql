-- 20260701T2000_shop_order_public_token_and_status.sql
-- Aplicada: (pendiente)
--
-- CONFIRMACIÓN VERAZ DEL FOLVY SHOP (pilar 0 del frente post-compra).
--
-- Problema que resuelve: la pantalla de confirmación del checkout se fiaba de
-- señales del cliente (que confirmPayment no diera error, o el redirect_status
-- que Stripe pone en la URL de vuelta). En métodos ASÍNCRONOS con redirección
-- (Bizum), esa señal NO es la verdad del pago: puede volver 'succeeded' mientras
-- el pago real se resuelve después y acaba en 'failed'. Resultado: un pago
-- rechazado mostrando "¡Pedido confirmado!" -> el cliente se planta a recoger y
-- cocina nunca recibió nada.
--
-- Solución: el front pasa a LEER el estado real de la venta (payment_status /
-- order_status escritos por el webhook). Para poder hacerlo desde un canal
-- ANÓNIMO sin filtrar pedidos ajenos, la lectura va por un TOKEN no adivinable
-- propio del pedido (no por el UUID interno ni por el código FS… correlativo).
--
-- Tres piezas:
--   1) sale.public_token  (aleatorio, único, indexado).
--   2) place_shop_order    -> genera y devuelve el token (publicToken).
--   3) shop_order_status(p_token) -> RPC read-only, GRANT anon, expone SOLO el
--      estado mínimo (nada de cliente/dirección/raw_tab/líneas).
--
-- NOTA operativa: place_shop_order y shop_order_status son SECURITY DEFINER ->
-- NO se prueban en el SQL Editor (auth.uid() null); se verifican desde la app.
-- Este fichero es DDL: aplicar tal cual, sin BEGIN/COMMIT y sin SELECT de prueba
-- que llame a las funciones dentro de la misma tanda.


-- ─────────────────────────────────────────────────────────────────────
-- 1) Columna del token del pedido (llave pública, no adivinable)
-- ─────────────────────────────────────────────────────────────────────
alter table sale add column if not exists public_token text;

create unique index if not exists sale_public_token_uq
  on sale (public_token)
  where public_token is not null;


-- ─────────────────────────────────────────────────────────────────────
-- 2) place_shop_order: genera y devuelve public_token
--    (reproducida entera; lo NUEVO es v_token, la columna en el insert y
--     'publicToken' en el retorno)
-- ─────────────────────────────────────────────────────────────────────
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
  -- Token público del pedido: 64 hex (~244 bits de aleatoriedad), no adivinable.
  -- Es la ÚNICA llave con la que el cliente anónimo puede leer el estado de SU
  -- pedido; el código FS… es solo cosmético (nunca sirve para leer estado).
  v_token   := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');

  -- Nace SIEMPRE en 'new'. Si es efectivo, abajo se promueve a 'accepted' con un
  -- UPDATE (que SÍ dispara los triggers AFTER UPDATE de impresión + Catcher).
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

  -- EFECTIVO: se acepta automáticamente. El UPDATE new->accepted dispara
  -- impresión + Catcher por los triggers AFTER UPDATE existentes.
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


-- ─────────────────────────────────────────────────────────────────────
-- 3) shop_order_status(p_token): lectura anónima del estado del pedido
--    read-only, expone SOLO el mínimo. Sin cliente/dirección/raw_tab/líneas.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.shop_order_status(p_token text)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  select case
    when s.id is null then jsonb_build_object('ok', false, 'reason', 'not_found')
    else jsonb_build_object(
      'ok',            true,
      'code',          s.platform_order_code,
      'orderStatus',   s.order_status,
      'paymentStatus', s.payment_status,
      'payMethod',     s.payment_method,
      'mode',          case when s.service_type = 'pickup' then 'pickup' else 'delivery' end,
      'total',         s.total,
      'paidAt',        s.paid_at,
      'deliveryState', s.delivery_state,
      'etaAt',         coalesce(s.eta_delivery, s.eta_pickup),
      'riderName',     s.rider_name
    )
  end
  from (select nullif(btrim(coalesce(p_token,'')), '') as t) q
  left join sale s
    on s.public_token = q.t
   and s.source = 'folvy_shop';
$function$;

revoke all on function public.shop_order_status(text) from public;
grant execute on function public.shop_order_status(text) to anon, authenticated;
