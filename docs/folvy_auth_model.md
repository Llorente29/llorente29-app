# Folvy Auth Model — Modelo de autenticación detallado

**Fecha de cierre:** 18 de mayo de 2026 (Sesión 2)
**Versión:** 1.0
**Estado:** modelo aprobado, listo para ejecución técnica de Fase 0.
**Documentos complementarios:**
- `folvy_arquitectura_reconciliada.md` (Sesión 0).
- `folvy_v1_spec.md` (Sesión 1).
- `CONTEXTO_CLAUDE.md` versión P7-S0+.

---

## 0. Sobre este documento

Este documento es el **entregable de Sesión 2**: el modelo completo de autenticación y autorización de Folvy V1, en el nivel de detalle necesario para implementar Fase 0 sin improvisar.

**Lo que cubre:**

- Modelo de datos completo (tablas + columnas + relaciones + constraints + índices).
- Estructura de claims JWT y gestión de sesión.
- RLS policies tabla por tabla.
- Wireframes textuales de todas las pantallas de auth.
- Catálogo UI de ~60 permisos finos agrupado.
- Flujos extremo a extremo (11 viajes completos del usuario).
- Bus de eventos auth (qué emite, qué consume, quién escucha).
- Edge cases consolidados.
- Validaciones técnicas (performance budgets, cacheo, backups, observabilidad, compliance).

**Lo que NO cubre:**

- Migrations SQL ejecutables (las escribe Fase 0 técnica).
- Tests automatizados (Fase 0 técnica + V1.1+).
- Mockups visuales pixel-perfect (Fase 0 técnica).
- Estrategia comercial y pricing.

---

## 1. Principios firmes

Antes del detalle técnico, las reglas que estructuran todo el modelo.

### 1.1 — Multi-tenancy via account_id

Toda tabla operativa tiene columna `account_id`. Las únicas excepciones son tablas que viven en el **plano Folvy**: `platform_admins`, `platform_admin_permissions`, `platform_admin_2fa`, `platform_audit_log`, `platform_settings`, `auth_rate_limits`.

### 1.2 — Supabase Auth como fuente de verdad de identidad

`auth.users` (managed por Supabase) contiene email + password hash + email verification. **NUNCA replicamos estos campos.** `user_profiles` y `platform_admins` referencian `auth.users(id)` por FK.

### 1.3 — Un mismo auth.users puede ser N cosas simultáneamente

- User cliente en cuenta A (admin).
- User cliente en cuenta B (worker).
- Platform admin Folvy.

Los tres a la vez si así está configurado. Cada vínculo es una fila separada en su tabla.

### 1.4 — Soft delete obligatorio

`user_profiles.active`, `employees.active`, `accounts.deleted_at` con plazo de gracia. **Nunca hard delete** salvo anonimización RGPD documentada.

### 1.5 — Audit log append-only

Nunca se borra ni se edita. Retención mínima 12 meses operacional + 5 años legal.

### 1.6 — RLS activo en TODAS las tablas

Cero excepciones. Política por defecto = DENY.

### 1.7 — Defensa en profundidad

Frontend oculta, JWT firmado autentica, RLS autoriza, constraints validan. Cada capa falla cerrada.

---

## 2. Modelo de datos completo

### 2.1 — Tablas existentes confirmadas

Verificadas en código + auditoría BBDD:

```
auth.users                  (Supabase managed)
public.user_profiles        (multi-tenancy con role)
public.accounts             (cuentas cliente)
public.locations            (con account_id, lat, lng)
public.employees            (con location_id, PIN)
public.clock_entries
public.brands
public.security_audit_log
public.manager_locations
public.manager_permissions
public.centros_de_coste
public.canales_de_venta
public.cuentas_de_analisis
public.appcc_plans          (seed)
public.appcc_plan_templates (26 seed)
public.appcc_audits         (2 seed)
... (resto APPCC ya replicadas P6)
```

### 2.2 — Tablas nuevas a crear en Fase 0

#### `platform_admins`

```sql
CREATE TABLE platform_admins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       text NOT NULL,
  role            text NOT NULL CHECK (role IN ('ceo', 'senior_admin', 'admin', 'support')),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id),
  last_login_at   timestamptz,
  notes           text,
  
  CONSTRAINT platform_admins_user_unique UNIQUE (user_id)
);
```

**Roles:**
- `ceo` — máximos permisos (Julio).
- `senior_admin` — gestión de admins + decisiones críticas.
- `admin` — operativa habitual + impersonation.
- `support` — solo lectura + impersonation con motivo.

#### `platform_admin_permissions`

```sql
CREATE TABLE platform_admin_permissions (
  id                                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id                       uuid NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  platform_can_create_accounts            boolean NOT NULL DEFAULT false,
  platform_can_suspend_accounts           boolean NOT NULL DEFAULT false,
  platform_can_archive_accounts           boolean NOT NULL DEFAULT false,
  platform_can_delete_accounts            boolean NOT NULL DEFAULT false,
  platform_can_impersonate                boolean NOT NULL DEFAULT false,
  platform_can_manage_admins              boolean NOT NULL DEFAULT false,
  platform_can_reset_2fa_of_others        boolean NOT NULL DEFAULT false,
  platform_can_view_audit_log             boolean NOT NULL DEFAULT true,
  platform_can_edit_seed_data             boolean NOT NULL DEFAULT false,
  platform_can_view_system_health         boolean NOT NULL DEFAULT true,
  platform_can_send_global_notifications  boolean NOT NULL DEFAULT false,
  updated_at                              timestamptz NOT NULL DEFAULT now(),
  updated_by                              uuid REFERENCES auth.users(id),
  
  CONSTRAINT platform_admin_permissions_unique UNIQUE (platform_admin_id)
);
```

Defaults conservadores: nuevo platform admin solo ve audit + system health.

#### `platform_admin_2fa`

```sql
CREATE TABLE platform_admin_2fa (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id   uuid NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  totp_secret         text NOT NULL,  -- Encriptado con Supabase Vault
  backup_codes_hash   text[] NOT NULL DEFAULT ARRAY[]::text[],
  backup_codes_used   integer[] NOT NULL DEFAULT ARRAY[]::integer[],
  activated_at        timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz,
  
  CONSTRAINT platform_admin_2fa_unique UNIQUE (platform_admin_id),
  CONSTRAINT platform_admin_2fa_backup_codes_size CHECK (array_length(backup_codes_hash, 1) = 10)
);
```

**Backup codes:** 10 códigos alfanuméricos de 8 chars generados al activar. Hash bcrypt en BBDD, original mostrado UNA vez al admin.

#### `auth_rate_limits`

```sql
CREATE TABLE auth_rate_limits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  attempts        integer NOT NULL DEFAULT 1,
  first_attempt   timestamptz NOT NULL DEFAULT now(),
  locked_until    timestamptz,
  ip_address      inet,
  user_agent      text,
  
  CONSTRAINT auth_rate_limits_email_window UNIQUE (email),
  CONSTRAINT auth_rate_limits_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  CONSTRAINT auth_rate_limits_attempts_positive CHECK (attempts >= 1)
);
```

Cleanup cron diario: borra registros con `first_attempt < now() - interval '24 hours'`.

#### `impersonation_sessions`

```sql
CREATE TABLE impersonation_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id   uuid NOT NULL REFERENCES platform_admins(id),
  target_user_id      uuid NOT NULL REFERENCES auth.users(id),
  target_account_id   uuid NOT NULL REFERENCES accounts(id),
  reason              text NOT NULL,
  started_at          timestamptz NOT NULL DEFAULT now(),
  ended_at            timestamptz,
  ip_address          inet,
  user_agent          text,
  actions_taken       jsonb NOT NULL DEFAULT '[]'::jsonb,
  force_closed        boolean DEFAULT false,
  
  CONSTRAINT impersonation_reason_min_length CHECK (length(reason) >= 10),
  CONSTRAINT impersonation_max_duration CHECK (
    ended_at IS NULL OR ended_at <= started_at + interval '4 hours'
  ),
  CONSTRAINT impersonation_chronology CHECK (ended_at IS NULL OR ended_at >= started_at)
);
```

**`actions_taken` jsonb:** array de acciones durante la sesión con timestamps.

#### `permission_sets`

