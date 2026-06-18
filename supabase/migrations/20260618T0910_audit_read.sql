-- ============================================================================
-- 20260618T0910_audit_read.sql
-- AUDITORÍA · Pieza C (datos): RPC de LECTURA del registro.
--
-- list_platform_events(...): devuelve los eventos enriquecidos (nombre del
-- admin actor, email, nombre de la cuenta objetivo) con filtros e paginación.
-- Resuelve los UUID a nombres legibles en SQL (la pantalla no hace N+1).
--
-- ACCESO: SECURITY DEFINER + comprobación explícita de que el llamante es
-- platform_admin activo. Si no lo es, EXCEPTION (no devuelve nada). auth.uid()
-- es null en SQL Editor -> probar desde la app, no aquí.
--
-- Filtros (todos opcionales): cuenta, admin, tipo de evento, rango de fechas.
-- total_count va en cada fila (window) para que la UI muestre "N eventos".
-- DDL puro al crearse -> seguro en SQL Editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_platform_events(
  p_account_id  uuid       DEFAULT NULL,
  p_admin_id    uuid       DEFAULT NULL,
  p_event_type  text       DEFAULT NULL,
  p_from        timestamptz DEFAULT NULL,
  p_to          timestamptz DEFAULT NULL,
  p_limit       integer    DEFAULT 100,
  p_offset      integer    DEFAULT 0
)
RETURNS TABLE (
  id                uuid,
  created_at        timestamptz,
  event_type        text,
  admin_id          uuid,
  admin_name        text,
  admin_email       text,
  target_account_id uuid,
  account_name      text,
  target_user_id    uuid,
  details           jsonb,
  ip_address        text,
  user_agent        text,
  total_count       bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Solo platform admins activos pueden leer la auditoría.
  IF NOT EXISTS (
    SELECT 1 FROM platform_admins pa
    WHERE pa.user_id = auth.uid() AND pa.active = true
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: solo platform admins pueden leer la auditoría';
  END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.created_at,
    l.event_type::text,
    l.platform_admin_id                              AS admin_id,
    pa.full_name::text                               AS admin_name,
    au.email::text                                   AS admin_email,
    l.target_account_id,
    acc.name::text                                   AS account_name,
    l.target_user_id,
    l.details,
    host(l.ip_address)::text                          AS ip_address,
    l.user_agent::text,
    count(*) OVER ()                                 AS total_count
  FROM platform_audit_log l
  LEFT JOIN platform_admins pa ON pa.id = l.platform_admin_id
  LEFT JOIN auth.users      au ON au.id = pa.user_id
  LEFT JOIN accounts        acc ON acc.id = l.target_account_id
  WHERE (p_account_id IS NULL OR l.target_account_id = p_account_id)
    AND (p_admin_id   IS NULL OR l.platform_admin_id = p_admin_id)
    AND (p_event_type IS NULL OR l.event_type = p_event_type)
    AND (p_from       IS NULL OR l.created_at >= p_from)
    AND (p_to         IS NULL OR l.created_at <= p_to)
  ORDER BY l.created_at DESC
  LIMIT  greatest(1, least(coalesce(p_limit, 100), 500))
  OFFSET greatest(0, coalesce(p_offset, 0));
END;
$function$;
