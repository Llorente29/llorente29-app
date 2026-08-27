-- 20260827T1700_secret_caducidad_config_y_aviso.sql
-- APLICADA en produccion el 27-08-2026.
--
-- CADUCIDAD DE SECRETS: LA FECHA EN UNA TABLA, NO EN EL CODIGO.
-- ============================================================================
-- POR QUE. `edge-drift-watchdog` depende de MGMT_API_TOKEN, que caduca el
-- 25/08/2027. El dia que caduque, la funcion devolvera 500 y dejara de
-- comparar produccion con el repositorio. El vigia del vigia lo detectaria
-- 48 h DESPUES -- ya roto. Avisar 30 dias ANTES convierte una averia en un
-- recordatorio.
--
-- LA FECHA VA EN UNA TABLA, no incrustada en la funcion, por dos razones:
--   1. Al renovar el token solo se cambia una fila (un UPDATE), no se toca ni
--      se redespliega codigo. Una fecha en el codigo se queda vieja el dia que
--      alguien renueva sin acordarse de tocar la funcion -- y entonces el aviso
--      pasa a mentir, que es peor que no tenerlo.
--   2. Sirve para cualquier otro secret con caducidad que aparezca despues:
--      basta una fila mas, sin tocar SQL.
--
-- ── QUE HAY Y QUE NO HAY EN LA TABLA ─────────────────────────────────────
-- Solo se guardan fechas REALES declaradas por quien creo el secret. NUNCA se
-- inventa una fecha ni se mete una fila con caduca_el a NULL "por si acaso":
-- una fila que no puede avisar es exactamente la falsa tranquilidad que este
-- proyecto lleva dos dias arrancando.
--
-- Hoy: MGMT_API_TOKEN, 25/08/2027 (PAT de Supabase, scope Project -> FOLVY,
-- Edge Functions: Read).
--
-- FALTA por declarar: GITHUB_TOKEN. Los PAT fine-grained de GitHub tambien
-- caducan (un ano como maximo por defecto), pero su fecha no se ha declarado y
-- no se inventa. Cuando se sepa: insert en esta tabla y ya avisa.
--
-- ── NO GUARDA NINGUN SECRETO ─────────────────────────────────────────────
-- Solo el NOMBRE del secret, su fecha y donde se renueva. El valor del token
-- vive en los secrets de Edge Functions y no toca esta tabla ni por asomo.
--
-- ── EL AVISO ─────────────────────────────────────────────────────────────
-- Se anade a edge_drift_salud_watchdog() SIN cambiar su firma (nada de
-- sobrecargas: la leccion del 42725). Es una comprobacion INDEPENDIENTE de las
-- de "el vigia no esta vigilando": un token que caduca dentro de 20 dias es un
-- aviso aunque el vigia funcione perfectamente hoy, asi que se evalua y se
-- encola aparte, con su propia clave de debounce.
--   ya caducado ................. CRITICO
--   <= dias_critico (7 por def.) . CRITICO
--   <= dias_aviso  (30 por def.) . ALTO
-- Mismo debounce de 20 h, con la severidad en la clave: pasar de ALTO a
-- CRITICO rompe el silencio.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.secret_expiry (
  nombre         text PRIMARY KEY,                 -- tal cual en Edge Functions -> Secrets
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
-- Tabla de plataforma, no de cuenta: sin politicas, solo service_role.
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


-- ── El vigia del vigia, ahora tambien con caducidades ────────────────────────
-- MISMA FIRMA que la version del 20260827T1600: CREATE OR REPLACE limpio, sin
-- sobrecarga nueva.
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
  -- ── Parte 1: ¿esta el vigia de drift vivo? ────────────────────────────────
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

  -- ── Parte 2: caducidad de secrets ─────────────────────────────────────────
  -- INDEPENDIENTE de lo anterior: un token que caduca dentro de 20 dias hay que
  -- avisarlo aunque hoy el vigia funcione perfectamente. Aviso aparte, clave de
  -- debounce aparte.
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
