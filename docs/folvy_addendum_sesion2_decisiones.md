# Addendum Sesión 2 — Decisiones arquitectónicas + Sprint 1 ejecutado

> **Documento de reconciliación entre la Sesión 2 documental original (18/05/2026 mañana) y la realidad implementada en BBDD tras Sprint 1 (19/05/2026).**
>
> Este documento NO reemplaza `folvy_auth_model.md` (Sesión 2). Lo complementa con las 5 decisiones aprobadas, los 5 bugs SQL detectados en ejecución, y los hallazgos de auditoría BBDD.
>
> Lectura obligatoria junto con la Sesión 2 original.

---

## 0. Resumen ejecutivo

Entre el 18 y 19 de mayo de 2026, ejecutamos las 19 migrations Sprint 1 sobre la BBDD producción Supabase. **5 decisiones arquitectónicas** se tomaron formalmente durante el proceso, 4 de ellas como ajustes a la Sesión 2 documental tras una auditoría de la BBDD que reveló divergencias con lo planeado.

**5 bugs SQL** se detectaron durante la ejecución y se corrigieron en vivo. Documentados aquí como lecciones aprendidas para futuras migrations.

**Estado final**: las 19 migrations están en producción. Julio CEO es oficialmente el primer `platform_admin` con `role='ceo'`. Las 4 funciones auxiliares RLS están operativas (1 refactorizada, 3 nuevas). 23 RLS policies nuevas activas en las 8 tablas auth nuevas. 2 cron jobs programados.

---

## 1. Auditoría BBDD — divergencias detectadas

Al ejecutar la regla 5 del proyecto ("Antes de cualquier decisión arquitectónica, consultar BBDD real"), descubrimos que el estado real de la BBDD divergía de lo documentado en Sesión 2.

### 1.1 — Conteo de tablas

| Origen | Tablas reportadas |
|---|---|
| CONTEXTO_CLAUDE (antes del 19/05) | 40 tablas RLS |
| BBDD real (auditoría 18/05 noche) | **75 tablas** (65 funcionales + 10 backup) |

Las 35 tablas adicionales no documentadas son del trabajo P5-P6 (catálogo APPCC seed, módulos, submódulos, billing_plans, subscriptions, etc.).

### 1.2 — Funciones auxiliares RLS existentes

El **Bloque S del 16/05/2026** dejó implementadas 4 funciones auxiliares que NO estaban documentadas en Sesión 2:

```sql
-- Patrón consistente: LANGUAGE sql, STABLE, SECURITY DEFINER, search_path='public'
current_user_is_admin()                          -- consultaba accounts.is_internal=true
current_user_is_admin_of(uuid)                   -- admin específico de cuenta
current_user_is_admin_or_manager_of(uuid)        -- admin o manager de cuenta
current_user_account_ids()                       -- array uuid[] de cuentas del user
```

**Implicación**: el patrón "platform admin = user_profile.role='admin' en cuenta con is_internal=true" ya estaba implementado y funcionando con 14 policies dependientes. Esto entró en conflicto con la propuesta de Sesión 2 §2.2 (tabla `platform_admins` separada).

### 1.3 — Policies existentes auditadas

24 RLS policies en 14 tablas auth-relevantes, todas siguiendo patrón consistente del Bloque S. Tablas afectadas:

```
accounts, app_settings, domain_events, employees, feature_flags, 
locations, manager_locations, manager_permissions, modules, 
security_audit_log, submodules, user_profiles
```

### 1.4 — Conteo de datos reales

```
accounts:                     2  (Llorente29 + Foodint Interno)
user_profiles:                3
employees:                    4
locations:                    3  (los 3 de Llorente29)
clock_entries:                0  ← Llorente29 NO usa app
appcc_executions:             0
security_audit_log:           0
```

**Conclusión operativa**: la BBDD está prácticamente vacía. Esto justificó posteriormente aceptar el riesgo de ejecutar migrations sin PITR (decisión D5).

### 1.5 — Problemas legales detectados

Dos FK constraints con `ON DELETE CASCADE` sobre `employees(id)` violarían el Real Decreto-ley 8/2019 (conservación obligatoria de fichajes 4 años):