```sql
CREATE TABLE permission_sets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid REFERENCES accounts(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  is_system       boolean NOT NULL DEFAULT false,
  permissions     jsonb NOT NULL DEFAULT '{}'::jsonb,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id),
  
  CONSTRAINT permission_sets_name_account_unique UNIQUE (account_id, name),
  CONSTRAINT permission_sets_name_min_length CHECK (length(name) >= 3 AND length(name) <= 60),
  CONSTRAINT permission_sets_system_immutable_active CHECK (NOT (is_system = true AND active = false)),
  CONSTRAINT permission_sets_permissions_is_object CHECK (jsonb_typeof(permissions) = 'object')
);
```

**Los 4 sets system precargados** (`is_system = true`) viven con `account_id = NULL` como plantillas globales. Trigger los replica a cuentas nuevas:

- `gerente_total` (~50 permisos)
- `encargado_sala` (~18 permisos)
- `encargado_appcc` (~25 permisos)
- `gestor_rrhh` (~14 permisos)

#### `permission_set_assignments`

```sql
CREATE TABLE permission_set_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id   uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  permission_set_id uuid NOT NULL REFERENCES permission_sets(id) ON DELETE CASCADE,
  assigned_at       timestamptz NOT NULL DEFAULT now(),
  assigned_by       uuid REFERENCES auth.users(id),
  
  CONSTRAINT permission_set_assignments_unique UNIQUE (user_profile_id)
);
```

**Un user_profile = un set asignado.** Override individual via `manager_permissions` existente.

**Resolución del permiso final:**
1. Sistema carga el set asignado al user_profile.
2. Carga overrides en `manager_permissions`.
3. Override gana sobre set.

#### `platform_audit_log`

```sql
CREATE TABLE platform_audit_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id   uuid REFERENCES platform_admins(id),
  event_type          text NOT NULL,
  target_account_id   uuid REFERENCES accounts(id),
  target_user_id      uuid REFERENCES auth.users(id),
  details             jsonb,
  ip_address          inet,
  user_agent          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
```

**Event types:** `account_created`, `account_suspended`, `account_archived`, `account_deleted`, `impersonation_started`, `impersonation_ended`, `admin_created`, `admin_suspended`, `admin_2fa_reset`, `seed_data_modified`, `system_config_changed`.

#### `platform_settings`

```sql
CREATE TABLE platform_settings (
  key             text PRIMARY KEY,
  value           jsonb NOT NULL,
  description     text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES auth.users(id)
);
```

**Settings iniciales:** `platform_version`, `email_templates`, `default_permission_sets`, `holiday_calendar_spain_2026`, `seed_appcc_plans_version`, `feature_flags_global`.

### 2.3 — Cambios a tablas existentes

#### `accounts`

```sql
ALTER TABLE accounts ADD COLUMN suspended_at timestamptz;
ALTER TABLE accounts ADD COLUMN suspended_by uuid REFERENCES auth.users(id);
ALTER TABLE accounts ADD COLUMN suspension_reason text;
ALTER TABLE accounts ADD COLUMN archived_at timestamptz;
ALTER TABLE accounts ADD COLUMN deleted_at timestamptz;
ALTER TABLE accounts ADD COLUMN feature_flags jsonb DEFAULT '{}'::jsonb;
ALTER TABLE accounts ADD COLUMN plan_id text DEFAULT 'folvy_v1';
ALTER TABLE accounts ADD COLUMN slug text UNIQUE;
ALTER TABLE accounts ADD COLUMN fiscal_data jsonb DEFAULT '{}'::jsonb;

ALTER TABLE accounts ADD CONSTRAINT accounts_slug_format
  CHECK (slug ~* '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' AND length(slug) BETWEEN 3 AND 50);

ALTER TABLE accounts ADD CONSTRAINT accounts_suspended_consistency
  CHECK (
    (suspended_at IS NULL AND suspended_by IS NULL AND suspension_reason IS NULL)
    OR (suspended_at IS NOT NULL AND suspended_by IS NOT NULL)
  );
```

#### `user_profiles`

```sql
ALTER TABLE user_profiles ADD COLUMN terms_accepted_at timestamptz;
ALTER TABLE user_profiles ADD COLUMN welcome_completed_at timestamptz;
ALTER TABLE user_profiles ADD COLUMN last_password_change_at timestamptz;
ALTER TABLE user_profiles ADD COLUMN last_login_at timestamptz;
ALTER TABLE user_profiles ADD COLUMN active boolean DEFAULT true;
ALTER TABLE user_profiles ADD COLUMN suspended_at timestamptz;
ALTER TABLE user_profiles ADD COLUMN suspended_by uuid REFERENCES auth.users(id);

ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_valid
  CHECK (role IN ('admin', 'manager', 'worker'));

ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_unique_per_account
  UNIQUE (user_id, account_id);

ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_welcome_requires_terms
  CHECK (
    welcome_completed_at IS NULL 
    OR (welcome_completed_at IS NOT NULL AND terms_accepted_at IS NOT NULL 
        AND terms_accepted_at <= welcome_completed_at)
  );
```

### 2.4 — Diagrama de relaciones

```
auth.users (Supabase managed)
    │
    ├── user_profiles (cliente: 1 row por (user_id, account_id))
    │       │
    │       ├── manager_locations (qué locales gestiona)
    │       │
    │       ├── manager_permissions (overrides individuales)
    │       │
    │       └── permission_set_assignments → permission_sets
    │
    └── platform_admins (Folvy interno: 1 row por user_id global)
            │
            ├── platform_admin_permissions (11 flags)
            │
            ├── platform_admin_2fa
            │
            └── impersonation_sessions (cuando actúa "como" cliente)


accounts
    ├── locations
    ├── employees
    ├── permission_sets (4 system + custom)
    └── feature_flags jsonb


platform_settings (globales Folvy, sin account_id)
```

### 2.5 — Triggers necesarios

#### Trigger 1: Replicar permission_sets system a cuenta nueva

```sql
CREATE OR REPLACE FUNCTION replicate_system_permission_sets()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO permission_sets (account_id, name, description, is_system, permissions)
  SELECT NEW.id, name, description, true, permissions
  FROM permission_sets
  WHERE is_system = true AND account_id IS NULL;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_replicate_permission_sets
AFTER INSERT ON accounts
FOR EACH ROW
EXECUTE FUNCTION replicate_system_permission_sets();
```

#### Trigger 2: Auto-set updated_at

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Aplicar a `permission_sets`, `platform_settings`, etc.

#### Trigger 3: Proteger último admin

```sql
CREATE OR REPLACE FUNCTION protect_last_admin()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.role = 'admin' AND (NEW.role != 'admin' OR NEW.active = false) THEN
    IF (SELECT COUNT(*) FROM user_profiles
        WHERE account_id = OLD.account_id
          AND role = 'admin'
          AND active = true
          AND id != OLD.id) = 0 THEN
      RAISE EXCEPTION 'No se puede quitar el último admin de la cuenta';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_last_admin
BEFORE UPDATE ON user_profiles
FOR EACH ROW
WHEN (OLD.role = 'admin')
EXECUTE FUNCTION protect_last_admin();
```

#### Funciones de cleanup periódico

```sql
-- Cron diario (via pg_cron Supabase Pro)
CREATE OR REPLACE FUNCTION cleanup_auth_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM auth_rate_limits
  WHERE first_attempt < now() - interval '24 hours';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION force_close_long_impersonations()
RETURNS void AS $$
BEGIN
  UPDATE impersonation_sessions
  SET ended_at = now(), force_closed = true
  WHERE ended_at IS NULL
    AND started_at < now() - interval '4 hours';
END;
$$ LANGUAGE plpgsql;
```

---

## 3. Claims JWT y gestión de sesión

### 3.1 — Estructura completa del JWT

