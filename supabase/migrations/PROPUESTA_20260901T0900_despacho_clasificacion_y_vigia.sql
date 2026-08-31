-- PROPUESTA_20260901T0900_despacho_clasificacion_y_vigia.sql
-- ============================================================================
-- NO APLICADA. Claude Code propone, Julio ejecuta y verifica.
-- Al aplicarla: renombrar a la hora real y quitar el prefijo PROPUESTA_.
--
-- ENCARGO CODE (31/08 noche) «Folvy despacha a Catcher pedidos que reparte la
-- plataforma», puntos 1 y 2 del reparto de Julio.
--
-- SIN TOCAR hubrise-webhook. Regla permanente de la casa: es el camino vivo de
-- los pedidos de Alcalá y no se despliega. La correccion va donde ya viven las
-- otras guardas: en la base de datos, sobre `sale`.
--
-- POR QUE ESTO FUNCIONA SIN EL WEBHOOK (verificado antes de escribir nada):
--   trg_auto_dispatch es AFTER INSERT OR UPDATE.
--   Un trigger BEFORE que reescriba NEW.service_type se ejecuta ANTES, asi que
--   el despachador ya lee el valor corregido. No hay carrera ni orden fragil:
--   BEFORE siempre precede a AFTER, sin depender del nombre del trigger.
--   Y como el webhook hace UPSERT, el BEFORE UPDATE vuelve a corregir en cada
--   actualizacion: si el webhook reescribe own_delivery, se recorrige sola.
--
-- LO QUE ESTA MIGRACION NO HACE, A PROPOSITO
--   · No cierra las alarmas falsas (punto 5). Eso reescribe historico y va
--     aparte, con su huella antes/despues.
--   · No toca el grano marca x plataforma (punto 3). Sigue en pie y es otro lote.
--   · No corrige el service_type del historico. Solo actua de aqui en adelante.
-- ============================================================================

begin;

-- ── 1. La clasificacion respeta el interruptor ─────────────────────────────
-- SOLO cuando el interruptor esta EXPLICITAMENTE apagado (`false`).
--
-- NO se usa coalesce(own_delivery_enabled, ownership_type='own') como hace
-- resolve_dispatch, y es deliberado: ese coalesce convertiria en
-- platform_delivery a toda marca CEDIDA con el interruptor a null, y hay 15
-- pedidos de reparto propio de una marca cedida por Just Eat. Apagar eso de
-- rebote seria romper reparto que hoy funciona para arreglar el que no.
-- Aqui solo actua lo que alguien ha apagado a mano. Lo que esta a null es
-- «no se sabe», y eso lo resuelve el punto 4 del encargo, no esto.
--
-- Solo BAJA (own_delivery -> platform_delivery). Nunca al reves: este trigger
-- no puede encender reparto propio que nadie pidio.
create or replace function public.tg_sale_service_type_por_interruptor()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_apagado boolean;
begin
  if new.brand_id is null then return new; end if;
  if coalesce(new.source, '') <> 'hubrise' then return new; end if;
  if new.service_type is distinct from 'own_delivery' then return new; end if;

  select b.own_delivery_enabled is false
    into v_apagado
    from public.brand b
   where b.id = new.brand_id;

  if v_apagado then
    new.service_type := 'platform_delivery';
  end if;
  return new;
end;
$function$;

comment on function public.tg_sale_service_type_por_interruptor() is
  'ENCARGO 31/08: un pedido de HubRise de una marca con own_delivery_enabled = '
  'false entra como platform_delivery, no como own_delivery. Se corrige AQUI y '
  'no en hubrise-webhook porque ese webhook no se despliega (camino vivo de '
  'Alcala). BEFORE, para que trg_auto_dispatch (AFTER) ya lea el valor bueno.';

drop trigger if exists trg_sale_service_type_por_interruptor on public.sale;
create trigger trg_sale_service_type_por_interruptor
  before insert or update on public.sale
  for each row execute function public.tg_sale_service_type_por_interruptor();