- `clock_entries.employee_id → employees(id) ON DELETE CASCADE`
- `documents.employee_id → employees(id) ON DELETE CASCADE`

Borrar un empleado borraría todos sus fichajes/documentos = ilegal. Corregido en M12 (ver decisión D4 abajo).

---

## 2. Decisiones arquitectónicas aprobadas

Todas las decisiones formalmente aprobadas por Julio CEO en el chat o vía WhatsApp con trazabilidad escrita. Audit log en `platform_audit_log` registra implementaciones.

### D1 — Permisos: Opción B (capa cascada)

**Fecha**: 18/05/2026 ~22:30 UTC.
**Aprobada por**: Julio CEO (chat directo).
**Tomada inicialmente por**: José (refuerzo), confirmada por Julio.

#### Contexto

Sesión 2 §2.2 proponía tabla nueva `permission_sets` con `permissions jsonb` para todos los permisos finos. Pero `manager_permissions` ya existía en BBDD con 30+ columnas booleanas (`show_dashboard`, `show_appcc_today`, `can_manage_employees`, etc.) y 3 filas activas.

**Conflicto**: migrar `manager_permissions` a jsonb rompería código actual que lee esos booleanos directamente.

#### Decisión

**Opción B**: convivir ambos sistemas con cascada de resolución.

- ✅ Mantener `manager_permissions` (columnas booleanas legacy).
- ✅ Crear `permission_sets` + `permission_set_assignments` (jsonb).
- ✅ Función `has_permission(account_id, permission_key)` con cascada:
  1. Admin de cuenta → siempre `true`.
  2. Override en `manager_permissions` columna (si existe) → gana.
  3. Lectura desde `permission_set.permissions` jsonb → vale.
  4. Default → `false` (DENY).

#### Implementación

- M10: `create_permission_sets`.
- M11: `create_permission_set_assignments`.
- M14: función `has_permission()` con cascada.
- M18: seed de 4 permission_sets system globales con ~130 permisos jsonb totales.

#### Migración gradual futura

Cuando un permiso legacy en `manager_permissions` deje de ser leído por UI, se hace `DROP COLUMN`. Migración esperada Fase 1-2.

---

### D2 — Feature flags y plan_id: mantener tablas separadas

**Fecha**: 18/05/2026 ~22:35 UTC.
**Aprobada por**: Julio CEO (chat directo).

#### Contexto

Sesión 2 §2.3 proponía `accounts.feature_flags jsonb` y `accounts.plan_id text`. Pero la BBDD ya tenía:

- Tabla `feature_flags` (8 columnas: account_id, feature_key, enabled, source, expires_at, granted_by, created_at, updated_at) — diseño más auditable.
- Tabla `subscriptions` con `plan_id` → FK a `billing_plans` — diseño normalizado.

#### Decisión

**Mantener diseño actual normalizado.** NO añadir columnas jsonb a `accounts`.

- ✅ Tabla `feature_flags` separada (ya existente, mejor diseño).
- ✅ `subscriptions.plan_id` como fuente de truth de planes.
- ❌ NO `accounts.feature_flags jsonb`.
- ❌ NO `accounts.plan_id`.

#### Implementación

- M01 modificado: solo añade columnas lifecycle (suspended/archived/deleted), NO feature_flags ni plan_id.

#### Enmienda formal a Sesión 2

§2.3 de `folvy_auth_model.md` queda enmendada. La realidad BBDD está mejor diseñada que la propuesta original.

---

### D3 — Patrón platform admin: Opción C2 (tabla separada)

**Fecha**: 18/05/2026 ~22:40 UTC.
**Aprobada por**: Julio CEO (chat directo, dos veces — inicial + confirmación al volver del descanso).

#### Contexto

El Bloque S del 16/05/2026 implementó el concepto de "platform admin" usando `user_profile.role='admin'` en cuenta `accounts.is_internal=true`. Función `current_user_is_admin()` consultaba este patrón.

**Conflicto con Sesión 2 §2.2** que proponía tabla `platform_admins` dedicada con role jerárquico ('ceo', 'senior_admin', 'admin', 'support'), 11 flags granulares de permisos, 2FA dedicada, audit log separado.

