-- ============================================================================
-- `pase_ficha` RECOGE LO QUE SE FUE DE LA TARJETA · 17/09/2026
--
-- El 16/09 salieron de la tarjeta «Bolsa impresa · 21:41» y «Listo por Ana» /
-- «Lo dice la flota», porque son datos de CONSULTA y competían por el sitio con
-- lo que se mira de lejos. Pero se fueron de la tarjeta Y NO LLEGARON A LA
-- HOJA: durante un día no estuvieron en ninguna pantalla. Eso no es ordenar,
-- es esconder, que es lo que prohíbe la regla 7. Bajan de zona, no desaparecen.
--
-- Son los mismos dos campos que ya calcula `pase_board`, con la misma consulta:
-- el último `print_job` de tipo 'bag' de esa venta, y la derivación de
-- `avanzo_por` desde `delivery_state`/`ready_at`. No se inventa nada nuevo.
--
-- 🔴 `avanzo_quien` SIGUE SIENDO NULL, igual que en el tablero, y va dicho en
-- vez de disimularlo: hoy la base no guarda QUIÉN pulsó «Listo». La hoja
-- escribe «lo marcó una persona» --que es lo que se sabe-- y no «por Ana», que
-- sería inventarse un nombre. El día que se guarde el quién, esta clave se
-- llena y la pantalla lo dice sola.
--
-- LA BANDA: `create or replace` de una función, no toma cierre sobre ninguna
-- tabla. Y no la llama nada del camino del pedido: sólo la tablet, al abrir una
-- hoja. Se cuenta antes de aplicar y el número va al parte.
--
-- VOLVER ATRÁS: reaplicar la 20260916214617, que es la versión anterior entera.
-- ============================================================================

create or replace function public.pase_ficha(p_device_token text, p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device kds_device;
  v_sale   sale;
  v_raw    jsonb;
  v_codigo text;
  v_tel    text;
  v_marca  text;
  v_bolsa  jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'pase_ficha: token de dispositivo no válido';
  end if;

  select s.* into v_sale
    from sale s
   where s.id          = p_sale_id
     and s.account_id  = v_device.account_id
     and s.location_id = v_device.location_id;

  if v_sale.id is null then
    raise exception 'pase_ficha: ese pedido no es de este local';
  end if;

  begin
    v_raw := v_sale.raw_tab::jsonb;
  exception when others then
    v_raw := null;
  end;

  v_codigo := nullif(btrim(coalesce(
                v_raw #>> '{customer,phone_access_code}',      -- HubRise
                v_raw #>> '{customerInfo,phoneNumberCode}'     -- Last
              )), '');

  v_tel := nullif(btrim(v_sale.customer_phone), '');

  v_marca := case
               when v_tel is null then null
               when v_codigo is null then 'tel:' || replace(v_tel, ' ', '')
               else 'tel:' || replace(v_tel, ' ', '') || ',,,' || replace(v_codigo, ' ', '')
             end;

  -- LA BOLSA · la misma consulta que `pase_board`, para una sola venta.
  select jsonb_build_object(
           'estado', case
                       when b.sale_id is null then 'sin_pedir'
                       when b.estado = 'done'  then 'hecha'
                       when b.estado = 'error' then 'rota'
                       else 'esperando' end,
           'cuando',   to_char(b.cuando at time zone 'Europe/Madrid', 'HH24:MI'),
           'intentos', coalesce(b.fallidos, 0))
    into v_bolsa
    from (select pj.sale_id,
                 (array_agg(pj.status order by pj.created_at desc))[1] as estado,
                 max(pj.created_at)                                    as cuando,
                 count(*) filter (where pj.status = 'error')::int       as fallidos
            from print_job pj
           where pj.sale_id = v_sale.id and pj.doc_type = 'bag'
           group by pj.sale_id) b;

  return jsonb_build_object(
    'sale_id',       v_sale.id,
    'codigo',        coalesce(v_sale.pos_short_code, v_sale.platform_order_code),
    'marca',         (select b.name     from brand b where b.id = v_sale.brand_id),
    'marca_logo_url',(select b.logo_url from brand b where b.id = v_sale.brand_id),
    'channel',       coalesce((select c.name from sales_channel c where c.id = v_sale.channel_id),
                              v_sale.external_channel_text),
    'order_status',  v_sale.order_status,
    'service_type',  v_sale.service_type,
    'has_courier',   v_sale.has_courier,
    'carrier_code',  v_sale.carrier_code,
    'source',        v_sale.source,
    'delivery_state',v_sale.delivery_state,
    'repartidor_nombre',   nullif(btrim(v_sale.rider_name), ''),
    'repartidor_telefono', nullif(btrim(v_sale.rider_phone), ''),
    'cliente',       nullif(btrim(v_sale.customer_name), ''),
    'cliente_nombre',    nullif(btrim(v_sale.customer_name), ''),
    'cliente_telefono',  v_tel,
    'cliente_codigo',    v_codigo,
    'cliente_marcacion', v_marca,
    'entro_at',    coalesce(v_sale.opened_at, v_sale.sold_at, v_sale.created_at),
    'accepted_at', v_sale.accepted_at,
    'ready_at',    v_sale.ready_at,
    'handed_to_courier_at', v_sale.handed_to_courier_at,
    'delivered_at',         v_sale.delivered_at,
    'direccion',   nullif(btrim(v_sale.delivery_address), ''),
    'notas',       nullif(btrim(v_sale.customer_note), ''),
    -- LO QUE BAJÓ DE LA TARJETA (17/09)
    'bolsa',       coalesce(v_bolsa, jsonb_build_object('estado','sin_pedir','cuando',null,'intentos',0)),
    'avanzo_por',  case
                     when v_sale.delivery_state is not null then 'flota'
                     when v_sale.ready_at is not null       then 'persona'
                     else null end,
    'avanzo_quien', null
  );
end;
$$;

revoke all on function public.pase_ficha(text, uuid) from public;
grant execute on function public.pase_ficha(text, uuid) to anon, authenticated, service_role;
