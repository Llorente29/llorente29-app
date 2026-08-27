-- 20260827T0700_queue_system_alert_ventana_de_silencio.sql
-- APLICADA en produccion el 27-08-2026.
--
-- ── EL PARTE ─────────────────────────────────────────────────────────────
-- "El vigia venta_producto_sin_casar envia el mismo aviso cada hora (1:21,
-- 5:21, 6:21), con el mismo contenido: 2 productos, 26,90 EUR."
--
-- ── LA CAUSA, Y NO ES DE ESE VIGIA ───────────────────────────────────────
-- El debounce de _queue_system_alert solo miraba los PENDIENTES:
--
--   where debounce_kind = p_debounce_kind and status = 'pending'
--
-- En cuanto el drenador marca el aviso como 'sent', la clave deja de bloquear
-- y el cron de la hora siguiente inserta otro identico. Evitaba APILAR, no
-- evitaba REPETIR.
--
-- Se pidio "aplica el patron que ya funcione" de los otros vigias. No hay
-- ninguno que funcione: los cuatro comparten este encolador y los cuatro
-- sufren lo mismo.
--
--   clave                                veces  asuntos  ventana
--   kds_silencio_6d3585ed...                50        1     95 h
--   venta_sin_casar_<cuenta>_20260826       24        3     23 h
--   db-health-print-no-active-printer        9        1     56 h
--   cost_sweep_aluvion                       3        3     48 h
--
-- cost_sweep parece sano, pero solo porque su cron es diario — no porque el
-- debounce haga nada. Por eso el arreglo va aqui y no en un vigia: no habia
-- patron bueno que copiar, habia un bug compartido.
--
-- ── EL ARREGLO ───────────────────────────────────────────────────────────
-- VENTANA DE SILENCIO por clave: si ya se encolo uno con esa misma clave
-- dentro de la ventana, no se repite — se haya enviado o no.
--
-- Default 20 h, no 24: un cron diario a las 04:50 se bloquearia la mitad de
-- los dias por unos milisegundos de desfase. Medido: con 24 h, cost_sweep
-- perdia 1 de sus 3 avisos; con 20 h conserva los 3. "Como mucho uno al dia"
-- se cumple igual.
--
-- Medido sobre lo que ya hay en la cola: 176 avisos -> 15. El 91 % era ruido.
--
--   kds_device_silencio       125 -> 6
--   venta_producto_sin_casar   39 -> 4
--   db-health                   9 -> 2
--   cost_sweep                  3 -> 3   (ninguno perdido)
--
-- Quien necesite romper el silencio ante un empeoramiento no toca esto: mete
-- el dato que cambia en la propia clave. Es lo que hace sales_unmapped_watchdog
-- con la severidad, en la migracion siguiente.
--
-- p_debounce_window => null desactiva la ventana (comportamiento anterior)
-- para un vigia que de verdad quiera repetir.

CREATE INDEX IF NOT EXISTS idx_system_alert_queue_debounce
  ON public.system_alert_queue (debounce_kind, created_at DESC)
  WHERE debounce_kind IS NOT NULL;

CREATE OR REPLACE FUNCTION public._queue_system_alert(
  p_kind text,
  p_subject text,
  p_message text,
  p_debounce_kind text DEFAULT NULL::text,
  p_debounce_window interval DEFAULT interval '20 hours')
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_debounce_kind is not null then
    -- 1) Ya hay uno pendiente con esta clave: no apilar. (Como antes.)
    if exists (
      select 1 from public.system_alert_queue
       where debounce_kind = p_debounce_kind and status = 'pending'
    ) then
      return;
    end if;

    -- 2) Ya se encolo uno con esta clave dentro de la ventana: no repetir.
    --    Esto es lo que faltaba: sin ello, un aviso enviado deja de proteger
    --    y el vigia lo reenvia en cuanto vuelve a correr.
    if p_debounce_window is not null and exists (
      select 1 from public.system_alert_queue
       where debounce_kind = p_debounce_kind
         and created_at > now() - p_debounce_window
    ) then
      return;
    end if;
  end if;

  insert into public.system_alert_queue (kind, subject, message, debounce_kind)
  values (p_kind, p_subject, p_message, p_debounce_kind);
end;
$function$;

NOTIFY pgrst, 'reload schema';