```json
{
  // Claims estándar Supabase
  "aud": "authenticated",
  "exp": 1747752000,
  "iat": 1747748400,
  "iss": "https://xzmpnchlguibclvxyynt.supabase.co/auth/v1",
  "sub": "uuid-del-user",
  "email": "julio@idasal.com",
  "role": "authenticated",
  "aal": "aal1",
  "session_id": "uuid-session",
  
  // Claims Folvy custom (vía Auth Hook)
  "folvy": {
    "is_platform_admin": false,
    "platform_admin_role": null,
    "current_account_id": "uuid-account",
    "current_account_slug": "llorente29",
    "current_account_role": "admin",
    "active_accounts": [
      {"id": "uuid-1", "slug": "llorente29", "role": "admin"},
      {"id": "uuid-2", "slug": "otro-cliente", "role": "manager"}
    ],
    "permission_set_id": "uuid-set",
    "impersonating": false,
    "real_user_id": null,
    "session_max_age": 604800
  }
}
```

### 3.2 — Edge Function `custom-access-token-hook`

```typescript
async function customAccessTokenHook(event: HookEvent) {
  const { user_id } = event.user
  
  const platformAdmin = await supabaseAdmin
    .from('platform_admins')
    .select('id, role, active')
    .eq('user_id', user_id)
    .eq('active', true)
    .single()
  
  const profiles = await supabaseAdmin
    .from('user_profiles')
    .select('account_id, role, accounts(slug, suspended_at)')
    .eq('user_id', user_id)
    .eq('active', true)
  
  let currentAccountId = null
  if (profiles.data?.length) {
    currentAccountId = await resolveCurrentAccount(user_id, profiles.data)
  }
  
  return {
    claims: {
      ...event.claims,
      folvy: {
        is_platform_admin: !!platformAdmin.data,
        platform_admin_role: platformAdmin.data?.role || null,
        current_account_id: currentAccountId,
        current_account_slug: ...,
        active_accounts: profiles.data?.filter(p => !p.accounts.suspended_at).map(...),
        permission_set_id: ...,
        impersonating: false,
        real_user_id: null,
        session_max_age: platformAdmin.data ? 14400 : 604800
      }
    }
  }
}
```

### 3.3 — Cuándo regenerar el JWT

| Evento | Acción |
|---|---|
| Cambio de cuenta activa (selector multi-cuenta) | NO regenerar. Cambio en localStorage. RLS valida en backend. |
| Cambio de rol del user | Forzar logout + re-login |
| Cambio de permission_set asignado | Refresh token via `supabaseClient.auth.refreshSession()` |
| Inicio de impersonation | NO regenerar JWT principal. Crear JWT secundario en sessionStorage |
| Fin de impersonation | Descartar JWT secundario, volver al principal |
| Cambio de email | Refresh token tras confirmación |
| Suspensión de cuenta | Invalidación forzada via `auth.admin.signOut(user_id)` |

### 3.4 — Duración de tokens

| Tipo | Access token | Refresh token |
|---|---|---|
| User cliente normal | 1 hora | 7 días |
| Platform admin | 1 hora | 4 horas |
| Impersonation (secundario) | 1 hora | NO REFRESH (sessionStorage) |

### 3.5 — Auto-refresh y detección de fallos

- Supabase JS auto-refresca cuando <60s para expirar.
- Si refresh falla → forzar logout + redirect `/login`.
- Si refresh OK pero user suspendido → backend devuelve 403 → frontend interpreta como sesión inválida.

### 3.6 — Helpers en cliente

```typescript
useAuth()        // session + isLoading + signOut + isPlatformAdmin
useAccount()     // current_account_id + slug
useMembership()  // role + permissions + isAdmin/isOwner
usePermission(flag: PermissionFlag): boolean
```

---

## 4. RLS policies

### 4.1 — Funciones auxiliares

```sql
CREATE OR REPLACE FUNCTION is_account_admin_or_manager(target_account_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid()
      AND account_id = target_account_id
      AND role IN ('admin', 'manager')
      AND active = true
  );
$$;

CREATE OR REPLACE FUNCTION belongs_to_account(target_account_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid()
      AND account_id = target_account_id
      AND active = true
  );
$$;

CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform_admins
    WHERE user_id = auth.uid()
      AND active = true
  );
$$;

CREATE OR REPLACE FUNCTION has_permission(target_account_id uuid, permission_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  -- Resolución cascada: override gana sobre set
  WITH user_profile AS (
    SELECT id, role FROM user_profiles
    WHERE user_id = auth.uid()
      AND account_id = target_account_id
      AND active = true
    LIMIT 1
  ),
  set_perms AS (
    SELECT (ps.permissions->>permission_key)::boolean as has_it
    FROM user_profile up
    JOIN permission_set_assignments psa ON psa.user_profile_id = up.id
    JOIN permission_sets ps ON ps.id = psa.permission_set_id
  ),
  override_perms AS (
    SELECT (mp.permissions->>permission_key)::boolean as override
    FROM user_profile up
    JOIN manager_permissions mp ON mp.user_profile_id = up.id
  )
  SELECT COALESCE(
    (SELECT override FROM override_perms LIMIT 1),
    (SELECT has_it FROM set_perms LIMIT 1),
    false
  );
$$;
```

### 4.2 — Policies clave

**`accounts`:**

```sql
CREATE POLICY accounts_select ON accounts FOR SELECT
USING (belongs_to_account(id) OR is_platform_admin());

CREATE POLICY accounts_insert ON accounts FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM platform_admins pa
    JOIN platform_admin_permissions pap ON pap.platform_admin_id = pa.id
    WHERE pa.user_id = auth.uid()
      AND pa.active = true
      AND pap.platform_can_create_accounts = true
  )
);

CREATE POLICY accounts_update_admin ON accounts FOR UPDATE
USING (is_account_admin_or_manager(id));
```

**`user_profiles`:**

```sql
CREATE POLICY user_profiles_select ON user_profiles FOR SELECT
USING (
  user_id = auth.uid()
  OR is_account_admin_or_manager(account_id)
  OR is_platform_admin()
);

CREATE POLICY user_profiles_insert ON user_profiles FOR INSERT
WITH CHECK (
  is_account_admin_or_manager(NEW.account_id)
  OR is_platform_admin()
);

CREATE POLICY user_profiles_update_self ON user_profiles FOR UPDATE
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY user_profiles_update_admin ON user_profiles FOR UPDATE
USING (is_account_admin_or_manager(account_id));
```

**`platform_admins`:**

```sql
CREATE POLICY platform_admins_select ON platform_admins FOR SELECT
USING (user_id = auth.uid() OR is_platform_admin());

CREATE POLICY platform_admins_insert ON platform_admins FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM platform_admins pa
    JOIN platform_admin_permissions pap ON pap.platform_admin_id = pa.id
    WHERE pa.user_id = auth.uid()
      AND pa.active = true
      AND pap.platform_can_manage_admins = true
  )
);
```

**`impersonation_sessions`:**

```sql
CREATE POLICY impersonation_select ON impersonation_sessions FOR SELECT
USING (is_platform_admin());

CREATE POLICY impersonation_insert ON impersonation_sessions FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM platform_admins pa
    JOIN platform_admin_permissions pap ON pap.platform_admin_id = pa.id
    WHERE pa.id = NEW.platform_admin_id
      AND pa.user_id = auth.uid()
      AND pa.active = true
      AND pap.platform_can_impersonate = true
  )
  AND length(NEW.reason) >= 10
);
```

**`permission_sets`:**

```sql
CREATE POLICY permission_sets_select ON permission_sets FOR SELECT
USING (belongs_to_account(account_id) OR is_platform_admin());

CREATE POLICY permission_sets_modify ON permission_sets FOR ALL
USING (has_permission(account_id, 'can_manage_users'));
```

**`auth_rate_limits`:**

```sql
CREATE POLICY rate_limits_deny_all ON auth_rate_limits FOR ALL USING (false);
-- Solo backend via service role accede.
```

**`security_audit_log`:**

```sql
CREATE POLICY audit_log_select_account ON security_audit_log FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_profiles up_actor
    JOIN user_profiles up_self ON up_self.account_id = up_actor.account_id
    WHERE up_actor.user_id = security_audit_log.actor_user_id
      AND up_self.user_id = auth.uid()
      AND up_self.role = 'admin'
      AND up_self.active = true
  )
  OR is_platform_admin()
);

CREATE POLICY audit_log_insert ON security_audit_log FOR INSERT
WITH CHECK (actor_user_id = auth.uid());
```

**`platform_audit_log`:**