Dos opciones reales:
- **C1**: mantener patrón `is_internal=true`. Cero cambios, divergencia de Sesión 2.
- **C2**: crear tabla `platform_admins` separada. Más profesional, alineado con Sesión 2, requiere refactor `current_user_is_admin()`.

#### Decisión

**Opción C2.** Implementar Sesión 2 §2.2 como estaba escrito.

Justificación de Julio:
- Más profesional para presentar a inversores futuros.
- Permite roles platform jerárquicos (ceo/senior_admin/admin/support).
- 2FA obligatoria platform admin NO encaja en `user_profiles`.
- 11 flags granulares no caben en `manager_permissions`.
- Refactor C1→C2 más adelante (con datos reales) sería 10x más caro.

#### Implementación

- M03, M04, M05: crear tablas `platform_admins`, `platform_admin_permissions`, `platform_admin_2fa`.
- M14: función `current_user_has_platform_permission(flag)` para permisos finos platform.
- M15: 12 RLS policies en las 3 tablas platform_admin.
- M19: seed Julio CEO como primer platform_admin con todos flags=true.
- M13: refactor `current_user_is_admin()` para consultar `platform_admins` en lugar de `accounts.is_internal=true`.

#### Migración de Julio CEO

Datos verificados antes de M19:
- `user_profile_id`: `f38807e5-a814-4d8e-bd1c-a9bbaf38e636`
- `auth_user_id`: `e298629b-9d34-4d62-9a00-ff7c3fa29a1a`
- `display_name`: "Julio Gascón"
- `role`: admin
- `account_name`: Foodint Interno
- `is_internal`: true
- `created_at`: 2026-05-16 17:34:15 UTC (Bloque S)

Tras M19, Julio tiene fila en `platform_admins` con id `f532e7d1-9120-4e71-9532-d985b7c3496f`, role='ceo', active=true, los 11 flags=true.

#### Pendiente decisión Sprint 2+

¿DROP COLUMN `accounts.is_internal`? Mantenida por ahora por compatibilidad. Auditar uso en frontend antes de decidir.

---

### D4 — CASCADE legal: Opción α (RESTRICT)

**Fecha**: 18/05/2026 ~22:55 UTC.
**Aprobada por**: Julio CEO (chat directo).

#### Contexto

Detección de problema legal durante auditoría: `clock_entries.employee_id` y `documents.employee_id` con `ON DELETE CASCADE` violan Real Decreto-ley 8/2019 (conservación fichajes 4 años mínimo).

3 opciones evaluadas:
- **α**: `ON DELETE RESTRICT` — imposible borrar empleado físico, frontend usa soft delete.
- **β**: `ON DELETE SET NULL` + snapshot columns (employee_name, employee_dni) en fichajes para mantener trazabilidad.
- **γ**: Soft delete completo en código + anonimización cron tras 4 años (más profesional pero más trabajo).

#### Decisión

**Opción α (RESTRICT)**. Solución simple y suficiente.

Razón: la BBDD está vacía (0 fichajes), implementar α ahora es coste cero. Si en futuro hace falta refinamiento RGPD avanzado, se evalúa γ.

#### Implementación

- M12: DROP FK + ADD FK con `ON DELETE RESTRICT` en ambas tablas.
- Frontend Fase 1 (Sprint 8+) debe usar soft delete (`UPDATE employees SET active = false`).
- Botón "Eliminar empleado" físico NO debe existir en UI.

#### Mensaje al cliente

Cuando Llorente29 use Folvy V1, debe entenderse que "dar de baja" reemplaza "eliminar". Empleados inactivos siguen apareciendo en histórico de fichajes/cuadrantes anteriores. UI tendrá toggle "Mostrar empleados inactivos".

---

### D5 — PITR Supabase: Opción B (sin add-on)

**Fecha**: 18/05/2026 23:16 UTC (vía WhatsApp Julio CEO, captura registrada).
**Aprobada por**: Julio CEO (WhatsApp).

#### Contexto

Antes de ejecutar la primera migration en producción, José verificó PITR Supabase. Descubrió que:

- ✅ Plan Pro Supabase activo.
- ❌ PITR es **add-on de pago adicional** (~+100$/mes recurrente).
- ❌ NO contratado en Sprint 0.1.
- ✅ Solo "Scheduled backups" diarios disponibles.

