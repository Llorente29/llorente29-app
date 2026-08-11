-- Aplicada: NO POR ESTE FICHERO (Julio, 11/08, por MCP, con servicio CERRADO).
-- Julio genera la versión final directamente desde pg_get_functiondef de las
-- 13 definiciones VIVAS por sustitución de texto (el mismo patrón que la
-- mitigación del 11/08), con guard que aborta si alguna no encaja, y vuelca
-- el resultado al repo — cierra el drift por construcción. Transcribir 13
-- funciones grandes a mano es un riesgo innecesario (ya hubo tramos
-- corruptos en copias anteriores de este mismo fichero). ESTE FICHERO SE
-- CONSERVA como registro de intención — no se borra — pero el que se aplica
-- de verdad es el que Julio genera y vuelca él mismo.
--
-- ENCARGO fix/kds-latido-raiz · Tarea A, parte 2/2 — quita la escritura.
-- Partida en dos migraciones a propósito (ver 20260816T0900_kds_heartbeat_create.sql,
-- parte 1/2) para que la secuencia obligatoria del encargo §2.4 sea real:
--   1) 20260816T0900 crea kds_heartbeat (aditiva, ya aplicada si sigues el orden).
--   2) Bundle OTA desplegado y CONFIRMADO latiendo en las 3 tablets vivas
--      (kds_device.last_seen_at avanzando a ritmo de 60s, no al ritmo de las
--      lecturas de pantalla).
--   3) ESTA migración: quita la escritura de las 13 funciones de lectura.
--      NO LA APLIQUES sin haber confirmado el paso 2 — estas tablets se
--      quedarían sin latido alguno (las lecturas dejan de escribir y, si el
--      bundle con el heartbeat nuevo no llegó, nada más escribe).
--
-- Sustituye la mitigación de emergencia del 11/08 (backup public._backup_kds_fn_20260811
-- + freno de 30s en 13 funciones, migraciones kds_heartbeat_backup_20260811 y
-- kds_heartbeat_throttle_30s YA aplicadas) por el diseño definitivo. El backup
-- del 11/08 NO se toca ni se borra (es la red de reversión).
--
-- RECON verificado en vivo (fusiona sobre pg_get_functiondef de producción, no
-- sobre lo que dice el repo, que está pre-incidente):
--   · Las 13 funciones mitigadas llevan, TODAS con el mismo texto literal:
--       update kds_device set last_seen_at = now() where id = v_device.id
--         and (last_seen_at is null or last_seen_at < now() - interval '30 seconds');
--     Esta migración retira exactamente esa línea de las 13 (kds_authorize incluida:
--     autorizar es LEER, no escribir) y reproduce el resto de cada función carácter
--     a carácter desde la definición VIVA (validado por MCP con nombres temporales
--     _tmp_check_* antes de escribir este fichero: las 13 versiones limpias
--     compilan; se descartaron sin tocar las funciones reales).
--   · Las 5 funciones que llaman a kds_authorize (kds_bump, kds_unbump, kds_mark_line,
--     kds_ack_alarm, availability_ack_notice) NO tienen escritura propia — quedan
--     limpias automáticamente al limpiar kds_authorize. NO se tocan en esta migración.
--   · location_status: en su rama por token llama a kds_resolve_device DIRECTAMENTE
--     (no a kds_authorize) y NUNCA escribió kds_device. Corrección al RECON del
--     encargo (que la listaba como heredera de la escritura) — no requiere cambio.
--   · report_device_app_version y set_device_mode_by_token TAMBIÉN hacen
--     `update kds_device`, pero son escrituras de INTENCIÓN EXPLÍCITA (reporte de
--     versión al iniciar la app; cambio de modo del dispositivo al vincular), no
--     lecturas-que-escriben — volumen real ~0 llamadas en la ventana de incidente
--     (pg_stat_statements). No estaban en la lista de "13" del encargo porque no
--     son parte del antipatrón. Se dejan intactas: el objetivo de "exactamente 1
--     función con `update kds_device`" del encargo (checklist §8.1) por tanto NO
--     se cumple literalmente con 1, sino con 3 (kds_heartbeat + estas dos, ambas
--     de baja/nula frecuencia y de intención explícita). Ver nota en el parte de
--     vuelta — RECON manda, se avisa explícitamente en vez de forzar el número.
--
-- Aplicar con servicio CERRADO (son las funciones que las tablets llaman cada
-- segundo; CREATE OR REPLACE no toma lock de ALTER TABLE pero el cambio de
-- comportamiento en caliente durante servicio abierto no es aceptable aquí).

do $$
begin
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'kds_resolve_device'
  ) then
    raise exception 'kds_heartbeat_remove_writes: falta kds_resolve_device — RECON desactualizado, parar';
  end if;
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'kds_heartbeat'
  ) then
    raise exception 'kds_heartbeat_remove_writes: falta kds_heartbeat — aplica primero 20260816T0900_kds_heartbeat_create.sql y confirma el latido en las 3 tablets antes de seguir';
  end if;
end $$;

-- ── Retirar la escritura de las 13 funciones de lectura ─────────────────────
-- Cada CREATE OR REPLACE de abajo es la definición VIVA de producción con
-- ÚNICAMENTE la línea `update kds_device set last_seen_at = ...` retirada.
-- Nada más cambia: mismos parámetros, mismo cuerpo, mismo comportamiento.