```sql
CREATE POLICY platform_audit_select ON platform_audit_log FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM platform_admins pa
    JOIN platform_admin_permissions pap ON pap.platform_admin_id = pa.id
    WHERE pa.user_id = auth.uid()
      AND pa.active = true
      AND pap.platform_can_view_audit_log = true
  )
);
```

### 4.3 — Patrón para resto de tablas operativas

```sql
-- SELECT
USING (
  account_id IN (
    SELECT account_id FROM user_profiles
    WHERE user_id = auth.uid() AND active = true
  )
)

-- INSERT/UPDATE
WITH CHECK (
  account_id IN (
    SELECT account_id FROM user_profiles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manager') AND active = true
  )
)
```

Refinamientos por tabla específica (`clock_entries`, `appcc_executions`, `shifts`): worker accede solo a sus propios registros + tareas asignadas + "unassigned" elegibles.

### 4.4 — Impersonation técnica

**Doble JWT con sessionStorage secundario:**

1. Platform admin pulsa "Impersonar" → Edge Function `start-impersonation`.
2. Edge Function valida permiso + genera JWT con `sub = target_user_id` + `folvy.impersonating = true` + `folvy.real_user_id = platform_admin_user_id`.
3. Cliente guarda JWT secundario en `sessionStorage`.
4. RLS evalúa `auth.uid()` = target_user, así que el platform admin actúa "como" el target.
5. Triggers de audit registran `real_user_id` además de `actor_user_id` cuando detectan `request.jwt.claims.folvy.impersonating = true`.
6. Al cerrar impersonation: `end-impersonation` actualiza `ended_at = now()` + frontend descarta JWT secundario.

---

## 5. Pantallas detalladas

Cobertura completa en wireframes textuales. Detalle exhaustivo en este apartado.

### 5.1 — `/login`

**Layout:** split horizontal 50/50 desktop, vertical mobile.

Lado izquierdo accent #1E3A5F: logo Folvy oscuro + "Hostelería profesional. Software profesional." + subtítulo.

Lado derecho page #F5F4F0: card centrado max-width 400px con:
- Título "Iniciar sesión".
- Input email (required, formato, max 254).
- Input contraseña con icono ojo (required, max 128).
- Link "¿Olvidaste tu contraseña?" → `/reset-password`.
- Botón "[Entrar]" (disabled si campos vacíos).
- Pie: "¿No tienes cuenta? Contacta con ventas".

**Estados:** initial, escribiendo, submit en curso, error credenciales, error rate limit, cuenta suspendida, user sin profile activo, network error.

**Comportamiento al cargar:** si sesión activa Supabase → redirect al dashboard correspondiente.

**Submit handler:** `signInWithPassword` + Edge Function `check-account-status` + redirect según role.

### 5.2 — `/welcome?token=XXX`

Pantalla A "Validando enlace..." con spinner.

Pantalla B "Configurar contraseña":
- Email pre-rellenado disabled.
- Input nueva contraseña con indicador fortaleza tiempo real.
- Input confirmar contraseña.
- Checkbox T&C + política de privacidad.
- Botón "[Activar cuenta]".

Pantallas error: "Caducado", "Ya activado", "Enlace inválido".

**Submit handler:** `updateUser({password})` + Edge Function `complete-welcome` → audit + redirect según role.

### 5.3 — `/reset-password` y `/reset-password/confirm`

`/reset-password`: input email + botón "[Enviar enlace]". Mensaje neutro siempre tras submit.

`/reset-password/confirm?token=XXX`: idéntico a welcome SIN checkbox T&C.

Token reset caducidad: 24 horas (vs 7 días welcome).

### 5.4 — `/_admin/login`

**Layout austero, fondo accent oscuro completo.** Card centrado con logo Folvy principal.

- Título "Folvy Admin" + subtítulo "⚠ Acceso restringido".
- Email + Contraseña + botón "[Acceder]".
- Sin recordarme, sin recovery.

**Submit handler:** signInWithPassword + verificar `platform_admins.active = true` → si NO → signOut inmediato. Si SÍ → Pantalla 2FA.

### 5.5 — `/_admin/2fa`

Card austero:
- Título "Verificación en dos pasos".
- Input 6 dígitos separados con autoadvance + paste 6 a la vez.
- Botón "[Verificar]".
- Link "Usar código de respaldo" → alterna a input single 8 chars alfanuméricos.

**Submit handler:** Edge Function `verify-2fa` valida TOTP. Tras 3 fallos consecutivos: signOut + redirect login.

### 5.6 — Activación inicial 2FA (primer login platform admin)

3 pantallas obligatorias:
1. Introducción + "[Empezar configuración]".
2. QR + secret + input verificación + "[Verificar y continuar]".
3. Backup codes: mostrar 10 en monospace + "[Descargar PDF]" + "[Copiar todos]" + checkbox "He guardado mis códigos" + "[Continuar al panel]" (disabled hasta checkbox).

**Sin "más tarde". Sin skip.**

### 5.7 — Panel admin

`/_admin/dashboard`: 4 tarjetas métricas + gráficos + top 5 alertas.

`/_admin/cuentas`: tabla paginable + filtros + búsqueda + botón "Nueva cuenta".

`/_admin/cuentas/nueva`: wizard horizontal 5 pasos con stepper visual.

`/_admin/cuentas/[id]`: tabs Resumen/Locales/Usuarios/Módulos/Integraciones/Facturación/Soporte/Audit/Acciones.

`/_admin/cuentas/[id]/impersonar`: modal con textarea motivo (min 10 chars) + botón "[Iniciar impersonation]".

**Banner persistente impersonation:** TopBar rojo/ámbar con texto "Estás impersonando como X de Y. Motivo: Z. Sesión inicia: HH:MM" + botón "[Cerrar impersonation]".

### 5.8 — Cerrar sesión y errores globales

- Menú avatar → "Cerrar sesión" → confirmación modal → signOut + cleanup + redirect.
- Sesión expirada mid-uso: toast naranja + redirect login tras 2s.
- Cuenta suspendida mid-uso: modal bloqueante "Tu cuenta ha sido suspendida" + signOut.
- Permission denied: toast rojo.

### 5.9 — Responsividad y localización

- Desktop >1024px: split horizontal.
- Tablet 640-1024px: split más estrecho.
- Mobile <640px: vertical 100%.

V1 español único. V2+ catalán/euskera/gallego/inglés.

---

## 6. Catálogo UI de permisos finos agrupado

Los ~60 permisos se agrupan en 3 niveles jerárquicos: módulo → sub-área → permiso individual.

### 6.1 — Bloque "FOLVY TEAM" (23 permisos)

**Gestión de personas (3):**
- `can_manage_employees` — Crear y editar empleados
- `can_see_salaries` — Ver salarios
- `can_view_personal_data_sensitive` — Ver datos sensibles (DNI, IBAN, NSS)

**Fichajes (3):**
- `can_view_clock_entries` — Ver fichajes del equipo
- `can_edit_clock_entries` — Editar fichajes (con motivo audit)
- `can_export_clock_entries` — Exportar fichajes

**Cuadrante y turnos (4):**
- `can_view_schedule` — Ver cuadrante
- `can_edit_schedule` — Editar cuadrante
- `can_publish_schedule` — Publicar cuadrante
- `can_create_schedule_template` — Crear plantillas de turnos

**Vacaciones y ausencias (3):**
- `can_approve_vacations` — Aprobar vacaciones y permisos
- `can_register_absences` — Registrar bajas y ausencias
- `can_configure_holidays` — Configurar calendario laboral

**Cambios de turno (3):**
- `can_approve_shift_swaps` — Aprobar cambios de turno
- `can_configure_swap_rules` — Configurar reglas de cambios
- `can_disable_marketplace` — Desactivar marketplace

**Bolsa de horas (5):**
- `can_view_balance_all` — Ver bolsa de todos
- `can_approve_time_recovery` — Aprobar recuperación de horas
- `can_pay_overtime` — Liquidar horas extra (afecta nómina)
- `can_adjust_balance_manually` — Ajustar saldo manualmente
- `can_configure_balance_rules` — Configurar reglas de bolsa

**Export gestoría (3):**
- `can_generate_payroll_export` — Generar cierre gestoría
- `can_publish_payroll_export` — Publicar y enviar (solo admin default)
- `can_configure_gestoria` — Configurar destinatarios

