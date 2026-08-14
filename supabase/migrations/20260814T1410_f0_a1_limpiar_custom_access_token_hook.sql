-- 20260814T1410_f0_a1_limpiar_custom_access_token_hook.sql
-- ENCARGO CODE (14/08) feat/f0-responsable-de-local, Tramo A.1 (hallazgo
-- propio durante el RECON, no pedido literal del encargo — mismo motivo:
-- "código muerto que MIENTE").
-- Aplicada: 14/08/2026 vía MCP, verificada invocando el hook directamente.
--
-- custom_access_token_hook (Auth Hook, corre en cada login/refresh de cada
-- usuario de la plataforma) leía permission_set_assignments en su paso 6
-- para poblar el claim folvy.permission_set_id. Verificado: NINGÚN
-- consumidor del cliente lee ese claim para tomar decisiones de permisos
-- (usePermissions/AppContext usan get_effective_permissions, no este
-- claim; los hits de "permission_set_id" en useAuth.ts/check-account-status
-- son solo el tipo que refleja el claim, no una lectura propia).
--
-- Tras el drop de la migración anterior, esta consulta ya no rompía el
-- login (el BEGIN/EXCEPTION la atrapaba — verificado invocando el hook
-- directamente con un event sintético antes de este cambio: devolvió un
-- JWT válido con permission_set_id=null), pero dejaba un RAISE WARNING en
-- el log de Postgres en cada login/refresh, para siempre. Se quita el paso
-- muerto entero (la variable v_permission_set_id, la consulta y el campo
-- del claim) — no se parchea con un try/catch nuevo: ya no hay nada que
-- intentar.
--
-- Verificado antes/después: invocación directa del hook con un event
-- sintético da el mismo claim folvy.* (cuenta, rol, slug, session_max_age)
-- salvo por la ausencia de permission_set_id.

create or replace function public.custom_access_token_hook(event jsonb)
 returns jsonb
 language plpgsql
 stable
AS $function$
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
  -- 6. Calcular session_max_age (platform admin: 4h; normal: 7 días)
  -- ==========================================================
  IF v_is_platform_admin THEN
    v_session_max_age := 14400;   -- 4 horas en segundos
  ELSE
    v_session_max_age := 604800;  -- 7 días en segundos
  END IF;

  -- ==========================================================
  -- 7. Construir el claim folvy.*
  -- ==========================================================
  v_folvy_claim := jsonb_build_object(
    'is_platform_admin', v_is_platform_admin,
    'platform_admin_role', v_platform_admin_role,
    'current_account_id', v_current_account_id,
    'current_account_slug', v_current_account_slug,
    'current_account_role', v_current_account_role,
    'active_accounts', v_active_accounts,
    'impersonating', false,
    'real_user_id', null,
    'session_max_age', v_session_max_age
  );

  -- ==========================================================
  -- 8. Inyectar folvy.* en los claims y devolver el event modificado
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
$function$;

do $$
begin
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='custom_access_token_hook') ilike '%permission_set%' then
    raise exception 'A.1: custom_access_token_hook todavia menciona permission_set';
  end if;
end $$;
