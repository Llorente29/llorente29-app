-- R03 · 2 · Lo que necesita el repartidor en el ticket y en la tarjeta, quién
-- reparte cada Uber, y la lista de los que llegan sin dirección completa
-- (Julio, 16/10).
--
-- cambia: public.pedidos_sin_direccion · prueba: supabase/staging/sql/20261118_r03_ticket_codigo_quien_reparte_prueba.sql
-- cambia: public.orders_feed · prueba: supabase/staging/sql/20261118_r03_ticket_codigo_quien_reparte_prueba.sql
-- cambia: public.orders_feed_by_token · prueba: supabase/staging/sql/20261118_r03_ticket_codigo_quien_reparte_prueba.sql
-- cambia: public.order_for_print · prueba: supabase/staging/sql/20261118_r03_ticket_codigo_quien_reparte_prueba.sql
--
-- Va DETRÁS de la 0300 (que crea pedidos_sin_direccion y las columnas de la
-- dirección pegada).
--
-- 1. SIN ESPERA (Julio, tras ver las capturas): un pedido de reparto propio
--    sin dirección completa sale a Catcher al momento, como cualquier otro, con
--    el punto del mapa (catcher-dispatch). Aquí solo está la lista de los de
--    hoy (pedidos_sin_direccion) para la oficina, la tarjeta y el aviso rojo
--    de cuando NO ha podido salir.
-- 2. LO QUE NECESITA EL REPARTIDOR, separado de lo que vino mezclado. Tres
--    columnas nuevas, nulas, que rellena un disparador desde raw_tab:
--      customer_phone_code    Uber por HubRise: customer.phone_access_code (el
--                             teléfono es una centralita y sin el código no
--                             conecta; Folvy no lo leía en ninguna parte)
--      delivery_instructions  HubRise: customer.delivery_notes · Last: delivery.details
--      order_customer_note    HubRise: customer_notes · Last: customerNote
--    El disparador NO PUEDE TUMBAR UN PEDIDO (regla 10): si algo falla al leer,
--    las deja a null y el pedido entra igual.
-- 2b. UBER: QUIÉN REPARTE, POR PEDIDO (Julio, 16/10), por encima de la tabla
--    marca × plataforma. Foodint tiene activado en Uber «Llega a los clientes
--    que se encuentran fuera de tu zona»: fuera del radio reparte Uber y no
--    manda la entrega. Medido en 30 días, todas las marcas, Uber con
--    service_type delivery por HubRise: 121 traen calle, coordenadas y cargo
--    de envío (charges[].type delivery > 0) → los repartimos nosotros; 302 no
--    traen ninguna de las tres → los reparte Uber; mezclados, 0. La regla:
--      · las tres  → reparto propio (a Catcher)
--      · ninguna   → «La reparte Uber · fuera de zona»: ni Catcher, ni aviso,
--                    ni espera, y el ticket de los de la plataforma
--      · mezcladas → delivery_by_reason 'uber_decidir': aviso rojo para que
--                    decida una persona (decidir_quien_reparte), y no sale a
--                    Catcher hasta que decida (guard en resolve_dispatch, 0300)
--    Lo decidido a mano ('decidido_propio' / 'decidido_uber') no se vuelve a
--    tocar. Corre DESPUÉS del disparador de «Quién reparte» (por nombre). Los
--    abiertos, en la 0320.
-- 3. Pedidos (oficina y tablet) y el ticket devuelven esas tres y la dirección
--    pegada. Sustitución quirúrgica sobre pg_get_functiondef() en vivo, como la
--    20261008T1125: si un fragmento no aparece EXACTAMENTE una vez, para. md5
--    de lo vigente en producción el 16/10:
--      orders_feed 3370306726f9d96f3a38bbc2930bbf82 · orders_feed_by_token fea555609f6ff851bfe35ac36ffc4258
--      order_for_print 54ff49ac454780ea643164771aa86dec
--
-- Rellenar los abiertos: 20261118T0320_r03_entrega_datos.sql (aparte: escribe en sale).
-- Vuelta atrás: supabase/vuelta-atras/20261118T0310_r03_ticket_codigo_quien_reparte.down.sql

-- ── Columnas ────────────────────────────────────────────────────────────────
alter table public.sale add column if not exists customer_phone_code   text;
alter table public.sale add column if not exists delivery_instructions text;
alter table public.sale add column if not exists order_customer_note   text;

comment on column public.sale.customer_phone_code is
  'R03: código de acceso del teléfono del cliente (Uber por HubRise: customer.phone_access_code). Sin él la centralita no conecta. Lo rellena tg_sale_entrega_desde_raw.';
comment on column public.sale.delivery_instructions is
  'R03: indicaciones de entrega para el repartidor (HubRise: customer.delivery_notes; Last: delivery.details). Lo rellena tg_sale_entrega_desde_raw.';