### 6.2 — Bloque "FOLVY SAFETY" (33 permisos)

**Planes APPCC (4):**
- `can_view_appcc_plans`, `can_activate_deactivate_plans`, `can_edit_plan_documentation`, `can_assign_plan_responsible`

**Plantillas y schedules (6):**
- `can_view_templates`, `can_create_custom_templates`, `can_edit_custom_templates`, `can_archive_templates`, `can_manage_schedules`, `can_pause_schedules`

**Ejecución de tareas (4):**
- `can_execute_appcc_tasks`, `can_take_unassigned_tasks`, `can_justify_missed_tasks`, `can_mark_retroactive_execution`

**Incidencias (7):**
- `can_register_incident`, `can_assign_incident`, `can_resolve_incident`, `can_verify_incident_resolution`, `can_close_incident`, `can_reopen_incident`, `can_delete_incident`

**Auditorías (7):**
- `can_view_audits`, `can_execute_internal_audit`, `can_register_external_audit`, `can_close_audit`, `can_reopen_audit`, `can_export_audit`, `can_share_audit_link_external`

**Carpeta APPCC y reportes (5):**
- `can_generate_appcc_folder`, `can_access_inspection_mode`, `can_view_compliance_dashboard`, `can_configure_alerts`, `can_share_folder_externally`

### 6.3 — Bloque "FOLVY SALES" (2 permisos)

- `can_view_sales_data` — Ver datos de ventas Last.app
- `can_configure_sales_adapter` — Configurar conexión Last.app

### 6.4 — Bloque "CONFIGURACIÓN" (6 permisos)

- `can_manage_brands`, `can_manage_locations`, `can_manage_users`, `can_configure_account_settings`, `can_view_audit_log`, `can_manage_billing`

### 6.5 — Bloque "PERMISOS DEL EMPLEADO" (toggles cuenta, no flags manager)

- `worker_can_clock_in_from_mobile` — Fichaje móvil (requiere geofencing)
- `worker_can_see_coworkers_in_shifts` — Ver compañeros en turnos
- `worker_can_edit_personal_data` — Editar datos personales
- `worker_can_edit_iban` — Editar IBAN propio

### 6.6 — UI del editor permission_set

Ruta: `/[slug]/configuracion/usuarios/sets/[set_id]`.

Tabs: **Información** | **Permisos** (accordion agrupado) | **Asignaciones**.

Tab Permisos:
- Lista vertical de bloques colapsables.
- Cada bloque muestra contador "X de Y activos".
- Hover sobre label → tooltip con helper text.
- Botón "Activar/desactivar todos" por bloque con confirmación si afecta >5.
- Estados visuales: ☑ activo, ☐ inactivo, ⚠ activo con warning.

### 6.7 — UI del wizard "Crear gestor"

4 pasos:
1. Datos personales (sin PIN, sin datos laborales completos).
2. Rol base (Admin/Manager) + locales asignados.
3. Permission set + override individual expandible.
4. Confirmación.

Si checkbox "Esta persona también es empleada del negocio" → redirige a wizard T1 empleado pre-rellenando datos.

### 6.8 — Defaults sugeridos para los 4 sets system

- **Gerente total**: ~50 permisos (todos Team + Safety + Sales + casi todo Configuración).
- **Encargado de sala**: ~18 permisos (operativa diaria sin tocar config ni salarios).
- **Encargado APPCC**: ~25 permisos (todo Safety + ver empleados).
- **Gestor RRHH**: ~14 permisos (gestión personas + vacaciones + bolsa + gestoría).

Editables por admin cuenta (excepto `is_system = true` que protege contra borrado).

---

## 7. Flujos extremo a extremo

11 flujos completos del usuario atravesando todas las capas.

### 7.1 — Alta de cuenta cliente nueva (Modalidad 3)

Julio CEO en `/_admin/cuentas/nueva` → wizard 5 pasos → al confirmar transacción atómica:

```
BEGIN;
INSERT INTO accounts (..., feature_flags, plan_id, created_by);
-- Trigger replica_system_permission_sets crea los 4 sets system
auth.admin.createUser(first_admin_email);
INSERT INTO user_profiles (..., role='admin', active=true);
INSERT INTO permission_set_assignments (..., set='gerente_total');
INSERT INTO locations (...) initial;
INSERT INTO brands (...) default;
-- Trigger seed APPCC ya activo desde P6
auth.admin.inviteUserByEmail(first_admin_email, {redirectTo: '/welcome?token=...'});
INSERT INTO platform_audit_log (event_type='account_created', ...);
COMMIT;
```

Si algo falla: ROLLBACK completo. Sin estado parcial.

### 7.2 — Primer login del admin cliente

1. Click en welcome email → `/welcome?token=...`.
2. Sistema valida via `supabase.auth.verifyOtp({type:'invite'})`.
3. Pantalla configurar contraseña.
4. Admin establece contraseña + acepta T&C.
5. `auth.updateUser({password})` + Edge Function `complete-welcome` actualiza `terms_accepted_at` + `welcome_completed_at`.
6. Audit log `welcome_completed`.
7. Redirect a `/[slug]/configuracion`.

### 7.3 — Admin cliente crea primer gestor

Admin en `/[slug]/configuracion/usuarios` → "Nuevo gestor" → wizard 4 pasos → al confirmar:

```
BEGIN;
auth.admin.createUser(...);
INSERT INTO user_profiles (..., role='manager', active=true);
INSERT INTO manager_locations (...);
INSERT INTO permission_set_assignments (..., set='encargado_sala');
-- Si hay overrides:
INSERT INTO manager_permissions (...);
auth.admin.inviteUserByEmail(...);
INSERT INTO security_audit_log (action='user_profile_created', ...);
COMMIT;
```

### 7.4 — Cambio de email propio

Pamela en "Yo → Editar email":
1. Introduce nuevo email + contraseña actual (reauth).
2. `supabase.auth.reauthenticate(password)` valida identidad.
3. `auth.updateUser({email: nuevo})` → Supabase envía 2 emails (al actual: aviso, al nuevo: confirmación).
4. Pamela abre email nuevo, click → cambio aplicado.
5. Audit log `email_changed`.

Rate limit: máximo cambios por usuario / hora.

### 7.5 — Reset password de user olvidadizo

Worker en `/reset-password`:
1. Introduce email → `resetPasswordForEmail` (siempre, sin verificar).
2. Audit log `password_reset_requested`.
3. Pantalla mensaje neutro.
4. Worker recibe email (si existe), click → `/reset-password/confirm?token=...`.
5. Nueva contraseña → `updateUser({password})`.
6. Audit log `password_reset_completed`.
7. Redirect dashboard correspondiente.

Token caducidad 24h.

### 7.6 — Impersonation completa

Julio CEO en `/_admin/cuentas/[id]`:
1. Click "Impersonar" → modal motivo (min 10 chars).
2. Confirma → Edge Function `start-impersonation`:
   - Valida permiso `platform_can_impersonate`.
   - Identifica target admin de la cuenta.
   - Genera JWT secundario con `sub = target_user_id` + claims `impersonating: true`.
   - INSERT `impersonation_sessions`.
   - INSERT `platform_audit_log event_type='impersonation_started'`.
   - Devuelve JWT secundario.
3. Cliente guarda JWT en sessionStorage + configura Supabase client + redirect a `/[slug]/personal/empleados`.
4. Banner persistente TopBar visible.
5. Cada acción registra en `impersonation_sessions.actions_taken` + audit log con `real_user_id`.
6. Julio cierra impersonation → Edge Function `end-impersonation`:
   - UPDATE `impersonation_sessions SET ended_at = now()`.
   - INSERT `platform_audit_log event_type='impersonation_ended'`.
7. Frontend borra sessionStorage + vuelve a JWT principal + redirect al panel admin.

Cleanup automático >4h sin cerrar.

### 7.7 — Cuenta suspendida por platform admin

Julio en `/_admin/cuentas/[id]` → Acciones avanzadas → Suspender:
1. Modal motivo obligatorio.
2. Confirma → backend:

```
UPDATE accounts SET suspended_at = now(), suspended_by = Julio, suspension_reason = ...;
INSERT INTO platform_audit_log (event_type='account_suspended', ...);
-- Invalidar todas las sesiones activas
SELECT auth.admin.signOut(user_id) FROM user_profiles WHERE account_id = [id];
```

