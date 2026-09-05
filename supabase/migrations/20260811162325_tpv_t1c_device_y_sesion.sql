-- ENCARGO TPV T1.c — trazabilidad de dispositivo y turno, ANTES del merge de T1.
-- Barato ahora (dos columnas en una migracion que se escribe igual), caro despues:
-- el pasado no se puede rellenar, no hay forma de deducir desde que tablet salio
-- un ticket ya emitido.
--
-- kds_device NO SE TOCA (ni la tabla, ni el CHECK device_mode): un DROP/ADD
-- CONSTRAINT sobre ella es la operacion que participo en tumbar la BBDD el 11/08,
-- y ademas seria mal diseno — en un bar la MISMA tablet puede ser KDS y TPV a la
-- vez. device_id en sale dice todo lo necesario.
--
-- CORRECCION APLICADA AL APLICAR (Claude, 11/08): el fichero entregado hacia
-- DROP FUNCTION + CREATE de upsert_pos_sale pero NO restauraba los permisos.
-- Un DROP+CREATE los PIERDE: la funcion nueva nace con EXECUTE a PUBLIC por
-- defecto. Verificado que hoy tiene ACL explicita (authenticated + service_role,
-- SIN anon), asi que sin esto el RPC del TPV — SECURITY DEFINER que crea ventas —
-- quedaria ejecutable sin autenticar, engordando la deuda de seguridad que ya
-- bloquea al cliente 2. Se anaden REVOKE/GRANT + verificacion embebida.

do $$
begin
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='kds_resolve_device') then
    raise exception 'tpv_t1c: falta kds_resolve_device — parar';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'upsert_pos_sale'
      and pg_get_function_identity_arguments(p.oid) =
        'p_sale_id uuid, p_account_id uuid, p_location_id uuid, p_brand_id uuid, p_channel_kind text, p_lines jsonb, p_action text, p_payment_method text'
  ) then
    raise exception 'tpv_t1c: upsert_pos_sale no tiene la firma de 8 parametros esperada — parar';
  end if;
end $$;

-- 1) Tarea A: columnas en sale
alter table public.sale add column if not exists device_id uuid null references public.kds_device(id) on delete set null;
alter table public.sale add column if not exists cash_session_id uuid null;
comment on column public.sale.device_id is
  'Dispositivo Folvy (kds_device) que origino la venta — TPV T1.c, 11/08. '
  'ON DELETE SET NULL: borrar el dispositivo nunca borra la venta. NULL en ventas '
  'de Last/HubRise y en TPV abierto sin token de dispositivo. Se fija solo al crear.';
comment on column public.sale.cash_session_id is
  'Turno de CAJA (cash_session, llega en T2) — columna reservada en T1.c, sin FK '
  'todavia. No confundir con las tablas shift_* del modulo Team, que son turnos de '
  'personal de cuadrante.';

-- 2) Tarea C: indice parcial
create index if not exists idx_sale_device_id on public.sale (device_id) where device_id is not null;

-- 3) Tarea B: upsert_pos_sale acepta y guarda p_device_token.
-- DROP explicito de la firma vieja ANTES del CREATE: con 9 parametros en vez de 8,
-- un CREATE OR REPLACE habria creado una SEGUNDA funcion solapada (overload) en vez
-- de sustituir la de T1, y PostgREST tendria que desambiguar — bugs intermitentes.
drop function if exists public.upsert_pos_sale(uuid, uuid, uuid, uuid, text, jsonb, text, text);

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
    if v_result.status <> 'open' then
      raise exception 'upsert_pos_sale: la cuenta ya esta cerrada (status=%)', v_result.status;
    end if;
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

-- 3.bis) RESTAURAR PERMISOS (el DROP los borro). Patron del proyecto: nunca anon.
revoke all on function public.upsert_pos_sale(uuid, uuid, uuid, uuid, text, jsonb, text, text, text) from public, anon;
grant execute on function public.upsert_pos_sale(uuid, uuid, uuid, uuid, text, jsonb, text, text, text) to authenticated, service_role;

-- 3.ter) Verificacion embebida: aborta si anon puede ejecutarla o si authenticated no.
do $ver$
begin
  if has_function_privilege('anon',
     'public.upsert_pos_sale(uuid, uuid, uuid, uuid, text, jsonb, text, text, text)', 'EXECUTE') then
    raise exception 'tpv_t1c: anon puede ejecutar upsert_pos_sale — los permisos no se restauraron';
  end if;
  if not has_function_privilege('authenticated',
     'public.upsert_pos_sale(uuid, uuid, uuid, uuid, text, jsonb, text, text, text)', 'EXECUTE') then
    raise exception 'tpv_t1c: authenticated NO puede ejecutar upsert_pos_sale — el TPV no funcionaria';
  end if;
end;
$ver$;

notify pgrst, 'reload schema';