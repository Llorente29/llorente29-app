-- R03 · 2 · Cinco minutos para pegar la dirección, y lo que necesita el
-- repartidor en el ticket y en la tarjeta (Julio, 16/10).
--
-- cambia: public.pedidos_sin_direccion · prueba: supabase/staging/sql/20261118_r03_espera_ticket_codigo_prueba.sql
-- cambia: public.orders_feed · prueba: supabase/staging/sql/20261118_r03_espera_ticket_codigo_prueba.sql
-- cambia: public.orders_feed_by_token · prueba: supabase/staging/sql/20261118_r03_espera_ticket_codigo_prueba.sql
-- cambia: public.order_for_print · prueba: supabase/staging/sql/20261118_r03_espera_ticket_codigo_prueba.sql
--
-- Va DETRÁS de la 0300 (que crea pedidos_sin_direccion y las columnas de la
-- dirección pegada).
--
-- 1. LA ESPERA (opción B de Julio). Un pedido de reparto propio que llega sin
--    calle espera hasta 5 minutos antes de salir a Catcher: si alguien pega la
--    dirección, sale con ella; si no, sale igual con el punto del mapa. Quien
--    espera es catcher-dispatch (cuando lo llama el disparador del pedido y no
--    hay dirección, contesta «esperando» y no manda nada). Quien lo manda al
--    vencer es despachar_sin_calle_vencidos(), cada minuto. Marca
--    `delivery_wait_sent_at` al pedirlo, para no pedirlo dos veces. Los pedidos
--    CON dirección no pasan por aquí: salen como hoy.
-- 2. LO QUE NECESITA EL REPARTIDOR, separado de lo que vino mezclado. Tres
--    columnas nuevas, nulas, que rellena un disparador desde raw_tab:
--      customer_phone_code    Uber por HubRise: customer.phone_access_code (el
--                             teléfono es una centralita y sin el código no
--                             conecta; Folvy no lo leía en ninguna parte)
--      delivery_instructions  HubRise: customer.delivery_notes · Last: delivery.details
--      order_customer_note    HubRise: customer_notes · Last: customerNote
--    El disparador NO PUEDE TUMBAR UN PEDIDO (regla 10): si algo falla al leer,
--    las deja a null y el pedido entra igual.
-- 3. Pedidos (oficina y tablet) y el ticket devuelven esas tres y la dirección
--    pegada. Sustitución quirúrgica sobre pg_get_functiondef() en vivo, como la
--    20261008T1125: si un fragmento no aparece EXACTAMENTE una vez, para. md5
--    de lo vigente en producción el 16/10:
--      orders_feed 3370306726f9d96f3a38bbc2930bbf82 · orders_feed_by_token fea555609f6ff851bfe35ac36ffc4258
--      order_for_print 54ff49ac454780ea643164771aa86dec
--
-- Rellenar los abiertos: 20261118T0320_r03_entrega_datos.sql (aparte: escribe en sale).
-- Vuelta atrás: supabase/vuelta-atras/20261118T0310_r03_espera_ticket_codigo.down.sql

-- ── Columnas ────────────────────────────────────────────────────────────────
alter table public.sale add column if not exists customer_phone_code   text;
alter table public.sale add column if not exists delivery_instructions text;
alter table public.sale add column if not exists order_customer_note   text;
alter table public.sale add column if not exists delivery_wait_sent_at timestamptz;

comment on column public.sale.customer_phone_code is
  'R03: código de acceso del teléfono del cliente (Uber por HubRise: customer.phone_access_code). Sin él la centralita no conecta. Lo rellena tg_sale_entrega_desde_raw.';
comment on column public.sale.delivery_instructions is
  'R03: indicaciones de entrega para el repartidor (HubRise: customer.delivery_notes; Last: delivery.details). Lo rellena tg_sale_entrega_desde_raw.';
comment on column public.sale.order_customer_note is
  'R03: nota del cliente al pedido (HubRise: customer_notes; Last: customerNote), aparte de las indicaciones. Lo rellena tg_sale_entrega_desde_raw.';
comment on column public.sale.delivery_wait_sent_at is
  'R03: cuándo despachar_sin_calle_vencidos() pidió mandarlo a Catcher tras los 5 minutos de espera sin calle. Evita pedirlo dos veces.';

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
  v_t := p_raw_tab::jsonb;
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