-- ── 2. Sin direccion no se despacha: condicion PREVIA, con su mensaje ──────
-- Hoy la comprobacion existe pero vive DENTRO de catcher-dispatch, al final de
-- todo: el pedido ya se clasifico como propio, ya salio en el tablero, ya se
-- intento el despacho, y el rechazo llega como efecto secundario. Nos salvo
-- —los 4 «sin coordenadas» son esa guarda— pero llega tarde y solo por un
-- camino.
--
-- Aqui pasa a ser una condicion previa del RESOLUTOR, que es por donde entra
-- el despacho automatico. El boton manual la comprueba por su cuenta antes de
-- invocar (va en el front, en el mismo lote).
--
-- No se puede repartir lo que no se sabe donde va.
create or replace function public.resolve_dispatch(p_sale_id uuid)
 returns table(carrier text, reason text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_sale   record;
  v_mode   text;
  v_broker text;
  v_rule   record;
  v_now    timestamptz := now();
  v_dow    int;
  v_time   time;
  v_avail  int;
  v_rt     jsonb;
  v_dlat   numeric;
  v_dlng   numeric;
  v_llat   numeric;
  v_llng   numeric;
  v_dist   numeric;
  v_chain  text[];
  v_c      text;
  v_brand_enabled boolean;
BEGIN
  SELECT s.account_id, s.location_id, s.brand_id, s.total, s.service_type, s.raw_tab,
         s.delivery_address
    INTO v_sale FROM public.sale s WHERE s.id = p_sale_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, 'venta no encontrada'::text; RETURN;
  END IF;

  -- GUARD: interruptor de reparto propio por marca.
  -- own_delivery_enabled NULL → deriva de ownership_type (propia=on, cedida=off).
  -- Si está apagado → no despacha a nadie (ni flota ni Catcher). Corta aquí.
  IF v_sale.brand_id IS NOT NULL THEN
    SELECT coalesce(b.own_delivery_enabled, b.ownership_type = 'own')
      INTO v_brand_enabled
      FROM public.brand b WHERE b.id = v_sale.brand_id;
    IF v_brand_enabled IS NOT TRUE THEN
      RETURN QUERY SELECT NULL::text, 'marca sin reparto propio (interruptor apagado)'::text;
      RETURN;
    END IF;
  END IF;

  -- GUARD NUEVO (31/08): SIN DIRECCION NO SE DESPACHA. Condicion previa, antes
  -- de mirar reglas, distancias o repartidores. No se puede repartir lo que no
  -- se sabe donde va, y en Glovo la ausencia de direccion es justamente la
  -- señal de que reparte la plataforma.
  IF coalesce(btrim(v_sale.delivery_address), '') = '' THEN
    RETURN QUERY SELECT NULL::text,
      'sin dirección: este pedido no lo repartimos nosotros'::text;
    RETURN;
  END IF;

  SELECT coalesce(l.dispatch_mode,'auto'), coalesce(l.dispatch_broker,'catcher'), l.lat, l.lng
    INTO v_mode, v_broker, v_llat, v_llng
    FROM public.locations l WHERE l.id = v_sale.location_id;
  v_broker := coalesce(v_broker,'catcher');

  v_rt := CASE WHEN left(btrim(coalesce(v_sale.raw_tab,'')),1)='{' THEN v_sale.raw_tab::jsonb ELSE '{}'::jsonb END;
  v_dlat := nullif(v_rt->'delivery'->>'latitude','')::numeric;
  v_dlng := nullif(v_rt->'delivery'->>'longitude','')::numeric;
  IF v_llat IS NOT NULL AND v_llng IS NOT NULL AND v_dlat IS NOT NULL AND v_dlng IS NOT NULL THEN
    v_dist := round((2*6371*asin(sqrt(
      power(sin(radians(v_dlat - v_llat)/2),2) +
      cos(radians(v_llat))*cos(radians(v_dlat))*
      power(sin(radians(v_dlng - v_llng)/2),2)
    )))::numeric, 1);
  END IF;

  v_dow  := ((extract(dow FROM (v_now AT TIME ZONE 'Europe/Madrid'))::int) + 6) % 7;
  v_time := (v_now AT TIME ZONE 'Europe/Madrid')::time;

  SELECT * INTO v_rule
  FROM public.dispatch_rule r
  WHERE r.is_active
    AND r.account_id = v_sale.account_id
    AND (r.location_id IS NULL OR r.location_id = v_sale.location_id)
    AND (r.weekdays IS NULL OR v_dow = ANY(r.weekdays))
    AND (r.time_from IS NULL OR r.time_to IS NULL OR
         (CASE WHEN r.time_from <= r.time_to
               THEN v_time >= r.time_from AND v_time < r.time_to
               ELSE v_time >= r.time_from OR  v_time < r.time_to END))
    AND (r.min_total IS NULL OR v_sale.total >= r.min_total)
    AND (r.max_total IS NULL OR v_sale.total <  r.max_total)
  ORDER BY r.priority ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT v_broker, ('sin regla -> broker por defecto ('||v_broker||')')::text; RETURN;
  END IF;

  v_chain := v_rule.carrier_chain;
  IF v_chain IS NULL OR array_length(v_chain,1) IS NULL THEN
    v_chain := array_remove(ARRAY[v_rule.then_carrier, v_rule.fallback_carrier], NULL);
  END IF;
  IF array_length(v_chain,1) IS NULL THEN
    RETURN QUERY SELECT v_broker, ('regla '||v_rule.priority||' sin cadena -> broker por defecto')::text; RETURN;
  END IF;

  FOREACH v_c IN ARRAY v_chain LOOP
    IF v_c = 'own_fleet' THEN
      IF v_rule.max_distance_km IS NOT NULL AND v_dist IS NOT NULL AND v_dist > v_rule.max_distance_km THEN
        CONTINUE;
      END IF;
      SELECT count(*) INTO v_avail
      FROM public.courier c
      WHERE c.account_id = v_sale.account_id AND c.active AND c.on_shift
        AND (c.assigned_locations = '{}'::uuid[] OR v_sale.location_id = ANY(c.assigned_locations));
      IF v_avail > 0 THEN
        RETURN QUERY SELECT 'own_fleet'::text,
          ('regla '||v_rule.priority||' -> propio ('||v_avail||' en turno'||coalesce(', '||v_dist||' km','')||')')::text;
        RETURN;
      END IF;
    ELSE
      RETURN QUERY SELECT v_c, ('regla '||v_rule.priority||' -> '||v_c||' (cadena)')::text;
      RETURN;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_broker,
    ('regla '||v_rule.priority||' -> cadena agotada; broker por defecto ('||v_broker||')')::text;
END;
$function$;

-- ── 3. El vigia deja de afirmar lo que no sabe ─────────────────────────────
-- Lo que hacia: marcaba como alarma «no_rider» todo pedido own_delivery sin
-- carrier_order_id pasado el margen, y escribia
--     «Enviado a Catcher, sin rider tras 8 min»
-- SIN COMPROBAR si se habia enviado. Cuando resolve_dispatch se negaba —marca
-- sin reparto propio, o ahora sin direccion— el pedido no salio a ningun sitio
-- y el vigia decia que si. De las 9 alarmas de las dos marcas, 5 son esa frase
-- inventada; las otras 4 son la guarda real de catcher-dispatch.
--
-- Confirmado por Julio: has_courier y handed_to_courier_at nulos en los 9.
-- NINGUNO llego a Catcher.
--
-- Ahora pregunta al resolutor ANTES de alarmar:
--   · carrier null  → no se envio. No es un «sin rider»: se dice el motivo real
--                     y NO se usa la palabra «enviado».
--   · carrier no null → se envio de verdad y no vino rider: la alarma de antes.
create or replace function public.dispatch_watchdog_scan(p_grace_minutes integer)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_count integer := 0;
  v_row   record;
  v_carrier text;
  v_reason  text;
begin
  for v_row in
    select s.id, s.dispatch_error
      from public.sale s
      join public.locations l on l.id = s.location_id
     where s.service_type = 'own_delivery'
       and coalesce(l.dispatch_mode,'auto') = 'auto'
       and s.order_status in ('accepted','in_preparation','awaiting_collection')
       and s.carrier_order_id is null
       and s.delivery_alarm_at is null
       and s.created_at > now() - interval '24 hours'
       and now() - coalesce(s.accepted_at, s.created_at) > make_interval(mins => greatest(p_grace_minutes,1))
       and not exists (
         select 1 from public.delivery_assignment da
          where da.sale_id = s.id and da.state not in ('failed','canceled'))
  loop
    select carrier, reason into v_carrier, v_reason
      from public.resolve_dispatch(v_row.id);

    if v_carrier is null then
      -- NO SE ENVIO. El guard hizo su trabajo. Se marca para que se vea, pero
      -- con el motivo REAL y sin decir «enviado»: afirmar un envio que no pasó
      -- es lo que hizo creer durante 20 dias que el interruptor no se leia.
      update public.sale s
         set delivery_alarm_at    = now(),
             delivery_alarm_kind   = 'no_despachado',
             delivery_alarm_ack_at = null,
             dispatch_error        = 'No se despachó: ' || coalesce(v_reason, 'sin motivo del resolutor'),
             updated_at            = now()
       where s.id = v_row.id;
    else
      update public.sale s
         set delivery_alarm_at    = now(),
             delivery_alarm_kind   = 'no_rider',
             delivery_alarm_ack_at = null,
             dispatch_error        = case
               when s.dispatch_error is not null and btrim(s.dispatch_error) <> ''
                 then 'No se pudo enviar a Catcher: ' || s.dispatch_error
               else 'Enviado a Catcher, sin rider tras ' || p_grace_minutes || ' min. Revisar/despachar a mano.'
             end,
             updated_at            = now()
       where s.id = v_row.id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

-- ── 4. GUARDA ──────────────────────────────────────────────────────────────
do $ver$
declare v_n int; v_carrier text; v_reason text;
begin
  if to_regprocedure('public.tg_sale_service_type_por_interruptor()') is null then
    raise exception 'el trigger de clasificacion no quedo creado';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                  where c.relname='sale' and t.tgname='trg_sale_service_type_por_interruptor') then
    raise exception 'trg_sale_service_type_por_interruptor no quedo enganchado a sale';
  end if;
  -- Tiene que ser BEFORE: si fuese AFTER, trg_auto_dispatch ya habria leido el
  -- service_type viejo y todo esto no serviria de nada.
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                  where c.relname='sale' and t.tgname='trg_sale_service_type_por_interruptor'
                    and (t.tgtype & 2) = 2) then
    raise exception 'trg_sale_service_type_por_interruptor no es BEFORE: no serviria';
  end if;

  -- El resolutor sigue teniendo UNA sola firma (regla 2: nada de sobrecargas).
  select count(*) into v_n from pg_proc
   where pronamespace='public'::regnamespace and proname='resolve_dispatch';
  if v_n <> 1 then
    raise exception 'resolve_dispatch tiene % firmas, deberia tener 1', v_n;
  end if;
  select count(*) into v_n from pg_proc
   where pronamespace='public'::regnamespace and proname='dispatch_watchdog_scan';
  if v_n <> 1 then
    raise exception 'dispatch_watchdog_scan tiene % firmas, deberia tener 1', v_n;
  end if;

  raise notice 'VERIFICACION OK: trigger BEFORE en sale, resolve_dispatch y vigia con una firma cada uno';
