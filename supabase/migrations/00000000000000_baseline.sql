


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."appcc_calc_response_validation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_item RECORD;
  v_is_failure BOOLEAN := false;
  v_option_is_failure BOOLEAN;
BEGIN
  SELECT field_type, numeric_min, numeric_max, expected_boolean
  INTO v_item
  FROM appcc_template_items
  WHERE id = NEW.item_id;

  IF v_item.field_type = 'numeric' AND NEW.numeric_value IS NOT NULL THEN
    IF (v_item.numeric_min IS NOT NULL AND NEW.numeric_value < v_item.numeric_min)
       OR (v_item.numeric_max IS NOT NULL AND NEW.numeric_value > v_item.numeric_max) THEN
      v_is_failure := true;
    END IF;
  ELSIF v_item.field_type = 'boolean' AND NEW.boolean_value IS NOT NULL THEN
    IF v_item.expected_boolean IS NOT NULL AND NEW.boolean_value <> v_item.expected_boolean THEN
      v_is_failure := true;
    END IF;
  ELSIF v_item.field_type = 'select' AND NEW.selected_option_id IS NOT NULL THEN
    SELECT is_failure INTO v_option_is_failure
    FROM appcc_template_item_options
    WHERE id = NEW.selected_option_id;
    v_is_failure := COALESCE(v_option_is_failure, false);
  END IF;

  NEW.is_out_of_range := v_is_failure;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."appcc_calc_response_validation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."appcc_handle_response_incident"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_item RECORD;
  v_execution RECORD;
  v_incident_title TEXT;
  v_sla_hours INT;
BEGIN
  -- Solo actuar si la respuesta está fuera de rango
  IF NEW.is_out_of_range = false THEN
    RETURN NEW;
  END IF;

  -- Cargar definición del item
  SELECT label, creates_incident_on_fail, incident_severity
  INTO v_item
  FROM appcc_template_items
  WHERE id = NEW.item_id;

  -- Solo crear incidencia si el item está configurado para ello
  IF NOT v_item.creates_incident_on_fail THEN
    RETURN NEW;
  END IF;

  -- Cargar contexto (account_id, location_id de la execution)
  SELECT account_id, location_id INTO v_execution
  FROM appcc_executions
  WHERE id = NEW.execution_id;

  -- SLA según severidad
  v_sla_hours := CASE COALESCE(v_item.incident_severity, 'medium')
    WHEN 'critical' THEN 2
    WHEN 'high' THEN 8
    WHEN 'medium' THEN 24
    WHEN 'low' THEN 72
    ELSE 24
  END;

  v_incident_title := 'APPCC: ' || v_item.label;

  -- Crear incidencia (en AFTER trigger, NEW.id ya existe)
  INSERT INTO appcc_incidents (
    account_id, location_id, execution_id, response_id,
    title, severity, source, sla_due_at, created_by
  ) VALUES (
    v_execution.account_id, v_execution.location_id, NEW.execution_id, NEW.id,
    v_incident_title, COALESCE(v_item.incident_severity, 'medium'),
    'auto', NOW() + (v_sla_hours || ' hours')::INTERVAL, NEW.answered_by
  );

  -- Actualizar contador de fallos en la execution
  UPDATE appcc_executions
  SET has_failures = true, failure_count = failure_count + 1
  WHERE id = NEW.execution_id;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."appcc_handle_response_incident"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."appcc_mark_overdue"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE appcc_executions
  SET status = 'overdue', updated_at = now()
  WHERE status IN ('pending', 'in_progress')
    AND scheduled_date < CURRENT_DATE;
END;
$$;