Users de la cuenta: próximo refresh access token falla → frontend redirect `/login` con mensaje "Tu cuenta está suspendida".

Reactivación posterior: UPDATE inverso.

### 7.8 — Cambio de contraseña logueado

Pamela en "Yo → Seguridad → Cambiar contraseña":
1. 3 inputs: actual + nueva + confirmar.
2. Submit → `reauthenticate(actual)` valida.
3. Si OK → `updateUser({password: nueva})`.
4. Audit log `password_changed_self`.
5. Toast "Contraseña actualizada". Permanece logueada.

Si sesión >7 días: forzar re-login antes de permitir cambio.

### 7.9 — Cambio de role worker → manager

Admin promociona a Carmen:
1. `/[slug]/personal/empleados/[carmen_id]` → tab Permisos → "Convertir a manager".
2. Wizard 3 pasos (rol, locales, set).
3. Confirma → backend:

```
UPDATE user_profiles SET role = 'manager' WHERE id = [carmen];
INSERT INTO manager_locations (...);
INSERT INTO permission_set_assignments (...);
-- Forzar re-login con nuevos claims
SELECT auth.admin.signOut([carmen_user_id]);
INSERT INTO security_audit_log (action='user_role_changed', ...);
```

Carmen: próximo refresh falla → redirect `/login` → re-loguea → nuevo JWT con `current_account_role='manager'` → panel manager. PIN kiosko sigue funcionando porque sigue siendo empleada física.

Email automático: "Has sido promocionada a manager. Vuelve a iniciar sesión".

### 7.10 — Multi-cuenta (un user en varias cuentas)

Login normal. Sistema lee `user_profiles` activos en cuentas activas.

Si >1 cuenta: pantalla selector tras login (logo cliente + nombre + rol).

Click → guarda `current_account_id` en localStorage → redirect `/[slug]/personal`.

Si 1 cuenta: redirect directo, sin pantalla.

Cambio de cuenta activa durante uso: selector en Header → click → localStorage + refresh componentes. **Sin regenerar JWT.** RLS valida ownership.

Si user manipula localStorage para "saltar" a cuenta sin profile: queries devuelven vacío + selector multi-cuenta vuelve a las legítimas.

### 7.11 — Worker hace primer fichaje

Pamela primer día en kiosko `/[slug]/kiosko/[location_id]`:
1. Teclea PIN.
2. Sistema valida via Edge Function con service role (kiosko sin user logueado Supabase): `SELECT employees WHERE hashed_pin = ... AND location_id = ... AND active = true`.
3. Pantalla bienvenida con foto.
4. "Fichar entrada" → INSERT `clock_entries (employee_id, type='entry', timestamp=now(), source='kiosk')`.
5. Confirmación 3s.
6. Sistema dispara evento `personal.clock_in` → módulo Safety lo escucha → busca tareas APPCC pendientes asignadas a Pamela → activa.

---

## 8. Bus de eventos auth

### 8.1 — Dos canales separados

**Canal 1 — Eventos de sesión (cliente local):** mitt EventEmitter. No tocan BBDD.

**Canal 2 — Eventos auth backend (Supabase Realtime):** suscripciones a cambios en tablas auth. Pueden propagarse a múltiples clientes/dispositivos.

### 8.2 — Catálogo de eventos

**Eventos de sesión (canal cliente):**

| Evento | Cuándo se emite | Payload |
|---|---|---|
| `auth.session_started` | Login exitoso o welcome | `{user_id, role, account_id, slug}` |
| `auth.session_ended` | Logout manual o auto | `{reason: 'manual'\|'expired'\|'forced'}` |
| `auth.session_refreshed` | Refresh exitoso del JWT | `{user_id, expires_at}` |
| `auth.account_switched` | User selecciona otra cuenta | `{previous_account_id, new_account_id, new_slug}` |
| `auth.impersonation_started` | Platform admin inicia | `{platform_admin_id, target_account_id, target_user_id, reason, expires_at}` |
| `auth.impersonation_ended` | Platform admin cierra | `{platform_admin_id, target_account_id, duration_seconds}` |
| `auth.permissions_loaded` | Tras cargar/recargar permisos | `{permission_set_id, permissions_resolved}` |

**Eventos auth backend (canal Realtime):**

| Evento | Origen | Consumidores |
|---|---|---|
| `auth.user_suspended` | UPDATE user_profiles SET active=false | Cliente afectado → forceLogout |
| `auth.user_reactivated` | UPDATE user_profiles SET active=true | Cliente puede re-login |
| `auth.user_role_changed` | UPDATE user_profiles SET role=X | Cliente afectado → forceLogout (re-login) |
| `auth.account_suspended` | UPDATE accounts SET suspended_at=now() | TODOS users de la cuenta → forceLogout |
| `auth.account_reactivated` | UPDATE accounts SET suspended_at=NULL | Notificación a admin cuenta |
| `auth.permission_set_modified` | UPDATE permission_sets | Users con ese set → recargar permisos |
| `auth.permission_set_assignment_changed` | INSERT/UPDATE permission_set_assignments | User afectado → recargar permisos |
| `auth.manager_permission_override_changed` | UPDATE manager_permissions | User afectado → recargar permisos |
| `auth.platform_admin_suspended` | UPDATE platform_admins SET active=false | Platform admin → forceLogout panel |

### 8.3 — Eventos que auth CONSUME

| Evento (de otros) | Origen | Reacción de auth |
|---|---|---|
| `personal.employee_suspended` | Módulo Personal | Marca `user_profiles.active=false` automáticamente |
| `personal.employee_reactivated` | Módulo Personal | Re-activa `user_profiles.active=true` |
| `personal.employee_role_changed_to_manager` | Módulo Personal | Activa wizard "convertir a manager" |
| `account.gdpr_delete_requested` | Configuración cuenta | Marca `user_profiles` para anonimización tras 30 días |
| `platform.maintenance_mode_enabled` | Panel superadmin | Bloquea nuevos logins excepto platform admins |

### 8.4 — Implementación técnica

**Cliente emisor local (mitt):**

```typescript
import mitt from 'mitt'

export type AuthEvents = {
  'auth.session_started': { user_id: string; role: string; account_id: string; slug: string }
  // ...
}

export const authEventBus = mitt<AuthEvents>()
```

**Backend emisor (Supabase Realtime):**

Tablas con Realtime habilitado: `user_profiles`, `accounts`, `permission_sets`, `permission_set_assignments`, `manager_permissions`, `platform_admins`.

Cliente se suscribe filtrando:

```typescript
supabase.channel(`user_profile_${userId}`)
  .on('postgres_changes', {
    event: 'UPDATE', schema: 'public', table: 'user_profiles',
    filter: `user_id=eq.${userId}`
  }, (payload) => {
    if (payload.old.active === true && payload.new.active === false) {
      forceLogout('user_suspended')
    }
  })
  .subscribe()
```

### 8.5 — Limitaciones conocidas V1

- Sin garantía de entrega si cliente offline.
- Sin replay tras reconexión Realtime.
- Eventos cross-tenant no existen (deliberado por seguridad).
- Volumen alto V1.1+: considerar batching.

---

## 9. Edge cases consolidados

### 9.1 — Edge cases de login

- Email inexistente → mensaje genérico "Email o contraseña incorrectos".
- Email correcto + password mal → mismo mensaje + cuenta intento rate limit.
- Rate limit alcanzado → mensaje "Demasiados intentos. Inténtalo en 15 min".
- `user_profile.active = false` → signOut inmediato + mensaje "Tu acceso no está activo".
- `accounts.suspended_at != null` → mensaje "Tu cuenta Folvy está suspendida. Contacta con soporte".
- `accounts.deleted_at != null` en ventana 30 días → login permitido + banner persistente rojo.
- 0 user_profiles activos + no platform admin → signOut + mensaje "Acceso desactivado en todas las cuentas".
- Modo mantenimiento V2+ → mensaje específico.
- Network error → toast + permite reintentar.
- `current_account_id = NULL` tras login → selector multi-cuenta o error si bug interno.

### 9.2 — Edge cases de welcome