end
$ver$;

commit;

-- ── COMPROBACIONES DESPUES DE APLICAR ──────────────────────────────────────
-- 1) Verificacion 2 del encargo — el interruptor pasa a leerse en la
--    clasificacion. Sobre los pedidos ya existentes NO cambia nada (esto solo
--    actua al insertar/actualizar), asi que se comprueba en seco:
--      select b.name, b.own_delivery_enabled,
--             (b.own_delivery_enabled is false) as entraria_como_plataforma
--        from brand b where b.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
--         and b.name in ('Smash Brothers Burgers','Lovers Burgers');
--      -- esperado: las dos true.
--
-- 2) Verificacion 3 — quien SI reparte sigue igual. Milanesa House y Mila's
--    tienen el interruptor a null, asi que el trigger no las toca:
--      select b.name, b.own_delivery_enabled from brand b
--       where b.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
--         and b.name in ('Milanesa House','Mila''s Sandwiches');
--      -- esperado: null en las dos -> el trigger las ignora.
--
-- 3) El vigia ya no inventa. Con un pedido own_delivery de marca apagada:
--      select carrier, reason from resolve_dispatch('<sale_id>');
--      -- carrier null -> el vigia escribira «No se despachó: ...», nunca «Enviado».
--
-- 4) Huella del historico ANTES y DESPUES (verificacion 7 del encargo):
--      select count(*) as ventas,
--             md5(string_agg(id::text||':'||coalesce(dispatch_mode,'-')||':'
--                            ||coalesce(dispatch_error,'-')||':'
--                            ||coalesce(delivery_alarm_at::text,'-'), ',' order by id)) as huella
--        from sale;
--      -- Esta migracion NO reescribe historico: la huella debe ser IDENTICA.