ALTER FUNCTION "public"."appcc_mark_overdue"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."belongs_to_account"("p_account_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT p_account_id = ANY(public.current_user_account_ids());
$$;


ALTER FUNCTION "public"."belongs_to_account"("p_account_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."belongs_to_account"("p_account_id" "uuid") IS 'Wrapper sobre current_user_account_ids() para uso conveniente en policies RLS.';



CREATE OR REPLACE FUNCTION "public"."cleanup_auth_rate_limits"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM auth_rate_limits
  WHERE first_attempt < now() - interval '24 hours';
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  
  RAISE NOTICE 'cleanup_auth_rate_limits: deleted % old entries', v_deleted;
  
  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "public"."cleanup_auth_rate_limits"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cleanup_auth_rate_limits"() IS 'Cleanup diario de rate limits viejos (>24h). Programar con pg_cron o Supabase scheduled function.';



CREATE OR REPLACE FUNCTION "public"."current_user_account_ids"() RETURNS "uuid"[]
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(array_agg(account_id), '{}')
  FROM public.user_profiles
  WHERE user_id = auth.uid()
    AND active = true
    AND account_id IS NOT NULL;
$$;


ALTER FUNCTION "public"."current_user_account_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_has_platform_permission"("p_permission_flag" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_platform_admin_id uuid;
  v_has_permission boolean;
BEGIN
  SELECT pa.id INTO v_platform_admin_id
  FROM platform_admins pa
  WHERE pa.user_id = auth.uid()
    AND pa.active = true
  LIMIT 1;
  
  IF v_platform_admin_id IS NULL THEN
    RETURN false;
  END IF;
  
  BEGIN
    EXECUTE format(
      'SELECT %I FROM platform_admin_permissions WHERE platform_admin_id = $1',
      p_permission_flag
    )
    INTO v_has_permission
    USING v_platform_admin_id;
    
    RETURN COALESCE(v_has_permission, false);
  EXCEPTION
    WHEN undefined_column THEN
      RAISE WARNING 'current_user_has_platform_permission: flag % no existe', p_permission_flag;
      RETURN false;
    WHEN OTHERS THEN
      RAISE WARNING 'current_user_has_platform_permission: error %', SQLERRM;
      RETURN false;
  END;
END;
$_$;


ALTER FUNCTION "public"."current_user_has_platform_permission"("p_permission_flag" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."current_user_has_platform_permission"("p_permission_flag" "text") IS 'Verifica si el platform_admin actual tiene un flag específico activo.';



CREATE OR REPLACE FUNCTION "public"."current_user_is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- Decisión 3 (C2): platform admin se identifica por presencia en
  -- la tabla platform_admins (separada del concepto user_profile).
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins
    WHERE user_id = auth.uid()
      AND active = true
  );
$$;


ALTER FUNCTION "public"."current_user_is_admin"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."current_user_is_admin"() IS 'Verifica si el usuario actual es platform_admin activo. Decisión 3 (C2) refactor 19/05/2026: ahora consulta tabla platform_admins en lugar de accounts.is_internal.';



CREATE OR REPLACE FUNCTION "public"."current_user_is_admin_of"("p_account_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE user_id = auth.uid()
      AND account_id = p_account_id
      AND role = 'admin'
      AND active = true
  ) OR public.current_user_is_admin();
$$;


ALTER FUNCTION "public"."current_user_is_admin_of"("p_account_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_is_admin_or_manager_of"("p_account_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles me
    WHERE me.user_id = auth.uid()
      AND me.account_id = p_account_id
      AND me.role = ANY (ARRAY['admin', 'manager'])
      AND me.active = true
  );
$$;


ALTER FUNCTION "public"."current_user_is_admin_or_manager_of"("p_account_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."custom_access_token_hook"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
  v_user_id uuid;
  v_claims jsonb;
  v_folvy_existing jsonb;
  
  -- Platform admin lookup
  v_is_platform_admin boolean := false;
  v_platform_admin_role text := null;
  
  -- Active accounts lookup
  v_active_accounts jsonb := '[]'::jsonb;
  v_accounts_count integer := 0;
  
  -- Current account resolution
  v_current_account_id uuid := null;
  v_current_account_slug text := null;
  v_current_account_role text := null;
  
  -- Permission set lookup
  v_permission_set_id uuid := null;
  
  -- Final folvy claim
  v_folvy_claim jsonb;
  v_session_max_age integer;
BEGIN
  -- ==========================================================
  -- 1. Extraer user_id y claims base del payload
  -- ==========================================================
  v_user_id := (event->>'user_id')::uuid;
  v_claims := event->'claims';
  
  IF v_user_id IS NULL THEN
    -- Edge case: payload sin user_id (no debería pasar nunca, pero defensivo)
    RAISE WARNING '[custom_access_token_hook] user_id is NULL in event payload';
    RETURN event;
  END IF;
  
  -- ==========================================================
  -- 2. Respetar claim 'folvy' pre-existente (caso impersonation)
  --    Si el JWT secundario de impersonation ya trae folvy.*,
  --    no lo sobrescribimos.
  -- ==========================================================
  v_folvy_existing := v_claims->'folvy';
  IF v_folvy_existing IS NOT NULL 
     AND (v_folvy_existing->>'impersonating')::boolean = true THEN
    -- Es un JWT de impersonation, no tocar
    RETURN event;
  END IF;
  
  -- ==========================================================
  -- 3. Buscar si el user es platform admin activo
  -- ==========================================================
  BEGIN
    SELECT pa.role, true
    INTO v_platform_admin_role, v_is_platform_admin
    FROM public.platform_admins pa
    WHERE pa.user_id = v_user_id
      AND pa.active = true
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[custom_access_token_hook] platform_admin lookup failed: %', SQLERRM;
    v_is_platform_admin := false;
    v_platform_admin_role := null;
  END;
  
  -- Si no se encontró fila, los DEFAULT se mantienen (false, null)
  IF v_platform_admin_role IS NULL THEN
    v_is_platform_admin := false;
  END IF;
  
  -- ==========================================================
  -- 4. Buscar user_profiles activos en cuentas no eliminadas
  -- ==========================================================
  BEGIN
    SELECT 
      jsonb_agg(
        jsonb_build_object(
          'id', up.account_id,
          'slug', a.slug,
          'role', up.role,
          'profile_id', up.id
        )
        ORDER BY up.created_at DESC
      ),
      COUNT(*)
    INTO v_active_accounts, v_accounts_count
    FROM public.user_profiles up
    INNER JOIN public.accounts a ON a.id = up.account_id
    WHERE up.user_id = v_user_id
      AND up.active = true
      AND a.deleted_at IS NULL
      AND a.suspended_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[custom_access_token_hook] user_profiles lookup failed: %', SQLERRM;
    v_active_accounts := '[]'::jsonb;
    v_accounts_count := 0;
  END;
  
  -- Si jsonb_agg no encontró nada, devuelve NULL en lugar de '[]'
  IF v_active_accounts IS NULL THEN
    v_active_accounts := '[]'::jsonb;
    v_accounts_count := 0;
  END IF;
  
  -- ==========================================================
  -- 5. Resolver current_account_id (D-S2.7: created_at DESC)
  --    El primer elemento del array (ordenado DESC) gana.
  -- ==========================================================
  IF v_accounts_count > 0 THEN
    v_current_account_id := (v_active_accounts->0->>'id')::uuid;
    v_current_account_slug := v_active_accounts->0->>'slug';
    v_current_account_role := v_active_accounts->0->>'role';
  END IF;
  
  -- ==========================================================
  -- 6. Buscar permission_set asignado al user en la cuenta activa
  -- ==========================================================
  IF v_current_account_id IS NOT NULL THEN
    BEGIN
      SELECT psa.permission_set_id
      INTO v_permission_set_id
      FROM public.permission_set_assignments psa
      INNER JOIN public.user_profiles up ON up.id = psa.user_profile_id
      WHERE up.user_id = v_user_id
        AND up.account_id = v_current_account_id
        AND up.active = true
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[custom_access_token_hook] permission_set lookup failed: %', SQLERRM;
      v_permission_set_id := null;
    END;
  END IF;
  
  -- ==========================================================
  -- 7. Calcular session_max_age (platform admin: 4h; normal: 7 días)
  -- ==========================================================
  IF v_is_platform_admin THEN
    v_session_max_age := 14400;   -- 4 horas en segundos
  ELSE
    v_session_max_age := 604800;  -- 7 días en segundos
  END IF;
  
  -- ==========================================================
  -- 8. Construir el claim folvy.*
  -- ==========================================================
  v_folvy_claim := jsonb_build_object(
    'is_platform_admin', v_is_platform_admin,
    'platform_admin_role', v_platform_admin_role,
    'current_account_id', v_current_account_id,
    'current_account_slug', v_current_account_slug,
    'current_account_role', v_current_account_role,
    'active_accounts', v_active_accounts,
    'permission_set_id', v_permission_set_id,
    'impersonating', false,
    'real_user_id', null,
    'session_max_age', v_session_max_age
  );
  
  -- ==========================================================
  -- 9. Inyectar folvy.* en los claims y devolver el event modificado
  -- ==========================================================
  v_claims := jsonb_set(v_claims, '{folvy}', v_folvy_claim);
  event := jsonb_set(event, '{claims}', v_claims);
  
  RETURN event;
  
EXCEPTION WHEN OTHERS THEN
  -- Last resort: si algo no capturado falla, devuelve event sin tocar.
  -- Mejor login con JWT sin folvy.* que login bloqueado.
  RAISE WARNING '[custom_access_token_hook] unexpected error: %', SQLERRM;
  RETURN event;
END;
$$;


ALTER FUNCTION "public"."custom_access_token_hook"("event" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."force_close_long_impersonations"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_closed integer;
BEGIN
  UPDATE impersonation_sessions
  SET ended_at = now(), 
      force_closed = true
  WHERE ended_at IS NULL
    AND started_at < now() - interval '4 hours';
  
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  
  IF v_closed > 0 THEN
    RAISE NOTICE 'force_close_long_impersonations: closed % sessions exceeding 4h', v_closed;
  END IF;
  
  RETURN v_closed;
END;
$$;


ALTER FUNCTION "public"."force_close_long_impersonations"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."force_close_long_impersonations"() IS 'Cierra automáticamente sesiones impersonation >4h. Ejecutar cada 5-10 min via cron.';



CREATE OR REPLACE FUNCTION "public"."has_permission"("p_account_id" "uuid", "p_permission_key" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_user_profile_id uuid;
  v_user_role text;
  v_legacy_override boolean;
  v_set_permission boolean;
BEGIN
  -- Step 1: Obtener user_profile del caller en la cuenta dada.
  SELECT up.id, up.role 
    INTO v_user_profile_id, v_user_role
  FROM user_profiles up
  WHERE up.user_id = auth.uid()
    AND up.account_id = p_account_id
    AND up.active = true
    AND up.suspended_at IS NULL
  LIMIT 1;
  
  -- Si no tiene profile activo → DENY (a menos que sea platform admin).
  IF v_user_profile_id IS NULL THEN
    RETURN public.current_user_is_admin();
  END IF;
  
  -- Admin de cuenta tiene TODOS los permisos por defecto.
  IF v_user_role = 'admin' THEN
    RETURN true;
  END IF;
  
  -- Step 2: Cascada B — Override en manager_permissions (legacy).
  BEGIN
    EXECUTE format(
      'SELECT %I FROM manager_permissions WHERE user_profile_id = $1',
      p_permission_key
    )
    INTO v_legacy_override
    USING v_user_profile_id;
    
    -- Si la columna existe Y tiene valor (no NULL), usamos ese valor.
    IF v_legacy_override IS NOT NULL THEN
      RETURN v_legacy_override;
    END IF;
  EXCEPTION
    WHEN undefined_column THEN
      -- Columna no existe → seguir a step 3.
      NULL;
    WHEN OTHERS THEN
      RAISE WARNING 'has_permission: error evaluando legacy column %: %', p_permission_key, SQLERRM;
  END;
  
  -- Step 3: Cascada B — Lectura desde permission_set asignado.
  SELECT (ps.permissions ->> p_permission_key)::boolean
    INTO v_set_permission
  FROM permission_set_assignments psa
  JOIN permission_sets ps ON ps.id = psa.permission_set_id
  WHERE psa.user_profile_id = v_user_profile_id
    AND ps.active = true
  LIMIT 1;
  
  -- Si el set tiene la clave → usar su valor.
  IF v_set_permission IS NOT NULL THEN
    RETURN v_set_permission;
  END IF;
  
  -- Step 4: Default DENY.
  RETURN false;
END;
$_$;


ALTER FUNCTION "public"."has_permission"("p_account_id" "uuid", "p_permission_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_permission"("p_account_id" "uuid", "p_permission_key" "text") IS 'Resolución cascada de permisos (Decisión 1 B aprobada Julio CEO 18/05/2026): admin > legacy column > set jsonb > deny.';



CREATE OR REPLACE FUNCTION "public"."protect_last_admin"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_active_ceos integer;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    SELECT COUNT(*) INTO v_active_ceos
    FROM platform_admins
    WHERE role = 'ceo' 
      AND active = true
      AND id != OLD.id;
    
    IF OLD.role = 'ceo' AND v_active_ceos = 0 THEN
      RAISE EXCEPTION 'No se puede borrar el último CEO platform_admin. Promociona otro admin primero.';
    END IF;
    
    RETURN OLD;
  END IF;
  
  IF (TG_OP = 'UPDATE') THEN
    IF OLD.role = 'ceo' AND OLD.active = true THEN
      SELECT COUNT(*) INTO v_active_ceos
      FROM platform_admins
      WHERE role = 'ceo' 
        AND active = true
        AND id != OLD.id;
      
      IF v_active_ceos = 0 AND (NEW.role != 'ceo' OR NEW.active = false) THEN
        RAISE EXCEPTION 'No se puede desactivar o cambiar role del último CEO platform_admin.';
      END IF;
    END IF;
    
    RETURN NEW;
  END IF;
  
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."protect_last_admin"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."protect_last_admin"() IS 'Protege contra borrar/desactivar/degradar al último CEO platform_admin activo. Previene self-lockout.';



CREATE OR REPLACE FUNCTION "public"."replicate_system_permission_sets"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_replicated integer;
BEGIN
  INSERT INTO permission_sets (
    account_id, 
    name, 
    description, 
    is_system, 
    permissions, 
    active, 
    created_by
  )
  SELECT 
    NEW.id,
    ps.name, 
    ps.description, 
    true,
    ps.permissions, 
    true, 
    NEW.created_by
  FROM permission_sets ps
  WHERE ps.account_id IS NULL
    AND ps.is_system = true
    AND ps.active = true;
  
  GET DIAGNOSTICS v_replicated = ROW_COUNT;
  
  RAISE NOTICE 'replicate_system_permission_sets: replicated % sets to new account %', 
    v_replicated, NEW.id;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."replicate_system_permission_sets"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."replicate_system_permission_sets"() IS 'Replica los permission_sets system globales (account_id NULL) a cada nueva cuenta cliente.';



CREATE OR REPLACE FUNCTION "public"."seed_appcc_for_account"("p_account_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  -- IDs de planes (referencias estables a la tabla global appcc_plans)
  v_plan_aguas uuid;
  v_plan_limpieza uuid;
  v_plan_plagas uuid;
  v_plan_formacion uuid;
  v_plan_trazabilidad uuid;
  v_plan_mantenimiento uuid;
  v_plan_cadena_frio uuid;
  -- IDs de plantillas creadas (para insertar sus items después)
  v_tpl_id uuid;
  -- IDs de auditorías y secciones
  v_audit_id uuid;
  v_section_id uuid;
BEGIN
  -- Guard: si la cuenta ya tiene plantillas seed (detectado por la presencia
  -- del code 'agua_cloro_grifo' que es la primera que sembramos), no hacer nada.
  -- Detectamos por code en lugar de is_seed porque el patrón B2 (D1) usa
  -- is_seed=false en plantillas replicadas → no podríamos distinguir seed
  -- de las custom del cliente con solo is_seed.
  IF EXISTS (
    SELECT 1 FROM appcc_templates
    WHERE account_id = p_account_id AND code = 'agua_cloro_grifo'
  ) THEN
    RAISE NOTICE 'Cuenta % ya tiene plantillas seed (code agua_cloro_grifo existe), omitiendo seed_appcc_for_account', p_account_id;
    RETURN;
  END IF;

  -- Resolver IDs de planes globales
  SELECT id INTO v_plan_aguas FROM appcc_plans WHERE code = 'plan_aguas';
  SELECT id INTO v_plan_limpieza FROM appcc_plans WHERE code = 'plan_limpieza';
  SELECT id INTO v_plan_plagas FROM appcc_plans WHERE code = 'plan_plagas';
  SELECT id INTO v_plan_formacion FROM appcc_plans WHERE code = 'plan_formacion';
  SELECT id INTO v_plan_trazabilidad FROM appcc_plans WHERE code = 'plan_trazabilidad';
  SELECT id INTO v_plan_mantenimiento FROM appcc_plans WHERE code = 'plan_mantenimiento';
  SELECT id INTO v_plan_cadena_frio FROM appcc_plans WHERE code = 'plan_cadena_frio';

  IF v_plan_aguas IS NULL OR v_plan_limpieza IS NULL OR v_plan_plagas IS NULL
     OR v_plan_formacion IS NULL OR v_plan_trazabilidad IS NULL
     OR v_plan_mantenimiento IS NULL OR v_plan_cadena_frio IS NULL THEN
    RAISE EXCEPTION 'Planes globales no sembrados. Ejecuta Bloque 1.A primero.';
  END IF;

  -- ============================================================
  -- PLAN 1: CONTROL DE AGUAS
  -- ============================================================

  -- 1.1 Cloro residual en grifo de cocina (semanal)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_aguas, 'agua_cloro_grifo',
    'Control de cloro residual en grifo',
    'Medición semanal del cloro residual libre en grifo de cocina. Frecuencia: agua de red sin instalación intermedia = semanal.',
    false, true, 5)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, numeric_min, numeric_max, numeric_unit, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'cloro_ppm', 'Cloro residual libre',
     'Rango legal: 0.2-1.0 ppm (mg/L). Fuera de rango = incidencia.',
     'numeric', true, 1, 0.2, 1.0, 'ppm', true, 'high'),
    (v_tpl_id, 'grifo_estado', '¿Grifo en buen estado (sin fugas ni sarro)?',
     null,
     'boolean', true, 2, null, null, null, false, null),
    (v_tpl_id, 'observaciones', 'Observaciones',
     null,
     'text', false, 3, null, null, null, false, null);

  -- 1.2 Limpieza y desinfección de depósitos (anual)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_aguas, 'agua_limpieza_depositos',
    'Limpieza y desinfección de depósitos de agua',
    'Limpieza anual obligatoria de depósitos de agua potable. Aplica solo si hay instalación intermedia.',
    false, true, 60)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'deposito_vaciado', '¿Depósito vaciado completamente?',
     null, 'boolean', true, 1, true, 'medium'),
    (v_tpl_id, 'deposito_cepillado', '¿Paredes cepilladas y enjuagadas?',
     null, 'boolean', true, 2, true, 'medium'),
    (v_tpl_id, 'deposito_desinfectado', '¿Aplicado desinfectante alimentario?',
     'Hipoclorito sódico a 50 ppm durante 30 minutos, según protocolo.',
     'boolean', true, 3, true, 'high'),
    (v_tpl_id, 'deposito_aclarado', '¿Aclarado final con agua potable hasta retirar restos?',
     null, 'boolean', true, 4, true, 'high'),
    (v_tpl_id, 'producto_usado', 'Producto desinfectante utilizado',
     'Especifica marca y nº de registro sanitario.',
     'text', false, 5, false, null);

  -- 1.3 Análisis de potabilidad (anual)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_aguas, 'agua_analisis_potabilidad',
    'Análisis anual de potabilidad',
    'Registro del análisis de potabilidad realizado por laboratorio acreditado. Anual si red pública con depósito intermedio; sin instalación intermedia no aplica.',
    false, true, 10)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'fecha_analisis', 'Fecha del análisis',
     null, 'date', true, 1, false, null),
    (v_tpl_id, 'laboratorio', 'Laboratorio acreditado',
     'Nombre del laboratorio y nº de acreditación ENAC.',
     'text', true, 2, false, null),
    (v_tpl_id, 'resultado_apto', '¿Resultado APTO para consumo?',
     null, 'boolean', true, 3, true, 'critical'),
    (v_tpl_id, 'observaciones', 'Observaciones del informe',
     null, 'text', false, 4, false, null);

  -- ============================================================
  -- PLAN 2: LIMPIEZA Y DESINFECCIÓN
  -- ============================================================

  -- 2.1 Limpieza diaria de cocina (ESENCIAL — code preservado del frontend)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_limpieza, 'clean_kitchen_daily',
    'Limpieza diaria de cocina',
    'Checklist de limpieza al cierre de cocina. Cubre superficies, suelos, equipos y utensilios.',
    false, true, 25)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'superficies_limpias', '¿Superficies de trabajo limpias y desinfectadas?',
     null, 'boolean', true, 1, false, null),
    (v_tpl_id, 'suelos_limpios', '¿Suelos fregados con desengrasante?',
     null, 'boolean', true, 2, false, null),
    (v_tpl_id, 'fogones_limpios', '¿Fogones y planchas limpios?',
     null, 'boolean', true, 3, false, null),
    (v_tpl_id, 'desagues_limpios', '¿Desagües y rejillas libres de residuos?',
     null, 'boolean', true, 4, false, null),
    (v_tpl_id, 'utensilios_limpios', '¿Utensilios limpios y guardados?',
     null, 'boolean', true, 5, false, null),
    (v_tpl_id, 'basuras_retiradas', '¿Cubos de basura vaciados y desinfectados?',
     null, 'boolean', true, 6, true, 'medium'),
    (v_tpl_id, 'producto_usado', 'Producto de limpieza utilizado',
     null, 'text', false, 7, false, null);

  -- 2.2 Limpieza diaria de comedor (ESENCIAL)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_limpieza, 'clean_diningroom_daily',
    'Limpieza diaria de sala y comedor',
    'Limpieza al cierre de la zona de clientes: mesas, sillas, suelos, barra.',
    false, true, 20)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'mesas_limpias', '¿Mesas limpias y desinfectadas?',
     null, 'boolean', true, 1, false, null),
    (v_tpl_id, 'sillas_limpias', '¿Sillas/taburetes limpios?',
     null, 'boolean', true, 2, false, null),
    (v_tpl_id, 'suelos_sala', '¿Suelos de sala limpios?',
     null, 'boolean', true, 3, false, null),
    (v_tpl_id, 'barra_limpia', '¿Barra y tirador de cerveza limpios?',
     null, 'boolean', true, 4, false, null),
    (v_tpl_id, 'cristales_limpios', '¿Cristales y espejos sin marcas?',
     null, 'boolean', false, 5, false, null);

  -- 2.3 Limpieza diaria de aseos (ESENCIAL)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_limpieza, 'clean_toilets_daily',
    'Limpieza diaria de aseos',
    'Limpieza y desinfección de aseos al cierre. Punto crítico de inspección sanitaria.',
    false, true, 15)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'inodoros_desinfectados', '¿Inodoros limpios y desinfectados?',
     null, 'boolean', true, 1, true, 'medium'),
    (v_tpl_id, 'lavabos_limpios', '¿Lavabos limpios?',
     null, 'boolean', true, 2, false, null),
    (v_tpl_id, 'suelos_aseo', '¿Suelos fregados con desinfectante?',
     null, 'boolean', true, 3, false, null),
    (v_tpl_id, 'consumibles_repuestos', '¿Jabón, papel y secador repuestos?',
     null, 'boolean', true, 4, true, 'medium'),
    (v_tpl_id, 'olor_correcto', '¿Sin olores desagradables tras la limpieza?',
     null, 'boolean', true, 5, false, null);

  -- 2.4 Limpieza profunda cocina (semanal)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_limpieza, 'clean_kitchen_weekly',
    'Limpieza profunda de cocina (semanal)',
    'Limpieza exhaustiva semanal: zonas y elementos que no se limpian a diario.',
    false, true, 90)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'paredes_limpias', '¿Paredes de cocina limpias hasta 2m?',
     null, 'boolean', true, 1, false, null),
    (v_tpl_id, 'estanterias_limpias', '¿Estanterías vaciadas y limpias?',
     null, 'boolean', true, 2, false, null),
    (v_tpl_id, 'lamparas_limpias', '¿Lámparas y rejillas de iluminación limpias?',
     null, 'boolean', true, 3, false, null),
    (v_tpl_id, 'puertas_camaras', '¿Juntas de puertas de cámaras limpias?',
     'Las juntas acumulan moho y biofilm. Limpieza con cepillo y desinfectante.',
     'boolean', true, 4, true, 'medium'),
    (v_tpl_id, 'freidoras_fondo', '¿Freidoras vaciadas y limpiadas a fondo?',
     null, 'boolean', true, 5, true, 'medium'),
    (v_tpl_id, 'incidencias', 'Incidencias detectadas',
     null, 'text', false, 6, false, null);

  -- 2.5 Limpieza profunda cámaras (mensual)
  -- NOTA: dividido en 2 INSERTs porque el último item es numérico y declara
  -- columnas adicionales (numeric_min/max/unit), no compatibles con el VALUES
  -- de los items boolean en una sola sentencia.
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_limpieza, 'clean_cameras_monthly',
    'Limpieza profunda de cámaras frigoríficas',
    'Limpieza mensual a fondo de cámaras y congeladores: vaciado, descongelación si procede, desinfección.',
    false, true, 120)
  RETURNING id INTO v_tpl_id;

  -- Items 1-5: boolean (9 columnas)
  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'camara_vaciada', '¿Cámara vaciada completamente?',
     null, 'boolean', true, 1, false, null),
    (v_tpl_id, 'paredes_techos', '¿Paredes, techos y suelo de cámara limpios?',
     null, 'boolean', true, 2, false, null),
    (v_tpl_id, 'evaporador_limpio', '¿Evaporador limpio (sin hielo ni suciedad)?',
     null, 'boolean', true, 3, true, 'medium'),
    (v_tpl_id, 'desague_libre', '¿Desagüe de la cámara libre?',
     null, 'boolean', true, 4, true, 'medium'),
    (v_tpl_id, 'estanterias_desinfectadas', '¿Estanterías desinfectadas?',
     null, 'boolean', true, 5, false, null);

  -- Item 6: numérico (12 columnas con numeric_min/max/unit)
  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order,
     numeric_min, numeric_max, numeric_unit, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'temperatura_post_carga', 'Temperatura tras recarga (°C)',
     'Verifica que la cámara baja a temperatura de servicio tras la limpieza.',
     'numeric', true, 6, -25, 6, '°C', true, 'high');

  -- 2.6 Limpieza extracción/campana (mensual)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_limpieza, 'clean_extraction_monthly',
    'Limpieza de extracción y campana',
    'Limpieza mensual de filtros, campana y conductos accesibles. Crítico para prevención de incendios.',
    false, true, 60)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'filtros_desmontados', '¿Filtros desmontados y limpiados?',
     'Inmersión en desengrasante caliente y aclarado abundante.',
     'boolean', true, 1, true, 'high'),
    (v_tpl_id, 'campana_interior', '¿Interior de campana limpio?',
     null, 'boolean', true, 2, true, 'medium'),
    (v_tpl_id, 'campana_exterior', '¿Exterior de campana limpio?',
     null, 'boolean', true, 3, false, null),
    (v_tpl_id, 'conducto_accesible', '¿Tramo accesible del conducto limpio?',
     null, 'boolean', false, 4, false, null),
    (v_tpl_id, 'observaciones', 'Observaciones',
     null, 'text', false, 5, false, null);

  -- ============================================================
  -- PLAN 3: CONTROL DE PLAGAS
  -- ============================================================

  -- 3.1 Inspección visual semanal de plagas
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_plagas, 'plagas_inspeccion_visual',
    'Inspección visual de plagas',
    'Revisión semanal de presencia/indicios de plagas en cocina, almacén, comedor y aseos.',
    false, true, 15)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'sin_indicios_cocina', '¿Sin indicios de plagas en cocina?',
     'Indicios = excrementos, restos de pelaje, mordeduras en envases, insectos vivos o muertos.',
     'boolean', true, 1, true, 'high'),
    (v_tpl_id, 'sin_indicios_almacen', '¿Sin indicios de plagas en almacén?',
     null, 'boolean', true, 2, true, 'high'),
    (v_tpl_id, 'sin_indicios_comedor', '¿Sin indicios de plagas en comedor?',
     null, 'boolean', true, 3, true, 'high'),
    (v_tpl_id, 'sin_indicios_aseos', '¿Sin indicios de plagas en aseos?',
     null, 'boolean', true, 4, true, 'medium'),
    (v_tpl_id, 'mosquiteras_intactas', '¿Mosquiteras y barreras físicas intactas?',
     null, 'boolean', true, 5, false, null),
    (v_tpl_id, 'puertas_estancas', '¿Puertas exteriores cierran sin huecos?',
     null, 'boolean', true, 6, false, null),
    (v_tpl_id, 'zona_afectada', 'Zona afectada (si hay indicios)',
     null, 'text', false, 7, false, null);

  -- 3.2 Revisión de cebos y trampas (mensual)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_plagas, 'plagas_revision_cebos',
    'Revisión de cebos y trampas',
    'Revisión mensual del estado de cebos, trampas de roedores e insectocutores.',
    false, true, 20)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'cebos_completos', '¿Todos los cebos en su posición y completos?',
     'Si falta algún cebo o ha sido consumido, indica zona en observaciones.',
     'boolean', true, 1, true, 'medium'),
    (v_tpl_id, 'trampas_operativas', '¿Trampas mecánicas operativas?',
     null, 'boolean', true, 2, true, 'medium'),
    (v_tpl_id, 'insectocutor_limpio', '¿Insectocutor encendido y limpio?',
     null, 'boolean', true, 3, true, 'medium'),
    (v_tpl_id, 'capturas_revisadas', '¿Capturas revisadas y retiradas?',
     null, 'boolean', true, 4, false, null),
    (v_tpl_id, 'zonas_consumo_cebo', 'Zonas con consumo de cebo (si aplica)',
     null, 'text', false, 5, false, null);

  -- 3.3 Visita empresa DDD certificada (trimestral)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_plagas, 'plagas_visita_ddd',
    'Visita empresa DDD certificada',
    'Registro trimestral de visita de la empresa de Desinfección, Desinsectación y Desratización inscrita en ROESP.',
    false, true, 30)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'fecha_visita', 'Fecha de la visita',
     null, 'date', true, 1, false, null),
    (v_tpl_id, 'empresa_ddd', 'Empresa DDD',
     'Razón social y nº de registro ROESP (Registro Oficial de Establecimientos y Servicios Plaguicidas).',
     'text', true, 2, false, null),
    (v_tpl_id, 'tecnico_responsable', 'Técnico responsable',
     'Nombre del técnico que firma el certificado de actuación.',
     'text', true, 3, false, null),
    (v_tpl_id, 'tratamiento_aplicado', '¿Se aplicó tratamiento?',
     null, 'boolean', true, 4, false, null),
    (v_tpl_id, 'productos_usados', 'Productos / biocidas utilizados',
     'Nombres comerciales y números de registro sanitario.',
     'text', false, 5, false, null),
    (v_tpl_id, 'certificado_archivado', '¿Certificado archivado en carpeta APPCC?',
     null, 'boolean', true, 6, true, 'medium');

  -- ============================================================
  -- PLAN 4: FORMACIÓN DEL PERSONAL
  -- ============================================================

  -- 4.1 Formación inicial al alta del empleado
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_formacion, 'formacion_inicial',
    'Formación inicial del personal',
    'Registro de la formación inicial del empleado al alta. Obligatorio antes de iniciar tareas con alimentos.',
    false, true, 20)
  RETURNING id INTO v_tpl_id;

  -- Items boolean/text/date (9 columnas)
  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'empleado_nombre', 'Nombre del empleado',
     null, 'text', true, 1, false, null),
    (v_tpl_id, 'fecha_alta', 'Fecha de alta',
     null, 'date', true, 2, false, null),
    (v_tpl_id, 'fecha_formacion', 'Fecha de la formación',
     null, 'date', true, 3, false, null),
    (v_tpl_id, 'tipo_formacion', '¿Formación interna o externa?',
     'Interna = impartida por la empresa. Externa = curso oficial o academia.',
     'text', true, 4, false, null),
    (v_tpl_id, 'temas_cubiertos', '¿Temas cubiertos: higiene + APPCC + alérgenos?',
     null, 'boolean', true, 5, true, 'high'),
    (v_tpl_id, 'apto_manipulacion', '¿Empleado apto para manipular alimentos?',
     null, 'boolean', true, 7, true, 'critical'),
    (v_tpl_id, 'certificado_archivado', '¿Certificado o registro archivado?',
     null, 'boolean', true, 8, true, 'medium');

  -- Item numérico (12 columnas)
  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order,
     numeric_min, numeric_max, numeric_unit, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'duracion_horas', 'Duración (horas)',
     'Duración típica de formación inicial: 8h mínimo. Máximo razonable: 80h.',
     'numeric', true, 6, 0, 80, 'h', false, null);

  -- 4.2 Reciclaje anual de manipuladores
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_formacion, 'formacion_reciclaje_anual',
    'Reciclaje anual de manipuladores',
    'Registro de la formación de reciclaje anual obligatoria para manipuladores de alimentos.',
    false, true, 15)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'fecha_reciclaje', 'Fecha del reciclaje',
     null, 'date', true, 1, false, null),
    (v_tpl_id, 'empleados_asistentes', 'Empleados asistentes (lista)',
     'Nombres y firma de cada asistente.',
     'text', true, 2, false, null),
    (v_tpl_id, 'temas_actualizados', '¿Temas actualizados según normativa vigente?',
     null, 'boolean', true, 3, true, 'high'),
    (v_tpl_id, 'evaluacion_realizada', '¿Evaluación realizada y superada?',
     null, 'boolean', true, 4, true, 'medium'),
    (v_tpl_id, 'firma_responsable', '¿Firma del responsable de formación?',
     null, 'boolean', true, 5, true, 'medium');

  -- ============================================================
  -- PLAN 5: TRAZABILIDAD
  -- ============================================================

  -- 5.1 Recepción de mercancías (al evento)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_trazabilidad, 'traza_recepcion',
    'Recepción de mercancías',
    'Registro de cada recepción de mercancía: proveedor, lote, caducidad, temperatura si aplica. Punto crítico de trazabilidad.',
    false, true, 10)
  RETURNING id INTO v_tpl_id;

  -- Items boolean/text/date (9 columnas)
  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'fecha_recepcion', 'Fecha de recepción',
     null, 'date', true, 1, false, null),
    (v_tpl_id, 'proveedor', 'Proveedor',
     null, 'text', true, 2, false, null),
    (v_tpl_id, 'albaran_numero', 'Nº de albarán',
     null, 'text', true, 3, false, null),
    (v_tpl_id, 'envases_integros', '¿Envases íntegros y limpios?',
     null, 'boolean', true, 4, true, 'high'),
    (v_tpl_id, 'caducidades_correctas', '¿Caducidades dentro de margen aceptable?',
     null, 'boolean', true, 5, true, 'high'),
    (v_tpl_id, 'lote_anotado', '¿Lote anotado para trazabilidad?',
     null, 'boolean', true, 6, true, 'critical');

  -- Item numérico (12 columnas)
  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order,
     numeric_min, numeric_max, numeric_unit, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'temperatura_refrigerado', 'Temperatura productos refrigerados (°C)',
     'Solo si recibes refrigerados. Tolerancia: 0-7°C según producto. Rechazar si fuera de rango.',
     'numeric', false, 7, 0, 7, '°C', true, 'critical');

  -- 5.2 Etiquetado de productos descongelados (al evento)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_trazabilidad, 'traza_descongelados',
    'Etiquetado de productos descongelados',
    'Registro y etiquetado de cada producto puesto a descongelar. Norma: descongelación en refrigeración a <4°C.',
    false, true, 5)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'producto', 'Producto descongelado',
     null, 'text', true, 1, false, null),
    (v_tpl_id, 'lote_origen', 'Lote del producto original',
     'Imprescindible para trazabilidad si hay incidencia posterior.',
     'text', true, 2, true, 'high'),
    (v_tpl_id, 'fecha_inicio', 'Fecha de inicio descongelación',
     null, 'date', true, 3, false, null),
    (v_tpl_id, 'fecha_consumo_max', 'Fecha máxima de consumo (24-48h)',
     null, 'date', true, 4, true, 'high'),
    (v_tpl_id, 'metodo_correcto', '¿Descongelación en cámara a <4°C?',
     null, 'boolean', true, 5, true, 'critical'),
    (v_tpl_id, 'etiqueta_colocada', '¿Etiqueta visible en el envase?',
     null, 'boolean', true, 6, true, 'medium');

  -- 5.3 Etiquetado de productos elaborados (diaria)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_trazabilidad, 'traza_elaborados',
    'Etiquetado de productos elaborados',
    'Etiquetado diario de elaboraciones propias (salsas, marinados, cocidos): fecha, lote interno, fecha límite consumo.',
    false, true, 10)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'producto_elaborado', 'Producto elaborado',
     null, 'text', true, 1, false, null),
    (v_tpl_id, 'fecha_elaboracion', 'Fecha de elaboración',
     null, 'date', true, 2, false, null),
    (v_tpl_id, 'lote_interno', 'Lote interno',
     'Código asignado por la cocina (ej: 20260517-A).',
     'text', true, 3, true, 'high'),
    (v_tpl_id, 'fecha_caducidad', 'Fecha límite de consumo',
     null, 'date', true, 4, true, 'high'),
    (v_tpl_id, 'almacenado_correcto', '¿Almacenado a temperatura correcta?',
     null, 'boolean', true, 5, true, 'critical'),
    (v_tpl_id, 'etiqueta_visible', '¿Etiqueta visible en el recipiente?',
     null, 'boolean', true, 6, true, 'medium');

  -- ============================================================
  -- PLAN 6: MANTENIMIENTO
  -- ============================================================

  -- 6.1 Higiene apertura + estado de equipos (ESENCIAL — dayPeriod: opening)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_mantenimiento, 'hygiene_daily',
    'Checklist de apertura: higiene y equipos',
    'Verificación de apertura: limpieza general del cierre anterior, estado de equipos, lavamanos y uniforme del personal.',
    false, true, 10)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'limpieza_previa_ok', '¿Limpieza general del cierre anterior correcta?',
     'Verificación visual de que la cocina y zonas comunes quedaron limpias.',
     'boolean', true, 1, true, 'medium'),
    (v_tpl_id, 'equipos_encendidos', '¿Equipos de cocina encendidos correctamente?',
     null, 'boolean', true, 2, false, null),
    (v_tpl_id, 'camaras_funcionando', '¿Cámaras funcionando (luces y motores)?',
     null, 'boolean', true, 3, true, 'high'),
    (v_tpl_id, 'lavamanos_operativos', '¿Lavamanos operativos con jabón y papel?',
     null, 'boolean', true, 4, true, 'high'),
    (v_tpl_id, 'uniforme_personal', '¿Personal con uniforme y aseo personal correcto?',
     null, 'boolean', true, 5, true, 'medium'),
    (v_tpl_id, 'observaciones', 'Observaciones de apertura',
     null, 'text', false, 6, false, null);

  -- 6.2 Control del aceite de freidora (ESENCIAL — dayPeriod: anytime)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_mantenimiento, 'oil_check_daily',
    'Control del aceite de freidora',
    'Verificación del estado del aceite: color, olor, temperatura y nivel. Cambio si supera límites.',
    false, true, 5)
  RETURNING id INTO v_tpl_id;

  -- Items boolean/text (9 columnas)
  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'aceite_color_olor', '¿Color y olor del aceite correctos?',
     'Aceite oscuro, espumoso o con olor rancio = cambio inmediato.',
     'boolean', true, 1, true, 'high'),
    (v_tpl_id, 'aceite_filtrado', '¿Aceite filtrado tras servicio?',
     null, 'boolean', true, 3, false, null),
    (v_tpl_id, 'cambio_realizado', '¿Aceite cambiado hoy?',
     'Marcar si se ha realizado cambio completo.',
     'boolean', false, 4, false, null);

  -- Items numéricos (12 columnas con numeric_min/max/unit)
  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order,
     numeric_min, numeric_max, numeric_unit, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'temperatura_aceite', 'Temperatura del aceite (°C)',
     'Rango óptimo: 160-180°C. Por encima de 200°C degrada el aceite.',
     'numeric', true, 2, 160, 180, '°C', true, 'medium');

  -- 6.3 Revisión preventiva de equipos (mensual)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_mantenimiento, 'equipos_revision_mensual',
    'Revisión preventiva de equipos',
    'Revisión mensual del estado de equipos de cocina (hornos, planchas, lavavajillas) y registro de incidencias.',
    false, true, 45)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'hornos_ok', '¿Hornos en buen estado (temperatura, puertas, juntas)?',
     null, 'boolean', true, 1, true, 'medium'),
    (v_tpl_id, 'planchas_ok', '¿Planchas/parrillas en buen estado?',
     null, 'boolean', true, 2, true, 'medium'),
    (v_tpl_id, 'lavavajillas_ok', '¿Lavavajillas funcionando correctamente?',
     'Comprobar temperatura de lavado (>55°C) y de aclarado (>82°C).',
     'boolean', true, 3, true, 'high'),
    (v_tpl_id, 'freidoras_ok', '¿Freidoras sin fugas y termostato OK?',
     null, 'boolean', true, 4, true, 'high'),
    (v_tpl_id, 'electrico_ok', '¿Instalación eléctrica visible sin daños?',
     null, 'boolean', true, 5, true, 'high'),
    (v_tpl_id, 'incidencias_detectadas', 'Incidencias detectadas',
     null, 'text', false, 6, false, null);

  -- 6.4 Calibración de termómetros (semestral)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_mantenimiento, 'termometros_calibracion',
    'Calibración de termómetros',
    'Verificación semestral de la calibración de termómetros mediante prueba de hielo fundente (0°C) y agua hirviendo (100°C).',
    false, true, 20)
  RETURNING id INTO v_tpl_id;

  -- Items boolean (9 columnas)
  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'termometros_revisados', '¿Todos los termómetros del establecimiento revisados?',
     null, 'boolean', true, 1, true, 'high'),
    (v_tpl_id, 'desviacion_aceptable', '¿Desviación dentro de ±1°C?',
     null, 'boolean', true, 4, true, 'critical');

  -- Items numéricos (12 columnas)
  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order,
     numeric_min, numeric_max, numeric_unit, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'lectura_hielo', 'Lectura en hielo fundente (°C)',
     'Tolerancia: -1°C a +1°C. Fuera = recalibrar o sustituir.',
     'numeric', true, 2, -1, 1, '°C', true, 'high'),
    (v_tpl_id, 'lectura_hirviente', 'Lectura en agua hirviendo (°C)',
     'Tolerancia: 99°C a 101°C.',
     'numeric', true, 3, 99, 101, '°C', true, 'high');

  -- ============================================================
  -- PLAN 7: CADENA DE FRÍO
  -- ============================================================

  -- 7.1 Temperatura cámaras AM (ESENCIAL — dayPeriod: opening +30min)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_cadena_frio, 'temp_cameras_am',
    'Temperaturas de cámaras (apertura)',
    'Registro de temperaturas de cámaras frigoríficas, congelador y vitrinas al inicio de la jornada. Punto crítico APPCC.',
    false, true, 10)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order,
     numeric_min, numeric_max, numeric_unit, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'camara_carne', 'Cámara de carnes',
     'Rango legal: 0-4°C.',
     'numeric', true, 1, 0, 4, '°C', true, 'critical'),
    (v_tpl_id, 'camara_pescado', 'Cámara de pescado',
     'Rango legal: 0-2°C.',
     'numeric', false, 2, 0, 2, '°C', true, 'critical'),
    (v_tpl_id, 'camara_lacteos', 'Cámara de lácteos/precocinados',
     'Rango legal: 2-6°C.',
     'numeric', false, 3, 2, 6, '°C', true, 'critical'),
    (v_tpl_id, 'camara_verduras', 'Cámara de verduras',
     'Rango legal: 4-8°C.',
     'numeric', false, 4, 4, 8, '°C', true, 'high'),
    (v_tpl_id, 'congelador', 'Congelador',
     'Rango legal: -18°C o inferior.',
     'numeric', true, 5, -30, -18, '°C', true, 'critical'),
    (v_tpl_id, 'vitrina_expositora', 'Vitrina expositora (si aplica)',
     'Rango general: 0-7°C.',
     'numeric', false, 6, 0, 7, '°C', true, 'high');

  -- 7.2 Temperatura cámaras PM (ESENCIAL — dayPeriod: closing -60min)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_cadena_frio, 'temp_cameras_pm',
    'Temperaturas de cámaras (cierre)',
    'Segundo registro diario de temperaturas al cierre. Detecta desviaciones acumuladas durante el servicio.',
    false, true, 10)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order,
     numeric_min, numeric_max, numeric_unit, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'camara_carne', 'Cámara de carnes',
     'Rango legal: 0-4°C.',
     'numeric', true, 1, 0, 4, '°C', true, 'critical'),
    (v_tpl_id, 'camara_pescado', 'Cámara de pescado',
     'Rango legal: 0-2°C.',
     'numeric', false, 2, 0, 2, '°C', true, 'critical'),
    (v_tpl_id, 'camara_lacteos', 'Cámara de lácteos/precocinados',
     'Rango legal: 2-6°C.',
     'numeric', false, 3, 2, 6, '°C', true, 'critical'),
    (v_tpl_id, 'camara_verduras', 'Cámara de verduras',
     'Rango legal: 4-8°C.',
     'numeric', false, 4, 4, 8, '°C', true, 'high'),
    (v_tpl_id, 'congelador', 'Congelador',
     'Rango legal: -18°C o inferior.',
     'numeric', true, 5, -30, -18, '°C', true, 'critical');

  -- 7.3 Control de caducidades (ESENCIAL — dayPeriod: anytime)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_cadena_frio, 'expiry_cameras_daily',
    'Control de caducidades en cámaras',
    'Revisión diaria de fechas de caducidad/consumo preferente. Retirar productos caducados antes de servicio.',
    false, true, 10)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'camaras_revisadas', '¿Todas las cámaras revisadas?',
     null, 'boolean', true, 1, true, 'high'),
    (v_tpl_id, 'caducados_retirados', '¿Productos caducados retirados?',
     null, 'boolean', true, 2, true, 'critical'),
    (v_tpl_id, 'fifo_aplicado', '¿FIFO aplicado (primero entrado, primero salido)?',
     'Productos más próximos a caducar al frente.',
     'boolean', true, 3, true, 'medium'),
    (v_tpl_id, 'elaborados_revisados', '¿Elaboraciones propias dentro de fecha?',
     'Salsas, marinados, cocidos con su etiqueta de fecha límite.',
     'boolean', true, 4, true, 'high'),
    (v_tpl_id, 'productos_retirados', 'Productos retirados (descripción y motivo)',
     null, 'text', false, 5, false, null);

  -- 7.4 Verificación detallada de temperaturas (semanal)
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_cadena_frio, 'temp_verification_weekly',
    'Verificación detallada de temperaturas',
    'Verificación semanal con termómetro calibrado contra termómetro propio de cada cámara. Detecta desviaciones del sensor.',
    false, true, 20)
  RETURNING id INTO v_tpl_id;

  -- Items boolean (9 columnas)
  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'termometro_propio_ok', '¿Termómetro propio de la cámara coincide con el patrón?',
     null, 'boolean', true, 1, true, 'high'),
    (v_tpl_id, 'puertas_estancas', '¿Puertas cierran herméticamente sin pérdida de frío?',
     null, 'boolean', true, 4, true, 'medium'),
    (v_tpl_id, 'observaciones', 'Observaciones de la verificación',
     null, 'text', false, 5, false, null);

  -- Items numéricos (12 columnas)
  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order,
     numeric_min, numeric_max, numeric_unit, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'temp_patron', 'Temperatura medida con termómetro patrón (°C)',
     'Usa un termómetro calibrado externo, no el propio del aparato.',
     'numeric', true, 2, -30, 10, '°C', false, null),
    (v_tpl_id, 'desviacion', 'Desviación respecto al termómetro de la cámara (°C)',
     'Tolerancia: ±2°C. Más = recalibrar o llamar técnico.',
     'numeric', true, 3, -2, 2, '°C', true, 'high');

  -- 7.5 Análisis trimestral de la cadena de frío
  INSERT INTO appcc_templates (account_id, plan_id, code, name, description, is_seed, is_active, estimated_minutes)
  VALUES (p_account_id, v_plan_cadena_frio, 'cadena_frio_quarterly',
    'Análisis trimestral de la cadena de frío',
    'Revisión trimestral de incidencias acumuladas, tendencias de temperatura y mantenimiento preventivo de equipos de frío.',
    false, true, 60)
  RETURNING id INTO v_tpl_id;

  INSERT INTO appcc_template_items
    (template_id, code, label, help_text, field_type, is_required, display_order, creates_incident_on_fail, incident_severity)
  VALUES
    (v_tpl_id, 'fecha_revision', 'Fecha de la revisión',
     null, 'date', true, 1, false, null),
    (v_tpl_id, 'incidencias_periodo', 'Incidencias del periodo (resumen)',
     'Recuento de incidencias críticas detectadas en los últimos 3 meses.',
     'text', true, 2, false, null),
    (v_tpl_id, 'mantenimiento_realizado', '¿Mantenimiento preventivo realizado (limpieza condensadores, verificación juntas)?',
     null, 'boolean', true, 3, true, 'medium'),
    (v_tpl_id, 'equipos_sustituidos', 'Equipos sustituidos o reparados (si aplica)',
     null, 'text', false, 4, false, null),
    (v_tpl_id, 'tendencia_correcta', '¿Tendencia de temperaturas estable y dentro de rangos?',
     null, 'boolean', true, 5, true, 'medium'),
    (v_tpl_id, 'plan_mejora', 'Plan de mejora propuesto (si procede)',
     null, 'text', false, 6, false, null);

  -- ============================================================
  -- AUDITORÍA 1: MENSUAL INTERNA
  -- recurrence='monthly', pass_score=80
  -- 5 secciones, 32 items binarios
  -- ============================================================

  INSERT INTO appcc_audit_templates
    (account_id, code, name, description, is_seed, is_active, recurrence, pass_score)
  VALUES (p_account_id, 'audit_monthly',
    'Auditoría APPCC Mensual',
    'Auditoría interna mensual que verifica el cumplimiento del plan APPCC: registros del día a día, incidencias resueltas, estado de limpieza, cadena de frío, trazabilidad. Aprobar = ≥80% ponderado.',
    false, true, 'monthly', 80)
  RETURNING id INTO v_audit_id;

  -- Sección 1: Limpieza y Desinfección
  INSERT INTO appcc_audit_sections (template_id, code, name, description, display_order, weight)
  VALUES (v_audit_id, 'sec_limpieza', 'Limpieza y Desinfección',
    'Verificación del cumplimiento del plan de limpieza diaria, semanal y mensual.',
    1, 2)
  RETURNING id INTO v_section_id;

  INSERT INTO appcc_audit_items
    (section_id, code, question, help_text, display_order, scoring_type, weight, creates_incident_on_fail, incident_severity)
  VALUES
    (v_section_id, 'limp_diaria_completa', '¿Se ha registrado la limpieza diaria de cocina, sala y aseos los últimos 30 días?',
     'Comprobar que hay 3 ejecuciones diarias (kitchen, dining, toilets) por día laborable.',
     1, 'binary', 3, true, 'high'),
    (v_section_id, 'limp_semanal_realizada', '¿Se ha realizado la limpieza semanal profunda de cocina?',
     'Mínimo 4 ejecuciones en el mes.',
     2, 'binary', 2, true, 'medium'),
    (v_section_id, 'camaras_limpias', '¿Se ha realizado la limpieza mensual de cámaras frigoríficas?',
     null,
     3, 'binary', 3, true, 'high'),
    (v_section_id, 'extraccion_limpia', '¿Se ha realizado la limpieza mensual de extracción/campana?',
     'Crítico para prevención de incendios.',
     4, 'binary', 2, true, 'medium'),
    (v_section_id, 'productos_etiquetados', '¿Los productos de limpieza están correctamente etiquetados y guardados separados de alimentos?',
     null,
     5, 'binary', 2, true, 'high'),
    (v_section_id, 'limp_visual_ok', '¿Inspección visual: superficies, suelos y equipos en buen estado de limpieza?',
     null,
     6, 'binary', 1, false, null);

  -- Sección 2: Cadena de Frío
  INSERT INTO appcc_audit_sections (template_id, code, name, description, display_order, weight)
  VALUES (v_audit_id, 'sec_cadena_frio', 'Cadena de Frío',
    'Control de temperaturas en cámaras y verificación de caducidades.',
    2, 3)
  RETURNING id INTO v_section_id;

  INSERT INTO appcc_audit_items
    (section_id, code, question, help_text, display_order, scoring_type, weight, creates_incident_on_fail, incident_severity)
  VALUES
    (v_section_id, 'temp_am_registradas', '¿Hay registros diarios de temperatura AM en el último mes?',
     'Comprobar ejecuciones de temp_cameras_am.',
     1, 'binary', 3, true, 'critical'),
    (v_section_id, 'temp_pm_registradas', '¿Hay registros diarios de temperatura PM en el último mes?',
     null,
     2, 'binary', 3, true, 'critical'),
    (v_section_id, 'sin_desviaciones_criticas', '¿Sin desviaciones críticas de temperatura sin resolver?',
     'Desviación crítica = fuera de rango legal sin acción correctora documentada.',
     3, 'binary', 5, true, 'critical'),
    (v_section_id, 'caducidades_revisadas', '¿Se revisan diariamente las caducidades?',
     null,
     4, 'binary', 2, true, 'high'),
    (v_section_id, 'fifo_aplicado', '¿FIFO aplicado visualmente en cámaras?',
     null,
     5, 'binary', 2, true, 'medium'),
    (v_section_id, 'congelador_estable', '¿Congelador estable a -18°C o inferior?',
     null,
     6, 'binary', 3, true, 'critical'),
    (v_section_id, 'verificacion_semanal', '¿Verificación semanal de temperaturas con termómetro patrón realizada?',
     null,
     7, 'binary', 1, false, null);

  -- Sección 3: Trazabilidad
  INSERT INTO appcc_audit_sections (template_id, code, name, description, display_order, weight)
  VALUES (v_audit_id, 'sec_trazabilidad', 'Trazabilidad',
    'Registros de recepción, etiquetado de elaborados y descongelados.',
    3, 2)
  RETURNING id INTO v_section_id;

  INSERT INTO appcc_audit_items
    (section_id, code, question, help_text, display_order, scoring_type, weight, creates_incident_on_fail, incident_severity)
  VALUES
    (v_section_id, 'recepciones_registradas', '¿Cada recepción del último mes tiene registro de trazabilidad?',
     'Comprobar que ejecuciones de traza_recepcion coinciden con albaranes recibidos.',
     1, 'binary', 3, true, 'high'),
    (v_section_id, 'elaborados_etiquetados', '¿Productos elaborados de cocina etiquetados con fecha y lote?',
     null,
     2, 'binary', 3, true, 'high'),
    (v_section_id, 'descongelados_etiquetados', '¿Productos descongelados etiquetados con fecha límite consumo?',
     null,
     3, 'binary', 3, true, 'high'),
    (v_section_id, 'temp_recepcion_ok', '¿Las temperaturas de recepción están dentro de rango (0-7°C refrigerado)?',
     null,
     4, 'binary', 2, true, 'critical'),
    (v_section_id, 'sin_caducados', '¿Sin productos caducados en cámaras?',
     null,
     5, 'binary', 4, true, 'critical');

  -- Sección 4: Plagas y Mantenimiento
  INSERT INTO appcc_audit_sections (template_id, code, name, description, display_order, weight)
  VALUES (v_audit_id, 'sec_plagas_mant', 'Plagas y Mantenimiento',
    'Inspección visual de plagas, estado de cebos y mantenimiento de equipos.',
    4, 2)
  RETURNING id INTO v_section_id;

  INSERT INTO appcc_audit_items
    (section_id, code, question, help_text, display_order, scoring_type, weight, creates_incident_on_fail, incident_severity)
  VALUES
    (v_section_id, 'sin_indicios_plagas', '¿Sin indicios de plagas en cocina, almacén, sala y aseos?',
     null,
     1, 'binary', 4, true, 'critical'),
    (v_section_id, 'cebos_operativos', '¿Cebos y trampas operativos en todas las zonas?',
     null,
     2, 'binary', 2, true, 'medium'),
    (v_section_id, 'insectocutor_ok', '¿Insectocutor encendido y limpio?',
     null,
     3, 'binary', 1, false, null),
    (v_section_id, 'mosquiteras_ok', '¿Mosquiteras y barreras físicas intactas?',
     null,
     4, 'binary', 2, true, 'medium'),
    (v_section_id, 'equipos_funcionando', '¿Equipos de cocina (hornos, planchas, lavavajillas) en buen estado?',
     null,
     5, 'binary', 2, true, 'medium'),
    (v_section_id, 'incidencias_mantenimiento', '¿Incidencias de mantenimiento del mes resueltas o en plan de acción?',
     null,
     6, 'binary', 1, false, null);

  -- Sección 5: Personal y Documentación
  INSERT INTO appcc_audit_sections (template_id, code, name, description, display_order, weight)
  VALUES (v_audit_id, 'sec_personal', 'Personal y Documentación',
    'Uniformes, higiene personal, formación al día y archivo de registros.',
    5, 2)
  RETURNING id INTO v_section_id;

  INSERT INTO appcc_audit_items
    (section_id, code, question, help_text, display_order, scoring_type, weight, creates_incident_on_fail, incident_severity)
  VALUES
    (v_section_id, 'uniformes_correctos', '¿Personal con uniforme limpio, calzado y cubrecabezas?',
     null,
     1, 'binary', 2, true, 'medium'),
    (v_section_id, 'higiene_personal', '¿Higiene personal correcta (manos, uñas, ausencia de joyas)?',
     null,
     2, 'binary', 3, true, 'high'),
    (v_section_id, 'formacion_vigente', '¿Todo el personal con formación de manipulador vigente?',
     'Verificar fechas en registros del Plan de Formación.',
     3, 'binary', 3, true, 'high'),
    (v_section_id, 'altas_con_formacion', '¿Nuevas incorporaciones del mes con formación inicial registrada?',
     null,
     4, 'binary', 3, true, 'critical'),
    (v_section_id, 'registros_archivados', '¿Registros APPCC del mes archivados y accesibles?',
     null,
     5, 'binary', 2, true, 'medium'),
    (v_section_id, 'incidencias_documentadas', '¿Incidencias del mes documentadas con acción correctora?',
     null,
     6, 'binary', 3, true, 'high'),
    (v_section_id, 'cartelería_obligatoria', '¿Cartelería obligatoria visible (alérgenos, lavado de manos, NIF establecimiento)?',
     null,
     7, 'binary', 1, false, null),
    (v_section_id, 'firmas_responsable', '¿Registros del mes firmados por responsable?',
     null,
     8, 'binary', 2, true, 'medium');

  -- ============================================================
  -- AUDITORÍA 2: ANUAL / PRE-INSPECCIÓN
  -- recurrence='yearly', pass_score=90
  -- 7 secciones (los 7 prerrequisitos APPCC), 50 items binarios
  -- ============================================================

  INSERT INTO appcc_audit_templates
    (account_id, code, name, description, is_seed, is_active, recurrence, pass_score)
  VALUES (p_account_id, 'audit_yearly',
    'Auditoría APPCC Anual / Pre-Inspección',
    'Auditoría exhaustiva anual estructurada según los 7 prerrequisitos APPCC del RD 109/2010. Prepara al establecimiento para inspección sanitaria oficial. Aprobar = ≥90% ponderado.',
    false, true, 'yearly', 90)
  RETURNING id INTO v_audit_id;

  -- Sección 1: Control de Aguas
  INSERT INTO appcc_audit_sections (template_id, code, name, description, display_order, weight)
  VALUES (v_audit_id, 'sec_aguas', 'Control de Aguas',
    'Potabilidad, cloración y limpieza de depósitos si los hubiera.',
    1, 2)
  RETURNING id INTO v_section_id;

  INSERT INTO appcc_audit_items
    (section_id, code, question, help_text, display_order, scoring_type, weight, creates_incident_on_fail, incident_severity)
  VALUES
    (v_section_id, 'analisis_anual', '¿Análisis de potabilidad anual realizado por laboratorio acreditado?',
     'Solo obligatorio si hay instalación intermedia (depósito).',
     1, 'binary', 4, true, 'high'),
    (v_section_id, 'cloro_registros', '¿Registros semanales de cloro residual de los últimos 12 meses completos?',
     null,
     2, 'binary', 3, true, 'medium'),
    (v_section_id, 'limpieza_deposito', '¿Limpieza y desinfección anual de depósitos documentada?',
     null,
     3, 'binary', 3, true, 'medium'),
    (v_section_id, 'sin_incidencias_agua', '¿Sin incidencias de potabilidad sin resolver?',
     null,
     4, 'binary', 5, true, 'critical');

  -- Sección 2: Limpieza y Desinfección
  INSERT INTO appcc_audit_sections (template_id, code, name, description, display_order, weight)
  VALUES (v_audit_id, 'sec_limpieza_anual', 'Limpieza y Desinfección',
    'Cumplimiento del plan completo de limpieza durante el año.',
    2, 2)
  RETURNING id INTO v_section_id;

  INSERT INTO appcc_audit_items
    (section_id, code, question, help_text, display_order, scoring_type, weight, creates_incident_on_fail, incident_severity)
  VALUES
    (v_section_id, 'plan_limpieza_doc', '¿Plan de limpieza documentado con productos, frecuencias y responsables?',
     null,
     1, 'binary', 4, true, 'high'),
    (v_section_id, 'fichas_seguridad', '¿Fichas de seguridad de productos de limpieza disponibles?',
     'Obligatorio por normativa de productos químicos.',
     2, 'binary', 3, true, 'medium'),
    (v_section_id, 'cumplimiento_diario', '¿Tasa de cumplimiento de limpieza diaria > 95% en el año?',
     null,
     3, 'binary', 4, true, 'high'),
    (v_section_id, 'cumplimiento_semanal', '¿Cumplimiento semanal de limpieza profunda > 90%?',
     null,
     4, 'binary', 3, true, 'medium'),
    (v_section_id, 'cumplimiento_mensual', '¿Cumplimiento mensual de limpieza profunda (cámaras, extracción) > 90%?',
     null,
     5, 'binary', 3, true, 'medium'),
    (v_section_id, 'almacen_productos', '¿Productos de limpieza separados de alimentos y bien identificados?',
     null,
     6, 'binary', 3, true, 'high');

  -- Sección 3: Control de Plagas
  INSERT INTO appcc_audit_sections (template_id, code, name, description, display_order, weight)
  VALUES (v_audit_id, 'sec_plagas_anual', 'Control de Plagas',
    'Sistema de prevención y control vigente todo el año.',
    3, 2)
  RETURNING id INTO v_section_id;

  INSERT INTO appcc_audit_items
    (section_id, code, question, help_text, display_order, scoring_type, weight, creates_incident_on_fail, incident_severity)
  VALUES
    (v_section_id, 'contrato_ddd', '¿Contrato con empresa DDD inscrita en ROESP vigente?',
     'ROESP = Registro Oficial de Establecimientos y Servicios Plaguicidas.',
     1, 'binary', 5, true, 'critical'),
    (v_section_id, 'visitas_trimestrales', '¿Las 4 visitas trimestrales del año documentadas?',
     null,
     2, 'binary', 3, true, 'high'),
    (v_section_id, 'certificados_archivados', '¿Certificados de actuación archivados?',
     null,
     3, 'binary', 3, true, 'medium'),
    (v_section_id, 'plano_ddd', '¿Plano de ubicación de cebos y trampas disponible?',
     'Inspección sanitaria suele pedirlo.',
     4, 'binary', 2, true, 'medium'),
    (v_section_id, 'sin_indicios_anuales', '¿Sin incidencias graves de plagas en el año?',
     null,
     5, 'binary', 4, true, 'critical'),
    (v_section_id, 'barreras_fisicas', '¿Mosquiteras y barreras físicas en buen estado?',
     null,
     6, 'binary', 2, false, null);

  -- Sección 4: Formación del Personal
  INSERT INTO appcc_audit_sections (template_id, code, name, description, display_order, weight)
  VALUES (v_audit_id, 'sec_formacion_anual', 'Formación del Personal',
    'Acreditación de formación inicial y reciclajes anuales.',
    4, 2)
  RETURNING id INTO v_section_id;

  INSERT INTO appcc_audit_items
    (section_id, code, question, help_text, display_order, scoring_type, weight, creates_incident_on_fail, incident_severity)
  VALUES
    (v_section_id, 'todos_con_formacion', '¿Todo el personal con formación de manipulador acreditada?',
     null,
     1, 'binary', 5, true, 'critical'),
    (v_section_id, 'altas_anuales_formadas', '¿Todas las altas del año con formación inicial antes de iniciar tareas?',
     null,
     2, 'binary', 5, true, 'critical'),
    (v_section_id, 'reciclaje_anual', '¿Reciclaje anual realizado para todo el personal?',
     null,
     3, 'binary', 4, true, 'high'),
    (v_section_id, 'certificados_personal', '¿Carpeta con certificados/registros de cada empleado disponible?',
     null,
     4, 'binary', 3, true, 'medium'),
    (v_section_id, 'formacion_alergenos', '¿Personal formado específicamente en alérgenos?',
     'Obligatorio desde RD 126/2015.',
     5, 'binary', 4, true, 'high'),
    (v_section_id, 'plan_formacion_doc', '¿Plan de formación documentado con temario y duración?',
     null,
     6, 'binary', 2, false, null);

  -- Sección 5: Trazabilidad
  INSERT INTO appcc_audit_sections (template_id, code, name, description, display_order, weight)
  VALUES (v_audit_id, 'sec_traza_anual', 'Trazabilidad',
    'Recepciones, etiquetado y trazado de productos durante el año.',
    5, 3)
  RETURNING id INTO v_section_id;

  INSERT INTO appcc_audit_items
    (section_id, code, question, help_text, display_order, scoring_type, weight, creates_incident_on_fail, incident_severity)
  VALUES
    (v_section_id, 'lista_proveedores', '¿Lista de proveedores actualizada con autorizaciones sanitarias (RSI)?',
     'RSI = Registro Sanitario de Industrias.',
     1, 'binary', 4, true, 'high'),
    (v_section_id, 'recepciones_registradas_ano', '¿Recepciones de mercancía con trazabilidad completa durante el año?',
     null,
     2, 'binary', 4, true, 'high'),
    (v_section_id, 'lotes_internos', '¿Sistema de lotes internos para elaboraciones aplicado consistentemente?',
     null,
     3, 'binary', 3, true, 'medium'),
    (v_section_id, 'plan_alergenos', '¿Plan de gestión de alérgenos documentado por plato?',
     null,
     4, 'binary', 5, true, 'critical'),
    (v_section_id, 'carta_alergenos', '¿Carta o ficha con alérgenos por plato visible/disponible para clientes?',
     'Obligatorio por RD 126/2015 + Reglamento UE 1169/2011.',
     5, 'binary', 5, true, 'critical'),
    (v_section_id, 'retiradas_anuales', '¿Procedimiento de retirada de productos definido y conocido por personal?',
     null,
     6, 'binary', 3, true, 'high'),
    (v_section_id, 'incidencias_traza', '¿Sin incidencias graves de trazabilidad sin resolver?',
     null,
     7, 'binary', 4, true, 'critical');

  -- Sección 6: Mantenimiento y Equipos
  INSERT INTO appcc_audit_sections (template_id, code, name, description, display_order, weight)
  VALUES (v_audit_id, 'sec_mant_anual', 'Mantenimiento y Equipos',
    'Estado de equipos, calibraciones y revisiones técnicas anuales.',
    6, 2)
  RETURNING id INTO v_section_id;

  INSERT INTO appcc_audit_items
    (section_id, code, question, help_text, display_order, scoring_type, weight, creates_incident_on_fail, incident_severity)
  VALUES
    (v_section_id, 'calibracion_termometros', '¿Termómetros calibrados al menos 2 veces en el año?',
     null,
     1, 'binary', 4, true, 'high'),
    (v_section_id, 'revisiones_mensuales', '¿Revisiones mensuales de equipos documentadas (>10 de 12)?',
     null,
     2, 'binary', 3, true, 'medium'),
    (v_section_id, 'contratos_mantenimiento', '¿Contratos de mantenimiento de cámaras y campana vigentes?',
     null,
     3, 'binary', 3, true, 'medium'),
    (v_section_id, 'extintores_revisados', '¿Extintores revisados y dentro de fecha?',
     'Anual obligatorio.',
     4, 'binary', 4, true, 'critical'),
    (v_section_id, 'instalacion_gas', '¿Revisión de instalación de gas vigente?',
     null,
     5, 'binary', 3, true, 'high'),
    (v_section_id, 'lavavajillas_temp', '¿Lavavajillas alcanza temperaturas legales (lavado >55°C, aclarado >82°C)?',
     null,
     6, 'binary', 3, true, 'high');

  -- Sección 7: Cadena de Frío
  INSERT INTO appcc_audit_sections (template_id, code, name, description, display_order, weight)
  VALUES (v_audit_id, 'sec_frio_anual', 'Cadena de Frío',
    'Punto crítico APPCC. Histórico anual de temperaturas y desviaciones.',
    7, 3)
  RETURNING id INTO v_section_id;

  INSERT INTO appcc_audit_items
    (section_id, code, question, help_text, display_order, scoring_type, weight, creates_incident_on_fail, incident_severity)
  VALUES
    (v_section_id, 'registros_completos', '¿Registros diarios de temperatura completos durante el año (>95%)?',
     null,
     1, 'binary', 5, true, 'critical'),
    (v_section_id, 'sin_desviaciones_anuales', '¿Sin desviaciones de temperatura sin acción correctora documentada?',
     null,
     2, 'binary', 5, true, 'critical'),
    (v_section_id, 'temperaturas_estables', '¿Histórico anual muestra temperaturas estables dentro de rango?',
     null,
     3, 'binary', 4, true, 'high'),
    (v_section_id, 'verificacion_externa', '¿Al menos 1 verificación con termómetro patrón externo en el año?',
     null,
     4, 'binary', 3, true, 'medium'),
    (v_section_id, 'congelador_estable_ano', '¿Congelador mantenido a -18°C o inferior todo el año?',
     null,
     5, 'binary', 4, true, 'critical'),
    (v_section_id, 'mantenimiento_camaras', '¿Mantenimiento preventivo de cámaras realizado (limpieza condensadores, juntas)?',
     null,
     6, 'binary', 3, true, 'medium'),
    (v_section_id, 'expositores_ok', '¿Vitrinas expositoras dentro de rangos en operación?',
     null,
     7, 'binary', 2, false, null);

  RAISE NOTICE 'Seed APPCC completo (7 planes, 26 plantillas, 2 auditorías) creado para cuenta %', p_account_id;
