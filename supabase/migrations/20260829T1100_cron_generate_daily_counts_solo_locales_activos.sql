-- 20260829T1100_cron_generate_daily_counts_solo_locales_activos.sql
-- ============================================================================
-- El autoinventario dejaba de generar conteo para un local dado de baja
-- ============================================================================
-- Cabo suelto del arreglo de esta madrugada (20260829T0800 / T0810). Al
-- verificar aquello reporte como hallazgo a favor que «eran tres locales sin
-- conteo automatico, no dos». ERA FALSO: el tercero es Foodint Plaza Castilla
-- con locations.active = false, un local dado de baja.
--
-- Comprobado en transaccion con rollback ANTES de tocar nada:
--
--   Foodint Alcala          active=true    18 lineas
--   Foodint Carabanchel     active=true    23 lineas
--   Foodint Plaza Castilla  active=FALSE   24 lineas   <- 629f9154-...
--
-- Generarle conteo diario y asignarle personas produce un rezagado nuevo cada
-- dia, que ademas alimentaria la alerta de rezagados creada anoche: la primera
-- alerta del cron recien arreglado habria nacido siendo ruido.
--
-- OJO AL ELEGIR EL LOCAL: hay locales DUPLICADOS POR NOMBRE. Dos «Foodint
-- Plaza Castilla» (una activa sin conteos, otra inactiva con 14), dos «Foodint
-- Alcala» y dos «Foodint Carabanchel». Filtrar por nombre habria sido un error;
-- por eso se filtra por `active` y se identifico el local por id.
--
-- Tras aplicar, verificado igual: solo Alcala y Carabanchel.
--
-- Definicion literal de pg_get_functiondef tras aplicar:
--   1.254 caracteres · md5 ff3729c505502d7fdc553400acbd443c
--
-- MARCHA ATRAS: quitar la linea `AND COALESCE(l.active, true) = true`.
--
-- BARRIDO DEL MISMO OLVIDO EN OTROS CRONES (encargo 29/08 §5). De las 9
-- funciones alcanzables desde cron.job que tocan `locations` sin filtrar
-- `active`, solo UNA itera locales para generar trabajo:
--
--   reparto_weather_poll   FOR r IN SELECT id, lat, lng FROM public.locations
--                          -> llama al tiempo por CADA local cada 10 minutos,
--                             incluidos el inactivo y los duplicados. Gasto,
--                             no ruido: no genera avisos. Queda REPORTADO,
--                             pendiente de decision de Julio.
--
-- Las otras 8 usan `locations` solo como join de etiqueta o de configuracion, y
-- su driver son ventas, dispositivos o empleados, asi que un local cerrado no
-- produce nada. Comprobado una a una, no deducido. El caso mas parecido era
-- delivery_watchdog_scan, que hace `from public.locations l`, pero es una CTE
-- de umbrales: el driver real son las ventas paradas.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cron_generate_daily_counts()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_counters uuid[];
  v_per_person integer;
BEGIN
  FOR r IN
    SELECT s.account_id, l.id AS location_id,
           COALESCE(s.autoinventory_per_person, 8) AS per_person
    FROM public.supply_settings s
    JOIN public.locations l ON l.account_id = s.account_id
    WHERE COALESCE(s.autoinventory_enabled, true) = true
      -- 29/08/2026: SOLO LOCALES ACTIVOS. Sin esto se generaba conteo diario
      -- para Foodint Plaza Castilla (629f9154, locations.active = false), un
      -- local dado de baja: 24 lineas y personas asignadas cada dia, y un
      -- rezagado nuevo cada dia que ademas alimentaria la alerta de rezagados
      -- recien creada. La primera alerta del cron arreglado habria nacido
      -- siendo ruido.
      AND COALESCE(l.active, true) = true
  LOOP
    v_counters := public._resolve_day_counters(r.location_id, current_date);
    -- genera y reparte (idempotente: si ya hay cola de hoy, no duplica)
    PERFORM public._generate_daily_count_core(
      r.account_id, r.location_id, v_counters, r.per_person, 80, false);
  END LOOP;
END;
$function$
;
