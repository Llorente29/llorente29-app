-- ============================================================================
-- 20260618T0900_audit_immutable.sql
-- AUDITORÍA · Pieza A: INMUTABILIDAD de platform_audit_log.
--
-- Requisito nº1 de una auditoría seria (consenso de la industria): el registro
-- es APPEND-ONLY. No se puede modificar ni borrar desde la app; solo añadir.
-- Si un atacante con acceso intentara borrar su rastro, el trigger lo impide.
--
-- Bloquea UPDATE y DELETE a nivel de fila. INSERT sigue permitido.
-- Idempotente. DDL puro (sin SECURITY DEFINER que invocar) -> seguro en SQL Editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_platform_audit_modification()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'platform_audit_log es inmutable (append-only): operación % no permitida', TG_OP;
END;
$function$;

DROP TRIGGER IF EXISTS trg_platform_audit_immutable ON public.platform_audit_log;

CREATE TRIGGER trg_platform_audit_immutable
  BEFORE UPDATE OR DELETE ON public.platform_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_platform_audit_modification();