END;
$$;


ALTER FUNCTION "public"."seed_appcc_for_account"("p_account_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_seed_appcc_on_account_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  PERFORM seed_appcc_for_account(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- No bloquear el INSERT de accounts si el seed falla.
  -- La cuenta queda creada; el admin puede ejecutar manualmente
  -- SELECT seed_appcc_for_account(<uuid>) más tarde.
  RAISE WARNING 'Seed APPCC falló para cuenta % (%): %', NEW.id, NEW.slug, SQLERRM;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_seed_appcc_on_account_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_formations_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_formations_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_swap_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_swap_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_profile_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_user_profile_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."_backup_20260516_accounts" (
    "id" "uuid",
    "name" "text",
    "legal_name" "text",
    "cif" "text",
    "billing_email" "text",
    "billing_phone" "text",
    "billing_address" "jsonb",
    "country" "text",
    "timezone" "text",
    "locale" "text",
    "currency" "text",
    "status" "text",
    "is_internal" boolean,
    "trial_ends_at" timestamp with time zone,
    "stripe_customer_id" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "created_by" "uuid"
);


ALTER TABLE "public"."_backup_20260516_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_20260516_accounts_pre_slug" (
    "id" "uuid",
    "name" "text",
    "legal_name" "text",
    "cif" "text",
    "billing_email" "text",
    "billing_phone" "text",
    "billing_address" "jsonb",
    "country" "text",
    "timezone" "text",
    "locale" "text",
    "currency" "text",
    "status" "text",
    "is_internal" boolean,
    "trial_ends_at" timestamp with time zone,
    "stripe_customer_id" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "created_by" "uuid"
);


ALTER TABLE "public"."_backup_20260516_accounts_pre_slug" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_20260516_billing_plans" (
    "id" "uuid",
    "code" "text",
    "name" "text",
    "description" "text",
    "included_submodules" "uuid"[],
    "base_price_eur" numeric(10,2),
    "per_location_price" numeric(10,2),
    "max_locations" integer,
    "max_employees" integer,
    "trial_days" integer,
    "billing_cycle" "text",
    "stripe_price_id" "text",
    "status" "text",
    "sort_order" integer,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_20260516_billing_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_20260516_feature_flags" (
    "account_id" "uuid",
    "feature_key" "text",
    "enabled" boolean,
    "source" "text",
    "expires_at" timestamp with time zone,
    "granted_by" "uuid",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_20260516_feature_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_20260516_functions" (
    "proname" "name",
    "args" "text",
    "returns" "text",
    "body" "text" COLLATE "pg_catalog"."C",
    "prokind" "char",
    "provolatile" "char",
    "security_definer" boolean
);


ALTER TABLE "public"."_backup_20260516_functions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_20260516_modules" (
    "id" "uuid",
    "code" "text",
    "name" "text",
    "description" "text",
    "category" "text",
    "is_base" boolean,
    "icon" "text",
    "status" "text",
    "sort_order" integer,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_20260516_modules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_20260516_policies" (
    "schemaname" "name",
    "tablename" "name",
    "policyname" "name",
    "permissive" "text",
    "roles" "name"[],
    "cmd" "text",
    "using_expression" "text" COLLATE "pg_catalog"."C",
    "with_check" "text" COLLATE "pg_catalog"."C"
);


ALTER TABLE "public"."_backup_20260516_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_20260516_submodules" (
    "id" "uuid",
    "module_id" "uuid",
    "code" "text",
    "name" "text",
    "description" "text",
    "type" "text",
    "tier_level" integer,
    "features" "jsonb",
    "status" "text",
    "sort_order" integer,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_20260516_submodules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_20260516_user_profiles" (
    "id" "uuid",
    "user_id" "uuid",
    "employee_id" "uuid",
    "role" "text",
    "active" boolean,
    "display_name" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_20260516_user_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_20260517_user_profiles_read_policy" (
    "policy_name" "text",
    "cmd" "text",
    "old_qual" "text"
);


ALTER TABLE "public"."_backup_20260517_user_profiles_read_policy" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "legal_name" "text",
    "cif" "text",
    "billing_email" "text",
    "billing_phone" "text",
    "billing_address" "jsonb" DEFAULT '{}'::"jsonb",
    "country" "text" DEFAULT 'ES'::"text" NOT NULL,
    "timezone" "text" DEFAULT 'Europe/Madrid'::"text",
    "locale" "text" DEFAULT 'es-ES'::"text",
    "currency" "text" DEFAULT 'EUR'::"text",
    "status" "text" DEFAULT 'trial'::"text" NOT NULL,
    "is_internal" boolean DEFAULT false NOT NULL,
    "trial_ends_at" timestamp with time zone,
    "stripe_customer_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "slug" "text" NOT NULL,
    "suspended_at" timestamp with time zone,
    "suspended_by" "uuid",
    "suspension_reason" "text",
    "archived_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "accounts_lifecycle_order" CHECK ((("deleted_at" IS NULL) OR ("archived_at" IS NULL) OR ("deleted_at" >= "archived_at"))),
    CONSTRAINT "accounts_slug_format" CHECK ((("slug" ~ '^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$'::"text") OR (("length"("slug") = 1) AND ("slug" ~ '^[a-z0-9]$'::"text")))),
    CONSTRAINT "accounts_status_check" CHECK (("status" = ANY (ARRAY['trial'::"text", 'active'::"text", 'past_due'::"text", 'suspended'::"text", 'canceled'::"text"]))),
    CONSTRAINT "accounts_suspended_consistency" CHECK (((("suspended_at" IS NULL) AND ("suspended_by" IS NULL) AND ("suspension_reason" IS NULL)) OR (("suspended_at" IS NOT NULL) AND ("suspended_by" IS NOT NULL) AND ("suspension_reason" IS NOT NULL))))
);


ALTER TABLE "public"."accounts" OWNER TO "postgres";


COMMENT ON TABLE "public"."accounts" IS 'Cuenta empresarial (tenant facturable). Agrupa varios locations.';



COMMENT ON COLUMN "public"."accounts"."is_internal" IS 'Cuentas internas con acceso completo sin requerir suscripcion.';



COMMENT ON COLUMN "public"."accounts"."suspended_at" IS 'Fecha de suspensión temporal de la cuenta. NULL = activa.';



COMMENT ON COLUMN "public"."accounts"."suspended_by" IS 'auth.users.id del platform_admin que suspendió la cuenta.';



COMMENT ON COLUMN "public"."accounts"."suspension_reason" IS 'Razón de la suspensión. Obligatoria si suspended_at NO ES NULL.';



COMMENT ON COLUMN "public"."accounts"."archived_at" IS 'Fecha de archivado. NULL = no archivada.';



COMMENT ON COLUMN "public"."accounts"."deleted_at" IS 'Fecha de borrado lógico (soft delete). Ventana de gracia 30 días.';



CREATE TABLE IF NOT EXISTS "public"."analysis_account" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "parent_id" "uuid",
    "account_type" "text" DEFAULT 'expense'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "analysis_account_account_type_check" CHECK (("account_type" = ANY (ARRAY['expense'::"text", 'revenue'::"text", 'cost_of_goods'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."analysis_account" OWNER TO "postgres";


COMMENT ON TABLE "public"."analysis_account" IS 'Cuentas de análisis contables (Tspoon "Cuenta de análisis"). Scope cuenta. Soporta jerarquía con parent_id.';



CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope" "text" DEFAULT 'global'::"text" NOT NULL,
    "rounding_tolerance_min" integer DEFAULT 8 NOT NULL,
    "show_hour_bank_to_employee" boolean DEFAULT false NOT NULL,
    "late_alert_min" integer DEFAULT 15 NOT NULL,
    "forgot_clockout_min" integer DEFAULT 30 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "account_id" "uuid",
    CONSTRAINT "app_settings_scope_check" CHECK (("scope" = 'global'::"text"))
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_audit_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "section_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "question" "text" NOT NULL,
    "help_text" "text",
    "display_order" integer DEFAULT 0,
    "scoring_type" "text" DEFAULT 'binary'::"text",
    "weight" integer DEFAULT 1,
    "creates_incident_on_fail" boolean DEFAULT false,
    "incident_severity" "text",
    CONSTRAINT "appcc_audit_items_incident_severity_check" CHECK (("incident_severity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "appcc_audit_items_scoring_type_check" CHECK (("scoring_type" = ANY (ARRAY['binary'::"text", 'scale_0_5'::"text", 'na_allowed'::"text"]))),
    CONSTRAINT "appcc_audit_items_weight_check" CHECK ((("weight" >= 1) AND ("weight" <= 10)))
);


ALTER TABLE "public"."appcc_audit_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "event_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "performed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "performed_by" "uuid",
    "ip_address" "inet",
    "user_agent" "text"
);


ALTER TABLE "public"."appcc_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_audit_response_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "response_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "caption" "text",
    "taken_at" timestamp with time zone DEFAULT "now"(),
    "taken_by" "uuid"
);


ALTER TABLE "public"."appcc_audit_response_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_audit_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "audit_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "value" "text",
    "notes" "text",
    "incident_id" "uuid",
    "answered_at" timestamp with time zone DEFAULT "now"(),
    "answered_by" "uuid"
);


ALTER TABLE "public"."appcc_audit_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_audit_schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "template_id" "uuid" NOT NULL,
    "recurrence" "text" NOT NULL,
    "day_of_month" integer,
    "is_active" boolean DEFAULT true,
    "next_due_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "appcc_audit_schedules_day_of_month_check" CHECK ((("day_of_month" >= 1) AND ("day_of_month" <= 28))),
    CONSTRAINT "appcc_audit_schedules_recurrence_check" CHECK (("recurrence" = ANY (ARRAY['monthly'::"text", 'quarterly'::"text", 'yearly'::"text", 'on_demand'::"text"])))
);


ALTER TABLE "public"."appcc_audit_schedules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_audit_sections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "display_order" integer DEFAULT 0,
    "weight" integer DEFAULT 1,
    CONSTRAINT "appcc_audit_sections_weight_check" CHECK ((("weight" >= 1) AND ("weight" <= 10)))
);


