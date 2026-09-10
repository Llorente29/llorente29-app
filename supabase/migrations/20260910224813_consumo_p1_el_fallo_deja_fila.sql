-- 20260910224813_consumo_p1_el_fallo_deja_fila.sql
--
-- UN CONSUMO QUE FALLA DEJA FILA, NO UN AVISO QUE NO LEE NADIE
--
-- `tg_sale_line_consumption` terminaba así:
--
--   exception when others then
--     -- NUNCA silencioso, pero tampoco puede tumbar la ingesta de un pedido.
--     raise warning 'tg_sale_line_consumption: venta % : %', v_sale_id, sqlerrm;
--     return new;
--
-- El comentario dice «nunca silencioso» y la línea de debajo lo desmiente: un
-- `raise warning` en un trigger no llega a ninguna pantalla, a ningún correo y
-- a ninguna persona. Es la familia del botón que calla (regla 8) un piso más
-- abajo: la 8 prohíbe esconder que algo ha pasado; esto escondía que algo NO
-- había pasado.
--
-- LO QUE SE MIDIÓ ANTES DE TOCAR NADA (10/09, ventana de 24 h de `postgres_logs`)
--   · 9 ventas distintas con el aviso, entre las 12:04 y las 21:30 UTC. Ocho las
--     recuperó Julio al reprocesar tras el hotfix (movimientos a las 22:03-22:04).
--     La novena, G464 de Carabanchel, seguía abierta en `accepted`.
--   · G464 no estaba «sin consumo»: estaba A MEDIAS. 3 movimientos de 9. El
--     trigger es FOR EACH ROW y cada disparo rehace la venta ENTERA; el disparo
--     de «Sticky chicken fingers» escribió sus 3 y el de «DOBLE SMOKEY
--     Cheeseburger» reventó y se llevó su propio DELETE por delante. Quedó el
--     resultado del primero. Huella: `recipe_item_location_stock.updated_at` de
--     Cebollino, Salsa Coreana y Solomillo marca 12:04:58.496527 y los seis
--     ingredientes de la hamburguesa no.
--   · Y la red de seguridad no lo veía: `cron_recompute_missing_sale_consumption`
--     preguntaba `NOT EXISTS (... movimiento de esta venta)`. G464 tiene 3. Para
--     la red estaba resuelta. Para siempre.
--   · Barrido de integridad (Foodint, 3 días, 208 ventas con escandallo): 0 sin
--     nada, 4 a medias, 204 completas. De las 4, solo G464 tenía aviso.
--
-- QUÉ CAMBIA
--   1. El fallo escribe una fila en `sale_consumption_failure` y encola una
--      alerta con cuenta y local. La fila es la verdad sin filtrar; la alerta
--      lleva antirruido de 30 min por local, que es donde SÍ va un umbral
--      (regla 7): en lo que interrumpe, nunca en lo que existe.
--   2. Cuando el consumo vuelve a salir bien, la fila se marca resuelta CON el
--      número de movimientos escritos. Confirmación con contenido, no un visto.
--   3. `cron_recompute_missing_sale_consumption` deja de preguntar solo «¿tiene
--      algún movimiento?» y recoge también las ventas con fallo sin resolver,
--      tengan o no movimientos — siempre por encima del último conteo aprobado
--      de su local (regla 6). Ese corte es nuevo también para la rama vieja:
--      medido a los dos lados hoy, 6 candidatas sin corte y 6 con corte.
--   4. `consumo_sin_descontar_watchdog()` (cron `35 * * * *`) avisa de lo que
--      lleva más de una hora pendiente. Reporta, no reescribe.
--
-- LO QUE NO CAMBIA, Y HAY QUE DECIRLO. El trigger sigue sin tumbar la ingesta.
-- Un pedido rechazado en la puerta es un pedido perdido: peor que un consumo
-- pendiente. Lo que cambia es que el consumo pendiente ahora se ve, se avisa y
-- se reintenta solo.
--
-- ENSAYO (regla 10: por sus CAMINOS), todo dentro de una transacción revertida:
--   A · alta normal ............ 5 movimientos, 0 filas de fallo
--   B · fallo inyectado ........ la línea SE INSERTA igual; fila=1 (23514,
--                                1 intento), 1 alerta encolada
--   C · reintento nocturno ..... resuelta, 10 movimientos
--   1 · cerrar una venta ....... OK
--   2 · recibir un albarán ..... OK (d0c22b47, Alcalá)
--   3 · apuntar una merma ...... OK (delta = −1)
--   4 · aprobar un recuento .... OK (INV-00217)
-- El fallo se inyecta con un CHECK NOT VALID sobre `recipe_item_location_stock`,
-- no con el 23502 original: ese ya no se puede reproducir porque la columna
-- admite NULL desde el hotfix. Se dice porque cambia lo que prueba el ensayo —
-- prueba la FORMA del fallo (una escritura del recálculo revienta), no el 23502.
--
-- md5 de `prosrc` tras aplicar:
--   _registrar_fallo_de_consumo ............ 60af3cb1e2c9ff6426a478ece416e27b (1.482)
--   _resolver_fallo_de_consumo ............. 2599a72aaada9417695822bfeb01d691 (172)
--   tg_sale_line_consumption ............... a6a8a7b3f88d748fca4dd50ebb3a51a3 (1.526)
--   cron_recompute_missing_sale_consumption  7433baf9ab96eee63a117faba719fb9b (2.279)
--   consumo_sin_descontar_watchdog ......... 097539bfd57dd6cbf41e706a05d529bd (1.223)

