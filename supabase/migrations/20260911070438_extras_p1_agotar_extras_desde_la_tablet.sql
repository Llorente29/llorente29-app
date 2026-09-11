-- 20260911070438_extras_p1_agotar_extras_desde_la_tablet.sql
--
-- AGOTAR UN EXTRA DESDE LA COCINA
--
-- Un extra es lo que el cliente anade aparte: una salsa, unas tiras de pollo.
-- Hasta hoy solo se podian agotar desde la oficina, y quien se queda sin salsa
-- de yogur a las nueve de la noche esta en la cocina, no en la oficina.
--
-- LO QUE SE MIDIO ANTES DE ESCRIBIR NADA (Foodint, 11/09):
--   · 241 opciones de modificador, 210 con `external_id`... y 210 refs
--     DISTINTAS. Es decir: el agrupado por `external_id` que lleva dentro
--     `_set_modifier_option_availability_core` —«las gemelas incluidas»— no
--     agrupa absolutamente nada en esta cuenta.
--   · Los nombres si: 126 nombres para 236 opciones activas, y 52 de esos
--     nombres tienen mas de una copia. «Salsa Yogur» son TRECE.
--   Conclusion: agotar por ref cierra una de trece y deja doce vendiendose.
--
-- QUE SE ANADE
--   1. `_extras_group_options(cuenta, clave)`: las copias de un extra, por
--      NOMBRE normalizado. Es el agrupado que la cocina entiende.
--   2. `extras_availability_panel_by_token(token)`: los extras agotados ahora
--      en el local del dispositivo, ya agrupados.
--   3. `search_extras_by_token(token, texto)`: el buscador, tambien agrupado.
--   4. `set_modifier_option_availability_by_token(...)`: agota o reactiva un
--      extra Y TODAS SUS COPIAS, con UN solo empujon al despachador con todos
--      los `option_refs` juntos.
--
-- LO QUE NO SE ESCONDE. Las copias sin `external_id` no se pueden agotar en el
-- canal: el core falla en voz alta con ellas, asi que se saltan y se DEVUELVEN
-- en `sin_ref`. La tablet lo dice en la misma frase de la confirmacion — «4
-- copias se quedan fuera por no tener referencia de canal» — en vez de en una
-- nota al pie (regla 7).
--
-- FUNCIONES NUEVAS, NADA TOCADO. No se modifica `availability_panel_by_token`
-- ni `set_product_availability_by_token`: una tablet con el paquete viejo sigue
-- viendo exactamente lo mismo. Por eso esto se puede aplicar en cualquier
-- momento, aunque el front espere a su ventana.
--
-- ENSAYO, revertido, con el token real de una tablet de Foodint:
--   Extra elegido: «Salsa Yogur» · 13 copias en la cuenta
--   A · agotar ..... {"refs": 9, "sin_ref": 4, "opciones": 9, "dispatched": true}
--   B · panel ...... 1 grupo agotado · 9 de 13 agotadas, 2 marcas, 4 sin ref
--   C · buscador ... 13 grupos con «Salsa»
--   D · reactivar .. {"refs": 9, "sin_ref": 4, "opciones": 9} · quedan 0
-- El `net.http_post` del ensayo se fue con el ROLLBACK: `net.http_request_queue`
-- quedo a 0 y no hay ninguna respuesta de `availability-dispatch` en la ventana.
-- Comprobado, no supuesto: un 86 de verdad en plena manana no es un ensayo.
--
-- md5 de `prosrc`:
--   _extras_group_options .................... 8778abf3cf53807bfd2bc55fd68f2ace (178)
--   search_extras_by_token ................... 548b5b55cb82d357461f6530d0a776f3 (1.135)
--   set_modifier_option_availability_by_token  c8e62d97f9802aa0d65b0f4782d2281e (2.896)
--   extras_availability_panel_by_token ....... lo deja la p1b, ver ese fichero

BEGIN;