ALTER TABLE "public"."appcc_audit_sections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_audit_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_seed" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "recurrence" "text" DEFAULT 'monthly'::"text",
    "pass_score" integer DEFAULT 80,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "appcc_audit_templates_pass_score_check" CHECK ((("pass_score" >= 0) AND ("pass_score" <= 100))),
    CONSTRAINT "appcc_audit_templates_recurrence_check" CHECK (("recurrence" = ANY (ARRAY['monthly'::"text", 'quarterly'::"text", 'yearly'::"text", 'on_demand'::"text"])))
);


ALTER TABLE "public"."appcc_audit_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_audits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "template_id" "uuid" NOT NULL,
    "scheduled_date" "date" NOT NULL,
    "status" "text" DEFAULT 'scheduled'::"text",
    "started_at" timestamp with time zone,
    "started_by" "uuid",
    "completed_at" timestamp with time zone,
    "completed_by" "uuid",
    "final_score" integer,
    "passed" boolean,
    "notes" "text",
    "signature" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "auditor_id" "uuid",
    "auditor_name" "text",
    CONSTRAINT "appcc_audits_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'in_progress'::"text", 'completed'::"text", 'overdue'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."appcc_audits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_execution_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "response_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_name" "text",
    "mime_type" "text",
    "file_size_bytes" integer,
    "caption" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "uploaded_by" "uuid"
);


ALTER TABLE "public"."appcc_execution_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_execution_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "execution_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "numeric_value" numeric,
    "boolean_value" boolean,
    "text_value" "text",
    "date_value" "date",
    "selected_option_id" "uuid",
    "is_out_of_range" boolean DEFAULT false NOT NULL,
    "answered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "answered_by" "uuid"
);


ALTER TABLE "public"."appcc_execution_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_executions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "template_id" "uuid" NOT NULL,
    "schedule_id" "uuid",
    "scheduled_date" "date" NOT NULL,
    "scheduled_time" time without time zone,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "assigned_to" "uuid",
    "started_at" timestamp with time zone,
    "started_by" "uuid",
    "completed_at" timestamp with time zone,
    "completed_by" "uuid",
    "has_failures" boolean DEFAULT false NOT NULL,
    "failure_count" integer DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "appcc_executions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text", 'overdue'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."appcc_executions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_incident_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "incident_id" "uuid" NOT NULL,
    "description" "text" NOT NULL,
    "action_type" "text",
    "taken_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "taken_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "appcc_incident_actions_action_type_check" CHECK (("action_type" = ANY (ARRAY['corrective'::"text", 'preventive'::"text", 'observation'::"text", 'escalation'::"text"])))
);


ALTER TABLE "public"."appcc_incident_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_incident_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "incident_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "event_data" "jsonb",
    "description" "text",
    "actor_id" "uuid",
    "actor_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."appcc_incident_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_incident_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "incident_id" "uuid" NOT NULL,
    "action_id" "uuid",
    "storage_path" "text" NOT NULL,
    "file_name" "text",
    "mime_type" "text",
    "file_size_bytes" integer,
    "caption" "text",
    "photo_kind" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "uploaded_by" "uuid",
    CONSTRAINT "appcc_incident_photos_photo_kind_check" CHECK (("photo_kind" = ANY (ARRAY['problem'::"text", 'resolution'::"text"])))
);


ALTER TABLE "public"."appcc_incident_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_incidents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "execution_id" "uuid",
    "response_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "severity" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "source" "text" DEFAULT 'auto'::"text" NOT NULL,
    "assigned_to" "uuid",
    "sla_due_at" timestamp with time zone,
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "category" "text",
    "assigned_at" timestamp with time zone,
    "due_at" timestamp with time zone,
    "sla_hours" integer DEFAULT 24,
    "escalated" boolean DEFAULT false,
    "escalated_at" timestamp with time zone,
    "escalated_to" "uuid",
    "root_cause" "text",
    "root_cause_method" "text",
    "root_cause_data" "jsonb",
    "corrective_action" "text",
    "corrective_action_at" timestamp with time zone,
    "corrective_action_by" "uuid",
    "preventive_action" "text",
    "preventive_action_at" timestamp with time zone,
    "preventive_action_by" "uuid",
    "verified_at" timestamp with time zone,
    "verified_by" "uuid",
    "verification_notes" "text",
    "verification_effective" boolean,
    "closed_at" timestamp with time zone,
    "closed_by" "uuid",
    "closure_signature" "text",
    CONSTRAINT "appcc_incidents_root_cause_method_check" CHECK (("root_cause_method" = ANY (ARRAY['5whys'::"text", 'fishbone'::"text", 'direct'::"text", 'other'::"text"]))),
    CONSTRAINT "appcc_incidents_severity_check" CHECK (("severity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "appcc_incidents_source_check" CHECK (("source" = ANY (ARRAY['auto'::"text", 'manual'::"text"]))),
    CONSTRAINT "appcc_incidents_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'assigned'::"text", 'investigating'::"text", 'corrected'::"text", 'verified'::"text", 'closed'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."appcc_incidents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "link_type" "text",
    "link_id" "uuid",
    "severity" "text" DEFAULT 'info'::"text",
    "read_at" timestamp with time zone,
    "email_sent" boolean DEFAULT false,
    "email_sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "appcc_notifications_severity_check" CHECK (("severity" = ANY (ARRAY['info'::"text", 'warning'::"text", 'error'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."appcc_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "icon" "text",
    "display_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."appcc_plans" OWNER TO "postgres";


COMMENT ON TABLE "public"."appcc_plans" IS 'Catálogo maestro de planes APPCC (14 planes oficiales)';



CREATE TABLE IF NOT EXISTS "public"."appcc_schedule_responsibles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schedule_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."appcc_schedule_responsibles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "template_id" "uuid" NOT NULL,
    "recurrence_type" "text" NOT NULL,
    "recurrence_config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "scheduled_time" time without time zone,
    "valid_from" "date" DEFAULT CURRENT_DATE NOT NULL,
    "valid_until" "date",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "appcc_schedules_recurrence_type_check" CHECK (("recurrence_type" = ANY (ARRAY['daily'::"text", 'weekly'::"text", 'monthly'::"text", 'quarterly'::"text", 'yearly'::"text", 'on_event'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."appcc_schedules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_signatures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "execution_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "signed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ip_address" "inet",
    "user_agent" "text",
    "signature_hash" "text" NOT NULL,
    "canvas_storage_path" "text"
);


ALTER TABLE "public"."appcc_signatures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appcc_template_item_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "item_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "is_failure" boolean DEFAULT false NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."appcc_template_item_options" OWNER TO "postgres";


COMMENT ON TABLE "public"."appcc_template_item_options" IS 'Opciones para items tipo select (ej: Bueno/Regular/Rechazado)';



COMMENT ON COLUMN "public"."appcc_template_item_options"."is_failure" IS 'Si esta opción cuenta como fallo (dispara incidencia)';



CREATE TABLE IF NOT EXISTS "public"."appcc_template_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "help_text" "text",
    "field_type" "text" NOT NULL,
    "is_required" boolean DEFAULT true NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "numeric_min" numeric,
    "numeric_max" numeric,
    "numeric_unit" "text",
    "expected_boolean" boolean,
    "creates_incident_on_fail" boolean DEFAULT false NOT NULL,
    "incident_severity" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "appcc_template_items_field_type_check" CHECK (("field_type" = ANY (ARRAY['numeric'::"text", 'boolean'::"text", 'select'::"text", 'text'::"text", 'date'::"text", 'photo'::"text", 'signature'::"text"]))),
    CONSTRAINT "appcc_template_items_incident_severity_check" CHECK (("incident_severity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."appcc_template_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."appcc_template_items" IS 'Campos/preguntas de cada plantilla con sus reglas de validación';



COMMENT ON COLUMN "public"."appcc_template_items"."field_type" IS 'Tipo de respuesta esperada';



COMMENT ON COLUMN "public"."appcc_template_items"."expected_boolean" IS 'Para field_type=boolean: qué valor se considera "OK" (true normalmente)';



CREATE TABLE IF NOT EXISTS "public"."appcc_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "account_id" "uuid",
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_seed" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "requires_feature" "text",
    "estimated_minutes" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."appcc_templates" OWNER TO "postgres";


COMMENT ON TABLE "public"."appcc_templates" IS 'Plantillas concretas. is_seed=true para las 30 globales; account_id NULL para seeds.';



COMMENT ON COLUMN "public"."appcc_templates"."requires_feature" IS 'Feature flag necesaria para usar esta plantilla (ej: appcc_pro.firma_canvas)';



CREATE TABLE IF NOT EXISTS "public"."auth_rate_limits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "attempts" integer DEFAULT 1 NOT NULL,
    "first_attempt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "locked_until" timestamp with time zone,
    "ip_address" "inet",
    "user_agent" "text",
    CONSTRAINT "auth_rate_limits_attempts_positive" CHECK (("attempts" >= 1)),
    CONSTRAINT "auth_rate_limits_email_format" CHECK (("email" ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::"text")),
    CONSTRAINT "auth_rate_limits_lock_in_future" CHECK ((("locked_until" IS NULL) OR ("locked_until" > "first_attempt")))
);


ALTER TABLE "public"."auth_rate_limits" OWNER TO "postgres";


COMMENT ON TABLE "public"."auth_rate_limits" IS 'Rate limiting de intentos de login fallidos por email. Cleanup cron diario (>24h). Solo accesible via service_role.';



COMMENT ON COLUMN "public"."auth_rate_limits"."email" IS 'Email del intento. Único por email (window deslizante 24h via cleanup).';



COMMENT ON COLUMN "public"."auth_rate_limits"."attempts" IS 'Contador de intentos fallidos en esta ventana.';



COMMENT ON COLUMN "public"."auth_rate_limits"."first_attempt" IS 'Inicio de la ventana actual. Si first_attempt < now() - 24h, cleanup borra registro.';



COMMENT ON COLUMN "public"."auth_rate_limits"."locked_until" IS 'Si attempts >= threshold, este timestamp indica cuándo expira el bloqueo.';



COMMENT ON COLUMN "public"."auth_rate_limits"."ip_address" IS 'IP del último intento. Útil para detección de ataques distribuidos.';



COMMENT ON COLUMN "public"."auth_rate_limits"."user_agent" IS 'User agent del último intento. Útil para detección de bots.';



CREATE TABLE IF NOT EXISTS "public"."billing_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "stripe_event_id" "text",
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."billing_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "included_submodules" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "base_price_eur" numeric(10,2) DEFAULT 0 NOT NULL,
    "per_location_price" numeric(10,2) DEFAULT 0 NOT NULL,
    "max_locations" integer DEFAULT 0 NOT NULL,
    "max_employees" integer DEFAULT 0 NOT NULL,
    "trial_days" integer DEFAULT 14 NOT NULL,
    "billing_cycle" "text" DEFAULT 'monthly'::"text" NOT NULL,
    "stripe_price_id" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "sort_order" integer DEFAULT 100,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "billing_plans_billing_cycle_check" CHECK (("billing_cycle" = ANY (ARRAY['monthly'::"text", 'annual'::"text"]))),
    CONSTRAINT "billing_plans_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'hidden'::"text", 'legacy'::"text"])))
);


ALTER TABLE "public"."billing_plans" OWNER TO "postgres";


COMMENT ON COLUMN "public"."billing_plans"."max_locations" IS '0 = ilimitado';



COMMENT ON COLUMN "public"."billing_plans"."max_employees" IS '0 = ilimitado';



CREATE TABLE IF NOT EXISTS "public"."brand" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "ownership_type" "text" DEFAULT 'own'::"text" NOT NULL,
    "color" "text",
    "logo_url" "text",
    "commission_pct" numeric(5,2),
    "notes" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "created_by_name" "text",
    CONSTRAINT "brand_commission_only_if_licensed" CHECK ((("commission_pct" IS NULL) OR ("ownership_type" = 'licensed'::"text"))),
    CONSTRAINT "brand_ownership_type_check" CHECK (("ownership_type" = ANY (ARRAY['own'::"text", 'licensed'::"text"])))
);


ALTER TABLE "public"."brand" OWNER TO "postgres";


COMMENT ON TABLE "public"."brand" IS 'Marcas comerciales operadas por la cuenta. Scope cuenta (compartido entre locales). Las marcas varían en el tiempo: usar is_active/archived_at para preservar histórico de ventas.';



CREATE TABLE IF NOT EXISTS "public"."brand_location_availability" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "active_since" "date",
    "inactive_since" "date",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."brand_location_availability" OWNER TO "postgres";


COMMENT ON TABLE "public"."brand_location_availability" IS 'Qué marcas operan en qué locales. Si un par brand+location NO tiene row aquí = no disponible. Si tiene row con is_active=false = pausada.';



CREATE TABLE IF NOT EXISTS "public"."clock_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "datetime" timestamp with time zone DEFAULT "now"() NOT NULL,
    "real_datetime" timestamp with time zone,
    "lat" double precision,
    "lng" double precision,
    "address" "text",
    "scheduled" "text",
    "rounding_applied" boolean DEFAULT false,
    "diff_minutes" integer,
    "source" "text" DEFAULT 'manual'::"text",
    "location_id_at_clock" "uuid",
    "photo_data_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "clock_entries_source_check" CHECK (("source" = ANY (ARRAY['kiosko'::"text", 'movil'::"text", 'manual'::"text"]))),
    CONSTRAINT "clock_entries_type_check" CHECK (("type" = ANY (ARRAY['entrada'::"text", 'salida'::"text"])))
);


ALTER TABLE "public"."clock_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cost_center" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cost_center" OWNER TO "postgres";


COMMENT ON TABLE "public"."cost_center" IS 'Centros de coste (Tspoon "Centro de coste"). Scope cuenta con vínculo opcional a location. En Foodint: 1 por local.';



CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "file_size_kb" integer DEFAULT 0 NOT NULL,
    "uploaded_by" "uuid",
    "uploaded_role" "text" DEFAULT 'gestor'::"text" NOT NULL,
    "notes" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "documents_uploaded_role_check" CHECK (("uploaded_role" = ANY (ARRAY['gestor'::"text", 'trabajador'::"text"])))
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."domain_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "module_code" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "entity_type" "text",
    "entity_id" "uuid",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."domain_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_availability" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "day_of_week" integer NOT NULL,
    "shift_period" "text" NOT NULL,
    "available" boolean DEFAULT false NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employee_availability_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6))),
    CONSTRAINT "employee_availability_shift_period_check" CHECK (("shift_period" = ANY (ARRAY['morning'::"text", 'evening'::"text", 'any'::"text"])))
);


ALTER TABLE "public"."employee_availability" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_formations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "issuer" "text",
    "issue_date" "date" NOT NULL,
    "expiry_date" "date",
    "document_url" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."employee_formations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "data" "jsonb",
    "read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone
);


ALTER TABLE "public"."employee_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employees" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "dni" "text" DEFAULT ''::"text",
    "phone" "text" DEFAULT ''::"text",
    "email" "text" DEFAULT ''::"text",
    "photo" "text" DEFAULT ''::"text",
    "position" "text" DEFAULT ''::"text",
    "department" "text" DEFAULT ''::"text",
    "contract_type" "text" DEFAULT ''::"text",
    "start_date" "date",
    "end_date" "date",
    "salary" numeric DEFAULT 0,
    "weekly_hours" numeric DEFAULT 40,
    "schedule" "text" DEFAULT ''::"text",
    "active" boolean DEFAULT true NOT NULL,
    "notes" "text" DEFAULT ''::"text",
    "pin" "text",
    "location_id" "uuid",
    "assigned_locations" "uuid"[] DEFAULT ARRAY[]::"uuid"[],
    "weekly_schedule" "jsonb" DEFAULT '{}'::"jsonb",
    "availability" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "contracted_hours_week" numeric(5,2) DEFAULT 40,
    "shift_code" "text",
    "shift_period" "text",
    "rest_pattern" "text",
    "initial_hours_balance" numeric(6,2) DEFAULT 0,
    "show_hours_balance" boolean DEFAULT true,
    "termination_type" "text",
    "termination_reason" "text",
    "termination_communicated_to_gestoria" boolean DEFAULT false,
    "trial_period_days" integer,
    "birth_date" "date",
    CONSTRAINT "employees_shift_period_check" CHECK (("shift_period" = ANY (ARRAY['manana'::"text", 'tarde'::"text", 'partido'::"text"])))
);


ALTER TABLE "public"."employees" OWNER TO "postgres";


COMMENT ON COLUMN "public"."employees"."initial_hours_balance" IS 'Saldo de horas inicial. Positivo = la empresa debe horas. Negativo = el empleado debe horas.';



COMMENT ON COLUMN "public"."employees"."show_hours_balance" IS 'Si true, el empleado ve su saldo de horas en su app móvil.';



COMMENT ON COLUMN "public"."employees"."termination_type" IS 'Valores: despido, fin_contrato, voluntaria, jubilacion, otro';



COMMENT ON COLUMN "public"."employees"."trial_period_days" IS 'Duración del periodo de prueba en días desde startDate. NULL si no aplica.';



COMMENT ON COLUMN "public"."employees"."birth_date" IS 'Fecha de nacimiento del empleado (DATE, sin hora)';



CREATE TABLE IF NOT EXISTS "public"."feature_flags" (
    "account_id" "uuid" NOT NULL,
    "feature_key" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "source" "text" DEFAULT 'subscription'::"text" NOT NULL,
    "expires_at" timestamp with time zone,
    "granted_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "feature_flags_source_check" CHECK (("source" = ANY (ARRAY['subscription'::"text", 'trial'::"text", 'manual_grant'::"text", 'internal'::"text"])))
);


ALTER TABLE "public"."feature_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."impersonation_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "platform_admin_id" "uuid" NOT NULL,
    "target_user_id" "uuid" NOT NULL,
    "target_account_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "ip_address" "inet",
    "user_agent" "text",
    "actions_taken" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "force_closed" boolean DEFAULT false,
    CONSTRAINT "impersonation_actions_is_array" CHECK (("jsonb_typeof"("actions_taken") = 'array'::"text")),
    CONSTRAINT "impersonation_chronology" CHECK ((("ended_at" IS NULL) OR ("ended_at" >= "started_at"))),
    CONSTRAINT "impersonation_max_duration" CHECK ((("ended_at" IS NULL) OR ("ended_at" <= ("started_at" + '04:00:00'::interval)))),
    CONSTRAINT "impersonation_reason_min_length" CHECK (("length"("reason") >= 10))
);


ALTER TABLE "public"."impersonation_sessions" OWNER TO "postgres";


COMMENT ON TABLE "public"."impersonation_sessions" IS 'Tracking completo de sesiones impersonation. Audit trail obligatorio. Duración máxima 4h.';



COMMENT ON COLUMN "public"."impersonation_sessions"."platform_admin_id" IS 'Platform admin que inicia la impersonation.';



COMMENT ON COLUMN "public"."impersonation_sessions"."target_user_id" IS 'auth.users.id del user cliente que se está "siendo".';



COMMENT ON COLUMN "public"."impersonation_sessions"."target_account_id" IS 'accounts.id de la cuenta cliente accedida.';



COMMENT ON COLUMN "public"."impersonation_sessions"."reason" IS 'Motivo escrito por el platform_admin al iniciar. Mínimo 10 chars.';



COMMENT ON COLUMN "public"."impersonation_sessions"."actions_taken" IS 'Array jsonb de acciones durante la sesión.';



COMMENT ON COLUMN "public"."impersonation_sessions"."force_closed" IS 'TRUE si la sesión se cerró automáticamente por cron force_close.';



CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "number" "text",
    "amount_eur" numeric(10,2) NOT NULL,
    "tax_eur" numeric(10,2) DEFAULT 0 NOT NULL,
    "total_eur" numeric(10,2) GENERATED ALWAYS AS (("amount_eur" + "tax_eur")) STORED,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "issued_at" "date",
    "paid_at" "date",
    "due_at" "date",
    "stripe_invoice_id" "text",
    "pdf_url" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invoices_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'issued'::"text", 'paid'::"text", 'overdue'::"text", 'refunded'::"text", 'void'::"text"])))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."location_planning" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "location_id" "uuid" NOT NULL,
    "shift_type_id" "uuid" NOT NULL,
    "needed_lun" integer,
    "needed_mar" integer,
    "needed_mie" integer,
    "needed_jue" integer,
    "needed_vie" integer,
    "needed_sab" integer,
    "needed_dom" integer,
    "needed_default" integer DEFAULT 1 NOT NULL,
    "notes" "text" DEFAULT ''::"text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."location_planning" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "address" "text" DEFAULT ''::"text",
    "phone" "text" DEFAULT ''::"text",
    "active" boolean DEFAULT true NOT NULL,
    "lat" double precision,
    "lng" double precision,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hours_balance_close_day" integer DEFAULT 25,
    "hours_balance_sync_with_gestoria" boolean DEFAULT true,
    "account_id" "uuid",
    "is_billable" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."locations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."locations"."hours_balance_close_day" IS 'Día del mes en que se cierra el periodo de bolsa de horas (1-31). El periodo va del día siguiente al día actual del mes siguiente.';



COMMENT ON COLUMN "public"."locations"."hours_balance_sync_with_gestoria" IS 'Si true, el día de cierre sincroniza con la fecha de envío a gestoría. Si false, usa el día configurado en hours_balance_close_day.';



CREATE TABLE IF NOT EXISTS "public"."manager_locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_profile_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."manager_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."manager_permissions" (
    "user_profile_id" "uuid" NOT NULL,
    "show_dashboard" boolean DEFAULT true NOT NULL,
    "show_staff" boolean DEFAULT true NOT NULL,
    "show_ahora_mismo" boolean DEFAULT true NOT NULL,
    "show_fichajes_global" boolean DEFAULT true NOT NULL,
    "show_kiosko_fichaje" boolean DEFAULT true NOT NULL,
    "show_solicitudes_pendientes" boolean DEFAULT true NOT NULL,
    "show_turnos_abiertos" boolean DEFAULT true NOT NULL,
    "show_cambios_pendientes" boolean DEFAULT true NOT NULL,
    "show_calendario" boolean DEFAULT true NOT NULL,
    "show_plantilla_turnos" boolean DEFAULT true NOT NULL,
    "show_informes_personal" boolean DEFAULT false NOT NULL,
    "show_bolsa_horas" boolean DEFAULT true NOT NULL,
    "show_tasks" boolean DEFAULT true NOT NULL,
    "show_scheduled" boolean DEFAULT true NOT NULL,
    "show_templates" boolean DEFAULT false NOT NULL,
    "show_incidents" boolean DEFAULT true NOT NULL,
    "show_audits" boolean DEFAULT true NOT NULL,
    "show_history" boolean DEFAULT true NOT NULL,
    "show_tspoon" boolean DEFAULT true NOT NULL,
    "show_ventas_analisis" boolean DEFAULT true NOT NULL,
    "show_prediccion_personal" boolean DEFAULT true NOT NULL,
    "show_zonas_pedido" boolean DEFAULT false NOT NULL,
    "show_inventory" boolean DEFAULT true NOT NULL,
    "show_locations" boolean DEFAULT false NOT NULL,
    "show_tspoon_settings" boolean DEFAULT false NOT NULL,
    "show_salaries" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "can_manage_employees" boolean DEFAULT true NOT NULL,
    "show_appcc_today" boolean DEFAULT false,
    "show_appcc_incidents" boolean DEFAULT false
);


ALTER TABLE "public"."manager_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."modules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "category" "text" NOT NULL,
    "is_base" boolean DEFAULT false NOT NULL,
    "icon" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "sort_order" integer DEFAULT 100,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "modules_category_check" CHECK (("category" = ANY (ARRAY['core'::"text", 'operations'::"text", 'sales'::"text", 'integrations'::"text", 'custom'::"text"]))),
    CONSTRAINT "modules_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'beta'::"text", 'coming_soon'::"text", 'deprecated'::"text"])))
);


ALTER TABLE "public"."modules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monthly_balance_closures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "period_label" "text" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "scheduled_hours" numeric(6,2) DEFAULT 0 NOT NULL,
    "vacation_hours" numeric(6,2) DEFAULT 0 NOT NULL,
    "contracted_hours_period" numeric(6,2) DEFAULT 0 NOT NULL,
    "delta" numeric(6,2) DEFAULT 0 NOT NULL,
    "resolution" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "resolution_notes" "text",
    "resolution_amount" numeric(6,2),
    "closed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_by" "text",
    "resolved_at" timestamp with time zone,
    "resolved_by" "text",
    CONSTRAINT "monthly_balance_closures_resolution_check" CHECK (("resolution" = ANY (ARRAY['pendiente'::"text", 'pagado'::"text", 'compensado'::"text", 'arrastrado'::"text", 'descartado'::"text"])))
);


ALTER TABLE "public"."monthly_balance_closures" OWNER TO "postgres";


COMMENT ON TABLE "public"."monthly_balance_closures" IS 'Histórico de cierres mensuales de la bolsa de horas. Cada cierre congela el saldo del periodo y permite marcar cómo se resolvió.';



CREATE TABLE IF NOT EXISTS "public"."open_shift_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shift_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "notes" "text" DEFAULT ''::"text",
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "review_notes" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "open_shift_requests_status_check" CHECK (("status" = ANY (ARRAY['pendiente'::"text", 'aceptada'::"text", 'rechazada'::"text", 'retirada'::"text"])))
);


ALTER TABLE "public"."open_shift_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."open_shifts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "location_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "start_time" "text" NOT NULL,
    "end_time" "text" NOT NULL,
    "position" "text" DEFAULT ''::"text",
    "notes" "text" DEFAULT ''::"text",
    "status" "text" DEFAULT 'abierto'::"text" NOT NULL,
    "assigned_to" "uuid",
    "assigned_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "open_shifts_status_check" CHECK (("status" = ANY (ARRAY['abierto'::"text", 'asignado'::"text", 'cancelado'::"text"])))
);


ALTER TABLE "public"."open_shifts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permission_set_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_profile_id" "uuid" NOT NULL,
    "permission_set_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assigned_by" "uuid"
);


ALTER TABLE "public"."permission_set_assignments" OWNER TO "postgres";


COMMENT ON TABLE "public"."permission_set_assignments" IS 'Vincula user_profile con permission_set (1 set por user_profile).';



COMMENT ON COLUMN "public"."permission_set_assignments"."user_profile_id" IS 'user_profile que recibe el set. UNIQUE = solo 1 set por profile.';



COMMENT ON COLUMN "public"."permission_set_assignments"."permission_set_id" IS 'Permission set asignado. Si el set se borra, el assignment también (CASCADE).';



COMMENT ON COLUMN "public"."permission_set_assignments"."assigned_by" IS 'auth.users.id del admin que asignó el set.';



CREATE TABLE IF NOT EXISTS "public"."permission_sets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "is_system" boolean DEFAULT false NOT NULL,
    "permissions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "permission_sets_name_lowercase_or_humans" CHECK (("length"(TRIM(BOTH FROM "name")) >= 3)),
    CONSTRAINT "permission_sets_name_min_length" CHECK ((("length"("name") >= 3) AND ("length"("name") <= 60))),
    CONSTRAINT "permission_sets_permissions_is_object" CHECK (("jsonb_typeof"("permissions") = 'object'::"text")),
    CONSTRAINT "permission_sets_system_immutable_active" CHECK ((NOT (("is_system" = true) AND ("active" = false))))
);


ALTER TABLE "public"."permission_sets" OWNER TO "postgres";