BEGIN;

CREATE TABLE IF NOT EXISTS public.sale_consumption_failure (
  sale_id            uuid PRIMARY KEY REFERENCES public.sale(id) ON DELETE CASCADE,
  account_id         uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  location_id        uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  sqlstate           text,
  message            text NOT NULL,
  first_failed_at    timestamptz NOT NULL DEFAULT now(),
  last_failed_at     timestamptz NOT NULL DEFAULT now(),
  attempts           integer     NOT NULL DEFAULT 1,
  resolved_at        timestamptz,
  resolved_movements integer
);

COMMENT ON TABLE public.sale_consumption_failure IS
  'Ventas cuyo consumo de almacen fallo. Una fila por venta; se marca resuelta '
  'cuando el consumo vuelve a escribirse. 11/09/2026: antes esto era un '
  'raise warning que no leia nadie.';

CREATE INDEX IF NOT EXISTS sale_consumption_failure_pendiente_idx
  ON public.sale_consumption_failure (account_id, location_id, last_failed_at)
  WHERE resolved_at IS NULL;

ALTER TABLE public.sale_consumption_failure ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_consumption_failure_all ON public.sale_consumption_failure;
CREATE POLICY sale_consumption_failure_all ON public.sale_consumption_failure
  FOR ALL USING (public.belongs_to_account(account_id))
  WITH CHECK (public.belongs_to_account(account_id));