CREATE OR REPLACE FUNCTION public._extras_group_options(p_account_id uuid, p_clave text)
RETURNS TABLE(option_id uuid, external_id text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT mo.id, mo.external_id, mo.name
    FROM public.modifier_option mo
   WHERE mo.account_id = p_account_id
     AND mo.is_active
     AND lower(btrim(mo.name)) = p_clave;
$fn$;

COMMENT ON FUNCTION public._extras_group_options(uuid, text) IS
  'Las copias de un extra en la cuenta, agrupadas por NOMBRE normalizado. '
  '11/09/2026: el core agrupaba por external_id y medido no agrupa nada — '
  'en Foodint hay 210 refs para 210 opciones, pero 52 de 126 nombres tienen '
  'mas de una copia, y «Salsa Yogur» tiene 13.';

CREATE OR REPLACE FUNCTION public.search_extras_by_token(p_device_token text, p_query text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_device kds_device; v_q text;
BEGIN
  v_device := public.kds_resolve_device(p_device_token);
  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'search_extras_by_token: token no válido';
  END IF;
  v_q := '%' || lower(btrim(COALESCE(p_query, ''))) || '%';
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'name')
    FROM (
      SELECT jsonb_build_object(
               'clave',     lower(btrim(mo.name)),
               'name',      min(mo.name),
               'option_id', min(mo.id::text),
               'opciones',  count(*),
               'marcas',    count(DISTINCT mg.brand_id),
               'con_ref',   count(*) FILTER (WHERE mo.external_id IS NOT NULL),
               'sin_ref',   count(*) FILTER (WHERE mo.external_id IS NULL)) AS x
        FROM public.modifier_option mo
        JOIN public.modifier_group mg ON mg.id = mo.modifier_group_id
       WHERE mo.account_id = v_device.account_id AND mo.is_active
         AND lower(mo.name) LIKE v_q
       GROUP BY lower(btrim(mo.name))
      HAVING count(*) FILTER (WHERE mo.external_id IS NOT NULL) > 0
       LIMIT 40
    ) s
  ), '[]'::jsonb);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.set_modifier_option_availability_by_token(
  p_device_token text, p_option_id uuid, p_is_available boolean,
  p_reason text DEFAULT 'manual', p_available_until timestamptz DEFAULT NULL,
  p_reason_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_device kds_device; v_acct uuid; v_clave text; v_mo_acct uuid;
  v_refs text[] := '{}'; v_n int := 0; v_sin_ref int := 0;
  v_sec text; v_r record; v_core jsonb;
BEGIN
  v_device := public.kds_resolve_device(p_device_token);
  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'set_modifier_option_availability_by_token: token de dispositivo no valido';
  END IF;
  v_acct := v_device.account_id;

  SELECT mo.account_id, lower(btrim(mo.name)) INTO v_mo_acct, v_clave
    FROM public.modifier_option mo WHERE mo.id = p_option_id;
  IF v_mo_acct IS NULL THEN
    RAISE EXCEPTION 'set_modifier_option_availability_by_token: extra % no encontrado', p_option_id;
  END IF;
  IF v_mo_acct <> v_acct THEN
    RAISE EXCEPTION 'set_modifier_option_availability_by_token: el extra no pertenece a la cuenta del dispositivo';
  END IF;

  -- TODAS LAS COPIAS DEL MISMO EXTRA, POR NOMBRE. Quien agota «Salsa Yogur»
  -- desde la cocina no sabe —ni tiene por que saber— que hay 13 copias
  -- repartidas por marcas y grupos: agotar una sola dejaria las otras doce
  -- vendiendose. Las que no tienen `external_id` no se pueden empujar al
  -- canal, y eso se DEVUELVE en `sin_ref` en vez de callarse (regla 7).
  FOR v_r IN SELECT * FROM public._extras_group_options(v_acct, v_clave)
  LOOP
    IF v_r.external_id IS NULL THEN
      v_sin_ref := v_sin_ref + 1;
      CONTINUE;
    END IF;
    v_core := public._set_modifier_option_availability_core(
      v_r.option_id, p_is_available, v_device.location_id, p_reason,
      p_available_until, p_reason_code, v_acct, NULL, 'cocina', 'tablet');
    v_refs := v_refs || array(SELECT jsonb_array_elements_text(v_core->'option_refs'));
    v_n := v_n + 1;
  END LOOP;

  IF array_length(v_refs, 1) > 0 THEN
    SELECT decrypted_secret INTO v_sec FROM vault.decrypted_secrets
     WHERE name = 'availability_dispatch_secret';
    IF v_sec IS NOT NULL THEN
      -- UN solo empujon con todos los refs, no uno por copia.
      PERFORM net.http_post(
        url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/availability-dispatch',
        headers := jsonb_build_object('Content-Type','application/json','x-availability-dispatch-secret', v_sec),
        body := jsonb_build_object(
          'account_id', v_acct,
          'option_refs', to_jsonb(v_refs),
          'location_id', v_device.location_id,
          'available_until', p_available_until,
          'enable', p_is_available,
          'reason', p_reason));
    ELSE
      RAISE WARNING 'set_modifier_option_availability_by_token: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'opciones', v_n, 'refs', COALESCE(array_length(v_refs,1), 0),
    'sin_ref', v_sin_ref, 'location_id', v_device.location_id,
    'dispatched', v_sec IS NOT NULL AND COALESCE(array_length(v_refs,1),0) > 0);
END;
$fn$;

COMMIT;