COMMENT ON TABLE "public"."permission_sets" IS 'Sets reutilizables de permisos granulares en jsonb. 4 sets system precargados via M18. Decisión 1 (B) aprobada Julio CEO 18/05/2026.';



COMMENT ON COLUMN "public"."permission_sets"."account_id" IS 'Cuenta cliente dueña del set. NULL para sets system templates globales.';



COMMENT ON COLUMN "public"."permission_sets"."name" IS 'Nombre humano del set. UNIQUE por cuenta. 3-60 chars.';



COMMENT ON COLUMN "public"."permission_sets"."is_system" IS 'TRUE = set precargado por Folvy. Inmutable en is_system y active. Replicado a cada cuenta cliente nueva.';



COMMENT ON COLUMN "public"."permission_sets"."permissions" IS 'Permisos en formato jsonb. Estructura: { "can_manage_employees": true, ... }';



COMMENT ON COLUMN "public"."permission_sets"."active" IS 'FALSE = set desactivado (no asignable). Sets system NO pueden desactivarse (constraint).';



CREATE TABLE IF NOT EXISTS "public"."platform_admin_2fa" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "platform_admin_id" "uuid" NOT NULL,
    "totp_secret" "text" NOT NULL,
    "backup_codes_hash" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "backup_codes_used" integer[] DEFAULT ARRAY[]::integer[] NOT NULL,
    "activated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone,
    CONSTRAINT "platform_admin_2fa_backup_codes_size" CHECK (("array_length"("backup_codes_hash", 1) = 10)),
    CONSTRAINT "platform_admin_2fa_secret_not_empty" CHECK (("length"("totp_secret") >= 16)),
    CONSTRAINT "platform_admin_2fa_used_indices_valid" CHECK (("backup_codes_used" <@ ARRAY[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))
);


ALTER TABLE "public"."platform_admin_2fa" OWNER TO "postgres";


COMMENT ON TABLE "public"."platform_admin_2fa" IS '2FA TOTP para platform_admins. OBLIGATORIO antes del primer acceso a /_admin. Sesión 2 §1.6 + §5.6.';



COMMENT ON COLUMN "public"."platform_admin_2fa"."totp_secret" IS 'TOTP secret CIFRADO (ciphertext). NUNCA almacenar en plain.';



COMMENT ON COLUMN "public"."platform_admin_2fa"."backup_codes_hash" IS 'Array de 10 hashes bcrypt de backup codes. User los ve plain UNA vez al activar.';



COMMENT ON COLUMN "public"."platform_admin_2fa"."backup_codes_used" IS 'Array de índices (0-9) de backup codes ya consumidos.';



COMMENT ON COLUMN "public"."platform_admin_2fa"."activated_at" IS 'Fecha de activación inicial del 2FA. INMUTABLE tras creación.';



COMMENT ON COLUMN "public"."platform_admin_2fa"."last_used_at" IS 'Última vez que se validó código TOTP o backup correctamente.';



CREATE TABLE IF NOT EXISTS "public"."platform_admin_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "platform_admin_id" "uuid" NOT NULL,
    "platform_can_create_accounts" boolean DEFAULT false NOT NULL,
    "platform_can_suspend_accounts" boolean DEFAULT false NOT NULL,
    "platform_can_archive_accounts" boolean DEFAULT false NOT NULL,
    "platform_can_delete_accounts" boolean DEFAULT false NOT NULL,
    "platform_can_impersonate" boolean DEFAULT false NOT NULL,
    "platform_can_manage_admins" boolean DEFAULT false NOT NULL,
    "platform_can_reset_2fa_of_others" boolean DEFAULT false NOT NULL,
    "platform_can_view_audit_log" boolean DEFAULT true NOT NULL,
    "platform_can_edit_seed_data" boolean DEFAULT false NOT NULL,
    "platform_can_view_system_health" boolean DEFAULT true NOT NULL,
    "platform_can_send_global_notifications" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid"
);


ALTER TABLE "public"."platform_admin_permissions" OWNER TO "postgres";


COMMENT ON TABLE "public"."platform_admin_permissions" IS 'Permisos granulares por platform_admin. 1 fila por platform_admin.';



COMMENT ON COLUMN "public"."platform_admin_permissions"."platform_can_create_accounts" IS 'Puede crear nuevas cuentas cliente via wizard /_admin/cuentas/nueva.';



COMMENT ON COLUMN "public"."platform_admin_permissions"."platform_can_suspend_accounts" IS 'Puede suspender cuentas (cliente pierde acceso pero datos se conservan).';



COMMENT ON COLUMN "public"."platform_admin_permissions"."platform_can_archive_accounts" IS 'Puede archivar cuentas (cliente que ya no usa, conservamos histórico).';



COMMENT ON COLUMN "public"."platform_admin_permissions"."platform_can_delete_accounts" IS 'Puede marcar cuentas para borrado lógico. DOBLE confirmación en UI.';



COMMENT ON COLUMN "public"."platform_admin_permissions"."platform_can_impersonate" IS 'Puede entrar como user de cuenta cliente. Audit log + motivo obligatorios.';



COMMENT ON COLUMN "public"."platform_admin_permissions"."platform_can_manage_admins" IS 'Puede crear/suspender/borrar otros platform_admins.';



COMMENT ON COLUMN "public"."platform_admin_permissions"."platform_can_reset_2fa_of_others" IS 'Puede resetear 2FA de otros platform_admins. MUY sensible.';



COMMENT ON COLUMN "public"."platform_admin_permissions"."platform_can_edit_seed_data" IS 'Puede modificar datos seed inmutables: planes APPCC, plantillas, permission_sets system.';



COMMENT ON COLUMN "public"."platform_admin_permissions"."platform_can_send_global_notifications" IS 'Puede enviar notificaciones a TODOS los users de TODAS las cuentas.';



CREATE TABLE IF NOT EXISTS "public"."platform_admins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "last_login_at" timestamp with time zone,
    "notes" "text",
    CONSTRAINT "platform_admins_full_name_not_empty" CHECK (("length"(TRIM(BOTH FROM "full_name")) >= 2)),
    CONSTRAINT "platform_admins_role_check" CHECK (("role" = ANY (ARRAY['ceo'::"text", 'senior_admin'::"text", 'admin'::"text", 'support'::"text"])))
);


ALTER TABLE "public"."platform_admins" OWNER TO "postgres";


COMMENT ON TABLE "public"."platform_admins" IS 'Admins internos de la plataforma Folvy (no clientes finales). Sesión 2 §2.2.';



COMMENT ON COLUMN "public"."platform_admins"."user_id" IS 'auth.users.id del admin. Único. ON DELETE CASCADE.';



COMMENT ON COLUMN "public"."platform_admins"."role" IS 'Rol jerárquico platform. ceo > senior_admin > admin > support.';



COMMENT ON COLUMN "public"."platform_admins"."created_by" IS 'auth.users.id del platform_admin que creó este. NULL para el primer admin self-created.';



CREATE TABLE IF NOT EXISTS "public"."platform_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "platform_admin_id" "uuid",
    "event_type" "text" NOT NULL,
    "target_account_id" "uuid",
    "target_user_id" "uuid",
    "details" "jsonb",
    "ip_address" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "platform_audit_log_details_is_object" CHECK ((("details" IS NULL) OR ("jsonb_typeof"("details") = 'object'::"text"))),
    CONSTRAINT "platform_audit_log_event_type_valid" CHECK (("event_type" = ANY (ARRAY['account_created'::"text", 'account_suspended'::"text", 'account_unsuspended'::"text", 'account_archived'::"text", 'account_unarchived'::"text", 'account_deleted'::"text", 'account_restored'::"text", 'impersonation_started'::"text", 'impersonation_ended'::"text", 'admin_created'::"text", 'admin_suspended'::"text", 'admin_reactivated'::"text", 'admin_2fa_reset'::"text", 'admin_permissions_changed'::"text", 'seed_data_modified'::"text", 'system_config_changed'::"text", 'global_notification_sent'::"text", 'permission_set_modified'::"text"])))
);


ALTER TABLE "public"."platform_audit_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."platform_audit_log" IS 'Audit log append-only de todas las acciones de platform_admins. Retención 5 años mínimo.';



COMMENT ON COLUMN "public"."platform_audit_log"."platform_admin_id" IS 'Platform admin que ejecutó la acción. NULL en eventos automáticos del sistema.';



COMMENT ON COLUMN "public"."platform_audit_log"."event_type" IS 'Tipo de evento. Lista cerrada en CHECK. Ampliable mediante migration si se añaden nuevos tipos.';



COMMENT ON COLUMN "public"."platform_audit_log"."target_account_id" IS 'Cuenta cliente afectada por el evento. NULL si no aplica.';



COMMENT ON COLUMN "public"."platform_audit_log"."target_user_id" IS 'auth.users.id afectado por el evento. NULL si no aplica.';



COMMENT ON COLUMN "public"."platform_audit_log"."details" IS 'Detalles adicionales del evento en jsonb. Estructura por event_type.';



CREATE TABLE IF NOT EXISTS "public"."platform_settings" (
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "platform_settings_key_format" CHECK ((("key" ~* '^[a-z][a-z0-9_]*$'::"text") AND (("length"("key") >= 3) AND ("length"("key") <= 100)))),
    CONSTRAINT "platform_settings_value_not_null_jsonb" CHECK ((("value" IS NOT NULL) AND ("jsonb_typeof"("value") IS NOT NULL)))
);


ALTER TABLE "public"."platform_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."platform_settings" IS 'Configuración global de la plataforma Folvy. Key-value con value jsonb flexible.';



COMMENT ON COLUMN "public"."platform_settings"."key" IS 'Clave única del setting. Formato snake_case: solo letras minúsculas, números, underscores. 3-100 chars.';



COMMENT ON COLUMN "public"."platform_settings"."value" IS 'Valor del setting en jsonb. Puede ser string, number, boolean, object, array.';



COMMENT ON COLUMN "public"."platform_settings"."description" IS 'Descripción humana del setting.';



COMMENT ON COLUMN "public"."platform_settings"."updated_by" IS 'auth.users.id del platform_admin que modificó este setting por última vez. NULL si lo creó seed.';



CREATE TABLE IF NOT EXISTS "public"."quotas" (
    "account_id" "uuid" NOT NULL,
    "quota_key" "text" NOT NULL,
    "limit_value" integer NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."quotas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_channel" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "channel_type" "text" DEFAULT 'delivery'::"text" NOT NULL,
    "default_commission_pct" numeric(5,2),
    "color" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sales_channel_channel_type_check" CHECK (("channel_type" = ANY (ARRAY['delivery'::"text", 'dine_in'::"text", 'takeaway'::"text", 'catering'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."sales_channel" OWNER TO "postgres";


COMMENT ON TABLE "public"."sales_channel" IS 'Canales de venta. Scope cuenta. Glovo, Uber Eats, Just Eat son los típicos para dark kitchen.';



CREATE TABLE IF NOT EXISTS "public"."schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "location_id" "uuid" NOT NULL,
    "week_start" "date" NOT NULL,
    "cells" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "coverage_overrides" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "generated_at" timestamp with time zone,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "schedules_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."schedules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."security_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_user_id" "uuid",
    "target_user_id" "uuid",
    "action" "text" NOT NULL,
    "details" "jsonb",
    "ip_address" "text",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."security_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "shift_type_id" "uuid",
    "override_start" "text",
    "override_end" "text",
    "notes" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "slot" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."shift_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_minimums" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "location_id" "uuid",
    "shift_type_id" "uuid",
    "min_default" integer DEFAULT 1 NOT NULL,
    "min_weekend" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shift_minimums" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_swap_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "swap_type" "text" NOT NULL,
    "requester_id" "uuid" NOT NULL,
    "requester_schedule_id" "uuid" NOT NULL,
    "requester_template_id" "uuid" NOT NULL,
    "requester_day_key" "text" NOT NULL,
    "requester_date" "date" NOT NULL,
    "target_id" "uuid",
    "target_schedule_id" "uuid",
    "target_template_id" "uuid",
    "target_day_key" "text",
    "target_date" "date",
    "status" "text" DEFAULT 'abierta'::"text" NOT NULL,
    "request_notes" "text",
    "acceptor_notes" "text",
    "manager_notes" "text",
    "reviewed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    "hours_attribution" "text",
    CONSTRAINT "shift_swap_requests_check" CHECK ((("swap_type" = 'cesion'::"text") OR (("swap_type" = ANY (ARRAY['intercambio'::"text", 'peticion_directa'::"text"])) AND ("target_id" IS NOT NULL)))),
    CONSTRAINT "shift_swap_requests_check1" CHECK ((("swap_type" <> 'intercambio'::"text") OR (("target_schedule_id" IS NOT NULL) AND ("target_template_id" IS NOT NULL) AND ("target_day_key" IS NOT NULL) AND ("target_date" IS NOT NULL)))),
    CONSTRAINT "shift_swap_requests_status_check" CHECK (("status" = ANY (ARRAY['abierta'::"text", 'propuesta'::"text", 'aprobada'::"text", 'rechazada'::"text", 'cancelada'::"text"]))),
    CONSTRAINT "shift_swap_requests_swap_type_check" CHECK (("swap_type" = ANY (ARRAY['cesion'::"text", 'intercambio'::"text", 'peticion_directa'::"text"])))
);


ALTER TABLE "public"."shift_swap_requests" OWNER TO "postgres";


COMMENT ON COLUMN "public"."shift_swap_requests"."hours_attribution" IS 'Atribución de horas tras aprobación: worker (quien trabaja) o requester (cedente). NULL en estados no aprobados.';



CREATE TABLE IF NOT EXISTS "public"."shift_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "location_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "coverage_mon" integer DEFAULT 0 NOT NULL,
    "coverage_tue" integer DEFAULT 0 NOT NULL,
    "coverage_wed" integer DEFAULT 0 NOT NULL,
    "coverage_thu" integer DEFAULT 0 NOT NULL,
    "coverage_fri" integer DEFAULT 0 NOT NULL,
    "coverage_sat" integer DEFAULT 0 NOT NULL,
    "coverage_sun" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shift_templates_coverage_fri_check" CHECK (("coverage_fri" >= 0)),
    CONSTRAINT "shift_templates_coverage_mon_check" CHECK (("coverage_mon" >= 0)),
    CONSTRAINT "shift_templates_coverage_sat_check" CHECK (("coverage_sat" >= 0)),
    CONSTRAINT "shift_templates_coverage_sun_check" CHECK (("coverage_sun" >= 0)),
    CONSTRAINT "shift_templates_coverage_thu_check" CHECK (("coverage_thu" >= 0)),
    CONSTRAINT "shift_templates_coverage_tue_check" CHECK (("coverage_tue" >= 0)),
    CONSTRAINT "shift_templates_coverage_wed_check" CHECK (("coverage_wed" >= 0))
);


ALTER TABLE "public"."shift_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "start_time" "text",
    "end_time" "text",
    "break_minutes" integer DEFAULT 0,
    "hours" numeric(5,2),
    "color" "text" DEFAULT '#7C1A1A'::"text",
    "is_split" boolean DEFAULT false,
    "split_2_start" "text",
    "split_2_end" "text",
    "is_off" boolean DEFAULT false,
    "active" boolean DEFAULT true,
    "display_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "account_id" "uuid"
);


ALTER TABLE "public"."shift_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submodules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "module_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "type" "text" NOT NULL,
    "tier_level" integer,
    "features" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "sort_order" integer DEFAULT 100,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "submodules_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'beta'::"text", 'coming_soon'::"text", 'deprecated'::"text"]))),
    CONSTRAINT "submodules_type_check" CHECK (("type" = ANY (ARRAY['tier'::"text", 'addon'::"text"])))
);


ALTER TABLE "public"."submodules" OWNER TO "postgres";


COMMENT ON COLUMN "public"."submodules"."tier_level" IS '1=Esencial, 2=Pro, 3=Multi-local. NULL si es addon.';



COMMENT ON COLUMN "public"."submodules"."features" IS 'Array de feature_keys que este submódulo desbloquea';



CREATE TABLE IF NOT EXISTS "public"."subscription_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subscription_id" "uuid" NOT NULL,
    "submodule_id" "uuid" NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "unit_price_eur" numeric(10,2) DEFAULT 0 NOT NULL,
    "starts_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ends_at" timestamp with time zone,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "subscription_items_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'trialing'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."subscription_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "plan_id" "uuid",
    "status" "text" DEFAULT 'trialing'::"text" NOT NULL,
    "current_period_start" timestamp with time zone DEFAULT "now"() NOT NULL,
    "current_period_end" timestamp with time zone DEFAULT ("now"() + '14 days'::interval) NOT NULL,
    "cancel_at" timestamp with time zone,
    "canceled_at" timestamp with time zone,
    "trial_ends_at" timestamp with time zone,
    "stripe_subscription_id" "text",
    "billing_cycle" "text" DEFAULT 'monthly'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "subscriptions_billing_cycle_check" CHECK (("billing_cycle" = ANY (ARRAY['monthly'::"text", 'annual'::"text"]))),
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['trialing'::"text", 'active'::"text", 'past_due'::"text", 'canceled'::"text", 'paused'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usage_counters" (
    "account_id" "uuid" NOT NULL,
    "quota_key" "text" NOT NULL,
    "period_start" "date" NOT NULL,
    "current_value" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."usage_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "employee_id" "uuid",
    "role" "text" DEFAULT 'worker'::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "display_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "account_id" "uuid",
    "terms_accepted_at" timestamp with time zone,
    "welcome_completed_at" timestamp with time zone,
    "last_password_change_at" timestamp with time zone,
    "last_login_at" timestamp with time zone,
    "suspended_at" timestamp with time zone,
    "suspended_by" "uuid",
    CONSTRAINT "user_profiles_suspended_consistency" CHECK (((("suspended_at" IS NULL) AND ("suspended_by" IS NULL)) OR (("suspended_at" IS NOT NULL) AND ("suspended_by" IS NOT NULL)))),
    CONSTRAINT "user_profiles_welcome_requires_terms" CHECK ((("welcome_completed_at" IS NULL) OR (("terms_accepted_at" IS NOT NULL) AND ("terms_accepted_at" <= "welcome_completed_at")))),
    CONSTRAINT "valid_role" CHECK (("role" = ANY (ARRAY['admin'::"text", 'manager'::"text", 'worker'::"text"])))
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_profiles"."terms_accepted_at" IS 'Fecha de aceptación de T&C en welcome flow. NULL = no aceptado.';



COMMENT ON COLUMN "public"."user_profiles"."welcome_completed_at" IS 'Fecha de completar onboarding inicial. NULL = invitación pendiente.';



COMMENT ON COLUMN "public"."user_profiles"."last_password_change_at" IS 'Última fecha de cambio de password.';



COMMENT ON COLUMN "public"."user_profiles"."last_login_at" IS 'Última fecha de login exitoso. Detección de cuentas zombi (>90 días).';



COMMENT ON COLUMN "public"."user_profiles"."suspended_at" IS 'Suspensión individual del user_profile (independiente de cuenta).';



COMMENT ON COLUMN "public"."user_profiles"."suspended_by" IS 'auth.users.id del admin que suspendió este perfil.';



CREATE TABLE IF NOT EXISTS "public"."vacation_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope" "text" DEFAULT 'global'::"text" NOT NULL,
    "employee_id" "uuid",
    "vacation_days_per_year" numeric(5,2) DEFAULT 22 NOT NULL,
    "asuntos_propios_per_year" numeric(5,2) DEFAULT 3 NOT NULL,
    "min_staff_per_location" integer DEFAULT 2 NOT NULL,
    "min_lead_days" integer DEFAULT 30 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vacation_settings_scope_check" CHECK (("scope" = ANY (ARRAY['global'::"text", 'employee'::"text"])))
);


ALTER TABLE "public"."vacation_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vacations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "days" numeric(5,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'solicitada'::"text" NOT NULL,
    "notes" "text" DEFAULT ''::"text",
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "review_notes" "text" DEFAULT ''::"text",
    "alert_min_staff" boolean DEFAULT false,
    "alert_lead_time" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "paid" boolean DEFAULT true,
    CONSTRAINT "vacations_status_check" CHECK (("status" = ANY (ARRAY['solicitada'::"text", 'aprobada'::"text", 'rechazada'::"text", 'cancelada'::"text"])))
);


ALTER TABLE "public"."vacations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."vacations"."paid" IS 'Si TRUE, la ausencia es retribuida y cuenta como horas trabajadas en la bolsa de horas. Si FALSE, descuenta del contrato del periodo.';



CREATE TABLE IF NOT EXISTS "public"."weekly_availability" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "week_start" "date" NOT NULL,
    "available" boolean DEFAULT true NOT NULL,
    "notes" "text" DEFAULT ''::"text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."weekly_availability" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weekly_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "location_id" "uuid",
    "week_start" "date" NOT NULL,
    "status" "text" DEFAULT 'borrador'::"text" NOT NULL,
    "notes" "text" DEFAULT ''::"text",
    "published_at" timestamp with time zone,
    "published_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "weekly_plans_status_check" CHECK (("status" = ANY (ARRAY['borrador'::"text", 'publicado'::"text"])))
);


ALTER TABLE "public"."weekly_plans" OWNER TO "postgres";


ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_slug_unique" UNIQUE ("slug");



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_stripe_customer_id_key" UNIQUE ("stripe_customer_id");



ALTER TABLE ONLY "public"."analysis_account"
    ADD CONSTRAINT "analysis_account_code_unique_per_account" UNIQUE ("account_id", "code");



ALTER TABLE ONLY "public"."analysis_account"
    ADD CONSTRAINT "analysis_account_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_audit_items"
    ADD CONSTRAINT "appcc_audit_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_audit_log"
    ADD CONSTRAINT "appcc_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_audit_response_photos"
    ADD CONSTRAINT "appcc_audit_response_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_audit_responses"
    ADD CONSTRAINT "appcc_audit_responses_audit_id_item_id_key" UNIQUE ("audit_id", "item_id");



ALTER TABLE ONLY "public"."appcc_audit_responses"
    ADD CONSTRAINT "appcc_audit_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_audit_schedules"
    ADD CONSTRAINT "appcc_audit_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_audit_sections"
    ADD CONSTRAINT "appcc_audit_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_audit_templates"
    ADD CONSTRAINT "appcc_audit_templates_account_id_code_key" UNIQUE ("account_id", "code");



ALTER TABLE ONLY "public"."appcc_audit_templates"
    ADD CONSTRAINT "appcc_audit_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_audits"
    ADD CONSTRAINT "appcc_audits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_execution_photos"
    ADD CONSTRAINT "appcc_execution_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_execution_responses"
    ADD CONSTRAINT "appcc_execution_responses_execution_id_item_id_key" UNIQUE ("execution_id", "item_id");



ALTER TABLE ONLY "public"."appcc_execution_responses"
    ADD CONSTRAINT "appcc_execution_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_executions"
    ADD CONSTRAINT "appcc_executions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_incident_actions"
    ADD CONSTRAINT "appcc_incident_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_incident_events"
    ADD CONSTRAINT "appcc_incident_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_incident_photos"
    ADD CONSTRAINT "appcc_incident_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_incidents"
    ADD CONSTRAINT "appcc_incidents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_notifications"
    ADD CONSTRAINT "appcc_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_plans"
    ADD CONSTRAINT "appcc_plans_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."appcc_plans"
    ADD CONSTRAINT "appcc_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_schedule_responsibles"
    ADD CONSTRAINT "appcc_schedule_responsibles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_schedule_responsibles"
    ADD CONSTRAINT "appcc_schedule_responsibles_schedule_id_user_id_key" UNIQUE ("schedule_id", "user_id");



ALTER TABLE ONLY "public"."appcc_schedules"
    ADD CONSTRAINT "appcc_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_signatures"
    ADD CONSTRAINT "appcc_signatures_execution_id_user_id_key" UNIQUE ("execution_id", "user_id");



ALTER TABLE ONLY "public"."appcc_signatures"
    ADD CONSTRAINT "appcc_signatures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_template_item_options"
    ADD CONSTRAINT "appcc_template_item_options_item_id_code_key" UNIQUE ("item_id", "code");



ALTER TABLE ONLY "public"."appcc_template_item_options"
    ADD CONSTRAINT "appcc_template_item_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_template_items"
    ADD CONSTRAINT "appcc_template_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appcc_template_items"
    ADD CONSTRAINT "appcc_template_items_template_id_code_key" UNIQUE ("template_id", "code");



ALTER TABLE ONLY "public"."appcc_templates"
    ADD CONSTRAINT "appcc_templates_account_id_code_key" UNIQUE ("account_id", "code");



ALTER TABLE ONLY "public"."appcc_templates"
    ADD CONSTRAINT "appcc_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auth_rate_limits"
    ADD CONSTRAINT "auth_rate_limits_email_window" UNIQUE ("email");



ALTER TABLE ONLY "public"."auth_rate_limits"
    ADD CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_events"
    ADD CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_events"
    ADD CONSTRAINT "billing_events_stripe_event_id_key" UNIQUE ("stripe_event_id");



ALTER TABLE ONLY "public"."billing_plans"
    ADD CONSTRAINT "billing_plans_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."billing_plans"
    ADD CONSTRAINT "billing_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brand_location_availability"
    ADD CONSTRAINT "brand_location_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brand_location_availability"
    ADD CONSTRAINT "brand_location_availability_unique_triplet" UNIQUE ("account_id", "brand_id", "location_id");



ALTER TABLE ONLY "public"."brand"
    ADD CONSTRAINT "brand_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brand"
    ADD CONSTRAINT "brand_slug_unique_per_account" UNIQUE ("account_id", "slug");



ALTER TABLE ONLY "public"."clock_entries"
    ADD CONSTRAINT "clock_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cost_center"
    ADD CONSTRAINT "cost_center_code_unique_per_account" UNIQUE ("account_id", "code");



ALTER TABLE ONLY "public"."cost_center"
    ADD CONSTRAINT "cost_center_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."domain_events"
    ADD CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_availability"
    ADD CONSTRAINT "employee_availability_employee_id_day_of_week_shift_period_key" UNIQUE ("employee_id", "day_of_week", "shift_period");



ALTER TABLE ONLY "public"."employee_availability"
    ADD CONSTRAINT "employee_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_formations"
    ADD CONSTRAINT "employee_formations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_notifications"
    ADD CONSTRAINT "employee_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("account_id", "feature_key");



ALTER TABLE ONLY "public"."impersonation_sessions"
    ADD CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_number_key" UNIQUE ("number");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_stripe_invoice_id_key" UNIQUE ("stripe_invoice_id");



ALTER TABLE ONLY "public"."location_planning"
    ADD CONSTRAINT "location_planning_location_id_shift_type_id_key" UNIQUE ("location_id", "shift_type_id");



ALTER TABLE ONLY "public"."location_planning"
    ADD CONSTRAINT "location_planning_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."manager_locations"
    ADD CONSTRAINT "manager_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."manager_locations"
    ADD CONSTRAINT "manager_locations_user_profile_id_location_id_key" UNIQUE ("user_profile_id", "location_id");



ALTER TABLE ONLY "public"."manager_permissions"
    ADD CONSTRAINT "manager_permissions_pkey" PRIMARY KEY ("user_profile_id");



ALTER TABLE ONLY "public"."modules"
    ADD CONSTRAINT "modules_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."modules"
    ADD CONSTRAINT "modules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monthly_balance_closures"
    ADD CONSTRAINT "monthly_balance_closures_employee_id_period_start_period_en_key" UNIQUE ("employee_id", "period_start", "period_end");



ALTER TABLE ONLY "public"."monthly_balance_closures"
    ADD CONSTRAINT "monthly_balance_closures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."open_shift_requests"
    ADD CONSTRAINT "open_shift_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."open_shifts"
    ADD CONSTRAINT "open_shifts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permission_set_assignments"
    ADD CONSTRAINT "permission_set_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permission_set_assignments"
    ADD CONSTRAINT "permission_set_assignments_user_unique" UNIQUE ("user_profile_id");



ALTER TABLE ONLY "public"."permission_sets"
    ADD CONSTRAINT "permission_sets_name_account_unique" UNIQUE ("account_id", "name");