comment on column public.sale.order_customer_note is
  'R03: nota del cliente al pedido (HubRise: customer_notes; Last: customerNote), aparte de las indicaciones. Lo rellena tg_sale_entrega_desde_raw.';
-- ── Leerlas de lo que mandó la plataforma ───────────────────────────────────
create or replace function public.sale_entrega_desde_raw(p_source text, p_raw_tab text)
returns table(customer_phone_code text, delivery_instructions text, order_customer_note text)
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_t jsonb;
  v_w constant text := E' \t\r\n';
begin
  if left(btrim(coalesce(p_raw_tab, '')), 1) <> '{' then
    return query select null::text, null::text, null::text; return;
  end if;
  -- Un raw_tab roto no es un error de nadie que esté pidiendo: no se lee y ya
  -- (la 0320 llama aquí fila a fila; un solo roto tumbaba la tanda entera).
  begin
    v_t := p_raw_tab::jsonb;
  exception when others then
    return query select null::text, null::text, null::text; return;
  end;
  if p_source = 'hubrise' then
    return query select
      nullif(btrim(coalesce(v_t->'customer'->>'phone_access_code', ''), v_w), ''),
      nullif(btrim(coalesce(v_t->'customer'->>'delivery_notes', ''), v_w), ''),
      nullif(btrim(coalesce(v_t->>'customer_notes', ''), v_w), '');
  elsif p_source = 'lastapp' then
    return query select
      null::text,
      nullif(btrim(coalesce(v_t->'delivery'->>'details', ''), v_w), ''),
      nullif(btrim(coalesce(v_t->>'customerNote', ''), v_w), '');
  else
    return query select null::text, null::text, null::text;
  end if;
end;
$function$;

comment on function public.sale_entrega_desde_raw(text, text) is
  'R03: código del teléfono, indicaciones de entrega y nota del cliente, leídos de raw_tab. Espacios o saltos de línea solos = null.';

create or replace function public.tg_sale_entrega_desde_raw()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare r record;
begin
  if new.source not in ('lastapp', 'hubrise') then return new; end if;
  begin
    select * into r from public.sale_entrega_desde_raw(new.source, new.raw_tab);
    new.customer_phone_code   := r.customer_phone_code;
    new.delivery_instructions := r.delivery_instructions;
    new.order_customer_note   := r.order_customer_note;
  exception when others then
    -- Un pedido nunca se cae por esto.
    raise warning 'tg_sale_entrega_desde_raw: % (venta %)', sqlstate, new.id;
  end;
  return new;
end;
$function$;

drop trigger if exists trg_sale_entrega_desde_raw on public.sale;
create trigger trg_sale_entrega_desde_raw
  before insert or update of raw_tab on public.sale
  for each row execute function public.tg_sale_entrega_desde_raw();

-- ── Uber: quién reparte, por pedido ────────────────────────────────────────
-- Las tres señales de que el reparto es nuestro: calle, coordenadas y cargo de
-- envío. Pura, para el disparador, el relleno de los abiertos y las pruebas.
create or replace function public.uber_senales_de_reparto(p_raw_tab text)
returns table(calle boolean, coordenadas boolean, cargo_envio boolean)
language plpgsql
immutable
set search_path to 'public'
as $function$
declare v_t jsonb;
begin
  if left(btrim(coalesce(p_raw_tab, '')), 1) <> '{' then
    return query select null::boolean, null::boolean, null::boolean; return;
  end if;
  -- Ilegible = no lo sé (nulos), no «ninguna señal»: un raw_tab que no se lee
  -- no puede mandar un pedido a «la reparte Uber».
  begin
    v_t := p_raw_tab::jsonb;
  exception when others then
    return query select null::boolean, null::boolean, null::boolean; return;
  end;
  return query select
    nullif(btrim(coalesce(v_t->'customer'->>'address_1', ''), E' \t\r\n'), '') is not null,
    nullif(v_t->'customer'->>'latitude', '') is not null and nullif(v_t->'customer'->>'longitude', '') is not null,
    exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_t->'charges') = 'array' then v_t->'charges' else '[]'::jsonb end) c
             where coalesce(c->>'type', c->>'charge_type') = 'delivery'
               and coalesce(nullif(regexp_replace(coalesce(c->>'price', ''), '[^0-9.]', '', 'g'), '')::numeric, 0) > 0);
end;
$function$;

comment on function public.uber_senales_de_reparto(text) is
  'R03: las tres señales de que un pedido de Uber lo repartimos nosotros (calle, coordenadas y cargo de envío > 0), leídas de raw_tab.';