CONTEXTO_CLAUDE viejo marcaba erróneamente "PITR Supabase Pro activado".

3 opciones evaluadas:
- **A**: activar PITR add-on AHORA (decisión presupuestaria del CEO).
- **B**: aceptar riesgo con scheduled backups (Llorente29 no usa app, riesgo bajo).
- **C**: detener hasta crear staging duplicado (~+25$/mes).

#### Decisión

**Opción B.** Aceptar riesgo. NO activar add-on.

Justificación de Julio:
- Llorente29 no está usando la app.
- 0 fichajes, 4 empleados, 3 locales en BBDD.
- Datos perdidos recuperables manualmente en 5-10 minutos.
- 100$/mes × 4-5 meses hasta producción Llorente29 = ahorro de 400-500$.

#### Riesgo aceptado

Si una migration falla catastróficamente entre 03:25 (último backup) y momento del fallo, hay pérdida de hasta ~20 horas. **Riesgo evaluado como bajo dada la operativa real**.

#### Revisión obligatoria

**Activar PITR antes de Sprint 14 (1-7 septiembre 2026)** = antes de migrar Llorente29 a producción. A partir de ese momento la BBDD tendrá datos reales operativos y PITR es necesario.

---

## 3. Bugs SQL detectados durante ejecución

5 bugs encontrados al ejecutar las 19 migrations. Documentados aquí como lecciones aprendidas para SQL futuro.

### Bug 1 — `accounts_slug_format` ya existía (M01)

**Síntoma**: Error `42710: constraint already exists`.

**Diagnóstico**: El Bloque S del 16/05 ya había creado un CHECK constraint `accounts_slug_format` con regex `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`. Mi M01 borrador intentaba crear el mismo constraint con regex distinta.

**Solución aplicada**: quitar la creación del constraint en M01. El existente cubre la misma función.

**Lección**: **siempre preview-antes** para detectar choques con constraints/columnas/índices existentes.

### Bug 2 — `user_profiles_role_valid` redundante (M02)

**Síntoma**: detectado en preview, no llegó a ejecutarse.

**Diagnóstico**: M02 quería crear `user_profiles_role_valid` para validar `role IN (admin, manager, worker)`. Pero ya existía `valid_role` haciendo exactamente el mismo trabajo (del Bloque S).

**Solución aplicada**: quitar de M02.

**Lección**: igual que Bug 1 — preview-antes detecta esto.

### Bug 3 — `CHECK (NOT EXISTS (SELECT ...))` rechazado (M05)

**Síntoma**: Error `0A000: cannot use subquery in check constraint`.

**Diagnóstico**: PostgreSQL no permite subqueries dentro de CHECK constraints. Restricción del motor.

**Mi código original**:
```sql
CONSTRAINT platform_admin_2fa_used_indices_valid 
  CHECK (NOT EXISTS (
    SELECT 1 FROM unnest(backup_codes_used) AS idx 
    WHERE idx < 0 OR idx > 9
  ))
```

**Corrección**:
```sql
CONSTRAINT platform_admin_2fa_used_indices_valid 
  CHECK (backup_codes_used <@ ARRAY[0,1,2,3,4,5,6,7,8,9])
```

El operador `<@` (contenido en) verifica que todos los elementos del array izquierdo están en el array derecho. Equivalente funcional sin subquery.

**Lección**: ❌ **Nunca subqueries en CHECK constraints**. Usar operadores de array (`<@`, `@>`, `&&`) o expresiones que operen directamente sobre valores.

### Bug 4 — Función volátil `now()` en índice parcial (M06)

**Síntoma**: detectado en revisión preventiva, no llegó a ejecutarse.

**Mi código original**:
```sql
CREATE INDEX idx_auth_rate_limits_cleanup 
  ON auth_rate_limits(first_attempt) 
  WHERE first_attempt < now() - interval '24 hours';
```

**Problema**: `now()` es función VOLÁTIL — su resultado cambia cada llamada. PostgreSQL no permite funciones volátiles en predicados de índice (cambiarían entre evaluaciones).

**Solución aplicada**: eliminar el índice. La función cleanup hace seq scan, lo cual es OK porque la tabla nunca crecerá significativamente (cleanup diario).