CREATE OR REPLACE FUNCTION public._registrar_fallo_de_consumo(
  p_sale_id uuid, p_sqlstate text, p_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_account uuid; v_location uuid; v_ref text; v_local text;
BEGIN
  SELECT s.account_id, s.location_id,
         COALESCE(s.pos_short_code, s.platform_order_code, s.external_ref, s.id::text)
    INTO v_account, v_location, v_ref FROM public.sale s WHERE s.id = p_sale_id;
  IF v_account IS NULL THEN RETURN; END IF;
  INSERT INTO public.sale_consumption_failure AS f
    (sale_id, account_id, location_id, sqlstate, message)
  VALUES (p_sale_id, v_account, v_location, p_sqlstate, p_message)
  ON CONFLICT (sale_id) DO UPDATE
     SET last_failed_at = now(), attempts = f.attempts + 1,
         sqlstate = EXCLUDED.sqlstate, message = EXCLUDED.message,
         resolved_at = NULL, resolved_movements = NULL;
  SELECT l.name INTO v_local FROM public.locations l WHERE l.id = v_location;
  PERFORM public.encolar_alerta(
    p_kind => 'consumo_no_descontado',
    p_subject => 'Un pedido no ha descontado del almacén',
    p_message => format(
      'El pedido %s%s no ha podido descontar del almacén: %s (%s). '
      'Queda apuntado y se reintenta solo esta noche. Mientras tanto, el stock '
      'de ese local está de más.',
      v_ref, COALESCE(' de ' || v_local, ''), p_message, COALESCE(p_sqlstate, 'sin código')),
    p_debounce_kind => 'consumo_no_descontado:' || COALESCE(v_location::text, 'sin-local'),
    p_debounce_window => interval '30 minutes',
    p_account_id => v_account, p_location_id => v_location,
    p_brand_id => NULL, p_severity => 'alto');
END;
$fn$;

CREATE OR REPLACE FUNCTION public._resolver_fallo_de_consumo(
  p_sale_id uuid, p_movimientos integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  UPDATE public.sale_consumption_failure
     SET resolved_at = now(), resolved_movements = p_movimientos
   WHERE sale_id = p_sale_id AND resolved_at IS NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.tg_sale_line_consumption()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
declare
  v_sale_id uuid; v_sale record; v_n integer; v_state text; v_msg text;
begin
  -- Con FOR EACH ROW tenemos new; resolvemos la venta y recalculamos su consumo.
  v_sale_id := new.sale_id;
  if v_sale_id is null then return new; end if;
  select id, status, order_status, is_active into v_sale
    from public.sale where id = v_sale_id;
  if not found then return new; end if;
  -- No consumir ventas canceladas ni inactivas.
  if coalesce(v_sale.status,'') = 'cancelled'
     or coalesce(v_sale.order_status,'') in ('cancelled','rejected')
     or not coalesce(v_sale.is_active, true) then
    return new;
  end if;
  -- Solo lineas de producto aportan consumo; las hijas las resuelve el motor.
  if coalesce(new.line_type,'product') <> 'product' then
    return new;
  end if;
  v_n := public.generate_sale_consumption(v_sale_id);
  -- Salio bien: si esta venta arrastraba un fallo, se cierra con contenido.
  perform public._resolver_fallo_de_consumo(v_sale_id, v_n);
  return new;
exception when others then
  -- No tumbamos la ingesta —un pedido rechazado se pierde— pero el fallo deja
  -- FILA y ALERTA, no un aviso que no lee nadie.
  v_state := sqlstate;
  v_msg   := sqlerrm;
  begin
    perform public._registrar_fallo_de_consumo(v_sale_id, v_state, v_msg);
  exception when others then
    raise warning 'tg_sale_line_consumption: no se pudo apuntar el fallo de la venta % : %',
      v_sale_id, sqlerrm;
  end;
  raise warning 'tg_sale_line_consumption: venta % : %', v_sale_id, v_msg;
  return new;
end;
$fn$;

CREATE OR REPLACE FUNCTION public.cron_recompute_missing_sale_consumption(p_days integer DEFAULT 7)
RETURNS TABLE(sales_reprocessed integer, movements_written integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE r record; v_n integer := 0; v_mov integer := 0; v_esc integer;
BEGIN
  FOR r IN
    WITH candidatas AS (
      -- a) la de siempre: no ha descontado NADA y es de los ultimos p_days.
      SELECT s.id FROM sale s
       WHERE s.sold_at >= now() - make_interval(days => GREATEST(COALESCE(p_days,7), 1))
         AND NOT EXISTS (SELECT 1 FROM stock_movement sm
                WHERE sm.source_type = 'sale' AND sm.movement_type = 'consumo'
                  AND sm.source_id = s.id)
         AND EXISTS (SELECT 1 FROM sale_line sl
                WHERE sl.sale_id = s.id
                  AND COALESCE(sl.line_type, 'product') = 'product'
                  AND sl.ignored_at IS NULL
                  AND ( EXISTS (SELECT 1 FROM menu_item mi
                                 WHERE mi.id = sl.menu_item_id AND mi.recipe_item_id IS NOT NULL)
                        OR EXISTS (SELECT 1 FROM sale_line c
                                    WHERE c.parent_sale_line_id = sl.id AND c.line_type = 'combo_item') ))
      UNION
      -- b) la nueva: tiene un fallo apuntado sin resolver, TENGA O NO
      --    movimientos. Un consumo a medias no lo veia nadie: la red vieja
      --    preguntaba «¿hay algo?», no «¿esta entero?».
      SELECT f.sale_id FROM sale_consumption_failure f WHERE f.resolved_at IS NULL
    )
    SELECT s.id FROM candidatas c JOIN sale s ON s.id = c.id
     WHERE COALESCE(s.is_active, true)
       AND COALESCE(s.status, '') <> 'cancelled'
       AND COALESCE(s.order_status, '') NOT IN ('cancelled', 'rejected')
       -- REGLA 6: nunca por debajo del ultimo conteo aprobado del local.
       AND s.sold_at > COALESCE(
             (SELECT max(ic.closed_at) FROM inventory_count ic
               WHERE ic.account_id = s.account_id AND ic.location_id = s.location_id
                 AND ic.status = 'aprobado'), '-infinity'::timestamptz)
    ORDER BY s.sold_at
  LOOP
    v_esc := COALESCE(public.generate_sale_consumption(r.id), 0);
    PERFORM public._resolver_fallo_de_consumo(r.id, v_esc);
    v_mov := v_mov + v_esc; v_n := v_n + 1;
  END LOOP;
  IF v_n > 0 THEN
    RAISE NOTICE 'cron_recompute_missing_sale_consumption: % ventas, % movimientos', v_n, v_mov;
  END IF;
  sales_reprocessed := v_n; movements_written := v_mov; RETURN NEXT;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.consumo_sin_descontar_watchdog()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_n integer; v_detalle text;
BEGIN
  SELECT count(*), string_agg(
           format('%s de %s (%s intentos, desde %s)',
                  COALESCE(s.pos_short_code, s.platform_order_code, s.id::text),
                  COALESCE(l.name, 'sin local'), f.attempts,
                  to_char(f.first_failed_at AT TIME ZONE 'Europe/Madrid', 'DD/MM HH24:MI')),
           E'\n' ORDER BY f.first_failed_at)
    INTO v_n, v_detalle
    FROM public.sale_consumption_failure f
    JOIN public.sale s ON s.id = f.sale_id
    LEFT JOIN public.locations l ON l.id = f.location_id
   WHERE f.resolved_at IS NULL AND f.last_failed_at < now() - interval '1 hour';
  IF COALESCE(v_n, 0) = 0 THEN RETURN 0; END IF;
  PERFORM public.encolar_alerta(
    p_kind => 'consumo_sin_descontar_pendiente',
    p_subject => format('%s pedido(s) siguen sin descontar del almacén', v_n),
    p_message => 'El reintento automático no ha podido con estos. '
              || 'Su consumo NO está en el stock:' || E'\n' || v_detalle,
    p_debounce_kind => 'consumo_sin_descontar_pendiente',
    p_debounce_window => interval '6 hours',
    p_account_id => NULL, p_location_id => NULL, p_brand_id => NULL, p_severity => 'alto');
  RETURN v_n;
END;
$fn$;

DO $cron$
BEGIN
  PERFORM cron.unschedule('consumo-sin-descontar-watchdog');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$cron$;

SELECT cron.schedule('consumo-sin-descontar-watchdog', '35 * * * *',
                     'select public.consumo_sin_descontar_watchdog()');

COMMIT;