- Token caducado (>7 días) → pantalla "Caducado" + CTA contactar admin.
- Token ya usado → pantalla "Ya activado" + CTA login.
- Token malformado → pantalla "Enlace inválido".
- Apertura desde 2 pestañas simultáneas → primera gana.
- Welcome sin aceptar T&C → backend rechaza 400.
- Re-invitación a user ya activo → opción "Reenviar invitación" con confirmación V1.1+.

### 9.3 — Edge cases de reset password

- Email inexistente → mensaje neutro igualmente, sin envío real.
- Token caducado (>24h) → pantalla "Caducado" + CTA nuevo enlace.
- Rate limit reset → máximo 3 / hora.
- Token viejo válido tras login normal → sin invalidación automática (sin riesgo).
- Reset desde otro dispositivo no invalida sesión vieja en V1 (V1.1+ checkbox "cerrar todas las sesiones").

### 9.4 — Edge cases de sesión

- Access token caduca → auto-refresh silencioso.
- Refresh token caducado/revocado → toast "Sesión expirada" + redirect login.
- Refresh administrativo (signOut admin) → mismo flujo desde cliente.
- 3 pestañas + logout en una → otras pestañas detectan en próximo refresh (hasta 1h delay V1).
- Sesión semanas sin uso → refresh caduca tras 7 días normales / 4h platform admin.
- Cambio zona horaria → timestamps renderizan con nueva TZ. Sin problema técnico.
- Reloj desincronizado >5min → Supabase JS no valida local, sin riesgo real.

### 9.5 — Edge cases multi-cuenta

- Cuenta suspendida + es activa → forceLogout. Login posterior filtra suspendida del selector.
- Cambio de rol en cuenta no activa → no afecta sesión actual. Aplica al cambiar.
- Mismo email distintos passwords → imposible. Email único en `auth.users`.
- Manipulación localStorage para saltar a cuenta sin profile → RLS bloquea + UI muestra selector legítimo.
- Logout multi-cuenta → limpia toda la sesión.

### 9.6 — Edge cases de permisos

- Permiso perdido durante uso → Realtime emite evento → recarga permisos → UI re-renderiza. Si submit a mitad → 403 con toast.
- Permiso ganado → mismo flujo, UI actualiza automáticamente.
- Override contradice set → override gana.
- Permission_set custom eliminado con assignments activas → bloquear, admin debe reasignar primero.
- Worker con set de manager → RLS filtra por rol primero, permisos no surten efecto operativo.

### 9.7 — Edge cases de impersonation

- Cierre de pestaña sin "Cerrar impersonation" → JWT secundario muere sessionStorage. BBDD queda con `ended_at NULL`. Cron cierra forzado >4h.
- Pérdida de conexión → reconexión usa JWT si <1h. Si expiró → redirect panel admin.
- Dos platform admins impersonan misma cuenta → permitido + warning visible.
- Target_user suspendido durante impersonation → cierre automático + mensaje.
- Platform admin con impersonation activa intenta abrir otra cuenta → bloquear, cerrar la actual primero.
- Cliente reporta impersonation → audit log completo en `actions_taken`.

### 9.8 — Edge cases de cambio de email

- Email nuevo ya en uso → error claro.
- Cambio durante impersonation siendo target → imposible (platform admin no edita email via flujo user).
- Sin confirmar email nuevo → Supabase mantiene viejo + warning UI "Cambio pendiente".
- Pierde acceso al email nuevo antes de confirmar → cambio cancelado al expirar.

### 9.9 — Edge cases de borrado RGPD

- Admin pide cancelar cuenta → triple confirmación + 30 días gracia con banner + anonimización vía cron.
- Worker pide RGPD borrado → V1 admin contacta soporte Folvy. V1.1+ self-service.
- Worker pide portabilidad → V1 manual. V1.1+ self-service en Portal.

### 9.10 — Edge cases de platform admin

- Único platform admin pierde 2FA + backup codes → intervención manual Supabase dashboard.
- Pierde acceso a email → mismo procedimiento manual.
- Suspendido con impersonation activa → forceLogout + cierre automático sesión impersonation.
- Crea cuenta con slug duplicado → constraint UNIQUE rechaza + sugerencias.
- Welcome email no llega → botón "Re-enviar welcome" o canal alternativo manual.

### 9.11 — Edge cases de auth en kiosko

- PIN duplicado mismo local → constraint UNIQUE previene.
- Worker olvida PIN → manager resetea + notificación email.
- PIN incorrecto N veces → delay 2s entre intentos. V1.1+ bloqueo tras 5 fallos.
- Kiosko colgado → auto-reload 30s sin interacción.
- Manager fuerza salir kiosko → PIN admin 8 dígitos distinto.
- Kiosko ofrece fichar a worker de baja → mensaje "Acceso suspendido".

### 9.12 — Edge cases NO contemplados en V1

Decisiones explícitas de no construir:
- Detección IP sospechosa V2+.
- Bloqueo permanente por intentos masivos (V1 solo cooldown).
- CAPTCHA en login.
- 2FA para users cliente (V1 solo platform admins).
- Notificación email IP nueva V2+.
- Detección cuenta comprometida automática V2+.
- Sesiones concurrentes limitadas (V1 ilimitadas).
- Logout automático por inactividad cliente normal V1.
- Política complejidad password compleja (V1 acepta 8+ chars + letras + números).
- Rotación obligatoria password cada X meses V1.

---

## 10. Validaciones técnicas

### 10.1 — Índices críticos

Sin estos, queries auth tardarán segundos en producción.

```sql
CREATE INDEX idx_accounts_slug ON accounts(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_accounts_active ON accounts(id) 
  WHERE suspended_at IS NULL AND archived_at IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX idx_user_profiles_account_id ON user_profiles(account_id);
CREATE INDEX idx_user_profiles_user_account ON user_profiles(user_id, account_id);
CREATE INDEX idx_user_profiles_active ON user_profiles(account_id, role) WHERE active = true;
CREATE INDEX idx_user_profiles_login_resolution ON user_profiles(user_id, active, account_id) WHERE active = true;
CREATE INDEX idx_user_profiles_account_role ON user_profiles(account_id, role, active);
CREATE INDEX idx_platform_admins_user_id ON platform_admins(user_id) WHERE active = true;
CREATE INDEX idx_impersonation_admin ON impersonation_sessions(platform_admin_id);
CREATE INDEX idx_impersonation_target_account ON impersonation_sessions(target_account_id);
CREATE INDEX idx_impersonation_active ON impersonation_sessions(started_at) WHERE ended_at IS NULL;
CREATE INDEX idx_auth_rate_limits_email ON auth_rate_limits(email);
CREATE INDEX idx_auth_rate_limits_locked ON auth_rate_limits(locked_until) WHERE locked_until IS NOT NULL;
CREATE INDEX idx_permission_sets_account ON permission_sets(account_id) WHERE active = true;
CREATE INDEX idx_permission_set_assignments_user_profile ON permission_set_assignments(user_profile_id);
CREATE INDEX idx_permission_set_assignments_set ON permission_set_assignments(permission_set_id);
CREATE INDEX idx_security_audit_log_actor ON security_audit_log(actor_user_id);
CREATE INDEX idx_security_audit_log_target ON security_audit_log(target_user_id);
CREATE INDEX idx_security_audit_log_action ON security_audit_log(action);
CREATE INDEX idx_security_audit_log_created_at ON security_audit_log(created_at DESC);
CREATE INDEX idx_security_audit_account_recent ON security_audit_log(created_at DESC) 
  WHERE created_at > now() - interval '30 days';
CREATE INDEX idx_platform_audit_admin ON platform_audit_log(platform_admin_id);
CREATE INDEX idx_platform_audit_event_type ON platform_audit_log(event_type);
CREATE INDEX idx_platform_audit_target_account ON platform_audit_log(target_account_id);
CREATE INDEX idx_platform_audit_created_at ON platform_audit_log(created_at DESC);
```

### 10.2 — Performance budgets

| Query | Budget |
|---|---|
| Login completo (signInWithPassword + JWT hook) | < 500ms p95 |
| Resolución current_account_id en JWT hook | < 100ms p95 |
| Carga de permisos resueltos del user | < 150ms p95 |
| RLS evaluation por query operativa | < 20ms overhead p95 |
| Welcome onboarding completo | < 1s p95 |
| Generación JWT secundario impersonation | < 800ms p95 |
| Listado audit log últimos 100 eventos | < 300ms p95 |
| Listado empleados cuenta (50 users) | < 200ms p95 |
| Selector multi-cuenta tras login | < 150ms p95 |

