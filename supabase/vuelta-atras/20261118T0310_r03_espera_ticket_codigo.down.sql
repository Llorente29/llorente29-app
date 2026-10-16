-- supabase/vuelta-atras/20261118T0310_r03_espera_ticket_codigo.down.sql
--
-- Vuelta atrás de 20261118T0310: Pedidos y el ticket como estaban (la misma
-- sustitución quirúrgica, al revés), pedidos_sin_direccion como la dejó la
-- 0300, fuera la espera (cron y función), los disparadores (lo de la entrega y
-- quién reparte en Uber), decidir_quien_reparte y las cuatro columnas.
-- Antes, la 0320 (datos) deshecha. Las columnas se quitan aunque tengan datos:
-- son copia de raw_tab, que no se toca.

do $$ begin
  if to_regclass('public.r03_entrega_relleno') is not null then
    raise exception 'Vuelta atrás R03 0310: deshaz antes la 0320 (r03_entrega_relleno existe). No se toca nada.';
  end if;
end $$;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'r03-despachar-sin-calle') then
    perform cron.unschedule('r03-despachar-sin-calle');
  end if;
end $$;
drop function if exists public.despachar_sin_calle_vencidos();

do $$
declare
  f_s  text := 's\.expected_time, s\.customer_note, s\.delivery_address_fixed, s\.customer_phone_code, s\.delivery_instructions, s\.order_customer_note, s\.delivery_by_reason,';
  f_sn text := 's.expected_time, s.customer_note,';
  f_v  text := 'v\.expected_time, v\.customer_note, v\.delivery_address_fixed, v\.customer_phone_code, v\.delivery_instructions, v\.order_customer_note, v\.delivery_by_reason,';
  f_vn text := 'v.expected_time, v.customer_note,';
  r record; v_def text; c int;
begin
  for r in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('orders_feed_by_token', 'order_for_print', 'orders_feed')
  loop
    v_def := pg_get_functiondef(r.oid);
    select count(*) into c from regexp_matches(v_def, f_s, 'g');
    if c <> 1 then raise exception 'Vuelta atrás R03 0310: %, fragmento de sale = % — parar', r.proname, c; end if;
    select count(*) into c from regexp_matches(v_def, f_v, 'g');
    if c <> 1 then raise exception 'Vuelta atrás R03 0310: %, fragmento del pedido = % — parar', r.proname, c; end if;
    execute regexp_replace(regexp_replace(v_def, f_s, f_sn), f_v, f_vn);
  end loop;
end $$;

drop trigger if exists trg_sale_tipo_uber_quien_reparte on public.sale;
drop function if exists public.tg_sale_uber_quien_reparte();
drop function if exists public.uber_senales_de_reparto(text);
drop function if exists public.decidir_quien_reparte(uuid, text, text);
drop trigger if exists trg_sale_entrega_desde_raw on public.sale;
drop function if exists public.tg_sale_entrega_desde_raw();
drop function if exists public.sale_entrega_desde_raw(text, text);


-- pedidos_sin_direccion, como la dejó la 0300 (sin sale_solo_at ni dispatch_mode).
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
             s.dispatch_error
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

alter table public.sale drop column if exists customer_phone_code;
alter table public.sale drop column if exists delivery_instructions;
alter table public.sale drop column if exists order_customer_note;
alter table public.sale drop column if exists delivery_wait_sent_at;

notify pgrst, 'reload schema';