ALTER TABLE ONLY "public"."permission_sets"
    ADD CONSTRAINT "permission_sets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_admin_2fa"
    ADD CONSTRAINT "platform_admin_2fa_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_admin_2fa"
    ADD CONSTRAINT "platform_admin_2fa_unique" UNIQUE ("platform_admin_id");



ALTER TABLE ONLY "public"."platform_admin_permissions"
    ADD CONSTRAINT "platform_admin_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_admin_permissions"
    ADD CONSTRAINT "platform_admin_permissions_unique" UNIQUE ("platform_admin_id");



ALTER TABLE ONLY "public"."platform_admins"
    ADD CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_admins"
    ADD CONSTRAINT "platform_admins_user_unique" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."platform_audit_log"
    ADD CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_settings"
    ADD CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."quotas"
    ADD CONSTRAINT "quotas_pkey" PRIMARY KEY ("account_id", "quota_key");



ALTER TABLE ONLY "public"."sales_channel"
    ADD CONSTRAINT "sales_channel_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_channel"
    ADD CONSTRAINT "sales_channel_slug_unique_per_account" UNIQUE ("account_id", "slug");



ALTER TABLE ONLY "public"."schedules"
    ADD CONSTRAINT "schedules_location_id_week_start_key" UNIQUE ("location_id", "week_start");



ALTER TABLE ONLY "public"."schedules"
    ADD CONSTRAINT "schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."security_audit_log"
    ADD CONSTRAINT "security_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_assignments"
    ADD CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_assignments"
    ADD CONSTRAINT "shift_assignments_unique_slot" UNIQUE ("plan_id", "employee_id", "date", "slot");



ALTER TABLE ONLY "public"."shift_minimums"
    ADD CONSTRAINT "shift_minimums_location_id_shift_type_id_key" UNIQUE ("location_id", "shift_type_id");



ALTER TABLE ONLY "public"."shift_minimums"
    ADD CONSTRAINT "shift_minimums_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_swap_requests"
    ADD CONSTRAINT "shift_swap_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_templates"
    ADD CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_types"
    ADD CONSTRAINT "shift_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submodules"
    ADD CONSTRAINT "submodules_module_id_code_key" UNIQUE ("module_id", "code");



ALTER TABLE ONLY "public"."submodules"
    ADD CONSTRAINT "submodules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_items"
    ADD CONSTRAINT "subscription_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_stripe_subscription_id_key" UNIQUE ("stripe_subscription_id");



ALTER TABLE ONLY "public"."usage_counters"
    ADD CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("account_id", "quota_key", "period_start");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vacation_settings"
    ADD CONSTRAINT "vacation_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vacations"
    ADD CONSTRAINT "vacations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_availability"
    ADD CONSTRAINT "weekly_availability_employee_id_week_start_key" UNIQUE ("employee_id", "week_start");



ALTER TABLE ONLY "public"."weekly_availability"
    ADD CONSTRAINT "weekly_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_plans"
    ADD CONSTRAINT "weekly_plans_location_id_week_start_key" UNIQUE ("location_id", "week_start");



ALTER TABLE ONLY "public"."weekly_plans"
    ADD CONSTRAINT "weekly_plans_pkey" PRIMARY KEY ("id");



CREATE INDEX "app_settings_account_idx" ON "public"."app_settings" USING "btree" ("account_id");



CREATE UNIQUE INDEX "app_settings_account_unique" ON "public"."app_settings" USING "btree" ("account_id") WHERE ("account_id" IS NOT NULL);



CREATE UNIQUE INDEX "app_settings_singleton" ON "public"."app_settings" USING "btree" ("scope");



CREATE INDEX "clock_entries_datetime_idx" ON "public"."clock_entries" USING "btree" ("datetime" DESC);



CREATE INDEX "clock_entries_employee_idx" ON "public"."clock_entries" USING "btree" ("employee_id", "datetime" DESC);



CREATE INDEX "documents_employee_idx" ON "public"."documents" USING "btree" ("employee_id", "created_at" DESC);



CREATE INDEX "employees_active_idx" ON "public"."employees" USING "btree" ("active");



CREATE INDEX "idx_accounts_active" ON "public"."accounts" USING "btree" ("id") WHERE (("suspended_at" IS NULL) AND ("archived_at" IS NULL) AND ("deleted_at" IS NULL));



COMMENT ON INDEX "public"."idx_accounts_active" IS 'Índice parcial para queries de cuentas operativas.';



CREATE INDEX "idx_accounts_status" ON "public"."accounts" USING "btree" ("status");



CREATE INDEX "idx_accounts_status_active" ON "public"."accounts" USING "btree" ("status") WHERE (("suspended_at" IS NULL) AND ("deleted_at" IS NULL));



COMMENT ON INDEX "public"."idx_accounts_status_active" IS 'Índice parcial para queries cuentas operativas filtradas por status.';



CREATE INDEX "idx_accounts_stripe" ON "public"."accounts" USING "btree" ("stripe_customer_id");



CREATE INDEX "idx_analysis_account_account" ON "public"."analysis_account" USING "btree" ("account_id") WHERE ("is_active" = true);



CREATE INDEX "idx_appcc_audit_account_date" ON "public"."appcc_audit_log" USING "btree" ("account_id", "performed_at" DESC);



CREATE INDEX "idx_appcc_audit_entity" ON "public"."appcc_audit_log" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_appcc_executions_account" ON "public"."appcc_executions" USING "btree" ("account_id");



CREATE INDEX "idx_appcc_executions_assigned" ON "public"."appcc_executions" USING "btree" ("assigned_to") WHERE ("assigned_to" IS NOT NULL);



CREATE INDEX "idx_appcc_executions_location_date" ON "public"."appcc_executions" USING "btree" ("location_id", "scheduled_date");



CREATE INDEX "idx_appcc_executions_status" ON "public"."appcc_executions" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'overdue'::"text"]));



CREATE INDEX "idx_appcc_incident_actions_incident" ON "public"."appcc_incident_actions" USING "btree" ("incident_id");



CREATE INDEX "idx_appcc_incident_photos_incident" ON "public"."appcc_incident_photos" USING "btree" ("incident_id");



CREATE INDEX "idx_appcc_incidents_account" ON "public"."appcc_incidents" USING "btree" ("account_id");



CREATE INDEX "idx_appcc_incidents_assigned" ON "public"."appcc_incidents" USING "btree" ("assigned_to") WHERE ("assigned_to" IS NOT NULL);



CREATE INDEX "idx_appcc_incidents_location" ON "public"."appcc_incidents" USING "btree" ("location_id");



CREATE INDEX "idx_appcc_incidents_open" ON "public"."appcc_incidents" USING "btree" ("account_id", "status") WHERE ("status" = ANY (ARRAY['open'::"text", 'in_progress'::"text"]));



CREATE INDEX "idx_appcc_photos_response" ON "public"."appcc_execution_photos" USING "btree" ("response_id");



CREATE INDEX "idx_appcc_responses_execution" ON "public"."appcc_execution_responses" USING "btree" ("execution_id");



CREATE INDEX "idx_appcc_responses_failures" ON "public"."appcc_execution_responses" USING "btree" ("execution_id") WHERE ("is_out_of_range" = true);



CREATE INDEX "idx_appcc_responses_item" ON "public"."appcc_execution_responses" USING "btree" ("item_id");



CREATE INDEX "idx_appcc_schedule_resp_user" ON "public"."appcc_schedule_responsibles" USING "btree" ("user_id");



CREATE INDEX "idx_appcc_schedules_account" ON "public"."appcc_schedules" USING "btree" ("account_id");



CREATE INDEX "idx_appcc_schedules_location" ON "public"."appcc_schedules" USING "btree" ("location_id");



CREATE INDEX "idx_appcc_schedules_template" ON "public"."appcc_schedules" USING "btree" ("template_id");



CREATE INDEX "idx_appcc_signatures_execution" ON "public"."appcc_signatures" USING "btree" ("execution_id");



CREATE INDEX "idx_audit_action" ON "public"."security_audit_log" USING "btree" ("action", "created_at" DESC);



CREATE INDEX "idx_audit_actor" ON "public"."security_audit_log" USING "btree" ("actor_user_id", "created_at" DESC);



CREATE INDEX "idx_audit_date" ON "public"."security_audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_responses_audit" ON "public"."appcc_audit_responses" USING "btree" ("audit_id");



CREATE INDEX "idx_audits_location_status" ON "public"."appcc_audits" USING "btree" ("location_id", "status");



CREATE INDEX "idx_audits_scheduled" ON "public"."appcc_audits" USING "btree" ("scheduled_date" DESC);



CREATE INDEX "idx_auth_rate_limits_email" ON "public"."auth_rate_limits" USING "btree" ("email");



CREATE INDEX "idx_auth_rate_limits_locked" ON "public"."auth_rate_limits" USING "btree" ("locked_until") WHERE ("locked_until" IS NOT NULL);



COMMENT ON INDEX "public"."idx_auth_rate_limits_locked" IS 'Índice parcial para detectar emails actualmente bloqueados.';



CREATE INDEX "idx_balance_closures_employee" ON "public"."monthly_balance_closures" USING "btree" ("employee_id");



CREATE INDEX "idx_balance_closures_location_period" ON "public"."monthly_balance_closures" USING "btree" ("location_id", "period_end" DESC);



CREATE INDEX "idx_balance_closures_pending" ON "public"."monthly_balance_closures" USING "btree" ("location_id", "resolution") WHERE ("resolution" = 'pendiente'::"text");



CREATE INDEX "idx_billing_events_account" ON "public"."billing_events" USING "btree" ("account_id");



CREATE INDEX "idx_billing_events_type" ON "public"."billing_events" USING "btree" ("type");



CREATE INDEX "idx_bla_brand" ON "public"."brand_location_availability" USING "btree" ("brand_id") WHERE ("is_active" = true);



CREATE INDEX "idx_bla_location" ON "public"."brand_location_availability" USING "btree" ("location_id") WHERE ("is_active" = true);



CREATE INDEX "idx_brand_account_active" ON "public"."brand" USING "btree" ("account_id") WHERE (("is_active" = true) AND ("archived_at" IS NULL));



CREATE INDEX "idx_cost_center_account" ON "public"."cost_center" USING "btree" ("account_id") WHERE ("is_active" = true);



CREATE INDEX "idx_cost_center_location" ON "public"."cost_center" USING "btree" ("location_id") WHERE ("location_id" IS NOT NULL);



CREATE INDEX "idx_domain_events_account" ON "public"."domain_events" USING "btree" ("account_id");



CREATE INDEX "idx_domain_events_type" ON "public"."domain_events" USING "btree" ("event_type");



CREATE INDEX "idx_domain_events_unprocessed" ON "public"."domain_events" USING "btree" ("occurred_at") WHERE ("processed_at" IS NULL);



CREATE INDEX "idx_employee_availability_emp" ON "public"."employee_availability" USING "btree" ("employee_id");



CREATE INDEX "idx_employee_notifications_employee_unread" ON "public"."employee_notifications" USING "btree" ("employee_id", "read", "created_at" DESC);



CREATE INDEX "idx_feature_flags_enabled" ON "public"."feature_flags" USING "btree" ("account_id") WHERE ("enabled" = true);



CREATE INDEX "idx_formations_employee" ON "public"."employee_formations" USING "btree" ("employee_id");



CREATE INDEX "idx_formations_expiry" ON "public"."employee_formations" USING "btree" ("expiry_date") WHERE ("expiry_date" IS NOT NULL);



CREATE INDEX "idx_impersonation_active" ON "public"."impersonation_sessions" USING "btree" ("started_at") WHERE ("ended_at" IS NULL);



COMMENT ON INDEX "public"."idx_impersonation_active" IS 'Índice parcial para detectar sesiones activas (no cerradas).';



CREATE INDEX "idx_impersonation_admin" ON "public"."impersonation_sessions" USING "btree" ("platform_admin_id");



CREATE INDEX "idx_impersonation_admin_active" ON "public"."impersonation_sessions" USING "btree" ("platform_admin_id", "started_at" DESC) WHERE ("ended_at" IS NULL);



CREATE INDEX "idx_impersonation_started_at" ON "public"."impersonation_sessions" USING "btree" ("started_at" DESC);



CREATE INDEX "idx_impersonation_target_account" ON "public"."impersonation_sessions" USING "btree" ("target_account_id");



CREATE INDEX "idx_impersonation_target_user" ON "public"."impersonation_sessions" USING "btree" ("target_user_id");



CREATE INDEX "idx_incident_events_incident" ON "public"."appcc_incident_events" USING "btree" ("incident_id", "created_at" DESC);



CREATE INDEX "idx_invoices_account" ON "public"."invoices" USING "btree" ("account_id");



CREATE INDEX "idx_invoices_status" ON "public"."invoices" USING "btree" ("status");



CREATE INDEX "idx_locations_account" ON "public"."locations" USING "btree" ("account_id");



CREATE INDEX "idx_manager_locations_location" ON "public"."manager_locations" USING "btree" ("location_id");



CREATE INDEX "idx_manager_locations_profile" ON "public"."manager_locations" USING "btree" ("user_profile_id");



CREATE INDEX "idx_notifications_created" ON "public"."appcc_notifications" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_notifications_user_unread" ON "public"."appcc_notifications" USING "btree" ("user_id", "read_at") WHERE ("read_at" IS NULL);



CREATE INDEX "idx_permission_set_assignments_set" ON "public"."permission_set_assignments" USING "btree" ("permission_set_id");



CREATE INDEX "idx_permission_set_assignments_user_profile" ON "public"."permission_set_assignments" USING "btree" ("user_profile_id");



CREATE INDEX "idx_permission_sets_account" ON "public"."permission_sets" USING "btree" ("account_id") WHERE ("active" = true);



CREATE INDEX "idx_permission_sets_system" ON "public"."permission_sets" USING "btree" ("is_system") WHERE ("is_system" = true);



COMMENT ON INDEX "public"."idx_permission_sets_system" IS 'Índice parcial para localizar rápido los sets system globales. Usado por trigger replicate.';



CREATE INDEX "idx_platform_admin_2fa_admin" ON "public"."platform_admin_2fa" USING "btree" ("platform_admin_id");



CREATE INDEX "idx_platform_admin_permissions_admin" ON "public"."platform_admin_permissions" USING "btree" ("platform_admin_id");



CREATE INDEX "idx_platform_admins_active" ON "public"."platform_admins" USING "btree" ("active");



CREATE INDEX "idx_platform_admins_role" ON "public"."platform_admins" USING "btree" ("role") WHERE ("active" = true);



CREATE INDEX "idx_platform_admins_user_id" ON "public"."platform_admins" USING "btree" ("user_id") WHERE ("active" = true);



COMMENT ON INDEX "public"."idx_platform_admins_user_id" IS 'Índice parcial para resolución rápida en current_user_is_admin().';



CREATE INDEX "idx_platform_audit_account_recent" ON "public"."platform_audit_log" USING "btree" ("target_account_id", "created_at" DESC) WHERE ("target_account_id" IS NOT NULL);



CREATE INDEX "idx_platform_audit_admin" ON "public"."platform_audit_log" USING "btree" ("platform_admin_id");



CREATE INDEX "idx_platform_audit_admin_recent" ON "public"."platform_audit_log" USING "btree" ("platform_admin_id", "created_at" DESC);



CREATE INDEX "idx_platform_audit_created_at" ON "public"."platform_audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_platform_audit_event_recent" ON "public"."platform_audit_log" USING "btree" ("event_type", "created_at" DESC);



CREATE INDEX "idx_platform_audit_event_type" ON "public"."platform_audit_log" USING "btree" ("event_type");



CREATE INDEX "idx_platform_audit_target_account" ON "public"."platform_audit_log" USING "btree" ("target_account_id") WHERE ("target_account_id" IS NOT NULL);



CREATE INDEX "idx_platform_audit_target_user" ON "public"."platform_audit_log" USING "btree" ("target_user_id") WHERE ("target_user_id" IS NOT NULL);



CREATE INDEX "idx_sales_channel_account_active" ON "public"."sales_channel" USING "btree" ("account_id") WHERE ("is_active" = true);



CREATE INDEX "idx_schedules_location_week" ON "public"."schedules" USING "btree" ("location_id", "week_start" DESC);



CREATE INDEX "idx_shift_templates_location" ON "public"."shift_templates" USING "btree" ("location_id") WHERE ("active" = true);



CREATE INDEX "idx_submodules_module" ON "public"."submodules" USING "btree" ("module_id");



CREATE INDEX "idx_subscription_items_sub" ON "public"."subscription_items" USING "btree" ("subscription_id");



CREATE INDEX "idx_subscriptions_account" ON "public"."subscriptions" USING "btree" ("account_id");



CREATE INDEX "idx_subscriptions_status" ON "public"."subscriptions" USING "btree" ("status");



CREATE INDEX "idx_swap_requester" ON "public"."shift_swap_requests" USING "btree" ("requester_id", "status");



CREATE INDEX "idx_swap_status_date" ON "public"."shift_swap_requests" USING "btree" ("status", "requester_date");



CREATE INDEX "idx_swap_target" ON "public"."shift_swap_requests" USING "btree" ("target_id", "status") WHERE ("target_id" IS NOT NULL);



CREATE INDEX "idx_user_profiles_account_active" ON "public"."user_profiles" USING "btree" ("account_id") WHERE (("active" = true) AND ("suspended_at" IS NULL));



CREATE INDEX "idx_user_profiles_active" ON "public"."user_profiles" USING "btree" ("account_id", "role") WHERE (("active" = true) AND ("suspended_at" IS NULL));



COMMENT ON INDEX "public"."idx_user_profiles_active" IS 'Índice parcial para queries auth de profiles activos no suspendidos.';



CREATE INDEX "idx_user_profiles_login_resolution" ON "public"."user_profiles" USING "btree" ("user_id", "active", "account_id") WHERE ("active" = true);



COMMENT ON INDEX "public"."idx_user_profiles_login_resolution" IS 'Índice compuesto para query "cuentas activas del user X" usado por JWT hook.';



CREATE INDEX "idx_user_profiles_role" ON "public"."user_profiles" USING "btree" ("role") WHERE ("active" = true);



CREATE INDEX "idx_user_profiles_user_id" ON "public"."user_profiles" USING "btree" ("user_id");



CREATE INDEX "open_shift_requests_employee_idx" ON "public"."open_shift_requests" USING "btree" ("employee_id", "created_at" DESC);



CREATE UNIQUE INDEX "open_shift_requests_unique" ON "public"."open_shift_requests" USING "btree" ("shift_id", "employee_id") WHERE ("status" = 'pendiente'::"text");



CREATE INDEX "open_shifts_location_idx" ON "public"."open_shifts" USING "btree" ("location_id", "date");



CREATE INDEX "open_shifts_status_idx" ON "public"."open_shifts" USING "btree" ("status", "date");



CREATE INDEX "shift_assignments_date_idx" ON "public"."shift_assignments" USING "btree" ("date");



CREATE INDEX "shift_assignments_employee_idx" ON "public"."shift_assignments" USING "btree" ("employee_id", "date");



CREATE INDEX "shift_types_account_idx" ON "public"."shift_types" USING "btree" ("account_id");



CREATE INDEX "user_profiles_account_idx" ON "public"."user_profiles" USING "btree" ("account_id");



CREATE UNIQUE INDEX "user_profiles_employee_account_unique" ON "public"."user_profiles" USING "btree" ("employee_id", "account_id") WHERE ("employee_id" IS NOT NULL);



CREATE UNIQUE INDEX "user_profiles_user_account_unique" ON "public"."user_profiles" USING "btree" ("user_id", "account_id");



CREATE INDEX "vacations_employee_idx" ON "public"."vacations" USING "btree" ("employee_id", "start_date" DESC);



CREATE INDEX "vacations_status_idx" ON "public"."vacations" USING "btree" ("status", "start_date");



CREATE INDEX "weekly_plans_week_idx" ON "public"."weekly_plans" USING "btree" ("week_start", "location_id");



CREATE OR REPLACE TRIGGER "seed_appcc_after_insert_accounts" AFTER INSERT ON "public"."accounts" FOR EACH ROW EXECUTE FUNCTION "public"."trg_seed_appcc_on_account_insert"();



CREATE OR REPLACE TRIGGER "trg_analysis_account_updated_at" BEFORE UPDATE ON "public"."analysis_account" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_appcc_executions_updated_at" BEFORE UPDATE ON "public"."appcc_executions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_appcc_incidents_updated_at" BEFORE UPDATE ON "public"."appcc_incidents" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_appcc_plans_updated_at" BEFORE UPDATE ON "public"."appcc_plans" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_appcc_response_calc" BEFORE INSERT OR UPDATE ON "public"."appcc_execution_responses" FOR EACH ROW EXECUTE FUNCTION "public"."appcc_calc_response_validation"();



CREATE OR REPLACE TRIGGER "trg_appcc_response_incident" AFTER INSERT OR UPDATE ON "public"."appcc_execution_responses" FOR EACH ROW EXECUTE FUNCTION "public"."appcc_handle_response_incident"();



CREATE OR REPLACE TRIGGER "trg_appcc_schedules_updated_at" BEFORE UPDATE ON "public"."appcc_schedules" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_appcc_template_items_updated_at" BEFORE UPDATE ON "public"."appcc_template_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_appcc_templates_updated_at" BEFORE UPDATE ON "public"."appcc_templates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_brand_location_availability_updated_at" BEFORE UPDATE ON "public"."brand_location_availability" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_brand_updated_at" BEFORE UPDATE ON "public"."brand" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cost_center_updated_at" BEFORE UPDATE ON "public"."cost_center" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_permission_sets_updated_at" BEFORE UPDATE ON "public"."permission_sets" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_platform_admin_permissions_updated_at" BEFORE UPDATE ON "public"."platform_admin_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_platform_settings_updated_at" BEFORE UPDATE ON "public"."platform_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_protect_last_admin" BEFORE DELETE OR UPDATE ON "public"."platform_admins" FOR EACH ROW EXECUTE FUNCTION "public"."protect_last_admin"();



COMMENT ON TRIGGER "trg_protect_last_admin" ON "public"."platform_admins" IS 'BEFORE UPDATE/DELETE: bloquea operaciones que dejarían sin CEO activo.';



CREATE OR REPLACE TRIGGER "trg_replicate_system_permission_sets" AFTER INSERT ON "public"."accounts" FOR EACH ROW EXECUTE FUNCTION "public"."replicate_system_permission_sets"();



COMMENT ON TRIGGER "trg_replicate_system_permission_sets" ON "public"."accounts" IS 'AFTER INSERT: copia permission_sets system globales a nueva cuenta.';