create or replace function public.tg_sale_uber_quien_reparte()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare r record;
begin
  if new.source is distinct from 'hubrise' then return new; end if;
  if new.service_type is null or new.service_type not in ('own_delivery', 'platform_delivery') then return new; end if;
  if lower(coalesce(new.external_channel_text, '')) not like '%uber%' then return new; end if;
  if coalesce(current_setting('folvy.reparto_tal_cual', true), '') = 'on' then return new; end if;
  if new.carrier_order_id is not null then return new; end if;
  if new.delivery_by_reason in ('decidido_propio', 'decidido_uber') then return new; end if;
  begin
    select * into r from public.uber_senales_de_reparto(new.raw_tab);
    if r.calle is null then return new; end if;  -- ilegible: se queda como está
    if r.calle and r.coordenadas and r.cargo_envio then
      new.service_type := 'own_delivery';
      new.delivery_by_reason := null;
    elsif not r.calle and not r.coordenadas and not r.cargo_envio then
      new.service_type := 'platform_delivery';
      new.delivery_by_reason := 'fuera_de_zona';
    else
      new.service_type := 'own_delivery';
      new.delivery_by_reason := 'uber_decidir';
    end if;
  exception when others then
    raise warning 'tg_sale_uber_quien_reparte: % (venta %)', sqlstate, new.id;
  end;
  return new;
end;
$function$;

drop trigger if exists trg_sale_tipo_uber_quien_reparte on public.sale;
create trigger trg_sale_tipo_uber_quien_reparte
  before insert or update on public.sale
  for each row execute function public.tg_sale_uber_quien_reparte();

-- Una persona decide quién reparte un Uber con señales mezcladas. Misma doble
-- puerta que el aviso (token de la tablet: solo su local; o sesión).
create or replace function public.decidir_quien_reparte(p_sale_id uuid, p_quien text, p_token text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_s record; v_carrier text; v_reason text; v_mode text;
begin
  select s.id, s.location_id, s.delivery_by_reason, s.status, s.carrier_order_id, s.delivery_address, s.delivery_address_fixed,
         s.rider_name, s.rider_phone
    into v_s from public.sale s where s.id = p_sale_id;
  if v_s.id is null then raise exception 'decidir_quien_reparte: el pedido no existe'; end if;
  perform public.kds_authorize(v_s.location_id, p_token);
  if v_s.status is distinct from 'open' then raise exception 'Este pedido ya está cerrado.'; end if;
  if p_quien not in ('nosotros', 'uber') then raise exception 'decidir_quien_reparte: «nosotros» o «uber»'; end if;
  if v_s.carrier_order_id is not null then raise exception 'Este pedido ya está en Catcher.'; end if;

  -- «Tal cual»: que el disparador de «Quién reparte» no lo devuelva a lo de antes.
  perform set_config('folvy.reparto_tal_cual', 'on', true);
  update public.sale
     set service_type = case when p_quien = 'nosotros' then 'own_delivery' else 'platform_delivery' end,
         delivery_by_reason = case when p_quien = 'nosotros' then 'decidido_propio' else 'decidido_uber' end,
         updated_at = now()
   where id = p_sale_id;
  perform set_config('folvy.reparto_tal_cual', '', true);

  if p_quien = 'nosotros' then
    select r.carrier, r.reason into v_carrier, v_reason from public.resolve_dispatch(p_sale_id) r;
  end if;
  select coalesce(l.dispatch_mode, 'auto') into v_mode from public.locations l where l.id = v_s.location_id;
  return jsonb_build_object(
    'ok', true, 'sale_id', p_sale_id, 'quien', p_quien,
    'direccion', nullif(coalesce(nullif(btrim(v_s.delivery_address_fixed), ''), btrim(v_s.delivery_address)), ''),
    'carrier', v_carrier, 'reason', v_reason, 'dispatch_mode', v_mode,
    'ya_en_catcher', false, 'rider_name', v_s.rider_name, 'rider_phone', v_s.rider_phone);
end;
$function$;

comment on function public.decidir_quien_reparte(uuid, text, text) is
  'R03: una persona decide quién reparte un pedido de Uber con señales mezcladas (calle, punto o cargo de envío). «nosotros» → propio (decidido_propio); «uber» → la reparte Uber (decidido_uber). Con token, solo pedidos del local del dispositivo.';
revoke all on function public.decidir_quien_reparte(uuid, text, text) from public;
grant execute on function public.decidir_quien_reparte(uuid, text, text) to anon, authenticated, service_role;

-- ── Los de hoy sin dirección completa ──────────────────────────────────────
-- Una lista, tres usos: «Despacho» (la oficina, todos los de hoy, también los
-- ya completados: una pantalla que se abre a propósito no esconde filas), la
-- tarjeta y el aviso rojo (solo los que NO han podido salir a Catcher, o los
-- Uber que tiene que decidir una persona). Día de servicio con el corte de
-- siempre (_pase_dia_de_negocio, 4 h).
create or replace function public.pedidos_sin_direccion(p_location_id uuid, p_token text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_device kds_device;
  v_loc    uuid;
  v_acc    uuid;
  v_mode   text;
  v_result jsonb;
begin
  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then raise exception 'pedidos_sin_direccion: token de dispositivo no válido'; end if;
    v_loc := v_device.location_id;
  else
    if p_location_id is null then raise exception 'pedidos_sin_direccion: falta location_id'; end if;
    v_loc := p_location_id;
    perform public.kds_authorize(v_loc, null);
  end if;

  select coalesce(l.dispatch_mode, 'auto'), l.account_id into v_mode, v_acc
    from public.locations l where l.id = v_loc;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.sold_at desc), '[]'::jsonb)
    into v_result
    from (
      select s.id                                   as sale_id,
             s.sold_at,
             coalesce(s.pos_short_code, s.platform_order_code, s.external_ref) as code,
             s.platform_order_ref,
             s.external_channel_text                as channel,
             b.name                                 as brand,
             s.status,
             s.order_status,
             s.delivery_state,
             (case when left(btrim(coalesce(s.raw_tab,'')),1)='{'
                   then coalesce(nullif(s.raw_tab::jsonb->'customer'->>'latitude',''),
                                 nullif(s.raw_tab::jsonb->'delivery'->>'latitude','')) end)::numeric  as lat,
             (case when left(btrim(coalesce(s.raw_tab,'')),1)='{'
                   then coalesce(nullif(s.raw_tab::jsonb->'customer'->>'longitude',''),
                                 nullif(s.raw_tab::jsonb->'delivery'->>'longitude','')) end)::numeric as lng,
             s.carrier_code,
             (s.carrier_order_id is not null)       as en_catcher,
             s.rider_name,
             s.rider_phone,
             s.dispatch_error,
             v_mode                                 as dispatch_mode,
             nullif(btrim(s.delivery_address_fixed), '') as direccion_completada,
             s.delivery_address_fixed_at            as completada_at,
             s.delivery_address_fixed_by            as completada_por,
             -- R03 · Uber: señales mezcladas, lo decide una persona.
             (s.delivery_by_reason = 'uber_decidir') as decidir,
             -- El aviso rojo: abierto, sin salir a Catcher y con el motivo.
             (s.status = 'open' and s.carrier_order_id is null and s.dispatch_error is not null
              and coalesce(btrim(s.delivery_address_fixed), '') = '') as no_ha_salido
        from public.sale s
        left join public.brand b on b.id = s.brand_id
       where s.location_id = v_loc
         and s.service_type = 'own_delivery'
         and s.sold_at > now() - interval '30 hours'
         and public._pase_dia_de_negocio(v_acc, s.sold_at) = public._pase_dia_de_negocio(v_acc, now())
         and (coalesce(btrim(s.delivery_address), '') = '' or s.delivery_by_reason = 'uber_decidir')
    ) x;

  return jsonb_build_object('location_id', v_loc, 'now', now(), 'pedidos', v_result);