**Lección**: ❌ **Nunca funciones volátiles (`now()`, `random()`, etc.) en `WHERE` de índice parcial**. Solo `IMMUTABLE` o `STABLE` permitidas.

### Bug 5 — `jsonb_build_object()` con +100 args (M18)

**Síntoma**: Error `54023: cannot pass more than 100 arguments to a function`.

**Diagnóstico**: PostgreSQL limita `jsonb_build_object()` a 100 argumentos. Como cada par clave-valor son 2 argumentos, el límite efectivo es 50 pares.

`gerente_total` permission set tiene 51 permisos = 102 argumentos = falla.

**Mi código original**:
```sql
jsonb_build_object(
  'show_dashboard', true,
  'show_staff', true,
  ... 51 pares total ...
)
```

**Corrección**:
```sql
'{
  "show_dashboard": true,
  "show_staff": true,
  ... 51 pares ...
}'::jsonb
```

Literal jsonb sin límite de pares.

**Lección**: ❌ **Nunca `jsonb_build_object()` con más de 50 pares clave-valor**. Usar literal `'{...}'::jsonb` para objects grandes.

---

## 4. Estado final BBDD post-Sprint 1

### 4.1 — Tablas auth nuevas (9 creadas)

| Tabla | Filas | Estado |
|---|---|---|
| `platform_admins` | 1 | Julio CEO seed M19 |
| `platform_admin_permissions` | 1 | Julio con 11 flags=true |
| `platform_admin_2fa` | 0 | Setup en Sprint 4 |
| `auth_rate_limits` | 0 | Activo via Edge Function Sprint 2 |
| `impersonation_sessions` | 0 | UI Sprint 4 |
| `platform_audit_log` | 1 | admin_created de Julio |
| `platform_settings` | 1 | backup función pre-C2 |
| `permission_sets` | 4 | 4 sets system globales |
| `permission_set_assignments` | 0 | Asignaciones futuras |

### 4.2 — Tablas existentes alteradas (2)

| Tabla | Cambios |
|---|---|
| `accounts` | +5 columnas lifecycle, +2 constraints, +1 índice parcial |
| `user_profiles` | +6 columnas auth tracking, +2 constraints, +2 índices |

### 4.3 — FK constraints modificadas (2)

| FK | Antes | Después |
|---|---|---|
| `clock_entries.employee_id → employees(id)` | ON DELETE CASCADE | **ON DELETE RESTRICT** |
| `documents.employee_id → employees(id)` | ON DELETE CASCADE | **ON DELETE RESTRICT** |

### 4.4 — Funciones (1 refactorizada + 3 nuevas)

**Refactorizada (M13):**
- `current_user_is_admin()` — ya NO usa `accounts.is_internal`. Consulta `platform_admins`. Backup en `platform_settings`.

**Nuevas (M06, M07, M14, M16):**
- `cleanup_auth_rate_limits()` — cron diario.
- `force_close_long_impersonations()` — cron 5 min.
- `has_permission(account_id, permission_key)` — cascada B.
- `current_user_has_platform_permission(flag)` — permisos finos platform.
- `belongs_to_account(uuid)` — wrapper sobre current_user_account_ids.
- `protect_last_admin()` — trigger function.
- `replicate_system_permission_sets()` — trigger function.

### 4.5 — Triggers (2 nuevos + 3 set_updated_at)

- `trg_protect_last_admin` en `platform_admins`.
- `trg_replicate_system_permission_sets` en `accounts`.
- `trg_platform_admin_permissions_updated_at`.
- `trg_permission_sets_updated_at`.
- `trg_platform_settings_updated_at`.

### 4.6 — Policies RLS (23 nuevas)

```
platform_admins:                    4 policies
platform_admin_permissions:         2 policies
platform_admin_2fa:                 4 policies
impersonation_sessions:             3 policies
platform_audit_log:                 2 policies
platform_settings:                  2 policies
permission_sets:                    4 policies
permission_set_assignments:         2 policies
auth_rate_limits:                   1 policy (DENY ALL, creada en M06)
                            TOTAL: 24 policies
```

### 4.7 — Cron jobs activos

- `cleanup_auth_rate_limits_daily` — diario 03:00 UTC.
- `force_close_impersonations_5min` — cada 5 minutos.