CREATE OR REPLACE TRIGGER "trg_sales_channel_updated_at" BEFORE UPDATE ON "public"."sales_channel" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_schedules_updated" BEFORE UPDATE ON "public"."schedules" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_updated_at" BEFORE UPDATE ON "public"."accounts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_updated_at" BEFORE UPDATE ON "public"."billing_plans" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_updated_at" BEFORE UPDATE ON "public"."feature_flags" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_updated_at" BEFORE UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_updated_at" BEFORE UPDATE ON "public"."modules" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_updated_at" BEFORE UPDATE ON "public"."quotas" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_updated_at" BEFORE UPDATE ON "public"."submodules" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_updated_at" BEFORE UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_updated_at" BEFORE UPDATE ON "public"."usage_counters" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_shift_templates_updated" BEFORE UPDATE ON "public"."shift_templates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_formations_updated_at" BEFORE UPDATE ON "public"."employee_formations" FOR EACH ROW EXECUTE FUNCTION "public"."update_formations_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_swap_updated_at" BEFORE UPDATE ON "public"."shift_swap_requests" FOR EACH ROW EXECUTE FUNCTION "public"."update_swap_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_user_profiles_updated_at" BEFORE UPDATE ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_user_profile_updated_at"();



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_suspended_by_fkey" FOREIGN KEY ("suspended_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."analysis_account"
    ADD CONSTRAINT "analysis_account_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."analysis_account"
    ADD CONSTRAINT "analysis_account_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."analysis_account"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_account_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_audit_items"
    ADD CONSTRAINT "appcc_audit_items_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."appcc_audit_sections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_audit_log"
    ADD CONSTRAINT "appcc_audit_log_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_audit_log"
    ADD CONSTRAINT "appcc_audit_log_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_audit_log"
    ADD CONSTRAINT "appcc_audit_log_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."appcc_audit_response_photos"
    ADD CONSTRAINT "appcc_audit_response_photos_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."appcc_audit_responses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_audit_response_photos"
    ADD CONSTRAINT "appcc_audit_response_photos_taken_by_fkey" FOREIGN KEY ("taken_by") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_audit_responses"
    ADD CONSTRAINT "appcc_audit_responses_answered_by_fkey" FOREIGN KEY ("answered_by") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_audit_responses"
    ADD CONSTRAINT "appcc_audit_responses_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "public"."appcc_audits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_audit_responses"
    ADD CONSTRAINT "appcc_audit_responses_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "public"."appcc_incidents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_audit_responses"
    ADD CONSTRAINT "appcc_audit_responses_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."appcc_audit_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_audit_schedules"
    ADD CONSTRAINT "appcc_audit_schedules_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."appcc_audit_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_audit_sections"
    ADD CONSTRAINT "appcc_audit_sections_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."appcc_audit_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_audits"
    ADD CONSTRAINT "appcc_audits_auditor_id_fkey" FOREIGN KEY ("auditor_id") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_audits"
    ADD CONSTRAINT "appcc_audits_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_audits"
    ADD CONSTRAINT "appcc_audits_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_audits"
    ADD CONSTRAINT "appcc_audits_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."appcc_audit_templates"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."appcc_execution_photos"
    ADD CONSTRAINT "appcc_execution_photos_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."appcc_execution_responses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_execution_photos"
    ADD CONSTRAINT "appcc_execution_photos_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."appcc_execution_responses"
    ADD CONSTRAINT "appcc_execution_responses_answered_by_fkey" FOREIGN KEY ("answered_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."appcc_execution_responses"
    ADD CONSTRAINT "appcc_execution_responses_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "public"."appcc_executions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_execution_responses"
    ADD CONSTRAINT "appcc_execution_responses_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."appcc_template_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."appcc_execution_responses"
    ADD CONSTRAINT "appcc_execution_responses_selected_option_id_fkey" FOREIGN KEY ("selected_option_id") REFERENCES "public"."appcc_template_item_options"("id");



ALTER TABLE ONLY "public"."appcc_executions"
    ADD CONSTRAINT "appcc_executions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_executions"
    ADD CONSTRAINT "appcc_executions_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."appcc_executions"
    ADD CONSTRAINT "appcc_executions_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."appcc_executions"
    ADD CONSTRAINT "appcc_executions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."appcc_executions"
    ADD CONSTRAINT "appcc_executions_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."appcc_schedules"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_executions"
    ADD CONSTRAINT "appcc_executions_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."appcc_executions"
    ADD CONSTRAINT "appcc_executions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."appcc_templates"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."appcc_incident_actions"
    ADD CONSTRAINT "appcc_incident_actions_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "public"."appcc_incidents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_incident_actions"
    ADD CONSTRAINT "appcc_incident_actions_taken_by_fkey" FOREIGN KEY ("taken_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."appcc_incident_events"
    ADD CONSTRAINT "appcc_incident_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_incident_events"
    ADD CONSTRAINT "appcc_incident_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "public"."appcc_incidents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_incident_photos"
    ADD CONSTRAINT "appcc_incident_photos_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "public"."appcc_incident_actions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_incident_photos"
    ADD CONSTRAINT "appcc_incident_photos_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "public"."appcc_incidents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_incident_photos"
    ADD CONSTRAINT "appcc_incident_photos_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."appcc_incidents"
    ADD CONSTRAINT "appcc_incidents_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_incidents"
    ADD CONSTRAINT "appcc_incidents_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."appcc_incidents"
    ADD CONSTRAINT "appcc_incidents_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_incidents"
    ADD CONSTRAINT "appcc_incidents_corrective_action_by_fkey" FOREIGN KEY ("corrective_action_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_incidents"
    ADD CONSTRAINT "appcc_incidents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_incidents"
    ADD CONSTRAINT "appcc_incidents_escalated_to_fkey" FOREIGN KEY ("escalated_to") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_incidents"
    ADD CONSTRAINT "appcc_incidents_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "public"."appcc_executions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_incidents"
    ADD CONSTRAINT "appcc_incidents_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."appcc_incidents"
    ADD CONSTRAINT "appcc_incidents_preventive_action_by_fkey" FOREIGN KEY ("preventive_action_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_incidents"
    ADD CONSTRAINT "appcc_incidents_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."appcc_incidents"
    ADD CONSTRAINT "appcc_incidents_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."appcc_execution_responses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_incidents"
    ADD CONSTRAINT "appcc_incidents_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appcc_notifications"
    ADD CONSTRAINT "appcc_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_schedule_responsibles"
    ADD CONSTRAINT "appcc_schedule_responsibles_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."appcc_schedules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_schedule_responsibles"
    ADD CONSTRAINT "appcc_schedule_responsibles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_schedules"
    ADD CONSTRAINT "appcc_schedules_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_schedules"
    ADD CONSTRAINT "appcc_schedules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."appcc_schedules"
    ADD CONSTRAINT "appcc_schedules_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_schedules"
    ADD CONSTRAINT "appcc_schedules_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."appcc_templates"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."appcc_signatures"
    ADD CONSTRAINT "appcc_signatures_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "public"."appcc_executions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_signatures"
    ADD CONSTRAINT "appcc_signatures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."appcc_template_item_options"
    ADD CONSTRAINT "appcc_template_item_options_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."appcc_template_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_template_items"
    ADD CONSTRAINT "appcc_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."appcc_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_templates"
    ADD CONSTRAINT "appcc_templates_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appcc_templates"
    ADD CONSTRAINT "appcc_templates_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."appcc_plans"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."billing_events"
    ADD CONSTRAINT "billing_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."brand"
    ADD CONSTRAINT "brand_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."brand"
    ADD CONSTRAINT "brand_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."brand_location_availability"
    ADD CONSTRAINT "brand_location_availability_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."brand_location_availability"
    ADD CONSTRAINT "brand_location_availability_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."brand_location_availability"
    ADD CONSTRAINT "brand_location_availability_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clock_entries"
    ADD CONSTRAINT "clock_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE RESTRICT;



COMMENT ON CONSTRAINT "clock_entries_employee_id_fkey" ON "public"."clock_entries" IS 'ON DELETE RESTRICT: impide borrar empleado con fichajes asociados. Compliance Real Decreto-ley 8/2019.';



ALTER TABLE ONLY "public"."clock_entries"
    ADD CONSTRAINT "clock_entries_location_id_at_clock_fkey" FOREIGN KEY ("location_id_at_clock") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cost_center"
    ADD CONSTRAINT "cost_center_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cost_center"
    ADD CONSTRAINT "cost_center_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE RESTRICT;



COMMENT ON CONSTRAINT "documents_employee_id_fkey" ON "public"."documents" IS 'ON DELETE RESTRICT: impide borrar empleado con documentos asociados.';



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."domain_events"
    ADD CONSTRAINT "domain_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."domain_events"
    ADD CONSTRAINT "domain_events_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employee_availability"
    ADD CONSTRAINT "employee_availability_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_formations"
    ADD CONSTRAINT "employee_formations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_notifications"
    ADD CONSTRAINT "employee_notifications_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."impersonation_sessions"
    ADD CONSTRAINT "impersonation_sessions_platform_admin_id_fkey" FOREIGN KEY ("platform_admin_id") REFERENCES "public"."platform_admins"("id");



ALTER TABLE ONLY "public"."impersonation_sessions"
    ADD CONSTRAINT "impersonation_sessions_target_account_id_fkey" FOREIGN KEY ("target_account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE ONLY "public"."impersonation_sessions"
    ADD CONSTRAINT "impersonation_sessions_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."location_planning"
    ADD CONSTRAINT "location_planning_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."location_planning"
    ADD CONSTRAINT "location_planning_shift_type_id_fkey" FOREIGN KEY ("shift_type_id") REFERENCES "public"."shift_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."manager_locations"
    ADD CONSTRAINT "manager_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."manager_locations"
    ADD CONSTRAINT "manager_locations_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."manager_permissions"
    ADD CONSTRAINT "manager_permissions_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."monthly_balance_closures"
    ADD CONSTRAINT "monthly_balance_closures_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."monthly_balance_closures"
    ADD CONSTRAINT "monthly_balance_closures_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."open_shift_requests"
    ADD CONSTRAINT "open_shift_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."open_shift_requests"
    ADD CONSTRAINT "open_shift_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."open_shift_requests"
    ADD CONSTRAINT "open_shift_requests_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."open_shifts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."open_shifts"
    ADD CONSTRAINT "open_shifts_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."open_shifts"
    ADD CONSTRAINT "open_shifts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."open_shifts"
    ADD CONSTRAINT "open_shifts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permission_set_assignments"
    ADD CONSTRAINT "permission_set_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."permission_set_assignments"
    ADD CONSTRAINT "permission_set_assignments_permission_set_id_fkey" FOREIGN KEY ("permission_set_id") REFERENCES "public"."permission_sets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permission_set_assignments"
    ADD CONSTRAINT "permission_set_assignments_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permission_sets"
    ADD CONSTRAINT "permission_sets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permission_sets"
    ADD CONSTRAINT "permission_sets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."platform_admin_2fa"
    ADD CONSTRAINT "platform_admin_2fa_platform_admin_id_fkey" FOREIGN KEY ("platform_admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."platform_admin_permissions"
    ADD CONSTRAINT "platform_admin_permissions_platform_admin_id_fkey" FOREIGN KEY ("platform_admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."platform_admin_permissions"
    ADD CONSTRAINT "platform_admin_permissions_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."platform_admins"
    ADD CONSTRAINT "platform_admins_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."platform_admins"
    ADD CONSTRAINT "platform_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."platform_audit_log"
    ADD CONSTRAINT "platform_audit_log_platform_admin_id_fkey" FOREIGN KEY ("platform_admin_id") REFERENCES "public"."platform_admins"("id");



ALTER TABLE ONLY "public"."platform_audit_log"
    ADD CONSTRAINT "platform_audit_log_target_account_id_fkey" FOREIGN KEY ("target_account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE ONLY "public"."platform_audit_log"
    ADD CONSTRAINT "platform_audit_log_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."platform_settings"
    ADD CONSTRAINT "platform_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."quotas"
    ADD CONSTRAINT "quotas_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_channel"
    ADD CONSTRAINT "sales_channel_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedules"
    ADD CONSTRAINT "schedules_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."security_audit_log"
    ADD CONSTRAINT "security_audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."security_audit_log"
    ADD CONSTRAINT "security_audit_log_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shift_assignments"
    ADD CONSTRAINT "shift_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_assignments"
    ADD CONSTRAINT "shift_assignments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."weekly_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_assignments"
    ADD CONSTRAINT "shift_assignments_shift_type_id_fkey" FOREIGN KEY ("shift_type_id") REFERENCES "public"."shift_types"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shift_minimums"
    ADD CONSTRAINT "shift_minimums_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_minimums"
    ADD CONSTRAINT "shift_minimums_shift_type_id_fkey" FOREIGN KEY ("shift_type_id") REFERENCES "public"."shift_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_swap_requests"
    ADD CONSTRAINT "shift_swap_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_swap_requests"
    ADD CONSTRAINT "shift_swap_requests_requester_schedule_id_fkey" FOREIGN KEY ("requester_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_swap_requests"
    ADD CONSTRAINT "shift_swap_requests_requester_template_id_fkey" FOREIGN KEY ("requester_template_id") REFERENCES "public"."shift_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_swap_requests"
    ADD CONSTRAINT "shift_swap_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."employees"("id");



ALTER TABLE ONLY "public"."shift_swap_requests"
    ADD CONSTRAINT "shift_swap_requests_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_swap_requests"
    ADD CONSTRAINT "shift_swap_requests_target_schedule_id_fkey" FOREIGN KEY ("target_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_swap_requests"
    ADD CONSTRAINT "shift_swap_requests_target_template_id_fkey" FOREIGN KEY ("target_template_id") REFERENCES "public"."shift_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_templates"
    ADD CONSTRAINT "shift_templates_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_types"
    ADD CONSTRAINT "shift_types_account_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submodules"
    ADD CONSTRAINT "submodules_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscription_items"
    ADD CONSTRAINT "subscription_items_submodule_id_fkey" FOREIGN KEY ("submodule_id") REFERENCES "public"."submodules"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."subscription_items"
    ADD CONSTRAINT "subscription_items_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."usage_counters"
    ADD CONSTRAINT "usage_counters_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_suspended_by_fkey" FOREIGN KEY ("suspended_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vacation_settings"
    ADD CONSTRAINT "vacation_settings_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vacations"
    ADD CONSTRAINT "vacations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vacations"
    ADD CONSTRAINT "vacations_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."weekly_availability"
    ADD CONSTRAINT "weekly_availability_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_plans"
    ADD CONSTRAINT "weekly_plans_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_plans"
    ADD CONSTRAINT "weekly_plans_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE "public"."_backup_20260516_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_20260516_accounts_pre_slug" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_20260516_billing_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_20260516_feature_flags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_20260516_functions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_20260516_modules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_20260516_policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_20260516_submodules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_20260516_user_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_20260517_user_profiles_read_policy" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "accounts_read_own" ON "public"."accounts" FOR SELECT TO "authenticated" USING ((("id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()));



CREATE POLICY "accounts_write_admin" ON "public"."accounts" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



ALTER TABLE "public"."analysis_account" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "analysis_account_read" ON "public"."analysis_account" FOR SELECT TO "authenticated" USING (("account_id" = ANY ("public"."current_user_account_ids"())));



CREATE POLICY "analysis_account_write" ON "public"."analysis_account" TO "authenticated" USING ("public"."current_user_is_admin_of"("account_id")) WITH CHECK ("public"."current_user_is_admin_of"("account_id"));



ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_settings_read" ON "public"."app_settings" FOR SELECT TO "authenticated" USING (("account_id" = ANY ("public"."current_user_account_ids"())));



CREATE POLICY "app_settings_write" ON "public"."app_settings" TO "authenticated" USING ("public"."current_user_is_admin_of"("account_id")) WITH CHECK ("public"."current_user_is_admin_of"("account_id"));



ALTER TABLE "public"."appcc_audit_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_audit_items_read" ON "public"."appcc_audit_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."appcc_audit_sections" "s"
     JOIN "public"."appcc_audit_templates" "t" ON (("t"."id" = "s"."template_id")))
  WHERE (("s"."id" = "appcc_audit_items"."section_id") AND (("t"."is_seed" = true) OR ("t"."account_id" = ANY ("public"."current_user_account_ids"())))))));



CREATE POLICY "appcc_audit_items_write" ON "public"."appcc_audit_items" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."appcc_audit_sections" "s"
     JOIN "public"."appcc_audit_templates" "t" ON (("t"."id" = "s"."template_id")))
  WHERE (("s"."id" = "appcc_audit_items"."section_id") AND ((("t"."is_seed" = false) AND "public"."current_user_is_admin_of"("t"."account_id")) OR "public"."current_user_is_admin"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."appcc_audit_sections" "s"
     JOIN "public"."appcc_audit_templates" "t" ON (("t"."id" = "s"."template_id")))
  WHERE (("s"."id" = "appcc_audit_items"."section_id") AND ((("t"."is_seed" = false) AND "public"."current_user_is_admin_of"("t"."account_id")) OR "public"."current_user_is_admin"())))));



ALTER TABLE "public"."appcc_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_audit_log_insert" ON "public"."appcc_audit_log" FOR INSERT TO "authenticated" WITH CHECK ((("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()));



CREATE POLICY "appcc_audit_log_select" ON "public"."appcc_audit_log" FOR SELECT TO "authenticated" USING ((("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()));



ALTER TABLE "public"."appcc_audit_response_photos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_audit_response_photos_read" ON "public"."appcc_audit_response_photos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."appcc_audit_responses" "r"
     JOIN "public"."appcc_audits" "a" ON (("a"."id" = "r"."audit_id")))
  WHERE (("r"."id" = "appcc_audit_response_photos"."response_id") AND ("a"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "appcc_audit_response_photos_write" ON "public"."appcc_audit_response_photos" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."appcc_audit_responses" "r"
     JOIN "public"."appcc_audits" "a" ON (("a"."id" = "r"."audit_id")))
  WHERE (("r"."id" = "appcc_audit_response_photos"."response_id") AND ("a"."account_id" = ANY ("public"."current_user_account_ids"())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."appcc_audit_responses" "r"
     JOIN "public"."appcc_audits" "a" ON (("a"."id" = "r"."audit_id")))
  WHERE (("r"."id" = "appcc_audit_response_photos"."response_id") AND ("a"."account_id" = ANY ("public"."current_user_account_ids"()))))));



ALTER TABLE "public"."appcc_audit_responses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_audit_responses_read" ON "public"."appcc_audit_responses" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appcc_audits" "a"
  WHERE (("a"."id" = "appcc_audit_responses"."audit_id") AND ("a"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "appcc_audit_responses_write" ON "public"."appcc_audit_responses" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appcc_audits" "a"
  WHERE (("a"."id" = "appcc_audit_responses"."audit_id") AND ("a"."account_id" = ANY ("public"."current_user_account_ids"())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."appcc_audits" "a"
  WHERE (("a"."id" = "appcc_audit_responses"."audit_id") AND ("a"."account_id" = ANY ("public"."current_user_account_ids"()))))));



ALTER TABLE "public"."appcc_audit_schedules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_audit_schedules_read" ON "public"."appcc_audit_schedules" FOR SELECT TO "authenticated" USING (("account_id" = ANY ("public"."current_user_account_ids"())));



CREATE POLICY "appcc_audit_schedules_write" ON "public"."appcc_audit_schedules" TO "authenticated" USING ("public"."current_user_is_admin_of"("account_id")) WITH CHECK ("public"."current_user_is_admin_of"("account_id"));



ALTER TABLE "public"."appcc_audit_sections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_audit_sections_read" ON "public"."appcc_audit_sections" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appcc_audit_templates" "t"
  WHERE (("t"."id" = "appcc_audit_sections"."template_id") AND (("t"."is_seed" = true) OR ("t"."account_id" = ANY ("public"."current_user_account_ids"())))))));



CREATE POLICY "appcc_audit_sections_write" ON "public"."appcc_audit_sections" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appcc_audit_templates" "t"
  WHERE (("t"."id" = "appcc_audit_sections"."template_id") AND ((("t"."is_seed" = false) AND "public"."current_user_is_admin_of"("t"."account_id")) OR "public"."current_user_is_admin"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."appcc_audit_templates" "t"
  WHERE (("t"."id" = "appcc_audit_sections"."template_id") AND ((("t"."is_seed" = false) AND "public"."current_user_is_admin_of"("t"."account_id")) OR "public"."current_user_is_admin"())))));



ALTER TABLE "public"."appcc_audit_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_audit_templates_read" ON "public"."appcc_audit_templates" FOR SELECT TO "authenticated" USING ((("is_seed" = true) OR ("account_id" = ANY ("public"."current_user_account_ids"()))));



CREATE POLICY "appcc_audit_templates_write" ON "public"."appcc_audit_templates" TO "authenticated" USING (((("is_seed" = false) AND "public"."current_user_is_admin_of"("account_id")) OR "public"."current_user_is_admin"())) WITH CHECK (((("is_seed" = false) AND "public"."current_user_is_admin_of"("account_id")) OR "public"."current_user_is_admin"()));



ALTER TABLE "public"."appcc_audits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_audits_read" ON "public"."appcc_audits" FOR SELECT TO "authenticated" USING (("account_id" = ANY ("public"."current_user_account_ids"())));



CREATE POLICY "appcc_audits_write" ON "public"."appcc_audits" TO "authenticated" USING ("public"."current_user_is_admin_of"("account_id")) WITH CHECK ("public"."current_user_is_admin_of"("account_id"));



ALTER TABLE "public"."appcc_execution_photos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_execution_photos_all" ON "public"."appcc_execution_photos" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."appcc_execution_responses" "r"
     JOIN "public"."appcc_executions" "e" ON (("e"."id" = "r"."execution_id")))
  WHERE (("r"."id" = "appcc_execution_photos"."response_id") AND (("e"."account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."appcc_execution_responses" "r"
     JOIN "public"."appcc_executions" "e" ON (("e"."id" = "r"."execution_id")))
  WHERE (("r"."id" = "appcc_execution_photos"."response_id") AND (("e"."account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"())))));



ALTER TABLE "public"."appcc_execution_responses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_execution_responses_all" ON "public"."appcc_execution_responses" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appcc_executions" "e"
  WHERE (("e"."id" = "appcc_execution_responses"."execution_id") AND (("e"."account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."appcc_executions" "e"
  WHERE (("e"."id" = "appcc_execution_responses"."execution_id") AND (("e"."account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"())))));



ALTER TABLE "public"."appcc_executions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_executions_all" ON "public"."appcc_executions" TO "authenticated" USING ((("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"())) WITH CHECK ((("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()));



ALTER TABLE "public"."appcc_incident_actions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_incident_actions_all" ON "public"."appcc_incident_actions" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appcc_incidents" "i"
  WHERE (("i"."id" = "appcc_incident_actions"."incident_id") AND (("i"."account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."appcc_incidents" "i"
  WHERE (("i"."id" = "appcc_incident_actions"."incident_id") AND (("i"."account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"())))));



ALTER TABLE "public"."appcc_incident_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_incident_events_read" ON "public"."appcc_incident_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appcc_incidents" "i"
  WHERE (("i"."id" = "appcc_incident_events"."incident_id") AND ("i"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "appcc_incident_events_write" ON "public"."appcc_incident_events" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appcc_incidents" "i"
  WHERE (("i"."id" = "appcc_incident_events"."incident_id") AND ("i"."account_id" = ANY ("public"."current_user_account_ids"())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."appcc_incidents" "i"
  WHERE (("i"."id" = "appcc_incident_events"."incident_id") AND ("i"."account_id" = ANY ("public"."current_user_account_ids"()))))));



ALTER TABLE "public"."appcc_incident_photos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_incident_photos_all" ON "public"."appcc_incident_photos" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appcc_incidents" "i"
  WHERE (("i"."id" = "appcc_incident_photos"."incident_id") AND (("i"."account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."appcc_incidents" "i"
  WHERE (("i"."id" = "appcc_incident_photos"."incident_id") AND (("i"."account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"())))));



ALTER TABLE "public"."appcc_incidents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_incidents_all" ON "public"."appcc_incidents" TO "authenticated" USING ((("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"())) WITH CHECK ((("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()));



ALTER TABLE "public"."appcc_notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_notifications_delete" ON "public"."appcc_notifications" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."current_user_is_admin_of"("account_id")));



CREATE POLICY "appcc_notifications_insert" ON "public"."appcc_notifications" FOR INSERT TO "authenticated" WITH CHECK ((("account_id" = ANY ("public"."current_user_account_ids"())) AND (EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."user_id" = "appcc_notifications"."user_id") AND ("up"."account_id" = "appcc_notifications"."account_id") AND ("up"."active" = true))))));



ALTER TABLE "public"."appcc_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_plans_all_admin" ON "public"."appcc_plans" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



CREATE POLICY "appcc_plans_select" ON "public"."appcc_plans" FOR SELECT TO "authenticated" USING ((("is_active" = true) OR "public"."current_user_is_admin"()));



ALTER TABLE "public"."appcc_schedule_responsibles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_schedule_responsibles_all" ON "public"."appcc_schedule_responsibles" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appcc_schedules" "s"
  WHERE (("s"."id" = "appcc_schedule_responsibles"."schedule_id") AND (("s"."account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."appcc_schedules" "s"
  WHERE (("s"."id" = "appcc_schedule_responsibles"."schedule_id") AND (("s"."account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"())))));



ALTER TABLE "public"."appcc_schedules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_schedules_all" ON "public"."appcc_schedules" TO "authenticated" USING ((("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"())) WITH CHECK ((("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()));



ALTER TABLE "public"."appcc_signatures" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_signatures_all" ON "public"."appcc_signatures" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appcc_executions" "e"
  WHERE (("e"."id" = "appcc_signatures"."execution_id") AND (("e"."account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."appcc_executions" "e"
  WHERE (("e"."id" = "appcc_signatures"."execution_id") AND (("e"."account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"())))));



ALTER TABLE "public"."appcc_template_item_options" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_template_item_options_select" ON "public"."appcc_template_item_options" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."appcc_template_items" "i"
     JOIN "public"."appcc_templates" "t" ON (("t"."id" = "i"."template_id")))
  WHERE (("i"."id" = "appcc_template_item_options"."item_id") AND (("t"."is_seed" = true) OR ("t"."account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"())))));



CREATE POLICY "appcc_template_item_options_write" ON "public"."appcc_template_item_options" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."appcc_template_items" "i"
     JOIN "public"."appcc_templates" "t" ON (("t"."id" = "i"."template_id")))
  WHERE (("i"."id" = "appcc_template_item_options"."item_id") AND ((("t"."is_seed" = false) AND ("t"."account_id" = ANY ("public"."current_user_account_ids"()))) OR "public"."current_user_is_admin"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."appcc_template_items" "i"
     JOIN "public"."appcc_templates" "t" ON (("t"."id" = "i"."template_id")))
  WHERE (("i"."id" = "appcc_template_item_options"."item_id") AND ((("t"."is_seed" = false) AND ("t"."account_id" = ANY ("public"."current_user_account_ids"()))) OR "public"."current_user_is_admin"())))));



ALTER TABLE "public"."appcc_template_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_template_items_select" ON "public"."appcc_template_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appcc_templates" "t"
  WHERE (("t"."id" = "appcc_template_items"."template_id") AND (("t"."is_seed" = true) OR ("t"."account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"())))));



CREATE POLICY "appcc_template_items_write" ON "public"."appcc_template_items" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appcc_templates" "t"
  WHERE (("t"."id" = "appcc_template_items"."template_id") AND ((("t"."is_seed" = false) AND ("t"."account_id" = ANY ("public"."current_user_account_ids"()))) OR "public"."current_user_is_admin"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."appcc_templates" "t"
  WHERE (("t"."id" = "appcc_template_items"."template_id") AND ((("t"."is_seed" = false) AND ("t"."account_id" = ANY ("public"."current_user_account_ids"()))) OR "public"."current_user_is_admin"())))));



ALTER TABLE "public"."appcc_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appcc_templates_select" ON "public"."appcc_templates" FOR SELECT TO "authenticated" USING ((("is_seed" = true) OR ("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()));



CREATE POLICY "appcc_templates_write_account" ON "public"."appcc_templates" TO "authenticated" USING (((("is_seed" = false) AND ("account_id" = ANY ("public"."current_user_account_ids"()))) OR "public"."current_user_is_admin"())) WITH CHECK (((("is_seed" = false) AND ("account_id" = ANY ("public"."current_user_account_ids"()))) OR "public"."current_user_is_admin"()));



CREATE POLICY "auth_admin_read_accounts" ON "public"."accounts" FOR SELECT TO "supabase_auth_admin" USING (true);



CREATE POLICY "auth_admin_read_permission_set_assignments" ON "public"."permission_set_assignments" FOR SELECT TO "supabase_auth_admin" USING (true);



CREATE POLICY "auth_admin_read_platform_admins" ON "public"."platform_admins" FOR SELECT TO "supabase_auth_admin" USING (true);



CREATE POLICY "auth_admin_read_user_profiles" ON "public"."user_profiles" FOR SELECT TO "supabase_auth_admin" USING (true);



ALTER TABLE "public"."auth_rate_limits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "auth_rate_limits_deny_all" ON "public"."auth_rate_limits" USING (false) WITH CHECK (false);



COMMENT ON POLICY "auth_rate_limits_deny_all" ON "public"."auth_rate_limits" IS 'DENY ALL para users normales. Solo Edge Functions con service_role pueden acceder.';



ALTER TABLE "public"."billing_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_events_read_own" ON "public"."billing_events" FOR SELECT TO "authenticated" USING ((("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()));



CREATE POLICY "billing_events_write_admin" ON "public"."billing_events" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



ALTER TABLE "public"."billing_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_plans_read_all" ON "public"."billing_plans" FOR SELECT TO "authenticated" USING (("status" = 'active'::"text"));



CREATE POLICY "billing_plans_write_admin" ON "public"."billing_plans" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



CREATE POLICY "bla_read" ON "public"."brand_location_availability" FOR SELECT TO "authenticated" USING (("account_id" = ANY ("public"."current_user_account_ids"())));



CREATE POLICY "bla_write" ON "public"."brand_location_availability" TO "authenticated" USING ("public"."current_user_is_admin_of"("account_id")) WITH CHECK ("public"."current_user_is_admin_of"("account_id"));



ALTER TABLE "public"."brand" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."brand_location_availability" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "brand_read" ON "public"."brand" FOR SELECT TO "authenticated" USING (("account_id" = ANY ("public"."current_user_account_ids"())));



CREATE POLICY "brand_write" ON "public"."brand" TO "authenticated" USING ("public"."current_user_is_admin_of"("account_id")) WITH CHECK ("public"."current_user_is_admin_of"("account_id"));



ALTER TABLE "public"."clock_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clock_entries_delete" ON "public"."clock_entries" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "clock_entries"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



CREATE POLICY "clock_entries_insert" ON "public"."clock_entries" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "clock_entries"."employee_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "clock_entries_modify" ON "public"."clock_entries" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "clock_entries"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "clock_entries"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



CREATE POLICY "clock_entries_read" ON "public"."clock_entries" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "clock_entries"."employee_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



ALTER TABLE "public"."cost_center" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cost_center_read" ON "public"."cost_center" FOR SELECT TO "authenticated" USING (("account_id" = ANY ("public"."current_user_account_ids"())));



CREATE POLICY "cost_center_write" ON "public"."cost_center" TO "authenticated" USING ("public"."current_user_is_admin_of"("account_id")) WITH CHECK ("public"."current_user_is_admin_of"("account_id"));



ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "documents_read" ON "public"."documents" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "documents"."employee_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "documents_write" ON "public"."documents" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "documents"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "documents"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



ALTER TABLE "public"."domain_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "domain_events_insert" ON "public"."domain_events" FOR INSERT TO "authenticated" WITH CHECK ((("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()));



CREATE POLICY "domain_events_read_own" ON "public"."domain_events" FOR SELECT TO "authenticated" USING ((("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()));



ALTER TABLE "public"."employee_availability" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employee_availability_read" ON "public"."employee_availability" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "employee_availability"."employee_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "employee_availability_write" ON "public"."employee_availability" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "employee_availability"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "employee_availability"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



ALTER TABLE "public"."employee_formations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employee_notifications_delete" ON "public"."employee_notifications" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "employee_notifications"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



CREATE POLICY "employee_notifications_insert" ON "public"."employee_notifications" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "employee_notifications"."employee_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "employee_notifications_read" ON "public"."employee_notifications" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "employee_notifications"."employee_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "employee_notifications_update" ON "public"."employee_notifications" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "employee_notifications"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "employee_notifications"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employees_read" ON "public"."employees" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "employees"."location_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "employees_write" ON "public"."employees" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "employees"."location_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "employees"."location_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



ALTER TABLE "public"."feature_flags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feature_flags_read_own" ON "public"."feature_flags" FOR SELECT TO "authenticated" USING ((("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()));



CREATE POLICY "feature_flags_write_admin" ON "public"."feature_flags" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



ALTER TABLE "public"."impersonation_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "impersonation_sessions_insert" ON "public"."impersonation_sessions" FOR INSERT WITH CHECK (("public"."current_user_has_platform_permission"('platform_can_impersonate'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."platform_admins" "pa"
  WHERE (("pa"."id" = "impersonation_sessions"."platform_admin_id") AND ("pa"."user_id" = "auth"."uid"()))))));



CREATE POLICY "impersonation_sessions_select" ON "public"."impersonation_sessions" FOR SELECT USING ("public"."current_user_has_platform_permission"('platform_can_view_audit_log'::"text"));



CREATE POLICY "impersonation_sessions_update" ON "public"."impersonation_sessions" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."platform_admins" "pa"
  WHERE (("pa"."id" = "impersonation_sessions"."platform_admin_id") AND ("pa"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoices_read_own" ON "public"."invoices" FOR SELECT TO "authenticated" USING ((("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()));



CREATE POLICY "invoices_write_admin" ON "public"."invoices" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



ALTER TABLE "public"."location_planning" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "location_planning_read" ON "public"."location_planning" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "location_planning"."location_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "location_planning_write" ON "public"."location_planning" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "location_planning"."location_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "location_planning"."location_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



ALTER TABLE "public"."locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "locations_read" ON "public"."locations" FOR SELECT TO "authenticated" USING (("account_id" = ANY ("public"."current_user_account_ids"())));



CREATE POLICY "locations_write" ON "public"."locations" TO "authenticated" USING ("public"."current_user_is_admin_of"("account_id")) WITH CHECK ("public"."current_user_is_admin_of"("account_id"));



ALTER TABLE "public"."manager_locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "manager_locations_read" ON "public"."manager_locations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "manager_locations"."user_profile_id") AND (("up"."user_id" = "auth"."uid"()) OR "public"."current_user_is_admin_of"("up"."account_id"))))));



CREATE POLICY "manager_locations_write" ON "public"."manager_locations" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "manager_locations"."user_profile_id") AND "public"."current_user_is_admin_of"("up"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "manager_locations"."user_profile_id") AND "public"."current_user_is_admin_of"("up"."account_id")))));



ALTER TABLE "public"."manager_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "manager_permissions_read" ON "public"."manager_permissions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "manager_permissions"."user_profile_id") AND (("up"."user_id" = "auth"."uid"()) OR "public"."current_user_is_admin_of"("up"."account_id"))))));



CREATE POLICY "manager_permissions_write" ON "public"."manager_permissions" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "manager_permissions"."user_profile_id") AND "public"."current_user_is_admin_of"("up"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "manager_permissions"."user_profile_id") AND "public"."current_user_is_admin_of"("up"."account_id")))));



