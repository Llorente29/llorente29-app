-- Aplicada: SÍ — por Julio vía MCP, 11/08 ~18:09. Sincronizada al repo desde
-- la base viva (list_migrations + pg_get_functiondef), no al revés — el
-- repo iba por detrás de lo aplicado. Ver feedback_verificar_en_bbdd_no_repo.
--
-- FIX real encontrado y aplicado por Julio directamente (sin pasar por mí):
-- 'deliver' era INALCANZABLE para cualquier venta ya cobrada. upsert_pos_sale
-- tenía el bloque de 'deliver' solo AL FINAL de la función, después del
-- guard `if v_result.status <> 'open' then raise exception 'la cuenta ya
-- esta cerrada'` — y una venta cobrada (status='closed') SIEMPRE cae en ese
-- guard antes de llegar al bloque de deliver. Resultado: pulsar "Entregado"
-- sobre cualquier cuenta ya cobrada lanzaba "la cuenta ya esta cerrada" en
-- vez de completar la entrega.
--
-- Arreglo: un bloque de 'deliver' ADELANTADO, justo al entrar en la rama
-- "venta existente" (v_sale_id is not null), antes del guard de estado
-- abierto — exige status='closed' (coherente: no se puede entregar sin
-- cobrar antes), marca order_status='completed' y devuelve. El bloque viejo
-- de deliver al final de la función queda muerto (nunca se alcanza), pero no
-- se borra aquí — sincroniza tal cual está en producción.
--
-- Verificado en vivo tras el fix (11/08 tarde): venta T001/28,60€ cobrada y
-- entregada de verdad, con 23 filas reales en stock_movement (source_type=
-- 'sale', source_id=<sale_id> — OJO, NO via sale_line_id, esa columna no la
-- rellena generate_sale_consumption).

CREATE OR REPLACE FUNCTION public.upsert_pos_sale(p_sale_id uuid, p_account_id uuid, p_location_id uuid, p_brand_id uuid, p_channel_kind text, p_lines jsonb, p_action text, p_payment_method text DEFAULT NULL::text, p_device_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_device    kds_device;
  v_device_id uuid;
  v_result    sale%rowtype;
begin
  if not public._pos_can_operate(p_account_id, p_location_id) then
    raise exception 'upsert_pos_sale: sin acceso a esta cuenta/local';
  end if;
  if p_action not in ('save', 'command', 'charge', 'deliver') then
    raise exception 'upsert_pos_sale: accion no valida %', p_action;
  end if;
  if p_action = 'charge' and p_payment_method not in ('cash', 'card') then
    raise exception 'upsert_pos_sale: cobrar exige payment_method cash|card';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'upsert_pos_sale: la cuenta no tiene lineas';
  end if;

  select display_name into v_actor from user_profiles
  where user_id = auth.uid() and account_id = p_account_id limit 1;

  v_channel := public._pos_channel_id(p_account_id, coalesce(p_channel_kind, 'counter'));

  -- Dispositivo (T1.c): resuelto por TOKEN en el servidor, igual que las rutas
  -- por token — el cliente nunca manda un device_id propio. Si no resuelve, o
  -- resuelve a un dispositivo de otra cuenta/local, se queda null SIN bloquear
  -- la venta.
  if p_device_token is not null then
    v_device := public.kds_resolve_device(p_device_token);
    if v_device.id is not null
       and v_device.account_id = p_account_id
       and v_device.location_id = p_location_id then
      v_device_id := v_device.id;
    end if;
  end if;

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
      raw_tab, created_by, created_by_name, device_id
    ) values (
      p_account_id, p_location_id, p_brand_id, v_channel, 'folvy_pos', 'pickup',
      'open', null, now(), now(), round(v_total_sum, 2), round(v_base_sum, 2), round(v_tax_sum, 2),
      null, null, 'auto', public._pos_next_ticket_code(p_account_id, p_location_id),
      jsonb_build_object('lines', p_lines)::text, auth.uid(), v_actor, v_device_id
    )
    returning id into v_sale_id;
  else
    select * into v_result from sale where id = v_sale_id
      and account_id = p_account_id and location_id = p_location_id;
    if v_result.id is null then
      raise exception 'upsert_pos_sale: venta inexistente o de otra cuenta/local';
    end if;
    -- FIX (11/08): bloque de deliver ADELANTADO — antes del guard de "cuenta
    -- ya cerrada" de más abajo, que de otro modo la haría inalcanzable.
    if p_action = 'deliver' then
      if v_result.status <> 'closed' then
        raise exception 'upsert_pos_sale: no se puede marcar Entregado sin cobrar antes';
      end if;
      update sale set order_status = 'completed' where id = v_sale_id;
      select * into v_result from sale where id = v_sale_id;
      return jsonb_build_object('saleId', v_result.id, 'posShortCode', v_result.pos_short_code, 'status', v_result.status, 'orderStatus', v_result.order_status, 'paymentStatus', v_result.payment_status, 'total', v_result.total, 'taxableBase', v_result.taxable_base, 'tax', v_result.tax);
    end if;
    if v_result.status <> 'open' then raise exception 'upsert_pos_sale: la cuenta ya esta cerrada (status=%)', v_result.status; end if;
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

  -- Bloque viejo de deliver: inalcanzable desde el fix de arriba (la rama
  -- "venta existente" siempre retorna antes si p_action='deliver'). Se deja
  -- tal cual está en producción, no se limpia aquí — sincronía exacta.
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
$function$;
