-- 20260702T1000_shop_order_status_expand.sql
-- Aplicada: (pendiente)
--
-- SEGUIMIENTO DEL PEDIDO (pieza 3). Amplía shop_order_status(p_token) para que
-- la página de seguimiento del cliente pinte una pantalla rica CON MARCA sin
-- llamadas extra: además del estado, devuelve marca (nombre/logo/color),
-- líneas de producto y la dirección a mostrar según el modo.
--
-- Sigue siendo lectura ANÓNIMA por token no adivinable (canal público del Shop),
-- SECURITY DEFINER, y expone SOLO lo que es del propio pedido del cliente: nada
-- de teléfono del rider, ni datos de otros pedidos, ni raw_tab.
--
-- Fuentes (verificadas en el schema real):
--   · marca: brand.logo_url + brand.name; color = shop_theme.accent_color
--     (por brand_id; si el pedido es multimarca -> brand_id NULL -> tema del hub,
--      shop_theme del account con brand_id NULL). brand.color es de cocina/tickets,
--      NO se usa aquí (el front público usa accent_color).
--   · líneas: sale_line, solo producto (coalesce(line_type,'product')='product'
--     AND parent_sale_line_id IS NULL) — mismo criterio que orders_feed.
--   · dirección: domicilio -> sale.delivery_address; recogida -> locations.address
--     (+ locations.name) por sale.location_id.
--
-- DDL: aplicar tal cual, sin BEGIN/COMMIT y sin SELECT de prueba (SECURITY
-- DEFINER -> auth.uid() null en el SQL Editor; se verifica desde la app).

create or replace function public.shop_order_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s          sale%rowtype;
  v_bname    text;
  v_logo     text;
  v_accent   text;
  v_addr     text;
  v_locname  text;
  v_lines    jsonb;
begin
  select * into s
  from sale
  where public_token = nullif(btrim(coalesce(p_token,'')), '')
    and source = 'folvy_shop'
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Marca: nombre + logo (si el pedido es de una sola marca).
  if s.brand_id is not null then
    select b.name, b.logo_url into v_bname, v_logo from brand b where b.id = s.brand_id;
    select st.accent_color into v_accent from shop_theme st where st.brand_id = s.brand_id limit 1;
  end if;
  -- Color: si no hay tema de marca, cae al tema del hub (account, brand_id NULL).
  if v_accent is null then
    select st.accent_color into v_accent
    from shop_theme st
    where st.account_id = s.account_id and st.brand_id is null
    limit 1;
  end if;

  -- Dirección a mostrar según el modo.
  if s.service_type = 'pickup' then
    select l.name, l.address into v_locname, v_addr from locations l where l.id = s.location_id;
  else
    v_addr := s.delivery_address;
  end if;

  -- Líneas de producto (sin modificadores ni componentes de combo).
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'name', sl.product_name,
             'quantity', sl.quantity,
             'lineTotal', coalesce(sl.line_total, sl.unit_price * sl.quantity)
           ) order by sl.id
         ), '[]'::jsonb)
  into v_lines
  from sale_line sl
  where sl.sale_id = s.id
    and coalesce(sl.line_type, 'product') = 'product'
    and sl.parent_sale_line_id is null;

  return jsonb_build_object(
    'ok',            true,
    'code',          s.platform_order_code,
    'orderStatus',   s.order_status,
    'paymentStatus', s.payment_status,
    'payMethod',     s.payment_method,
    'mode',          case when s.service_type = 'pickup' then 'pickup' else 'delivery' end,
    'total',         s.total,
    'deliveryFee',   s.delivery_cost,
    'paidAt',        s.paid_at,
    'deliveryState', s.delivery_state,
    'etaAt',         coalesce(s.eta_delivery, s.eta_pickup),
    'riderName',     s.rider_name,
    'brand',         jsonb_build_object('name', v_bname, 'logoUrl', v_logo, 'accentColor', v_accent),
    'address',       v_addr,
    'locationName',  v_locname,
    'lines',         v_lines
  );
end;
$function$;

revoke all on function public.shop_order_status(text) from public;
grant execute on function public.shop_order_status(text) to anon, authenticated;