end;
$function$;

-- ── Pedidos y ticket: la dirección pegada, el código y las dos notas ────────
do $$
declare
  f_s  text := 's\.expected_time,\s*s\.customer_note,';
  f_sn text := 's.expected_time, s.customer_note, s.delivery_address_fixed, s.customer_phone_code, s.delivery_instructions, s.order_customer_note, s.delivery_by_reason,';
  f_v  text := 'v\.expected_time,\s*v\.customer_note,';
  f_vn text := 'v.expected_time, v.customer_note, v.delivery_address_fixed, v.customer_phone_code, v.delivery_instructions, v.order_customer_note, v.delivery_by_reason,';
  r record; v_def text; c int; v_n int := 0;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('orders_feed_by_token', 'order_for_print', 'orders_feed')
  loop
    v_def := pg_get_functiondef(r.oid);
    select count(*) into c from regexp_matches(v_def, f_s, 'g');
    if c <> 1 then raise exception 'R03 0310: %, columnas de sale = % (se esperaba 1) — parar', r.proname, c; end if;
    select count(*) into c from regexp_matches(v_def, f_v, 'g');
    if c <> 1 then raise exception 'R03 0310: %, columnas del pedido = % (se esperaba 1) — parar', r.proname, c; end if;
    execute regexp_replace(regexp_replace(v_def, f_s, f_sn), f_v, f_vn);
    v_n := v_n + 1;
  end loop;
  if v_n <> 3 then raise exception 'R03 0310: se esperaban 3 funciones y hay % — parar', v_n; end if;
end $$;

notify pgrst, 'reload schema';