CREATE OR REPLACE FUNCTION public.kds_alarms(p_location_id uuid, p_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device  kds_device;
  v_loc     uuid;
  v_result  jsonb;
begin
  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then raise exception 'kds_alarms: token de dispositivo no válido'; end if;
    v_loc := v_device.location_id;
  else
    if p_location_id is null then raise exception 'kds_alarms: falta location_id'; end if;
    v_loc := p_location_id;
    perform public.kds_authorize(v_loc, null);
  end if;

  select coalesce(jsonb_agg(row_to_json(a) order by a.raised_at desc), '[]'::jsonb)
  into v_result
  from (
    select s.id                                                             as sale_id,
           s.delivery_alarm_kind                                            as kind,
           s.delivery_alarm_at                                              as raised_at,
           s.delivery_state,
           s.order_status,
           coalesce(s.platform_order_code, s.external_tab_ref, s.external_ref) as code,
           s.customer_name,
           s.delivery_address,
           s.rider_name,
           s.rider_phone
    from sale s
    where s.location_id = v_loc
      and s.delivery_alarm_at is not null
      and s.delivery_alarm_ack_at is null
  ) a;

  return jsonb_build_object('location_id', v_loc, 'now', now(), 'alarms', v_result);
end;
$function$;

CREATE OR REPLACE FUNCTION public.kds_authorize(p_location_id uuid, p_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device  kds_device;
  v_account uuid;
begin
  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then
      raise exception 'kds: token de dispositivo no válido';
    end if;
    if v_device.location_id <> p_location_id then
      raise exception 'kds: el token no corresponde a esta ubicación';
    end if;
    return v_device.account_id;
  end if;
  select account_id into v_account from locations where id = p_location_id;
  if v_account is null then raise exception 'kds: ubicación inexistente'; end if;
  if not belongs_to_account(v_account) then
    raise exception 'kds: sin acceso a esta ubicación';
  end if;
  return v_account;
end;
$function$;

CREATE OR REPLACE FUNCTION public.kds_board(p_location_id uuid DEFAULT NULL::uuid, p_device_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id uuid;
  v_location_id uuid := p_location_id;
  v_device     kds_device;
  v_station_filter uuid[] := null;
  v_default_station uuid;
  v_result     jsonb;
begin
  if p_device_token is not null then
    v_device := public.kds_resolve_device(p_device_token);
    if v_device.id is null then
      raise exception 'kds_board: token de dispositivo no válido';
    end if;
    if v_location_id is null then
      v_location_id := v_device.location_id;
    elsif v_device.location_id <> v_location_id then
      raise exception 'kds_board: el token no corresponde a esta ubicación';
    end if;
    v_account_id := v_device.account_id;
    v_station_filter := v_device.station_ids;
  else
    if v_location_id is null then
      raise exception 'kds_board: falta location o token';
    end if;
    select account_id into v_account_id from locations where id = v_location_id;
    if v_account_id is null then
      raise exception 'kds_board: ubicación inexistente';
    end if;
    if not belongs_to_account(v_account_id) then
      raise exception 'kds_board: sin acceso a esta ubicación';
    end if;
  end if;

  select id into v_default_station from kitchen_station
   where location_id = v_location_id and is_default and is_active limit 1;

  with vivos as (
    select s.id, s.external_ref, s.external_tab_ref, s.status,
           s.brand_id, s.channel_id, s.external_channel_text,
           s.opened_at, s.closed_at, s.sold_at, s.raw_tab,
           coalesce(s.opened_at, s.sold_at, s.created_at) as entro_at
    from sale s
    where s.location_id = v_location_id
      and s.account_id = v_account_id
      and s.status <> 'cancelled'
      -- Pedido del Shop sin confirmar (pago online pendiente): NO entra en cocina.
      and not (s.source = 'folvy_shop' and s.order_status = 'new')
      and not exists (
        select 1 from kds_ticket_station_state st
        join kitchen_station k on k.id = st.station_id
        where st.sale_id = s.id and k.kind = 'expo' and st.status = 'done'
      )
      and (s.status <> 'closed' or coalesce(s.closed_at, s.sold_at) >= now() - interval '2 hours')
  ),
  notas as (
    select v.id as sale_id,
           (prod->>'organizationProductId') as ext_pid,
           nullif(btrim(prod->>'comments'), '') as note
    from vivos v
    cross join lateral (
      select safe_jsonb(v.raw_tab) as tab
    ) rt
    cross join lateral (
      select coalesce(rt.tab -> 'products', rt.tab -> 'bills' -> 0 -> 'products') as products
    ) p
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.products) = 'array' then p.products else '[]'::jsonb end
    ) as prod
    where nullif(btrim(prod->>'comments'), '') is not null
      and (prod->>'organizationProductId') is not null
  ),
  padres as (
    select sl.sale_id, sl.id as line_id, sl.product_name, sl.quantity,
           sl.line_type, sl.menu_item_id, sl.external_product_id,
           coalesce(
             ri.kds_station_id,
             (select fr.station_id from kitchen_family_route fr
               where fr.account_id = v_account_id and fr.family_id = ri.family_id limit 1),
             v_default_station
           ) as station_id,
           coalesce(ls.marked, false) as marked,
           array(select allergen_code from recipe_item_allergen a
                  where a.recipe_item_id = ri.id and a.state = 'contains') as allergens
    from sale_line sl
    left join menu_item mi on mi.id = sl.menu_item_id
    left join recipe_item ri on ri.id = mi.recipe_item_id
    left join kds_line_state ls on ls.sale_line_id = sl.id
    where sl.sale_id in (select id from vivos)
      and sl.parent_sale_line_id is null
  ),
  hijas as (
    select sl.parent_sale_line_id, sl.sale_id, sl.id as line_id,
           sl.product_name, sl.quantity, sl.line_type, sl.external_product_id
    from sale_line sl
    where sl.sale_id in (select id from vivos)
      and sl.parent_sale_line_id is not null
  ),
  tickets as (
    select v.id as sale_id, v.external_ref, v.external_tab_ref, v.status,
           b.name as brand,
           b.logo_url as brand_logo_url, b.color as brand_color,
           coalesce(ch.name, v.external_channel_text) as channel, v.entro_at,
           round(extract(epoch from (now() - v.entro_at)) / 60.0)::int as minutos,
           coalesce((select jsonb_agg(jsonb_build_object(
                'line_id', l.line_id, 'name', l.product_name, 'qty', l.quantity,
                'menu_item_id', l.menu_item_id,
                'station_id', l.station_id, 'marked', l.marked, 'allergens', l.allergens,
                'has_recipe', (l.menu_item_id is not null),
                'customer_note', (
                  select n.note from notas n
                   where n.sale_id = l.sale_id and n.ext_pid = l.external_product_id limit 1
                ),
                'children', coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'line_id', h.line_id, 'name', h.product_name, 'qty', h.quantity,
                           'line_type', h.line_type,
                           'customer_note', (
                             select n2.note from notas n2
                              where n2.sale_id = h.sale_id and n2.ext_pid = h.external_product_id limit 1
                           )
                         ) order by h.line_id)
                  from hijas h where h.parent_sale_line_id = l.line_id
                ), '[]'::jsonb)
            ) order by l.product_name)
            from padres l where l.sale_id = v.id), '[]'::jsonb) as lineas,
           (select jsonb_object_agg(st.station_id, st.status)
            from kds_ticket_station_state st where st.sale_id = v.id) as estaciones
    from vivos v
    left join brand b on b.id = v.brand_id
    left join sales_channel ch on ch.id = v.channel_id
  )
  select jsonb_build_object(
    'location_id', v_location_id,
    'station_filter', to_jsonb(v_station_filter),
    'default_station_id', v_default_station,
    'expo_station_id', (select id from kitchen_station
                         where location_id = v_location_id and kind='expo' and is_active
                         order by display_order limit 1),
    'stations', (
      select coalesce(jsonb_agg(jsonb_build_object(
                'id', k.id, 'name', k.name, 'kind', k.kind,
                'display_order', k.display_order, 'is_default', k.is_default
              ) order by k.display_order), '[]'::jsonb)
      from kitchen_station k
      where k.account_id = v_account_id and k.location_id = v_location_id and k.is_active
    ),
    'now', now(),
    'tickets', coalesce(jsonb_agg(to_jsonb(t) order by t.entro_at) filter (where t.sale_id is not null), '[]'::jsonb)
  ) into v_result
  from tickets t;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.kds_recipe(p_menu_item_id uuid, p_qty numeric DEFAULT 1, p_token text DEFAULT NULL::text, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ri      uuid;
  v_account uuid;
  v_qty     numeric := greatest(coalesce(p_qty, 1), 1);
  v_loc     uuid := p_location_id;
  v_device  kds_device;
  v_result  jsonb;
begin
  select mi.recipe_item_id, mi.account_id into v_ri, v_account
  from menu_item mi where mi.id = p_menu_item_id;
  if v_ri is null then
    return jsonb_build_object('found', false);
  end if;

  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then raise exception 'kds_recipe: token no válido'; end if;
    if v_loc is null then v_loc := v_device.location_id; end if;
    if v_device.account_id <> v_account then
      raise exception 'kds_recipe: el plato no pertenece a la cuenta del dispositivo';
    end if;
  else
    if not belongs_to_account(v_account) then
      raise exception 'kds_recipe: sin acceso';
    end if;
  end if;

  select jsonb_build_object(
    'found', true,
    'qty', v_qty,
    'photo_url', coalesce(
      (select kitchen_photo_url from recipe_item where id = v_ri),
      (select photo_url from menu_item where id = p_menu_item_id)
    ),
    'allergens', (
      select coalesce(jsonb_agg(jsonb_build_object('code', allergen_code, 'state', state)
                                order by allergen_code), '[]'::jsonb)
      from recipe_item_allergen where recipe_item_id = v_ri and state in ('contains','may_contain')
    ),
    'ingredients', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', child.name,
        'unit', u.abbreviation,
        'qty_base', rl.quantity_gross,
        'qty_total', round(rl.quantity_gross * v_qty, 3),
        'cut', ct.name
      ) order by rl.position), '[]'::jsonb)
      from recipe_line rl
      join recipe_item child on child.id = rl.child_item_id
      left join kitchen_unit u on u.id = rl.unit_id
      left join kitchen_cut_type ct on ct.id = rl.cut_type_id
      where rl.parent_item_id = v_ri
    ),
    'steps', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'position', st.position, 'text', st.text, 'kind', st.kind,
        'duration_min', st.duration_min, 'temperature_c', st.temperature_c,
        'photo_url', st.photo_url,
        'ingredients', (
          select coalesce(jsonb_agg(ci.name order by ci.name), '[]'::jsonb)
          from recipe_item_step_line sln
          join recipe_line rl2 on rl2.id = sln.line_id
          join recipe_item ci on ci.id = rl2.child_item_id
          where sln.step_id = st.id
        )
      ) order by st.position), '[]'::jsonb)
      from recipe_item_step st where st.recipe_item_id = v_ri
    )
  ) into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.availability_notices(p_location_id uuid DEFAULT NULL::uuid, p_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device kds_device;
  v_loc    uuid;
  v_result jsonb;
begin
  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then raise exception 'availability_notices: token de dispositivo no válido'; end if;
    v_loc := v_device.location_id;
  else
    if p_location_id is null then raise exception 'availability_notices: falta location_id'; end if;
    v_loc := p_location_id;
    perform public.kds_authorize(v_loc, null); -- valida sesión (belongs_to_account)
  end if;

  select coalesce(jsonb_agg(row_to_json(n) order by n.raised_at desc), '[]'::jsonb)
    into v_result
  from (
    select id, product_name, external_id, recipe_item_id, brands, integrators, reason, raised_at
    from availability_integrator_notice
    where location_id = v_loc and ack_at is null
  ) n;

  return jsonb_build_object('location_id', v_loc, 'notices', v_result);
end;
$function$;

CREATE OR REPLACE FUNCTION public.availability_panel_by_token(p_device_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device      kds_device;
  v_account_id  uuid;
  v_location_id uuid;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'availability_panel_by_token: token no válido';
  end if;
  v_account_id  := v_device.account_id;
  v_location_id := v_device.location_id;

  return coalesce((
    with
    last_off as (
      select ecp.organization_product_id::text as matricula, elm.location_id as loc
      from external_catalog_product ecp
      join external_location_map elm
        on elm.account_id = ecp.account_id and elm.source='lastapp'
       and elm.external_location_id = ecp.external_location_id::text and elm.is_active
      where ecp.account_id = v_account_id and ecp.source='lastapp' and ecp.is_enabled=false
      group by ecp.organization_product_id::text, elm.location_id
    ),
    folvy_off as (
      select pa.external_id as matricula, pa.recipe_item_id as rec_id, pa.location_id as loc,
             pa.reason as r_reason, pa.available_until as r_until, pa.set_at as r_set
      from product_availability pa
      where pa.account_id = v_account_id and pa.is_available = false
    ),
    ident as (
      select mi.external_id,
             max(mi.recipe_item_id::text)                                        as rec,
             min(mi.name)                                                        as nm,
             min(mi.id::text)                                                    as repr_id,
             count(distinct mi.brand_id)                                         as brs,
             array_agg(distinct b.name) filter (where b.name is not null)        as bnames,
             (array_agg(mi.photo_url) filter (where mi.photo_url is not null))[1] as photo
      from menu_item mi
      left join brand b on b.id = mi.brand_id
      where mi.account_id = v_account_id and mi.external_id is not null
      group by mi.external_id
    ),
    unioned as (
      select matricula, loc, true as s_last, false as s_folvy,
             null::text as u_reason, null::timestamptz as u_until, null::timestamptz as u_set
      from last_off
      union all
      select matricula, loc, false, true, r_reason, r_until, r_set
      from folvy_off
    ),
    exp as (
      select u.matricula, u.loc, u.s_last, u.s_folvy, u.u_reason, u.u_until, u.u_set,
             i.rec, i.nm, i.repr_id, i.brs, i.photo, i.external_id as i_ext,
             bn as brand_name
      from unioned u
      left join ident i on i.external_id = u.matricula
      left join lateral unnest(coalesce(i.bnames, array[]::text[])) as bn on true
    ),
    grouped as (
      select coalesce(rec, matricula)                                           as pkey,
             max(nm)                                                            as nm,
             max(repr_id)                                                       as repr,
             max(rec)                                                           as rec,
             loc,
             max(brs)                                                           as brs,
             array_agg(distinct brand_name) filter (where brand_name is not null) as bnames,
             (array_agg(photo) filter (where photo is not null))[1]            as photo,
             bool_or(s_folvy)                                                   as s_folvy,
             bool_or(s_last)                                                    as s_last,
             max(u_reason)                                                      as g_reason,
             max(u_until)                                                       as g_until,
             max(u_set)                                                         as g_set,
             bool_or(i_ext is not null)                                         as tiene_ficha
      from exp
      group by coalesce(rec, matricula), loc
    )
    select jsonb_agg(jsonb_build_object(
      'product_key',                 g.pkey,
      'name',                        coalesce(g.nm,'(producto)'),
      'representative_menu_item_id', g.repr::uuid,
      'recipe_item_id',              g.rec::uuid,
      'location_id',                 g.loc,
      'location_name',               l.name,
      'brands',                      coalesce(g.brs,0)::int,
      'brand_names',                 g.bnames,
      'photo_url',                   g.photo,
      'source_folvy',                g.s_folvy,
      'source_last',                 g.s_last,
      'reason',                      coalesce(g.g_reason,'manual'),
      'available_until',             g.g_until,
      'set_at',                      g.g_set
    ) order by g.nm)
    from grouped g
    left join locations l on l.id = g.loc
    where (v_location_id is null or g.loc = v_location_id or g.loc is null)
      and g.tiene_ficha and coalesce(g.brs,0) > 0
  ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_print_jobs(p_device_token text, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device  kds_device;
  v_jobs    jsonb;
  v_config  jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'claim_print_jobs: token no válido';
  end if;

  if v_device.device_mode is distinct from 'estacion' then
    return '[]'::jsonb;
  end if;

  select jsonb_build_object('bag_qr', coalesce(k.bag_qr, false))
    into v_config
    from kitchen_time_config k
   where k.location_id = v_device.location_id;
  v_config := coalesce(v_config, jsonb_build_object('bag_qr', false));

  with pend as (
    select j.id
    from print_job j
    join printer p on p.id = j.printer_id
    where j.account_id  = v_device.account_id
      and j.location_id = v_device.location_id
      and j.status = 'pending'
      and p.is_active
      and p.transport = 'escpos_network'
    order by j.created_at
    limit p_limit
    for update skip locked
  ),
  upd as (
    update print_job j
    set status = 'sent', sent_at = now(), attempts = attempts + 1
    from pend
    where j.id = pend.id
    returning j.id, j.printer_id, j.doc_type, j.payload
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id',   u.id,
           'doc_type', u.doc_type,
           'payload',  u.payload,
           'config',   v_config,
           'printer',  jsonb_build_object(
                         'id',   p.id,
                         'name', p.name,
                         'ip',   p.config->>'ip',
                         'port', coalesce((p.config->>'port')::int, 9100)
                       )
         )), '[]'::jsonb)
  into v_jobs
  from upd u
  join printer p on p.id = u.printer_id;

  return v_jobs;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_order_status_by_token(p_device_token text, p_sale_id uuid, p_new_status text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device   kds_device;
  v_acc      uuid;
  v_loc      uuid;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_order_status_by_token: token no válido';
  end if;

  select account_id, location_id into v_acc, v_loc from sale where id = p_sale_id;
  if v_acc is null then
    raise exception 'set_order_status_by_token: venta inexistente';
  end if;
  if v_acc <> v_device.account_id then
    raise exception 'set_order_status_by_token: la venta no pertenece a la cuenta del dispositivo';
  end if;
  if v_device.location_id is not null and v_loc is distinct from v_device.location_id then
    raise exception 'set_order_status_by_token: la venta no pertenece al local del dispositivo';
  end if;

  if p_new_status is null or p_new_status not in (
    'new','received','accepted','in_preparation','awaiting_collection',
    'awaiting_shipment','in_delivery','completed','rejected','cancelled','delivery_failed'
  ) then
    raise exception 'set_order_status_by_token: estado no válido %', p_new_status;
  end if;

  update sale
  set order_status = p_new_status,
      updated_at   = now()
  where id = p_sale_id;

  return p_new_status;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_brand_status_by_token(p_device_token text, p_brand_id uuid, p_mode text, p_resume_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason text DEFAULT NULL::text, p_reason_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device       kds_device;
  v_account_id   uuid;
  v_brand_acc    uuid;
  v_brand_name   text;
  v_matriculas   text[];
  v_affected_ids uuid[];
  v_count        int;
  v_secret       text;
  v_log_id       uuid;
  v_action       text;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_brand_status_by_token: token de dispositivo no válido';
  end if;
  v_account_id := v_device.account_id;

  select account_id, name into v_brand_acc, v_brand_name from brand where id = p_brand_id;
  if v_brand_acc is null then
    raise exception 'set_brand_status_by_token: marca % no encontrada', p_brand_id;
  end if;
  if v_brand_acc <> v_account_id then
    raise exception 'set_brand_status_by_token: la marca no pertenece a la cuenta del dispositivo';
  end if;

  if p_mode not in ('normal', 'paused') then
    raise exception 'set_brand_status_by_token: mode no válido % (solo normal|paused)', p_mode;
  end if;

  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception 'set_brand_status_by_token: reason_code no válido %', p_reason_code;
  end if;

  update brand
  set closure_mode      = p_mode,
      closure_resume_at = case when p_mode = 'normal' then null else p_resume_at end,
      closure_reason    = case when p_mode = 'normal' then null else p_reason end,
      closure_set_at    = now(),
      closure_set_by    = null
  where id = p_brand_id;

  select array_agg(distinct external_id) filter (where external_id is not null),
         array_agg(distinct id),
         count(*)
    into v_matriculas, v_affected_ids, v_count
  from menu_item
  where account_id = v_account_id
    and brand_id = p_brand_id
    and stock_group_id is null
    and external_id is not null
    and archived_at is null;

  insert into location_status_log
    (account_id, brand_id, kind, patch_body, mode, resume_at, reason, surface, set_by)
  values
    (v_account_id, p_brand_id, 'brand_closure',
     jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode, 'items', coalesce(v_count, 0)),
     p_mode, p_resume_at, p_reason, 'tablet', null)
  returning id into v_log_id;

  -- ANALÍTICA (C1) — fire-and-forget: nunca bloquea el cierre de marca.
  -- location_id informativo = local del dispositivo (el cierre en sí es de cuenta).
  v_action := case when p_mode = 'normal' then 'open' else 'close' end;
  begin
    insert into availability_event
      (account_id, scope, target_id, target_label, location_id, action, origin,
       reason_code, reason_note, actor_id, surface, resume_at)
    values
      (v_account_id, 'brand', p_brand_id, v_brand_name, v_device.location_id, v_action, 'cocina',
       case when v_action = 'close' then p_reason_code else null end,
       case when v_action = 'close' then p_reason else null end,
       null, 'tablet',
       case when v_action = 'close' then p_resume_at else null end);
  exception when others then
    raise warning 'set_brand_status_by_token: fallo insertando availability_event: %', sqlerrm;
  end;

  if v_matriculas is null or array_length(v_matriculas, 1) = 0 then
    update location_status_log
    set ok = true, error = 'Sin productos por-marca que empujar (todo compartido o sin matrícula)', resolved_at = now()
    where id = v_log_id;
    return jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode, 'items', 0, 'log_id', v_log_id);
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'availability_dispatch_secret';

  if v_secret is null then
    update location_status_log
    set ok = false, error = 'secret availability_dispatch_secret ausente en Vault', resolved_at = now()
    where id = v_log_id;
    raise warning 'set_brand_status_by_token: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    return jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode, 'items', v_count, 'log_id', v_log_id, 'dispatched', false);
  end if;

  perform net.http_post(
    url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/availability-dispatch',
    headers := jsonb_build_object(
      'Content-Type',                   'application/json',
      'x-availability-dispatch-secret', v_secret
    ),
    body    := jsonb_build_object(
      'account_id',              v_account_id,
      'matriculas',               to_jsonb(v_matriculas),
      'affected_menu_item_ids',   to_jsonb(coalesce(v_affected_ids, array[]::uuid[])),
      'external_location_ids',    to_jsonb(array[]::text[]),
      'location_id',              null,
      'available_until',          p_resume_at,
      'enable',                   (p_mode = 'normal'),
      'reason',                   'manual',
      'location_status_log_id',   v_log_id
    )
  );

  return jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode, 'items', v_count, 'log_id', v_log_id, 'dispatched', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_location_status_by_token(p_device_token text, p_mode text, p_resume_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason text DEFAULT NULL::text, p_reason_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device     kds_device;
  v_account_id uuid;
  v_location   uuid;
  v_loc_name   text;
  v_ext_loc    text;
  v_secret     text;
  v_log_id     uuid;
  v_patch      jsonb;
  v_action     text;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_location_status_by_token: token de dispositivo no válido';
  end if;
  v_account_id := v_device.account_id;
  v_location   := v_device.location_id;

  if p_mode not in ('normal', 'busy', 'paused') then
    raise exception 'set_location_status_by_token: mode no válido %', p_mode;
  end if;

  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception 'set_location_status_by_token: reason_code no válido %', p_reason_code;
  end if;

  select name into v_loc_name from locations where id = v_location;

  update locations
  set hubrise_status_mode      = p_mode,
      hubrise_status_resume_at = case when p_mode = 'normal' then null else p_resume_at end,
      hubrise_status_reason    = case when p_mode = 'normal' then null else p_reason end,
      hubrise_status_set_at    = now(),
      hubrise_status_set_by    = null
  where id = v_location;

  select elm.external_location_id into v_ext_loc
  from external_location_map elm
  where elm.account_id = v_account_id and elm.source = 'hubrise' and elm.is_active
    and elm.location_id = v_location
  limit 1;

  v_patch := jsonb_build_object('order_acceptance', jsonb_strip_nulls(jsonb_build_object(
    'mode', p_mode, 'resume_at', p_resume_at, 'reason', p_reason
  )));

  insert into location_status_log
    (account_id, location_id, external_location_id, kind, patch_body, mode, resume_at, reason, surface, set_by)
  values
    (v_account_id, v_location, v_ext_loc, 'order_acceptance', v_patch, p_mode, p_resume_at, p_reason, 'tablet', null)
  returning id into v_log_id;

  -- ANALÍTICA (C1) — fire-and-forget: nunca bloquea el cierre/apertura.
  v_action := case when p_mode = 'normal' then 'open' else 'close' end;
  begin
    insert into availability_event
      (account_id, scope, target_id, target_label, location_id, action, origin,
       reason_code, reason_note, actor_id, surface, resume_at)
    values
      (v_account_id, 'location', v_location, v_loc_name, v_location, v_action, 'cocina',
       case when v_action = 'close' then p_reason_code else null end,
       case when v_action = 'close' then p_reason else null end,
       null, 'tablet',
       case when v_action = 'close' then p_resume_at else null end);
  exception when others then
    raise warning 'set_location_status_by_token: fallo insertando availability_event: %', sqlerrm;
  end;

  if v_ext_loc is null then
    update location_status_log
    set ok = true, error = 'Local sin conexión HubRise: estado guardado solo en Folvy', resolved_at = now()
    where id = v_log_id;
    return jsonb_build_object('location_id', v_location, 'mode', p_mode, 'connected', false, 'log_id', v_log_id);
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'location_status_dispatch_secret';

  if v_secret is null then
    update location_status_log
    set ok = false, error = 'secret location_status_dispatch_secret ausente en Vault', resolved_at = now()
    where id = v_log_id;
    raise warning 'set_location_status_by_token: secret location_status_dispatch_secret ausente en Vault, no se empuja a HubRise';
    return jsonb_build_object('location_id', v_location, 'mode', p_mode, 'connected', true, 'log_id', v_log_id, 'dispatched', false);
  end if;

  perform net.http_post(
    url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/hubrise-location-dispatch',
    headers := jsonb_build_object(
      'Content-Type',                       'application/json',
      'x-location-status-dispatch-secret',  v_secret
    ),
    body    := jsonb_build_object(
      'log_id',               v_log_id,
      'account_id',           v_account_id,
      'external_location_id', v_ext_loc,
      'patch_body',           v_patch
    )
  );

  return jsonb_build_object('location_id', v_location, 'mode', p_mode, 'connected', true, 'log_id', v_log_id, 'dispatched', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_product_availability_by_token(p_device_token text, p_menu_item_id uuid, p_is_available boolean, p_reason text DEFAULT 'manual'::text, p_available_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device kds_device; v_account_id uuid; v_location_id uuid; v_mi_account uuid;
  v_core jsonb; v_matriculas text[]; v_affected_ids uuid[]; v_brands int;
  v_ext_locs text[]; v_channels int; v_secret text;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_product_availability_by_token: token de dispositivo no valido';
  end if;
  v_account_id := v_device.account_id; v_location_id := v_device.location_id;

  select mi.account_id into v_mi_account from menu_item mi where mi.id = p_menu_item_id;
  if v_mi_account is null then
    raise exception 'set_product_availability_by_token: producto % no encontrado', p_menu_item_id;
  end if;
  if v_mi_account <> v_account_id then
    raise exception 'set_product_availability_by_token: el producto no pertenece a la cuenta del dispositivo';
  end if;

  v_core := public._set_product_availability_core(
    p_menu_item_id, p_is_available, v_location_id, p_reason, p_available_until, p_reason_code,
    v_account_id, null, 'cocina', 'tablet');
  v_matriculas := array(select jsonb_array_elements_text(v_core->'matriculas'));
  v_affected_ids := array(select (jsonb_array_elements_text(v_core->'affected_ids'))::uuid);
  v_brands := coalesce((v_core->>'brands')::int, 0);

  select array_agg(distinct elm.external_location_id) into v_ext_locs from external_location_map elm
  where elm.account_id = v_account_id and elm.source = 'lastapp' and elm.is_active
    and elm.location_id = v_location_id;

  if v_matriculas is not null and array_length(v_matriculas, 1) > 0 then
    select count(distinct ecp.external_channel) into v_channels from external_catalog_product ecp
    where ecp.account_id = v_account_id and ecp.organization_product_id::text = any(v_matriculas)
      and (v_ext_locs is null or ecp.external_location_id::text = any(v_ext_locs));
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'availability_dispatch_secret';
    if v_secret is not null then
      perform net.http_post(
        url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/availability-dispatch',
        headers := jsonb_build_object('Content-Type','application/json','x-availability-dispatch-secret', v_secret),
        body := jsonb_build_object(
          'account_id', v_account_id, 'matriculas', to_jsonb(v_matriculas),
          'affected_menu_item_ids', to_jsonb(coalesce(v_affected_ids, array[]::uuid[])),
          'external_location_ids', to_jsonb(coalesce(v_ext_locs, array[]::text[])),
          'location_id', v_location_id, 'available_until', p_available_until,
          'enable', p_is_available, 'reason', p_reason));
    else
      raise warning 'set_product_availability_by_token: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    end if;
  end if;

  return jsonb_build_object('brands', v_brands, 'channels', coalesce(v_channels, 0),
    'matriculas', coalesce(array_length(v_matriculas, 1), 0), 'location_id', v_location_id,
    'external_locations', coalesce(array_length(v_ext_locs, 1), 0));
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_products_availability_bulk_by_token(p_device_token text, p_menu_item_ids uuid[], p_is_available boolean, p_reason text DEFAULT 'manual'::text, p_available_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device kds_device; v_account_id uuid; v_location_id uuid; v_n_found int;
  v_mi uuid; v_core jsonb; v_all_matr text[] := array[]::text[]; v_all_ids uuid[] := array[]::uuid[];
  v_failed jsonb := '[]'::jsonb; v_products_ok int := 0; v_ext_locs text[]; v_channels int; v_secret text;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_products_availability_bulk_by_token: token de dispositivo no valido';
  end if;
  v_account_id := v_device.account_id; v_location_id := v_device.location_id;

  if p_menu_item_ids is null or array_length(p_menu_item_ids, 1) is null then
    raise exception 'set_products_availability_bulk_by_token: la seleccion esta vacia';
  end if;
  if array_length(p_menu_item_ids, 1) > 50 then
    raise exception 'set_products_availability_bulk_by_token: maximo 50 productos por operacion (recibidos %)', array_length(p_menu_item_ids, 1);
  end if;
  if p_reason is null or p_reason not in ('manual','stock_out','schedule') then
    raise exception 'set_products_availability_bulk_by_token: reason no valido %', p_reason;
  end if;
  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception 'set_products_availability_bulk_by_token: reason_code no valido %', p_reason_code;
  end if;

  select count(*) into v_n_found from menu_item
  where id = any(p_menu_item_ids) and account_id = v_account_id;
  if v_n_found <> array_length(p_menu_item_ids, 1) then
    raise exception 'set_products_availability_bulk_by_token: algun producto de la seleccion no existe en esta cuenta';
  end if;

  foreach v_mi in array p_menu_item_ids loop
    begin
      v_core := public._set_product_availability_core(
        v_mi, p_is_available, v_location_id, p_reason, p_available_until, p_reason_code,
        v_account_id, null, 'cocina', 'tablet');
      v_all_matr := v_all_matr || array(select jsonb_array_elements_text(v_core->'matriculas'));
      v_all_ids := v_all_ids || array(select (jsonb_array_elements_text(v_core->'affected_ids'))::uuid);
      v_products_ok := v_products_ok + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object('menu_item_id', v_mi, 'error', sqlerrm);
    end;
  end loop;

  select array_agg(distinct x) into v_all_matr from unnest(v_all_matr) x;
  select array_agg(distinct x) into v_all_ids from unnest(v_all_ids) x;

  select array_agg(distinct elm.external_location_id) into v_ext_locs from external_location_map elm
  where elm.account_id = v_account_id and elm.source = 'lastapp' and elm.is_active
    and elm.location_id = v_location_id;

  if v_all_matr is not null and array_length(v_all_matr, 1) > 0 then
    select count(distinct ecp.external_channel) into v_channels from external_catalog_product ecp
    where ecp.account_id = v_account_id and ecp.organization_product_id::text = any(v_all_matr)
      and (v_ext_locs is null or ecp.external_location_id::text = any(v_ext_locs));
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'availability_dispatch_secret';
    if v_secret is not null then
      perform net.http_post(
        url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/availability-dispatch',
        headers := jsonb_build_object('Content-Type','application/json','x-availability-dispatch-secret', v_secret),
        body := jsonb_build_object(
          'account_id', v_account_id, 'matriculas', to_jsonb(v_all_matr),
          'affected_menu_item_ids', to_jsonb(coalesce(v_all_ids, array[]::uuid[])),
          'external_location_ids', to_jsonb(coalesce(v_ext_locs, array[]::text[])),
          'location_id', v_location_id, 'available_until', p_available_until,
          'enable', p_is_available, 'reason', p_reason));
    else
      raise warning 'set_products_availability_bulk_by_token: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    end if;
  end if;

  return jsonb_build_object('products', v_products_ok,
    'brands', coalesce((select count(distinct brand_id) from menu_item
                        where id = any(v_all_ids) and account_id = v_account_id), 0),
    'channels', coalesce(v_channels, 0),
    'matriculas', coalesce(v_all_matr, array[]::text[]), 'failed', v_failed);
end;
$function$;

CREATE OR REPLACE FUNCTION public.orders_feed_by_token(p_device_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device      kds_device;
  v_account_id  uuid;
  v_location_id uuid;
  v_result      jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'orders_feed_by_token: token no válido';
  end if;
  v_account_id  := v_device.account_id;
  v_location_id := v_device.location_id;
  if v_location_id is null then
    raise exception 'orders_feed_by_token: el dispositivo no tiene local asignado';
  end if;

  with vivos as (
    select s.id, s.external_ref, s.external_tab_ref,
           s.platform_order_code, s.pos_short_code,
           s.order_status, s.status, s.service_type, s.source,
           s.brand_id, s.channel_id, s.external_channel_text,
           s.customer_name, s.customer_phone, s.delivery_address,
           s.expected_time, s.customer_note,
           s.total, s.paid, s.payment_method, s.discount_amount, s.delivery_cost,
           -- Reparto (paridad con orders_feed) + campos de rider de Catcher.
           s.dispatch_mode, s.carrier_code, s.delivery_state,
           s.rider_name, s.rider_phone, s.eta_pickup, s.eta_delivery, s.transport_price, s.dispatch_error,
           s.rider_transport_type, s.rider_lat, s.rider_lng, s.rider_seen_at, s.has_courier,
           -- Hitos de tiempo: KPI de cocina (accepted_at/ready_at) y reparto.
           s.accepted_at, s.ready_at, s.handed_to_courier_at, s.delivered_at,
           s.opened_at, s.closed_at, s.cancelled_at, s.sold_at, s.raw_tab,
           coalesce(s.opened_at, s.sold_at, s.created_at) as entro_at
    from sale s
    where s.location_id = v_location_id
      and s.account_id  = v_account_id
      and s.order_status is not null
      -- GUARDARRAÍL DE PAGO (idéntico a orders_feed): no mostrar en la tablet un
      -- pedido del Shop pagado online cuyo pago no esté confirmado.
      and not (
        s.source = 'folvy_shop'
        and s.payment_method = 'stripe'
        and coalesce(s.payment_status,'pending') <> 'paid'
      )
      and (
        s.order_status not in ('completed','rejected','cancelled','delivery_failed')
        or coalesce(s.closed_at, s.cancelled_at, s.sold_at, s.opened_at) >= now() - interval '6 hours'
      )
  ),
  notas as (
    select v.id as sale_id,
           (prod->>'organizationProductId') as ext_pid,
           nullif(btrim(prod->>'comments'), '') as note
    from vivos v
    cross join lateral (select safe_jsonb(v.raw_tab) as tab) rt
    cross join lateral (
      select coalesce(rt.tab -> 'products', rt.tab -> 'bills' -> 0 -> 'products') as products
    ) p
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.products) = 'array' then p.products else '[]'::jsonb end
    ) as prod
    where nullif(btrim(prod->>'comments'), '') is not null
      and (prod->>'organizationProductId') is not null
  ),
  padres as (
    select sl.sale_id, sl.id as line_id, sl.product_name, sl.quantity,
           sl.line_type, sl.menu_item_id, sl.external_product_id,
           sl.unit_price, sl.line_total,
           coalesce(ls.marked, false) as marked,
           mi.category               as menu_category,
           df.name                   as family,
           df.color                  as family_color,
           df.icon                   as family_icon,
           array(select allergen_code from recipe_item_allergen a
                  where a.recipe_item_id = ri.id and a.state = 'contains') as allergens
    from sale_line sl
    left join menu_item mi on mi.id = sl.menu_item_id
    left join recipe_item ri on ri.id = mi.recipe_item_id
    left join recipe_family df on df.id = ri.family_id
    left join kds_line_state ls on ls.sale_line_id = sl.id
    where sl.sale_id in (select id from vivos)
      and sl.parent_sale_line_id is null
  ),
  hijas as (
    select sl.parent_sale_line_id, sl.sale_id, sl.id as line_id,
           sl.product_name, sl.quantity, sl.line_type, sl.external_product_id,
           sl.menu_item_id,
           mg.group_type,
           dfh.name  as family,
           dfh.color as family_color,
           mih.category as menu_category,
           case
             when sl.line_type = 'combo_item'                      then 1
             when mg.group_type = 'removal'                        then 2
             when mg.group_type = 'extras'                         then 3
             when mg.group_type in ('choice','side')               then 4
             when mg.group_type in ('cross_sell','info')           then 6
             else 5
           end as sort_rank
    from sale_line sl
    left join modifier_option mo on mo.id = sl.modifier_option_id
    left join modifier_group  mg on mg.id = mo.modifier_group_id
    left join menu_item   mih on mih.id = sl.menu_item_id
    left join recipe_item rih on rih.id = mih.recipe_item_id
    left join recipe_family dfh on dfh.id = rih.family_id
    where sl.sale_id in (select id from vivos)
      and sl.parent_sale_line_id is not null
  ),
  tickets as (
    select v.id as sale_id, v.external_ref, v.external_tab_ref,
           v.platform_order_code, v.pos_short_code,
           v.order_status, v.status, v.service_type, v.source,
           b.name as brand,
           b.logo_url as brand_logo_url, b.color as brand_color,
           b.shop_url as brand_shop_url, b.qr_caption as brand_qr_caption,
           b.ownership_type as brand_ownership_type,
           coalesce(ch.name, v.external_channel_text) as channel,
           v.channel_id,
           v.customer_name, v.customer_phone, v.delivery_address,
           v.expected_time, v.customer_note,
           v.total, v.paid, v.payment_method, v.discount_amount, v.delivery_cost,
           -- Reparto (paridad con orders_feed) + campos de rider de Catcher.
           v.dispatch_mode, v.carrier_code, v.delivery_state,
           v.rider_name, v.rider_phone, v.eta_pickup, v.eta_delivery, v.transport_price, v.dispatch_error,
           v.rider_transport_type, v.rider_lat, v.rider_lng, v.rider_seen_at, v.has_courier,
           v.accepted_at, v.ready_at, v.handed_to_courier_at, v.delivered_at,
           v.entro_at,
           round(extract(epoch from (now() - v.entro_at)) / 60.0)::int as minutos,
           coalesce((select jsonb_agg(jsonb_build_object(
                'line_id', l.line_id, 'name', l.product_name, 'qty', l.quantity,
                'menu_item_id', l.menu_item_id,
                'unit_price', l.unit_price, 'line_total', l.line_total,
                'marked', l.marked, 'allergens', l.allergens,
                'family', l.family, 'family_color', l.family_color,
                'family_icon', l.family_icon, 'menu_category', l.menu_category,
                'has_recipe', (l.menu_item_id is not null),
                'customer_note', (
                  select n.note from notas n
                   where n.sale_id = l.sale_id and n.ext_pid = l.external_product_id limit 1
                ),
                'children', coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'line_id', h.line_id, 'name', h.product_name, 'qty', h.quantity,
                           'line_type', h.line_type,
                           'group_type', h.group_type,
                           'menu_item_id', h.menu_item_id,
                           'family', h.family, 'family_color', h.family_color,
                           'menu_category', h.menu_category,
                           'customer_note', (
                             select n2.note from notas n2
                              where n2.sale_id = h.sale_id and n2.ext_pid = h.external_product_id limit 1
                           )
                         ) order by h.sort_rank, h.product_name)
                  from hijas h where h.parent_sale_line_id = l.line_id
                ), '[]'::jsonb)
            ) order by l.product_name)
            from padres l where l.sale_id = v.id), '[]'::jsonb) as lineas
    from vivos v
    left join brand b on b.id = v.brand_id
    left join sales_channel ch on ch.id = v.channel_id
  )
  select jsonb_build_object(
    'location_id', v_location_id,
    'now', now(),
    'orders', coalesce(
      jsonb_agg(to_jsonb(t) order by t.entro_at) filter (where t.sale_id is not null),
      '[]'::jsonb)
  ) into v_result
  from tickets t;

  return v_result;
end;
$function$;

-- ── Verificación embebida (además del checklist manual del encargo) ──────────
do $$
declare
  v_writers int;
begin
  select count(*) into v_writers
  from pg_proc
  where pronamespace = 'public'::regnamespace and prosrc ~* 'update\s+kds_device';
  -- Esperado: 3 (kds_heartbeat + report_device_app_version + set_device_mode_by_token).
  -- Las 13 de lectura ya no escriben. Ver nota de cabecera sobre el checklist §8.1.
  if v_writers <> 3 then
    raise exception 'kds_heartbeat_remove_writes: % funciones escriben kds_device (se esperaban 3) — revisar antes de continuar', v_writers;
  end if;
end $$;

notify pgrst, 'reload schema';