-- ── El aviso, con la hora a la que sale solo ────────────────────────────────
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

  select coalesce(l.dispatch_mode, 'auto') into v_mode from public.locations l where l.id = v_loc;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.sold_at), '[]'::jsonb)
    into v_result
    from (
      select s.id                                   as sale_id,
             s.sold_at,
             coalesce(s.pos_short_code, s.platform_order_code, s.external_ref) as code,
             s.platform_order_ref,
             s.external_channel_text                as channel,
             b.name                                 as brand,
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
             -- R03 · 2: a qué hora sale solo a Catcher por el punto del mapa.
             coalesce(s.accepted_at, s.created_at) + interval '5 minutes' as sale_solo_at,
             v_mode                                 as dispatch_mode
        from public.sale s
        left join public.brand b on b.id = s.brand_id
       where s.location_id = v_loc
         and s.service_type = 'own_delivery'
         and s.status = 'open'
         and coalesce(s.order_status, '') not in ('completed', 'cancelled', 'rejected', 'delivery_failed')
         and coalesce(s.delivery_state, '') not in ('delivered', 'completed')
         and coalesce(btrim(s.delivery_address), '') = ''
         and coalesce(btrim(s.delivery_address_fixed), '') = ''
         and s.sold_at > now() - interval '12 hours'
    ) x;

  return jsonb_build_object('location_id', v_loc, 'now', now(), 'pedidos', v_result);
end;
$function$;

-- ── Los que han esperado sus 5 minutos sin dirección: a Catcher ─────────────
-- Igual que tg_auto_dispatch: solo locales en automático, solo Catcher, con el
-- secreto interno de Vault. `tras_espera` le dice a catcher-dispatch que ya no
-- espere. Se marca antes de pedirlo: un fallo de red no lo repite cada minuto
-- (catcher-dispatch deja el motivo en dispatch_error y el vigía de siempre lo ve).
create or replace function public.despachar_sin_calle_vencidos()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_secret text;
  v_url    text := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/catcher-dispatch';
  v_anon   text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6bXBuY2hsZ3VpYmNsdnh5eW50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzE1NTksImV4cCI6MjA5Mzc0NzU1OX0.v5GsOW5hxwzJZA0z5Le26E9vAWflG1XFZ7ec2hvMphY';
  v_row    record;
  v_c      text;
  v_n      int := 0;
begin
  for v_row in
    select s.id
      from public.sale s
      join public.locations l on l.id = s.location_id
     where s.service_type = 'own_delivery'
       and coalesce(l.dispatch_mode, 'auto') = 'auto'
       and s.status = 'open'
       and s.order_status in ('accepted', 'in_preparation', 'awaiting_collection')
       and s.carrier_order_id is null
       and s.dispatch_error is null
       and s.delivery_wait_sent_at is null
       and coalesce(btrim(s.delivery_address), '') = ''
       and coalesce(btrim(s.delivery_address_fixed), '') = ''
       and s.created_at > now() - interval '6 hours'
       and coalesce(s.accepted_at, s.created_at) <= now() - interval '5 minutes'
       and not exists (select 1 from public.delivery_assignment da
                        where da.sale_id = s.id and da.state not in ('failed', 'canceled'))
     for update of s skip locked
  loop
    select r.carrier into v_c from public.resolve_dispatch(v_row.id) r;
    continue when v_c is distinct from 'catcher';
    if v_secret is null then
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'catcher_dispatch_secret';
    end if;
    update public.sale set delivery_wait_sent_at = now() where id = v_row.id;
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_anon,
                                    'x-catcher-dispatch-secret', v_secret),
      body    := jsonb_build_object('sale_id', v_row.id, 'internal', true, 'tras_espera', true));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

comment on function public.despachar_sin_calle_vencidos() is
  'R03: cada minuto, manda a Catcher los pedidos de reparto propio sin calle que han esperado 5 minutos a que alguien pegara la dirección. Solo locales en automático y solo Catcher.';
revoke all on function public.despachar_sin_calle_vencidos() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'r03-despachar-sin-calle') then
    perform cron.unschedule('r03-despachar-sin-calle');
  end if;
end $$;
select cron.schedule('r03-despachar-sin-calle', '* * * * *', $cron$select public.despachar_sin_calle_vencidos()$cron$);

-- ── Pedidos y ticket: la dirección pegada, el código y las dos notas ────────
do $$
declare
  f_s  text := 's\.expected_time,\s*s\.customer_note,';
  f_sn text := 's.expected_time, s.customer_note, s.delivery_address_fixed, s.customer_phone_code, s.delivery_instructions, s.order_customer_note,';
  f_v  text := 'v\.expected_time,\s*v\.customer_note,';
  f_vn text := 'v.expected_time, v.customer_note, v.delivery_address_fixed, v.customer_phone_code, v.delivery_instructions, v.order_customer_note,';
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
