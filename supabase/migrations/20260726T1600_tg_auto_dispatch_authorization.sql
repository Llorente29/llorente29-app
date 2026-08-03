-- ============================================================================
-- Folvy · tg_auto_dispatch — versionar el arreglo del 401 (incidente 26/07/2026)
--
-- QUÉ PASÓ
-- Al redesplegar catcher-dispatch (v38) con el código de pase, `supabase
-- functions deploy` ENCENDIÓ verify_jwt. El disparador llamaba a la edge con el
-- secreto interno pero SIN cabecera Authorization, así que la puerta de Supabase
-- devolvía 401 ANTES de entrar en la función: ningún pedido de reparto propio se
-- auto-despachó durante horas, sin rider y sin error visible en ninguna parte.
-- Sólo salió lo que se pulsó a mano.
--
-- POR QUÉ ESTE ARREGLO Y NO --no-verify-jwt
-- Apagar verify_jwt "arregla" el trigger y a la vez abre la función a cualquiera
-- que conozca la URL: con un sale_id se podría despachar un pedido desde fuera.
-- El diseño correcto —y el que está vivo— es verify_jwt ENCENDIDO + el trigger
-- mandando Authorization: Bearer <anon>, con el secreto interno haciendo de
-- seguridad real. Los dos caminos, el automático y el manual, quedan cerrados.
--
--   ⚠️ NO QUITAR la cabecera Authorization de este trigger. No sobra: sin ella
--   la llamada muere en la puerta con 401 y el auto-despacho deja de existir en
--   silencio. El token anon es público (exp 2036) y no da acceso a nada por sí
--   solo; lo que autoriza de verdad es x-catcher-dispatch-secret.
--
-- Esta migración es un VOLCADO VERBATIM de la función viva (pg_get_functiondef,
-- 26/07/2026 tras verificar el pedido a130b1: rider en 2 s y respuesta 200 con
-- carrier_order_id). No se ha reescrito de memoria ni se cambia comportamiento:
-- sólo se lleva al repo lo que ya corre, para que el repo deje de ir por detrás.
-- Respecto a la última versión versionada (20260721T3000_cfg7_nearest) hay DOS
-- diferencias, ambas ya vivas: la cabecera Authorization y que el secreto se lee
-- de Vault en vez de estar escrito en el código.
--
-- config.toml: catcher-dispatch NO tiene entrada, así que queda en el default
-- verify_jwt = true. Es lo correcto — nunca desplegar esta función con
-- --no-verify-jwt.
--
-- Aplicar a mano en el SQL Editor. Sin begin/commit. Sin RPC nueva (no hace
-- falta notify pgrst). Idempotente: CREATE OR REPLACE de la misma definición.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_auto_dispatch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_mode     text;
  v_carrier  text;
  v_reason   text;
  v_strategy text;
  v_timeout  int;
  v_courier  uuid;
  v_secret   text;
  v_url      text := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/catcher-dispatch';
  -- Clave anon del proyecto (pública, exp 2036). Sólo sirve para pasar la puerta
  -- de verify_jwt; la autorización real es el secreto interno de Vault.
  v_anon     text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6bXBuY2hsZ3VpYmNsdnh5eW50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzE1NTksImV4cCI6MjA5Mzc0NzU1OX0.v5GsOW5hxwzJZA0z5Le26E9vAWflG1XFZ7ec2hvMphY';
BEGIN
  IF new.service_type = 'own_delivery'
     AND new.order_status = 'accepted'
     AND new.carrier_order_id IS NULL
     AND (tg_op = 'INSERT' OR old.order_status IS DISTINCT FROM new.order_status)
  THEN
    IF EXISTS (SELECT 1 FROM public.delivery_assignment da
               WHERE da.sale_id = new.id AND da.state NOT IN ('failed','canceled')) THEN
      RETURN new;
    END IF;

    SELECT coalesce(l.dispatch_mode,'auto') INTO v_mode
      FROM public.locations l WHERE l.id = new.location_id;
    IF v_mode <> 'auto' THEN RETURN new; END IF;

    SELECT carrier, reason INTO v_carrier, v_reason FROM public.resolve_dispatch(new.id);

    IF v_carrier = 'own_fleet' THEN
      SELECT coalesce(l.assignment_strategy,'broadcast'), coalesce(l.offer_timeout_s,60)
        INTO v_strategy, v_timeout FROM public.locations l WHERE l.id = new.location_id;

      IF v_strategy = 'nearest' THEN
        SELECT c.id INTO v_courier
          FROM public.courier c, public.locations l
         WHERE l.id = new.location_id AND c.account_id = new.account_id AND c.active AND c.on_shift
           AND (c.assigned_locations = '{}'::uuid[] OR new.location_id = ANY(c.assigned_locations))
         ORDER BY (CASE WHEN c.last_lat IS NOT NULL AND c.last_lng IS NOT NULL AND l.lat IS NOT NULL AND l.lng IS NOT NULL
                        THEN 2*6371*asin(sqrt(power(sin(radians(c.last_lat - l.lat)/2),2)
                             + cos(radians(l.lat))*cos(radians(c.last_lat))*power(sin(radians(c.last_lng - l.lng)/2),2)))
                        ELSE NULL END) ASC NULLS LAST
         LIMIT 1;
        INSERT INTO public.delivery_assignment (sale_id, account_id, location_id, state, assigned_by, offered_to, offer_expires_at)
        VALUES (new.id, new.account_id, new.location_id, 'offered', 'auto', v_courier,
                CASE WHEN v_courier IS NOT NULL THEN now() + make_interval(secs => v_timeout) ELSE NULL END);
      ELSE
        INSERT INTO public.delivery_assignment (sale_id, account_id, location_id, state, assigned_by)
        VALUES (new.id, new.account_id, new.location_id, 'offered', 'auto');
      END IF;

    ELSIF v_carrier = 'catcher' THEN
      SELECT decrypted_secret INTO v_secret
        FROM vault.decrypted_secrets WHERE name = 'catcher_dispatch_secret';
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object('Content-Type','application/json',
                                      'Authorization', 'Bearer ' || v_anon,
                                      'x-catcher-dispatch-secret', v_secret),
        body    := jsonb_build_object('sale_id', new.id, 'internal', true)
      );
    END IF;
  END IF;
  RETURN new;
END;
$function$;

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
-- 1) Repo = producción (no debe haber diferencias con este fichero):
--    select pg_get_functiondef(oid) from pg_proc
--     where proname='tg_auto_dispatch' and pronamespace='public'::regnamespace;
--
-- 2) La cabecera sigue puesta (si esto da 0, el auto-despacho está roto):
--    select (pg_get_functiondef(oid) ilike '%Authorization%') as manda_authorization
--      from pg_proc where proname='tg_auto_dispatch' and pronamespace='public'::regnamespace;
--
-- 3) End-to-end: un pedido real own_delivery accepted → rider en segundos y
--    respuesta 200 con carrier_order_id en los logs de catcher-dispatch.
-- ============================================================================
