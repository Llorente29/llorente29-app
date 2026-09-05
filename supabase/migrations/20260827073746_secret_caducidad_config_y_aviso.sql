-- 20260827T1700_secret_caducidad_config_y_aviso.sql
-- La fecha de caducidad de un secret va en una TABLA, no en el codigo: al
-- renovar el token se cambia una fila, no se toca ni se redespliega nada. Una
-- fecha incrustada en la funcion se queda vieja el dia que alguien renueva sin
-- acordarse, y entonces el aviso pasa a mentir -- peor que no tenerlo.
-- Solo se guardan fechas REALES declaradas. Nunca una fila con caduca_el NULL
-- "por si acaso": una fila que no puede avisar es falsa tranquilidad.
-- No guarda ningun secreto: solo el NOMBRE, la fecha y donde se renueva.

CREATE TABLE IF NOT EXISTS public.secret_expiry (
  nombre         text PRIMARY KEY,
  descripcion    text,
  caduca_el      date    NOT NULL,
  dias_aviso     integer NOT NULL DEFAULT 30 CHECK (dias_aviso > 0),
  dias_critico   integer NOT NULL DEFAULT 7  CHECK (dias_critico > 0),
  donde_renovar  text,
  actualizado_at timestamptz NOT NULL DEFAULT now(),
  CHECK (dias_critico <= dias_aviso)
);

COMMENT ON TABLE public.secret_expiry IS
  'Fechas de caducidad de los secrets de los que dependen los vigias. Solo el '
  'NOMBRE y la fecha: ningun valor de token vive aqui. Al renovar, UPDATE de '
  'caduca_el -- no se toca ni se redespliega codigo.';

ALTER TABLE public.secret_expiry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.secret_expiry FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.secret_expiry TO service_role;

INSERT INTO public.secret_expiry (nombre, descripcion, caduca_el, donde_renovar)
VALUES (
  'MGMT_API_TOKEN',
  'PAT de Supabase (Management API) que usa edge-drift-watchdog para leer que '
  'Edge Functions hay desplegadas y su fuente. Scope Project -> FOLVY, Edge Functions: Read.',
  DATE '2027-08-25',
  'supabase.com/dashboard/account/tokens -> generar uno nuevo y pegarlo en '
  'Edge Functions -> Secrets. Despues: UPDATE public.secret_expiry SET caduca_el = ... '
  'WHERE nombre = ''MGMT_API_TOKEN'';'
)
ON CONFLICT (nombre) DO UPDATE
  SET descripcion    = excluded.descripcion,
      caduca_el      = excluded.caduca_el,
      donde_renovar  = excluded.donde_renovar,
      actualizado_at = now();

-- MISMA FIRMA que la version del 20260827T1600: CREATE OR REPLACE limpio, sin
-- sobrecarga nueva (la leccion del 42725).
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
  s          record;
  v_dias     integer;
  v_sev_s    text;
  v_cad      jsonb := '[]'::jsonb;
BEGIN
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

  IF v_sev IS NOT NULL AND NOT p_dry THEN
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

  -- Caducidad de secrets: INDEPENDIENTE de lo anterior. Un token que caduca
  -- dentro de 20 dias hay que avisarlo aunque hoy el vigia funcione bien.
  FOR s IN
    SELECT * FROM public.secret_expiry
     WHERE caduca_el <= (current_date + dias_aviso)
     ORDER BY caduca_el
  LOOP
    v_dias := s.caduca_el - current_date;
    v_sev_s := CASE
                 WHEN v_dias < 0                THEN 'CRITICO'
                 WHEN v_dias <= s.dias_critico  THEN 'CRITICO'
                 ELSE 'ALTO'
               END;
    v_cad := v_cad || jsonb_build_object('nombre', s.nombre, 'dias', v_dias,
                                         'severidad', v_sev_s);

    IF NOT p_dry THEN
      PERFORM public._queue_system_alert(
        'secret_caduca',
        v_sev_s || ': el secret ' || s.nombre
          || CASE WHEN v_dias < 0
                  THEN ' CADUCO hace ' || abs(v_dias)::text || ' dias'
                  ELSE ' caduca en ' || v_dias::text || ' dias' END,
        CASE WHEN v_dias < 0
             THEN 'El secret ' || s.nombre || ' caduco el '
                  || to_char(s.caduca_el, 'DD/MM/YYYY') || '. Lo que dependa de el ya '
                  || 'esta fallando.'
             ELSE 'El secret ' || s.nombre || ' caduca el '
                  || to_char(s.caduca_el, 'DD/MM/YYYY') || ', dentro de ' || v_dias::text
                  || ' dias.' END
          || chr(10) || chr(10)
          || coalesce(s.descripcion, '') || chr(10) || chr(10)
          || 'Como se renueva: ' || coalesce(s.donde_renovar, '(sin instrucciones guardadas)')
          || chr(10) || chr(10)
          || 'Se avisa con antelacion a proposito: cuando caduque, el vigia de '
          || 'divergencia deja de comparar produccion con el repositorio y volvemos '
          || 'a estar ciegos ante un deploy que pise trabajo no commiteado.',
        'secret_caduca_' || s.nombre || '_' || v_sev_s || '_'
          || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD'),
        p_debounce_window
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'avisa_salud',   v_sev IS NOT NULL,
    'severidad',     v_sev,
    'motivo',        v_motivo,
    'cron_ok',       v_cron_ok,
    'filas',         v_filas,
    'horas_desde_ultima', v_horas,
    'caducidades',   v_cad,
    'seco',          p_dry);
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_drift_salud_watchdog(integer, integer, interval, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edge_drift_salud_watchdog(integer, integer, interval, boolean)
  TO service_role;

NOTIFY pgrst, 'reload schema';