---

## 5. Pendientes para futuras sesiones

### 5.1 — Inmediato (Sprint 0.2 restante)

- ⬜ Limpiar repo Foodint actual + crear branch `folvy-v1`.
- ⬜ Actualizar 4 docs maestros: reemplazar `folvy.com` → `folvy.app`.
- ⬜ Decidir email Folvy (OVH Email Pro vs Zoho vs Google Workspace).
- ⬜ Activar 2FA en Resend.
- ⬜ Llamada Llorente29 + comunicar calendario realista.

### 5.2 — Sprint 2 (2-6 junio 2026)

- ⬜ Edge Function `custom-access-token-hook` — generar claims `folvy.*` en JWT.
- ⬜ Edge Functions auth (login-handler, welcome-handler, password-reset-handler).
- ⬜ Edge Functions impersonation (start-impersonation, end-impersonation).
- ⬜ Edge Functions 2FA (activate-platform-admin-2fa, verify-2fa).
- ⬜ Integración con `auth_rate_limits` tabla (rate limit brute force).

### 5.3 — Decisiones pendientes

- ⬜ DROP COLUMN `accounts.is_internal` o mantener? — auditar uso frontend antes.
- ⬜ Activar PITR add-on antes de Sprint 14 (~+100$/mes).
- ⬜ Limpiar 10 tablas backup `_backup_20260516_*` — confirmar con Julio.
- ⬜ Cartera comercial: aclarar discrepancia entre docs ("+1 esperando + cartera") y respuesta reciente Julio ("Solo Llorente29").

### 5.4 — Entidad legal

- ⬜ Aclarar formalmente: ¿es Foodint, Folvy SL, Idasal, o combinación? Documentar en próxima sesión cuál firma gastos (Supabase, Vercel, Resend, OVH) y cuál facturará a Llorente29.

---

## 6. Reglas técnicas consolidadas para SQL futuro

Tras los 5 bugs detectados, las reglas para futuras migrations:

### 6.1 — Constraints CHECK

- ❌ **Nunca subqueries** (`NOT EXISTS`, `SELECT`) dentro de CHECK.
- ✅ Usar operadores de array (`<@`, `@>`, `&&`) para validar contenido.
- ✅ Usar expresiones directas sobre valores.

### 6.2 — Índices parciales

- ❌ **Nunca funciones volátiles** (`now()`, `random()`) en `WHERE`.
- ✅ Solo `IMMUTABLE` o `STABLE` permitidas.
- ✅ Para "filtrar por edad", calcular en query, no en índice.

### 6.3 — jsonb grandes

- ❌ **Nunca `jsonb_build_object()` con +50 pares** clave-valor (límite 100 args).
- ✅ Usar literal `'{...}'::jsonb` para objects grandes.
- ✅ Literal admite cualquier cantidad de claves.

### 6.4 — Workflow recomendado

1. **Preview-antes**: consulta read-only que verifica estado actual antes de cada migration.
2. **Auditoría completa**: antes de cada decisión arquitectónica, consultar BBDD real (regla 5).
3. **BEGIN/COMMIT obligatorio** en cualquier migration con múltiples cambios.
4. **Verificaciones post-migration** en bloque DO (RAISE EXCEPTION si algo falla).
5. **ROLLBACK comentado** al final de cada archivo (no ejecutado, solo referencia).
6. **Ejecutar una migration a la vez + verificar antes de siguiente**.

---

## 7. Metadatos del documento

**Generado**: 19 de mayo de 2026, ~08:30 UTC.
**Por**: Claude + Julio CEO en sesión técnica.
**Versión**: 1.0 (primer addendum tras Sprint 1).
**Próxima revisión esperada**: tras Sprint 2 (junio 2026) con resultados Edge Functions auth.

**Documentos relacionados**:
- `folvy_auth_model.md` (Sesión 2 original, 18/05/2026 mañana).
- `CONTEXTO_CLAUDE.md` (actualizado misma fecha que este).
- `folvy_roadmap.md` (Sesión 3, sin cambios).
- `folvy_v1_spec.md` (Sesión 1, sin cambios).
- `folvy_arquitectura_reconciliada.md` (Sesión 0, sin cambios).

**Documento cerrado**: 19/05/2026.
