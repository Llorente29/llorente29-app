-- 20260827T1600_edge_drift_salud_vigia_del_vigia.sql
-- APLICADA en produccion el 27-08-2026.
--
-- EL VIGIA DEL VIGIA.
-- ============================================================================
-- POR QUE EXISTE. `edge-drift-watchdog` necesita dos tokens (MGMT_API_TOKEN y
-- GITHUB_TOKEN). El dia que uno caduque, lo borren o lo roten, la funcion
-- devolvera 500 en un log que nadie lee y dejara de escribir en
-- edge_function_deploy_state. A partir de ahi nadie compara produccion con el
-- repositorio y NO SALTA NADA: exactamente la forma del fallo del 13/08, un
-- nivel mas arriba. Un vigia que se apaga en silencio es peor que no tenerlo,
-- porque ademas da falsa tranquilidad.
--
-- Este vigia NO depende de la Edge Function: vive entero en SQL y solo mira dos
-- cosas que no puede falsear nadie desde fuera.
--
-- ── LAS CUATRO CONDICIONES ───────────────────────────────────────────────
--   1. El cron `edge-drift-watchdog` no existe o esta desactivado -> CRITICO.
--      Alguien lo borro o lo paro. Sin cron no hay vigilancia, punto.
--   2. La tabla de estado esta VACIA -> ALTO. El vigia no ha registrado nada
--      nunca: normalmente es que faltan los secrets (la funcion responde
--      "faltan secrets: ..." con 500 y no llega a escribir).
--   3. Lleva >= p_horas_critico (120 h = 5 dias) sin refrescarse -> CRITICO.
--   4. Lleva >= p_horas_alto (48 h = 2 dias) sin refrescarse -> ALTO.
--
-- El umbral de 48 h son DOS vueltas perdidas del cron diario, no una: un fallo
-- puntual de red una madrugada no despierta a nadie; dos seguidas si.
--
-- ── POR QUE NO MIRA cron.job_run_details ─────────────────────────────────
-- El cron dispara un net.http_post, que SIEMPRE "tiene exito" desde el punto de
-- vista de pg_cron: encola la peticion y devuelve. Si la Edge Function contesta
-- 500, el job consta como correcto igualmente. Por eso la unica prueba honesta
-- de que el vigia hizo su trabajo es que HAYA ESCRITO: comprobado_at fresco en
-- edge_function_deploy_state. Se mira el efecto, no la intencion.
--
-- ── MODO SECO ────────────────────────────────────────────────────────────
-- p_dry => true devuelve el diagnostico SIN encolar aviso. Sirve para probarlo
-- sin mandar un correo (asi se estreno, con la tabla vacia).
--
-- ── DEBONCE ──────────────────────────────────────────────────────────────
-- El mismo de siempre: _queue_system_alert con ventana de 20 h y clave por
-- severidad + motivo + dia. Un aviso al dia mientras siga apagado, y pasar de
-- ALTO a CRITICO rompe el silencio porque la severidad va en la clave.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.edge_drift_salud_watchdog(
  p_horas_alto     integer  DEFAULT 48,
  p_horas_critico  integer  DEFAULT 120,
  p_debounce_window interval DEFAULT interval '20 hours',
  p_dry            boolean  DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cron_ok  boolean;
  v_filas    integer;
  v_ultima   timestamptz;
  v_horas    numeric;
  v_sev      text := null;
  v_motivo   text := null;
  v_detalle  text := '';
BEGIN
  -- cron.job va cualificado a proposito: no depende del search_path.
  SELECT EXISTS (SELECT 1 FROM cron.job
                  WHERE jobname = 'edge-drift-watchdog' AND active)
    INTO v_cron_ok;

  SELECT count(*), max(comprobado_at)
    INTO v_filas, v_ultima
    FROM public.edge_function_deploy_state;

  v_horas := CASE WHEN v_ultima IS NULL THEN NULL
                  ELSE round((extract(epoch FROM (now() - v_ultima)) / 3600)::numeric, 1) END;

  IF NOT v_cron_ok THEN
    v_sev := 'CRITICO'; v_motivo := 'cron_ausente';
    v_detalle := 'El cron `edge-drift-watchdog` no existe o esta desactivado. '
      || 'Sin el, nadie compara lo desplegado con main.';
  ELSIF v_ultima IS NULL THEN
    v_sev := 'ALTO'; v_motivo := 'nunca_ha_corrido';
    v_detalle := 'El vigia de drift no ha registrado NADA todavia. Lo normal es que '
      || 'falten los secrets: prueba la funcion y mira si responde '
      || '"faltan secrets: MGMT_API_TOKEN, GITHUB_TOKEN".';
  ELSIF v_horas >= greatest(coalesce(p_horas_critico, 120), 1) THEN
    v_sev := 'CRITICO'; v_motivo := 'parado';
    v_detalle := 'El vigia de drift lleva ' || v_horas::text || ' horas sin refrescar su estado.';
  ELSIF v_horas >= greatest(coalesce(p_horas_alto, 48), 1) THEN
    v_sev := 'ALTO'; v_motivo := 'retrasado';
    v_detalle := 'El vigia de drift lleva ' || v_horas::text || ' horas sin refrescar su estado '
      || '(deberia hacerlo cada 24 h).';
  END IF;

  IF v_sev IS NULL THEN
    RETURN jsonb_build_object('avisa', false, 'cron_ok', v_cron_ok,
                              'filas', v_filas, 'horas_desde_ultima', v_horas);
  END IF;

  IF NOT p_dry THEN
    PERFORM public._queue_system_alert(
      'edge_drift_salud',
      v_sev || ': el vigia de divergencia con main no esta vigilando',
      v_detalle || chr(10) || chr(10)
        || 'Ultima comprobacion: '
        || coalesce(to_char(v_ultima at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'), 'nunca')
        || chr(10)
        || 'Funciones en la tabla de estado: ' || v_filas::text || chr(10)
        || 'Cron activo: ' || CASE WHEN v_cron_ok THEN 'si' ELSE 'NO' END || chr(10) || chr(10)
        || 'Por que importa: mientras esto siga asi, cualquier despliegue puede pisar '
        || 'trabajo no commiteado y no nos enteraremos. Es lo que paso el 13/08 con '
        || 'hubrise-webhook: 14 dias y 148 pedidos sin el codigo que ve el cliente.' || chr(10) || chr(10)
        || 'Que mirar, por orden: que MGMT_API_TOKEN y GITHUB_TOKEN sigan validos en los '
        || 'secrets de Edge Functions, los logs de `edge-drift-watchdog`, y que el cron '
        || 'siga programado.',
      'edge_drift_salud_' || v_sev || '_' || v_motivo || '_'
        || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD'),
      p_debounce_window
    );
  END IF;

  RETURN jsonb_build_object('avisa', true, 'severidad', v_sev, 'motivo', v_motivo,
                            'cron_ok', v_cron_ok, 'filas', v_filas,
                            'horas_desde_ultima', v_horas, 'seco', p_dry);
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_drift_salud_watchdog(integer, integer, interval, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edge_drift_salud_watchdog(integer, integer, interval, boolean)
  TO service_role;

-- Diario a las 08:10 de Madrid (06:10 UTC), una hora DESPUES del vigia de drift
-- (05:10 UTC): asi comprueba el resultado de la vuelta de esa misma madrugada.
SELECT cron.schedule('edge-drift-salud-watchdog', '10 6 * * *',
                     'select public.edge_drift_salud_watchdog();');

NOTIFY pgrst, 'reload schema';