Medición: Supabase Pro query logs + `pg_stat_statements`. V1.1+ Sentry/Datadog con alertas automáticas.

### 10.3 — Validación cliente vs servidor

**Cliente:** solo UX (feedback inmediato). Nunca confiar.

**Servidor:** línea de defensa real. RLS + constraints + Edge Functions. Independiente del cliente.

**Regla firme:** si está sólo en cliente, no existe. Toda validación crítica DEBE estar en servidor también.

### 10.4 — Estrategias de cacheo

**Cliente:**
- LocalStorage: sesión Supabase + current_account_id + current_location_id.
- SessionStorage: JWT secundario impersonation.
- Memoria React: permisos resueltos + cuentas activas + datos módulo.
- TTL: cero TTL en memoria. Recarga al refresh JWT o evento Realtime.

**Backend:**
- Sin cacheo aplicación V1. Cada query toca BBDD.
- V1.1+ considerar Redis para high-frequency.

Razón de no cachear permisos agresivamente: cambios deben verse rápido. Realtime evita stale cache.

### 10.5 — Backups y recovery

**PITR Supabase Pro:** blocker P-1. Activar ANTES de Llorente29 producción.

**Tablas críticas a respaldar:** todas las auth listadas en capa A + `security_audit_log` (append-only crítica).

**Restore scenarios:**
- Borrado accidental → PITR.
- Borrado RGPD legítimo → NO restore.
- Corrupción → PITR.
- Borrado malicioso → PITR + audit log identifica actor.

### 10.6 — Migrations

**Filosofía:**
- Versionadas con timestamp.
- Forward-only (sin rollback).
- Idempotentes cuando posible.
- SQL revisable antes de ejecutar (Julio aprueba).
- Transaccional (BEGIN/COMMIT atómico).

**Orden migrations auth Fase 0:**
1. `create_platform_admins.sql`
2. `create_platform_admin_permissions.sql`
3. `create_platform_admin_2fa.sql`
4. `create_auth_rate_limits.sql`
5. `create_impersonation_sessions.sql`
6. `create_platform_audit_log.sql`
7. `create_platform_settings.sql`
8. `create_permission_sets.sql`
9. `create_permission_set_assignments.sql`
10. `alter_accounts_add_auth_columns.sql`
11. `alter_user_profiles_add_auth_columns.sql`
12. `create_auth_rls_policies.sql`
13. `create_auth_triggers.sql`
14. `create_auth_functions.sql`
15. `seed_default_permission_sets.sql` (4 system globales)
16. `seed_first_platform_admin.sql` (Julio CEO)

### 10.7 — Testing

**Unit tests V1 mínimo:**
- Hash de PINs / backup codes.
- Resolución de permisos (override gana).
- Validación de slugs.
- Cálculo de fortaleza de contraseña.

**Integration tests V1 mínimo:**
- Login flow completo.
- Welcome flow completo.
- Reset password flow.
- Impersonation flow.
- RLS policies clave (worker no ve datos de otra cuenta).

**E2E V1.1+:** Playwright contra staging cubriendo los 11 flujos de capa E.

**Pentesting V2+:** auditoría externa antes de cliente enterprise. OWASP Top 10.

### 10.8 — Observabilidad

**Logs:**
- Supabase logs queries.
- Edge Functions logs Supabase dashboard.
- Cliente: console.error solo V1.

**Métricas a vigilar:**
- Rate de logins fallidos (alerta >50% en 1h → ataque).
- Latencia p95 signInWithPassword (>2s).
- Errores 401/403 (picos inusuales).
- Impersonation sessions abiertas (>5 simultáneas).
- Welcome emails enviados sin completar >7 días.

**Alertas V1:** email a Julio CEO si métrica en zona roja. V1.1+ PagerDuty/Slack.

### 10.9 — Compliance

**LOPD/RGPD:**
- Audit log de accesos a datos personales sensibles.
- Procedimiento documentado de acceso/rectificación/supresión/portabilidad.
- Encriptación at-rest (Supabase default) + in-transit (HTTPS obligatorio).

**Inspección laboral España:**
- Audit log fichajes inmutable durante 5 años mínimo.
- Conservación datos APPCC durante 5 años post-creación.

**Datos sensibles especiales:**
- IBAN, DNI, NSS encriptados con pgsodium.
- Backup codes 2FA → hash bcrypt.
- TOTP secrets → Supabase Vault.

---

## 11. Resumen ejecutivo

Folvy V1 implementa autenticación robusta con:

- Email + password primario + welcome onboarding + reset password.
- Panel superadmin separado con 2FA TOTP obligatorio.
- Multi-tenancy estricta via `account_id` en todas las tablas operativas.
- Multi-cuenta para usuarios con perfiles en varias cuentas.
- Permisos granulares (~60 flags) agrupados por módulo con 4 sets system precargados.
- Impersonation con audit trail estricto y duración máxima 4h.
- RLS activo en TODAS las tablas con funciones auxiliares para policies legibles.
- Audit log append-only con retención 5 años legal.
- Bus de eventos auth con Realtime para invalidación inmediata de sesiones.
- ~10 tablas nuevas + cambios a 2 existentes.
- ~20 índices críticos para performance.
- Performance budgets explícitos para queries clave.
- Cumplimiento RGPD + inspección laboral España.

**Próximos pasos:**
1. CEO acciones: PITR Supabase Pro, hosting + dominios, provider email transaccional.
2. Sesión 3: roadmap inverso con sprints.
3. Sesión 4+: ejecución técnica Fase 0 (Shell base, auth email+password, panel superadmin, permisos, migración maestros al Shell, rebranding Folvy).

**Lectura obligatoria al implementar Fase 0:** este documento + `folvy_arquitectura_reconciliada.md` + `folvy_v1_spec.md` + `CONTEXTO_CLAUDE.md` versión P7-S0+.

---

**Documento cerrado 18 mayo 2026 al final de Sesión 2.**
**Próxima revisión:** al completar Fase 0 (Shell + auth + panel superadmin estables).

---

## 📝 Nota de revisión — 19 de mayo de 2026

Este documento se reviso el 19/05/2026 tras la ejecución del Sprint 1 (auth backend BBDD).

**Cambios aplicados:**
- Ninguno textual (no contenía URLs `folvy.com`).

**Aclaración importante para futuros lectores:**

La **implementación real** del modelo auth diverge de este documento en 4 puntos críticos aprobados por Julio CEO el 18/05/2026. Resumen:

1. **Decisión D1 (Permisos, Opción B)**: además de `permission_sets` propuesto en §2.2, **mantenemos `manager_permissions` legacy** con cascada de resolución en función `has_permission()` (Decisión 1 B aprobada 18/05/2026).

2. **Decisión D2 (Feature flags y plan_id)**: NO se añade `accounts.feature_flags jsonb` ni `accounts.plan_id` como proponía §2.3. Mantenemos tabla `feature_flags` separada y `subscriptions.plan_id` (mejor normalización ya existente en BBDD).

3. **Decisión D3 (Platform admins, Opción C2)**: la tabla `platform_admins` separada SÍ se crea según §2.2, refactorizando la función `current_user_is_admin()` (M13). Julio CEO migrado de `user_profile` interno a fila en `platform_admins` con `role='ceo'`.

4. **Decisión D4 (CASCADE legal, Opción α)**: FK `clock_entries.employee_id` y `documents.employee_id` cambiados de `ON DELETE CASCADE` a `ON DELETE RESTRICT`. Cumple Real Decreto-ley 8/2019.

**Estado real de las 16 migrations §10.6**: ejecutadas como 19 migrations en producción 19/05/2026 (3 nuevas + 5 bug fixes en vivo). Detalles en `folvy_addendum_sesion2_decisiones.md`.

**Para estado real implementado, consultar:**
- `CONTEXTO_CLAUDE.md` versión 19/05/2026 (post-Sprint 1).
- `folvy_addendum_sesion2_decisiones.md` (decisiones D1-D5 + 5 bugs SQL + estado final BBDD).

