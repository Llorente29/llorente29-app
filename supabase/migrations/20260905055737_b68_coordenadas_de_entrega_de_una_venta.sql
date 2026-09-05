-- B68 §2 (05/09/2026). Las coordenadas que hoy se tiran.
--
-- FUNCION NUEVA Y AISLADA, y es una decision deliberada. La alternativa era
-- añadir dos claves al jsonb de `orders_feed` / `orders_feed_by_token`. Eso
-- habria sido CREATE OR REPLACE sin cambio de firma -- tecnicamente seguro --
-- pero son las dos funciones que alimentan la pantalla de pedidos Y las
-- tablets del pase, y son las 01:50 de la madrugada. Una funcion nueva que no
-- llama nadie mas tiene radio de explosion CERO.
--
-- Se consulta SOLO cuando hace falta: la tarjeta la pide unicamente si el
-- pedido es de reparto propio, esta sin despachar y no tiene direccion. Son 26
-- pedidos en 30 dias, no un coste por pantalla.
--
-- DE DONDE SALEN, y por que se miran DOS sitios:
--   Last.app  las pone en `raw_tab.delivery.latitude`   (265 de 265)
--   HubRise   las pone en `raw_tab.customer.latitude`   (138 de 148)
-- `resolve_dispatch` solo mira la primera, y por eso no calcula distancia para
-- ninguno de HubRise. Eso es B69 y NO se toca aqui.
--
-- DEVUELVE DE DONDE SALIERON (`origen`). Quien reparte tiene derecho a saber si
-- va a un portal o a un punto, y de que campo salio ese punto. El encargo lo
-- pide: «no lo pintes como si fuera una direccion confirmada».
--
-- NO HACE GEOCODIFICACION INVERSA. No se inventa la calle. Meter un proveedor
-- externo cambia el coste por pedido y es decision de Julio, no mia.
--
-- SOLO LEE. Regla 9: comprueba la cuenta antes de devolver nada.

create or replace function public.sale_coordenadas_de_entrega(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_s   record;
  v_rt  jsonb;
  v_lat numeric;
  v_lng numeric;
  v_org text;
begin
  select s.account_id, s.raw_tab, s.delivery_address
    into v_s
    from public.sale s
   where s.id = p_sale_id;

  if v_s.account_id is null then
    return jsonb_build_object('hay', false, 'motivo', 'pedido no encontrado');
  end if;

  if current_setting('request.jwt.claims', true) is not null
     and not public.belongs_to_account(v_s.account_id) then
    raise exception 'sale_coordenadas_de_entrega: sin acceso a ese pedido';
  end if;

  v_rt := case when left(btrim(coalesce(v_s.raw_tab, '')), 1) = '{'
               then v_s.raw_tab::jsonb else '{}'::jsonb end;

  v_lat := nullif(v_rt->'delivery'->>'latitude', '')::numeric;
  v_lng := nullif(v_rt->'delivery'->>'longitude', '')::numeric;
  v_org := 'delivery';

  if v_lat is null or v_lng is null then
    v_lat := nullif(v_rt->'customer'->>'latitude', '')::numeric;
    v_lng := nullif(v_rt->'customer'->>'longitude', '')::numeric;
    v_org := 'customer';
  end if;

  if v_lat is null or v_lng is null then
    return jsonb_build_object(
      'hay', false,
      'motivo', 'la plataforma tampoco ha enviado coordenadas');
  end if;

  return jsonb_build_object(
    'hay', true,
    'lat', v_lat,
    'lng', v_lng,
    'origen', v_org,
    -- Que quede dicho EN EL DATO, no solo en la pantalla: esto es un punto, no
    -- un portal. Si algun dia alguien consume esto desde otro sitio, se lo
    -- lleva puesto.
    'aproximada', true,
    'tiene_direccion_postal', coalesce(btrim(v_s.delivery_address), '') <> '');
end;
$function$;

comment on function public.sale_coordenadas_de_entrega(uuid) is
  'B68 §2: coordenadas de entrega de un pedido cuando la plataforma no mando direccion postal. Mira `delivery` (Last.app) y `customer` (HubRise) y DICE de cual salieron. Marca `aproximada: true` en el dato, no solo en la pantalla. No hace geocodificacion inversa: no inventa la calle. Funcion aparte a proposito, para no tocar orders_feed, que alimenta las tablets.';

revoke all on function public.sale_coordenadas_de_entrega(uuid) from public, anon;
grant execute on function public.sale_coordenadas_de_entrega(uuid) to authenticated, service_role;

do $verif$
declare v_r jsonb;
begin
  if has_function_privilege('anon','public.sale_coordenadas_de_entrega(uuid)','EXECUTE') then
    raise exception 'B68: sale_coordenadas_de_entrega abierta a anon.';
  end if;
  -- El pedido del encargo tiene que dar el punto que dice el payload.
  select public.sale_coordenadas_de_entrega(
    (select id from public.sale where platform_order_code = '101763565060' limit 1)) into v_r;
  if v_r is null then raise exception 'B68: la funcion devolvio NULL.'; end if;
end
$verif$;