ALTER TABLE "public"."modules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "modules_read_all" ON "public"."modules" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "modules_write_admin" ON "public"."modules" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



ALTER TABLE "public"."monthly_balance_closures" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monthly_balance_closures_read" ON "public"."monthly_balance_closures" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "monthly_balance_closures"."location_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "monthly_balance_closures_write" ON "public"."monthly_balance_closures" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "monthly_balance_closures"."location_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "monthly_balance_closures"."location_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



CREATE POLICY "notifications_select_own" ON "public"."appcc_notifications" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notifications_update_own" ON "public"."appcc_notifications" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."open_shift_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "open_shift_requests_read" ON "public"."open_shift_requests" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "open_shift_requests"."employee_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "open_shift_requests_write" ON "public"."open_shift_requests" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "open_shift_requests"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "open_shift_requests"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



ALTER TABLE "public"."open_shifts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "open_shifts_read" ON "public"."open_shifts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "open_shifts"."location_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "open_shifts_write" ON "public"."open_shifts" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "open_shifts"."location_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "open_shifts"."location_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



ALTER TABLE "public"."permission_set_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "permission_set_assignments_select" ON "public"."permission_set_assignments" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "permission_set_assignments"."user_profile_id") AND (("up"."user_id" = "auth"."uid"()) OR "public"."current_user_is_admin_or_manager_of"("up"."account_id"))))) OR "public"."current_user_is_admin"()));



CREATE POLICY "permission_set_assignments_write" ON "public"."permission_set_assignments" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "permission_set_assignments"."user_profile_id") AND "public"."has_permission"("up"."account_id", 'can_manage_users'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "permission_set_assignments"."user_profile_id") AND "public"."has_permission"("up"."account_id", 'can_manage_users'::"text")))));



ALTER TABLE "public"."permission_sets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "permission_sets_delete" ON "public"."permission_sets" FOR DELETE USING ((("is_system" = false) AND "public"."has_permission"("account_id", 'can_manage_users'::"text")));



CREATE POLICY "permission_sets_insert" ON "public"."permission_sets" FOR INSERT WITH CHECK ((("account_id" IS NOT NULL) AND "public"."has_permission"("account_id", 'can_manage_users'::"text")));



CREATE POLICY "permission_sets_select" ON "public"."permission_sets" FOR SELECT USING ((("account_id" IS NULL) OR "public"."belongs_to_account"("account_id") OR "public"."current_user_is_admin"()));



CREATE POLICY "permission_sets_update" ON "public"."permission_sets" FOR UPDATE USING ((("is_system" = false) AND "public"."has_permission"("account_id", 'can_manage_users'::"text"))) WITH CHECK ((("is_system" = false) AND "public"."has_permission"("account_id", 'can_manage_users'::"text")));



ALTER TABLE "public"."platform_admin_2fa" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "platform_admin_2fa_delete" ON "public"."platform_admin_2fa" FOR DELETE USING ("public"."current_user_has_platform_permission"('platform_can_reset_2fa_of_others'::"text"));



CREATE POLICY "platform_admin_2fa_insert" ON "public"."platform_admin_2fa" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."platform_admins" "pa"
  WHERE (("pa"."id" = "platform_admin_2fa"."platform_admin_id") AND ("pa"."user_id" = "auth"."uid"())))));



CREATE POLICY "platform_admin_2fa_select" ON "public"."platform_admin_2fa" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."platform_admins" "pa"
  WHERE (("pa"."id" = "platform_admin_2fa"."platform_admin_id") AND ("pa"."user_id" = "auth"."uid"())))) OR "public"."current_user_has_platform_permission"('platform_can_reset_2fa_of_others'::"text")));



CREATE POLICY "platform_admin_2fa_update" ON "public"."platform_admin_2fa" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."platform_admins" "pa"
  WHERE (("pa"."id" = "platform_admin_2fa"."platform_admin_id") AND ("pa"."user_id" = "auth"."uid"())))) OR "public"."current_user_has_platform_permission"('platform_can_reset_2fa_of_others'::"text")));



ALTER TABLE "public"."platform_admin_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "platform_admin_permissions_select" ON "public"."platform_admin_permissions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."platform_admins" "pa"
  WHERE (("pa"."id" = "platform_admin_permissions"."platform_admin_id") AND (("pa"."user_id" = "auth"."uid"()) OR "public"."current_user_has_platform_permission"('platform_can_manage_admins'::"text"))))));



CREATE POLICY "platform_admin_permissions_write" ON "public"."platform_admin_permissions" USING ("public"."current_user_has_platform_permission"('platform_can_manage_admins'::"text")) WITH CHECK ("public"."current_user_has_platform_permission"('platform_can_manage_admins'::"text"));



ALTER TABLE "public"."platform_admins" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "platform_admins_delete" ON "public"."platform_admins" FOR DELETE USING (("public"."current_user_has_platform_permission"('platform_can_manage_admins'::"text") AND ("user_id" <> "auth"."uid"())));



CREATE POLICY "platform_admins_insert" ON "public"."platform_admins" FOR INSERT WITH CHECK ("public"."current_user_has_platform_permission"('platform_can_manage_admins'::"text"));



CREATE POLICY "platform_admins_select" ON "public"."platform_admins" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."current_user_is_admin"()));



CREATE POLICY "platform_admins_update" ON "public"."platform_admins" FOR UPDATE USING ("public"."current_user_has_platform_permission"('platform_can_manage_admins'::"text")) WITH CHECK ("public"."current_user_has_platform_permission"('platform_can_manage_admins'::"text"));



ALTER TABLE "public"."platform_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "platform_audit_log_insert" ON "public"."platform_audit_log" FOR INSERT WITH CHECK ("public"."current_user_is_admin"());



CREATE POLICY "platform_audit_log_select" ON "public"."platform_audit_log" FOR SELECT USING ("public"."current_user_has_platform_permission"('platform_can_view_audit_log'::"text"));



ALTER TABLE "public"."platform_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "platform_settings_select" ON "public"."platform_settings" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "platform_settings_write" ON "public"."platform_settings" USING ("public"."current_user_has_platform_permission"('platform_can_edit_seed_data'::"text")) WITH CHECK ("public"."current_user_has_platform_permission"('platform_can_edit_seed_data'::"text"));



ALTER TABLE "public"."quotas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "quotas_read_own" ON "public"."quotas" FOR SELECT TO "authenticated" USING ((("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()));



CREATE POLICY "quotas_write_admin" ON "public"."quotas" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



ALTER TABLE "public"."sales_channel" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_channel_read" ON "public"."sales_channel" FOR SELECT TO "authenticated" USING (("account_id" = ANY ("public"."current_user_account_ids"())));



CREATE POLICY "sales_channel_write" ON "public"."sales_channel" TO "authenticated" USING ("public"."current_user_is_admin_of"("account_id")) WITH CHECK ("public"."current_user_is_admin_of"("account_id"));



ALTER TABLE "public"."schedules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedules_read" ON "public"."schedules" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "schedules"."location_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "schedules_write" ON "public"."schedules" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "schedules"."location_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "schedules"."location_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



ALTER TABLE "public"."security_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "security_audit_log_insert" ON "public"."security_audit_log" FOR INSERT TO "authenticated", "anon" WITH CHECK ((("actor_user_id" IS NULL) OR ("actor_user_id" = "auth"."uid"())));



CREATE POLICY "security_audit_log_read" ON "public"."security_audit_log" FOR SELECT TO "authenticated" USING ("public"."current_user_is_admin"());



ALTER TABLE "public"."shift_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shift_assignments_read" ON "public"."shift_assignments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "shift_assignments"."employee_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "shift_assignments_write" ON "public"."shift_assignments" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "shift_assignments"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "shift_assignments"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



ALTER TABLE "public"."shift_minimums" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shift_minimums_read" ON "public"."shift_minimums" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "shift_minimums"."location_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "shift_minimums_write" ON "public"."shift_minimums" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "shift_minimums"."location_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "shift_minimums"."location_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



ALTER TABLE "public"."shift_swap_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shift_swap_requests_delete" ON "public"."shift_swap_requests" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "shift_swap_requests"."requester_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



CREATE POLICY "shift_swap_requests_insert" ON "public"."shift_swap_requests" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "shift_swap_requests"."requester_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "shift_swap_requests_modify" ON "public"."shift_swap_requests" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "shift_swap_requests"."requester_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "shift_swap_requests"."requester_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



CREATE POLICY "shift_swap_requests_read" ON "public"."shift_swap_requests" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "shift_swap_requests"."requester_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



ALTER TABLE "public"."shift_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shift_templates_read" ON "public"."shift_templates" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "shift_templates"."location_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "shift_templates_write" ON "public"."shift_templates" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "shift_templates"."location_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "shift_templates"."location_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



ALTER TABLE "public"."shift_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shift_types_read" ON "public"."shift_types" FOR SELECT TO "authenticated" USING (("account_id" = ANY ("public"."current_user_account_ids"())));



CREATE POLICY "shift_types_write" ON "public"."shift_types" TO "authenticated" USING ("public"."current_user_is_admin_of"("account_id")) WITH CHECK ("public"."current_user_is_admin_of"("account_id"));



ALTER TABLE "public"."submodules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "submodules_read_all" ON "public"."submodules" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "submodules_write_admin" ON "public"."submodules" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



ALTER TABLE "public"."subscription_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscription_items_read_own" ON "public"."subscription_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."subscriptions" "s"
  WHERE (("s"."id" = "subscription_items"."subscription_id") AND (("s"."account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"())))));



CREATE POLICY "subscription_items_write_admin" ON "public"."subscription_items" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscriptions_read_own" ON "public"."subscriptions" FOR SELECT TO "authenticated" USING ((("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()));



CREATE POLICY "subscriptions_write_admin" ON "public"."subscriptions" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



ALTER TABLE "public"."usage_counters" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usage_counters_read_own" ON "public"."usage_counters" FOR SELECT TO "authenticated" USING ((("account_id" = ANY ("public"."current_user_account_ids"())) OR "public"."current_user_is_admin"()));



CREATE POLICY "usage_counters_write_admin" ON "public"."usage_counters" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_profiles_delete" ON "public"."user_profiles" FOR DELETE TO "authenticated" USING ("public"."current_user_is_admin_of"("account_id"));



CREATE POLICY "user_profiles_insert" ON "public"."user_profiles" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_is_admin_of"("account_id"));



CREATE POLICY "user_profiles_read" ON "public"."user_profiles" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."current_user_is_admin_or_manager_of"("account_id") OR "public"."current_user_is_admin"()));



CREATE POLICY "user_profiles_update" ON "public"."user_profiles" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."current_user_is_admin_of"("account_id"))) WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."current_user_is_admin_of"("account_id")));



ALTER TABLE "public"."vacation_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vacation_settings_read" ON "public"."vacation_settings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "vacation_settings"."employee_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "vacation_settings_write" ON "public"."vacation_settings" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "vacation_settings"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "vacation_settings"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



ALTER TABLE "public"."vacations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vacations_read" ON "public"."vacations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "vacations"."employee_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "vacations_write" ON "public"."vacations" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "vacations"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "vacations"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



ALTER TABLE "public"."weekly_availability" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "weekly_availability_read" ON "public"."weekly_availability" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "weekly_availability"."employee_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "weekly_availability_write" ON "public"."weekly_availability" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "weekly_availability"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."employees" "e"
     JOIN "public"."locations" "l" ON (("l"."id" = "e"."location_id")))
  WHERE (("e"."id" = "weekly_availability"."employee_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));



ALTER TABLE "public"."weekly_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "weekly_plans_read" ON "public"."weekly_plans" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "weekly_plans"."location_id") AND ("l"."account_id" = ANY ("public"."current_user_account_ids"()))))));



CREATE POLICY "weekly_plans_write" ON "public"."weekly_plans" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "weekly_plans"."location_id") AND "public"."current_user_is_admin_of"("l"."account_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "weekly_plans"."location_id") AND "public"."current_user_is_admin_of"("l"."account_id")))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."app_settings";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."clock_entries";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."documents";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."employee_availability";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."employees";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."location_planning";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."locations";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."monthly_balance_closures";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."open_shift_requests";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."open_shifts";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."schedules";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."shift_assignments";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."shift_minimums";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."shift_templates";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."shift_types";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."vacation_settings";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."vacations";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."weekly_availability";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."weekly_plans";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";











































































































































































GRANT ALL ON FUNCTION "public"."appcc_calc_response_validation"() TO "anon";
GRANT ALL ON FUNCTION "public"."appcc_calc_response_validation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."appcc_calc_response_validation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."appcc_handle_response_incident"() TO "anon";
GRANT ALL ON FUNCTION "public"."appcc_handle_response_incident"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."appcc_handle_response_incident"() TO "service_role";



GRANT ALL ON FUNCTION "public"."appcc_mark_overdue"() TO "anon";
GRANT ALL ON FUNCTION "public"."appcc_mark_overdue"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."appcc_mark_overdue"() TO "service_role";



GRANT ALL ON FUNCTION "public"."belongs_to_account"("p_account_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."belongs_to_account"("p_account_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."belongs_to_account"("p_account_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_auth_rate_limits"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_auth_rate_limits"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_auth_rate_limits"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_account_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_account_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_account_ids"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_has_platform_permission"("p_permission_flag" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_has_platform_permission"("p_permission_flag" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_has_platform_permission"("p_permission_flag" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_is_admin_of"("p_account_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_is_admin_of"("p_account_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_is_admin_of"("p_account_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_is_admin_or_manager_of"("p_account_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_is_admin_or_manager_of"("p_account_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_is_admin_or_manager_of"("p_account_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "supabase_auth_admin";



GRANT ALL ON FUNCTION "public"."force_close_long_impersonations"() TO "anon";
GRANT ALL ON FUNCTION "public"."force_close_long_impersonations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."force_close_long_impersonations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_permission"("p_account_id" "uuid", "p_permission_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_permission"("p_account_id" "uuid", "p_permission_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_permission"("p_account_id" "uuid", "p_permission_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_last_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_last_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_last_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."replicate_system_permission_sets"() TO "anon";
GRANT ALL ON FUNCTION "public"."replicate_system_permission_sets"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."replicate_system_permission_sets"() TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_appcc_for_account"("p_account_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."seed_appcc_for_account"("p_account_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_appcc_for_account"("p_account_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_seed_appcc_on_account_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_seed_appcc_on_account_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_seed_appcc_on_account_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_formations_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_formations_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_formations_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_swap_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_swap_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_swap_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_profile_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_profile_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_profile_updated_at"() TO "service_role";
























GRANT ALL ON TABLE "public"."_backup_20260516_accounts" TO "anon";
GRANT ALL ON TABLE "public"."_backup_20260516_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_20260516_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_20260516_accounts_pre_slug" TO "anon";
GRANT ALL ON TABLE "public"."_backup_20260516_accounts_pre_slug" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_20260516_accounts_pre_slug" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_20260516_billing_plans" TO "anon";
GRANT ALL ON TABLE "public"."_backup_20260516_billing_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_20260516_billing_plans" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_20260516_feature_flags" TO "anon";
GRANT ALL ON TABLE "public"."_backup_20260516_feature_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_20260516_feature_flags" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_20260516_functions" TO "anon";
GRANT ALL ON TABLE "public"."_backup_20260516_functions" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_20260516_functions" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_20260516_modules" TO "anon";
GRANT ALL ON TABLE "public"."_backup_20260516_modules" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_20260516_modules" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_20260516_policies" TO "anon";
GRANT ALL ON TABLE "public"."_backup_20260516_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_20260516_policies" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_20260516_submodules" TO "anon";
GRANT ALL ON TABLE "public"."_backup_20260516_submodules" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_20260516_submodules" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_20260516_user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."_backup_20260516_user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_20260516_user_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_20260517_user_profiles_read_policy" TO "anon";
GRANT ALL ON TABLE "public"."_backup_20260517_user_profiles_read_policy" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_20260517_user_profiles_read_policy" TO "service_role";



GRANT ALL ON TABLE "public"."accounts" TO "anon";
GRANT ALL ON TABLE "public"."accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."accounts" TO "service_role";
GRANT SELECT ON TABLE "public"."accounts" TO "supabase_auth_admin";



GRANT ALL ON TABLE "public"."analysis_account" TO "anon";
GRANT ALL ON TABLE "public"."analysis_account" TO "authenticated";
GRANT ALL ON TABLE "public"."analysis_account" TO "service_role";



GRANT ALL ON TABLE "public"."app_settings" TO "anon";
GRANT ALL ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_audit_items" TO "anon";
GRANT ALL ON TABLE "public"."appcc_audit_items" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_audit_items" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."appcc_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_audit_response_photos" TO "anon";
GRANT ALL ON TABLE "public"."appcc_audit_response_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_audit_response_photos" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_audit_responses" TO "anon";
GRANT ALL ON TABLE "public"."appcc_audit_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_audit_responses" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_audit_schedules" TO "anon";
GRANT ALL ON TABLE "public"."appcc_audit_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_audit_schedules" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_audit_sections" TO "anon";
GRANT ALL ON TABLE "public"."appcc_audit_sections" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_audit_sections" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_audit_templates" TO "anon";
GRANT ALL ON TABLE "public"."appcc_audit_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_audit_templates" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_audits" TO "anon";
GRANT ALL ON TABLE "public"."appcc_audits" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_audits" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_execution_photos" TO "anon";
GRANT ALL ON TABLE "public"."appcc_execution_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_execution_photos" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_execution_responses" TO "anon";
GRANT ALL ON TABLE "public"."appcc_execution_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_execution_responses" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_executions" TO "anon";
GRANT ALL ON TABLE "public"."appcc_executions" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_executions" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_incident_actions" TO "anon";
GRANT ALL ON TABLE "public"."appcc_incident_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_incident_actions" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_incident_events" TO "anon";
GRANT ALL ON TABLE "public"."appcc_incident_events" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_incident_events" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_incident_photos" TO "anon";
GRANT ALL ON TABLE "public"."appcc_incident_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_incident_photos" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_incidents" TO "anon";
GRANT ALL ON TABLE "public"."appcc_incidents" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_incidents" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_notifications" TO "anon";
GRANT ALL ON TABLE "public"."appcc_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_plans" TO "anon";
GRANT ALL ON TABLE "public"."appcc_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_plans" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_schedule_responsibles" TO "anon";
GRANT ALL ON TABLE "public"."appcc_schedule_responsibles" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_schedule_responsibles" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_schedules" TO "anon";
GRANT ALL ON TABLE "public"."appcc_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_schedules" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_signatures" TO "anon";
GRANT ALL ON TABLE "public"."appcc_signatures" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_signatures" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_template_item_options" TO "anon";
GRANT ALL ON TABLE "public"."appcc_template_item_options" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_template_item_options" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_template_items" TO "anon";
GRANT ALL ON TABLE "public"."appcc_template_items" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_template_items" TO "service_role";



GRANT ALL ON TABLE "public"."appcc_templates" TO "anon";
GRANT ALL ON TABLE "public"."appcc_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."appcc_templates" TO "service_role";



GRANT ALL ON TABLE "public"."auth_rate_limits" TO "anon";
GRANT ALL ON TABLE "public"."auth_rate_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."auth_rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."billing_events" TO "anon";
GRANT ALL ON TABLE "public"."billing_events" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_events" TO "service_role";



GRANT ALL ON TABLE "public"."billing_plans" TO "anon";
GRANT ALL ON TABLE "public"."billing_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_plans" TO "service_role";



GRANT ALL ON TABLE "public"."brand" TO "anon";
GRANT ALL ON TABLE "public"."brand" TO "authenticated";
GRANT ALL ON TABLE "public"."brand" TO "service_role";



GRANT ALL ON TABLE "public"."brand_location_availability" TO "anon";
GRANT ALL ON TABLE "public"."brand_location_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_location_availability" TO "service_role";



GRANT ALL ON TABLE "public"."clock_entries" TO "anon";
GRANT ALL ON TABLE "public"."clock_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."clock_entries" TO "service_role";



GRANT ALL ON TABLE "public"."cost_center" TO "anon";
GRANT ALL ON TABLE "public"."cost_center" TO "authenticated";
GRANT ALL ON TABLE "public"."cost_center" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON TABLE "public"."domain_events" TO "anon";
GRANT ALL ON TABLE "public"."domain_events" TO "authenticated";
GRANT ALL ON TABLE "public"."domain_events" TO "service_role";



GRANT ALL ON TABLE "public"."employee_availability" TO "anon";
GRANT ALL ON TABLE "public"."employee_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_availability" TO "service_role";



GRANT ALL ON TABLE "public"."employee_formations" TO "anon";
GRANT ALL ON TABLE "public"."employee_formations" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_formations" TO "service_role";



GRANT ALL ON TABLE "public"."employee_notifications" TO "anon";
GRANT ALL ON TABLE "public"."employee_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."employees" TO "anon";
GRANT ALL ON TABLE "public"."employees" TO "authenticated";
GRANT ALL ON TABLE "public"."employees" TO "service_role";



GRANT ALL ON TABLE "public"."feature_flags" TO "anon";
GRANT ALL ON TABLE "public"."feature_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."feature_flags" TO "service_role";



GRANT ALL ON TABLE "public"."impersonation_sessions" TO "anon";
GRANT ALL ON TABLE "public"."impersonation_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."impersonation_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON TABLE "public"."location_planning" TO "anon";
GRANT ALL ON TABLE "public"."location_planning" TO "authenticated";
GRANT ALL ON TABLE "public"."location_planning" TO "service_role";



GRANT ALL ON TABLE "public"."locations" TO "anon";
GRANT ALL ON TABLE "public"."locations" TO "authenticated";
GRANT ALL ON TABLE "public"."locations" TO "service_role";



GRANT ALL ON TABLE "public"."manager_locations" TO "anon";
GRANT ALL ON TABLE "public"."manager_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."manager_locations" TO "service_role";



GRANT ALL ON TABLE "public"."manager_permissions" TO "anon";
GRANT ALL ON TABLE "public"."manager_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."manager_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."modules" TO "anon";
GRANT ALL ON TABLE "public"."modules" TO "authenticated";
GRANT ALL ON TABLE "public"."modules" TO "service_role";



GRANT ALL ON TABLE "public"."monthly_balance_closures" TO "anon";
GRANT ALL ON TABLE "public"."monthly_balance_closures" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_balance_closures" TO "service_role";



GRANT ALL ON TABLE "public"."open_shift_requests" TO "anon";
GRANT ALL ON TABLE "public"."open_shift_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."open_shift_requests" TO "service_role";



GRANT ALL ON TABLE "public"."open_shifts" TO "anon";
GRANT ALL ON TABLE "public"."open_shifts" TO "authenticated";
GRANT ALL ON TABLE "public"."open_shifts" TO "service_role";



GRANT ALL ON TABLE "public"."permission_set_assignments" TO "anon";
GRANT ALL ON TABLE "public"."permission_set_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."permission_set_assignments" TO "service_role";
GRANT SELECT ON TABLE "public"."permission_set_assignments" TO "supabase_auth_admin";



GRANT ALL ON TABLE "public"."permission_sets" TO "anon";
GRANT ALL ON TABLE "public"."permission_sets" TO "authenticated";
GRANT ALL ON TABLE "public"."permission_sets" TO "service_role";



GRANT ALL ON TABLE "public"."platform_admin_2fa" TO "anon";
GRANT ALL ON TABLE "public"."platform_admin_2fa" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_admin_2fa" TO "service_role";



GRANT ALL ON TABLE "public"."platform_admin_permissions" TO "anon";
GRANT ALL ON TABLE "public"."platform_admin_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_admin_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."platform_admins" TO "anon";
GRANT ALL ON TABLE "public"."platform_admins" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_admins" TO "service_role";
GRANT SELECT ON TABLE "public"."platform_admins" TO "supabase_auth_admin";



GRANT ALL ON TABLE "public"."platform_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."platform_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."platform_settings" TO "anon";
GRANT ALL ON TABLE "public"."platform_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_settings" TO "service_role";



GRANT ALL ON TABLE "public"."quotas" TO "anon";
GRANT ALL ON TABLE "public"."quotas" TO "authenticated";
GRANT ALL ON TABLE "public"."quotas" TO "service_role";



GRANT ALL ON TABLE "public"."sales_channel" TO "anon";
GRANT ALL ON TABLE "public"."sales_channel" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_channel" TO "service_role";



GRANT ALL ON TABLE "public"."schedules" TO "anon";
GRANT ALL ON TABLE "public"."schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."schedules" TO "service_role";



GRANT ALL ON TABLE "public"."security_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."security_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."security_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."shift_assignments" TO "anon";
GRANT ALL ON TABLE "public"."shift_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."shift_minimums" TO "anon";
GRANT ALL ON TABLE "public"."shift_minimums" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_minimums" TO "service_role";



GRANT ALL ON TABLE "public"."shift_swap_requests" TO "anon";
GRANT ALL ON TABLE "public"."shift_swap_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_swap_requests" TO "service_role";



GRANT ALL ON TABLE "public"."shift_templates" TO "anon";
GRANT ALL ON TABLE "public"."shift_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_templates" TO "service_role";



GRANT ALL ON TABLE "public"."shift_types" TO "anon";
GRANT ALL ON TABLE "public"."shift_types" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_types" TO "service_role";



GRANT ALL ON TABLE "public"."submodules" TO "anon";
GRANT ALL ON TABLE "public"."submodules" TO "authenticated";
GRANT ALL ON TABLE "public"."submodules" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_items" TO "anon";
GRANT ALL ON TABLE "public"."subscription_items" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_items" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."usage_counters" TO "anon";
GRANT ALL ON TABLE "public"."usage_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."usage_counters" TO "service_role";



GRANT ALL ON TABLE "public"."user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."user_profiles" TO "supabase_auth_admin";



GRANT ALL ON TABLE "public"."vacation_settings" TO "anon";
GRANT ALL ON TABLE "public"."vacation_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."vacation_settings" TO "service_role";



GRANT ALL ON TABLE "public"."vacations" TO "anon";
GRANT ALL ON TABLE "public"."vacations" TO "authenticated";
GRANT ALL ON TABLE "public"."vacations" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_availability" TO "anon";
GRANT ALL ON TABLE "public"."weekly_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_availability" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_plans" TO "anon";
GRANT ALL ON TABLE "public"."weekly_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_plans" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































