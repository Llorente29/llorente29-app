# CONTEXTO_CLAUDE.md

> **Documento maestro de memoria persistente del proyecto Folvy.**
> Lectura obligatoria al inicio de cada sesión técnica.
> Última actualización: **22 de mayo de 2026, tras sesión Personal T8 + Punto 3 + fases 2.B/2.A/2.A.2 + Fase 1 de cierre.**

---

## 1. CONTEXTO BÁSICO DEL PROYECTO

**Empresa:** Foodint (rebrand en curso a Folvy SL).
**CEO:** Julio Gascón Colón (`jgcolon@idasal.com`).
**Refuerzo técnico:** José (junior, autoridad delegada total cuando opera identificado).
**Producto:** Folvy V1 — SaaS multi-tenant modular para hostelería.

**Cliente activo:** Llorente29 (3 locales: Alcalá, Pza Castilla, Carabanchel + Pamela como empleada).
**Cartera comercial:** estado pendiente de actualización tras Julio (anoche dijo "Solo Llorente29" pero docs decían "+1 esperando + cartera"). Revisar en próxima sesión.

**Fecha producción objetivo:** domingo 7 septiembre 2026 (16 semanas desde 18/05/2026).
**Camino A puro:** Fase 0 técnica antes de migrar Llorente29. Sin atajos.

**Stack:** React 19 + Vite 8 + TS 6 strict + Tailwind 3 + Supabase eu-west-1 (`xzmpnchlguibclvxyynt`).

---

## 2. ESTADO ACTUAL DE LA BBDD (19 MAYO 2026)

### 2.1 — Hechos clave verificados

- ✅ **75 tablas en `public` schema** (no 40 como decía CONTEXTO viejo).
- ✅ **100% de tablas con RLS ON** (auditoría confirmada).
- ✅ **9 tablas auth nuevas creadas en Sprint 1** (ejecutado 18-19 mayo):
  - `platform_admins` (1 fila: Julio CEO)
  - `platform_admin_permissions` (1 fila: Julio con todos flags=true)
  - `platform_admin_2fa` (0 filas; setup Sprint 4)
  - `auth_rate_limits` (0 filas; activo via Edge Function Sprint 2)
  - `impersonation_sessions` (0 filas)
  - `platform_audit_log` (1 fila: admin_created de Julio en seed M19)
  - `platform_settings` (1 fila: backup de current_user_is_admin pre-C2)
  - `permission_sets` (4 filas: 4 sets system globales con account_id NULL)
  - `permission_set_assignments` (0 filas)

### 2.2 — Columnas añadidas a tablas existentes

**`accounts`** (5 columnas nuevas):
- `suspended_at`, `suspended_by`, `suspension_reason`
- `archived_at`, `deleted_at`
- 3 constraints nuevos: `suspended_consistency`, `lifecycle_order`, `accounts_slug_format` (este último ya existía).

**`user_profiles`** (6 columnas nuevas):
- `terms_accepted_at`, `welcome_completed_at`, `last_password_change_at`, `last_login_at`
- `suspended_at`, `suspended_by`
- 2 constraints nuevos: `welcome_requires_terms`, `suspended_consistency`.
- 2 índices nuevos: `idx_user_profiles_active`, `idx_user_profiles_login_resolution`.

### 2.3 — FK constraints modificados (CRÍTICO LEGAL)

**`clock_entries.employee_id`**: `ON DELETE CASCADE` → **`ON DELETE RESTRICT`**.
**`documents.employee_id`**: `ON DELETE CASCADE` → **`ON DELETE RESTRICT`**.

⚠️ **Implicación para frontend Fase 1**: NO ofrecer botón "Eliminar empleado" físico. Solo soft delete (`UPDATE employees SET active = false`). Cumple Real Decreto-ley 8/2019.

### 2.4 — Funciones auxiliares RLS

**Funciones del Bloque S del 16/05 (mantenidas):**
- `current_user_is_admin_of(uuid)` — admin de cuenta específica.
- `current_user_is_admin_or_manager_of(uuid)` — admin o manager.
- `current_user_account_ids()` — array de cuentas del user.

**Función refactorizada en M13 (19/05):**
- `current_user_is_admin()` — **YA NO usa `accounts.is_internal`**. Ahora consulta `platform_admins`.
- Backup de definición vieja guardado en `platform_settings.key='backup_current_user_is_admin_pre_C2'`.

**Funciones nuevas en M14 (19/05):**
- `has_permission(account_id, permission_key)` — cascada B: admin → legacy column → permission_set jsonb → DENY.
- `current_user_has_platform_permission(flag)` — verifica flag en `platform_admin_permissions`.
- `belongs_to_account(uuid)` — wrapper sobre current_user_account_ids.

### 2.5 — Triggers nuevos

- `trg_protect_last_admin` en `platform_admins` (BEFORE UPDATE/DELETE) — impide self-lockout del último CEO.
- `trg_replicate_system_permission_sets` en `accounts` (AFTER INSERT) — copia 4 sets system a cada cuenta nueva.
- `trg_platform_admin_permissions_updated_at` (BEFORE UPDATE) — set_updated_at.
- `trg_permission_sets_updated_at` (BEFORE UPDATE) — set_updated_at.
- `trg_platform_settings_updated_at` (BEFORE UPDATE) — set_updated_at.

### 2.6 — Cron jobs activos (pg_cron disponible)

- `cleanup_auth_rate_limits_daily` — diario a las 03:00 UTC.
- `force_close_impersonations_5min` — cada 5 minutos.

### 2.7 — Conteo de filas relevantes

```
accounts                   2  (Llorente29 + Foodint Interno)
user_profiles              3  (incluye Julio admin en cuenta interna)
employees                  4
locations                  3  (los 3 de Llorente29)
clock_entries              0
appcc_executions           0
appcc_templates           52  (26 seed × 2 cuentas, vía trigger seed)
platform_admins            1  (Julio CEO)
permission_sets            4  (4 templates system globales)
platform_audit_log         1
platform_settings          1
```

**Diagnóstico**: Llorente29 NO usa la app todavía. 0 fichajes en BBDD. Esto justifica el riesgo aceptado de ejecutar migrations sin PITR activo.

---

## 3. INFRAESTRUCTURA DESPLEGADA

### 3.1 — Dominios

- `folvy.app` apex → Vercel proyecto `folvy-landing` (producción).
- `app.folvy.app` → Vercel proyecto `folvy-app-staging` (staging Folvy V1).
- `folvy.es` → registrado, sin configurar.
- ⚠️ Documentos viejos mencionan `folvy.com` — **ya no aplica**, cambiar a `folvy.app` en próxima sesión.

### 3.2 — Hosting Vercel

- 2 proyectos creados con SSL Let's Encrypt automático.
- Repos GitHub: `folvy-landing`, `folvy-app-staging`.
- 2FA GitHub activo, backup codes guardados por Julio.

### 3.3 — BBDD Supabase

- Plan: **Supabase Pro** ✅ activo.
- Región: eu-west-1 (Ireland).
- **PITR: ❌ NO activado.** PITR es **add-on de pago adicional al plan Pro** (~+100$/mes). Detectado por José el 18/05 ~23:00 UTC.
- Backups disponibles actualmente: **"Scheduled backups" diarios** (1 backup/día, retención ~7 días).
- Decisión Julio aprobada 18/05/2026 23:16 UTC vía WhatsApp: **Opción B — aceptar riesgo con scheduled backups, NO activar PITR add-on por ahora**.
- 🟡 **Pendiente revisar PITR antes de Llorente29 producción (Sprint 14, septiembre 2026).**

### 3.4 — Email transaccional Resend

- Cuenta: workspace "Folvy", owner `jgcolon@idasal.com`.
- Dominio `folvy.app` verificado (DKIM + SPF + DMARC + MX en OVH).
- API key `folvy-production-v1` generada, scope "Sending access", guardada por Julio.
- 🟡 **Pendiente activar 2FA en Resend** (deuda registrada 18/05).
- 🟡 **Pendiente migrar owner cuenta** de `@idasal.com` a `@folvy.app` cuando email Folvy operativo.

### 3.5 — Email Folvy operativo

- **NO existe todavía**. OVH MX Plan solo permite redirects, no buzones.
- Decisión presupuestaria pendiente: Email Pro OVH (~40€/año) vs Zoho gratis vs Google Workspace.

---

## 4. DECISIONES ARQUITECTÓNICAS APROBADAS (18-19 MAYO 2026)

Todas formalmente aprobadas por Julio CEO. Registradas en audit log + en este documento.

### D1 — Permisos (Opción B)

**Aprobado 18/05/2026 ~22:30 UTC.**

Mantener `manager_permissions` (columnas booleanas legacy del Bloque S) + añadir `permission_sets` + `permission_set_assignments` como capa jsonb superior.

Resolución cascada en función `has_permission()`:
1. Admin de cuenta → siempre `true`.
2. Override en columna `manager_permissions` (si existe) → gana.
3. Lectura desde `permission_set.permissions` jsonb → vale.
4. Default → `false`.

Migración gradual de columnas legacy a jsonb cuando UI ya no las lee.

### D2 — Feature flags y plan_id

**Aprobado 18/05/2026 ~22:35 UTC.**

Mantener tabla `feature_flags` separada (ya existe, más auditable con granted_by/expires_at/source). Mantener `subscriptions.plan_id` como fuente de truth. NO añadir `accounts.feature_flags jsonb` ni `accounts.plan_id`.

Sesión 2 §2.3 queda enmendada: la BBDD actual está mejor normalizada que la propuesta del documento.

### D3 — Patrón platform admin (Opción C2)

**Aprobado 18/05/2026 ~22:40 UTC.**

Tabla `platform_admins` separada según Sesión 2 §2.2. Implicó:
- Crear `platform_admins` + `platform_admin_permissions` + `platform_admin_2fa` (M03, M04, M05).
- Reescribir `current_user_is_admin()` para consultar nueva tabla (M13).
- Migrar Julio CEO de `user_profile` admin en cuenta `is_internal=true` → fila en `platform_admins` con role='ceo' (M19).
- Columna `accounts.is_internal` mantenida por compatibilidad. **Pendiente decidir Sprint 2+** si DROP COLUMN o mantener.

### D4 — CASCADE legal (Opción α)

**Aprobado 18/05/2026 ~22:55 UTC.**

Cambiar FK `clock_entries.employee_id` y `documents.employee_id` de `ON DELETE CASCADE` a **`ON DELETE RESTRICT`** (M12). Frontend usa soft delete (`active = false`). Cumple Real Decreto-ley 8/2019 (conservación fichajes 4 años).

⚠️ Implicación: frontend NO debe ofrecer DELETE físico de empleados con fichajes/docs.

### D5 (decisión menor) — PITR Supabase

**Aprobado 18/05/2026 23:16 UTC vía WhatsApp.**

NO activar add-on PITR. Aceptar riesgo de pérdida hasta 18h con scheduled backups diarios. Justificación: Llorente29 no usa app, datos recuperables manualmente en 10 min.

**Revisar antes de Sprint 14 (migración Llorente29 producción).**

---

## 5. HISTORIAL DE SESIONES

- **P1-P3:** construcción inicial app cliente Llorente29 (APPCC, employees, locations, brands).
- **P4 (16/05/2026):** Bloque C Fase 1 cerrada — URL slug + BrowserRouter. **Bloque S blindó RLS** en 40 tablas iniciales + creó 4 funciones auxiliares.
- **P5 (17/05/2026):** preparación Bloque C Fases 2-3. Sesión sin código.
- **P6 (17/05/2026):** Catálogo APPCC seed completo + locales reales Llorente29 + 1 empleado Pamela. Bug 3 Edge Function `manage-employee` aplazado.
- **Sesión 0 (18/05/2026 mañana):** Reconciliación arquitectónica completa. Rebrand Folvy. Decisión Escenario C1 (Fase 0 antes Llorente29). 4 documentos maestros producidos (~4325 líneas).
- **Sesión 1-2-3 (18/05/2026 día):** Sprint 0.1 — pre-requisitos CEO cerrados al 100% (Vercel, Resend, Supabase Pro, dominios, GitHub 2FA).
- **Sesión 4 (18/05/2026 noche):** Auditoría BBDD completa (75 tablas reales). 4 decisiones arquitectónicas D1-D4 aprobadas. 19 migrations SQL generadas como borrador.
- **Sesión 5 (18-19/05/2026 noche+mañana):** **SPRINT 1 EJECUTADO.** 19 migrations aplicadas en producción Supabase. 3 bugs SQL detectados en vivo y corregidos. PITR descubierto NO activo (D5 aprobada). Julio + José ejecutaron por turnos.
- **Sesión Personal T8 + Punto 3 (22/05/2026):** Onboarding sin password temporal cerrado (welcome via `hashed_token` + `/welcome` con `verifyOtp`, sin tocar `supabase.ts`). Wizard `NuevaCuentaPage` sin password, status corregido a `'trial'`. 404 SPA en Vercel resuelto (`vercel.json` rewrite). Auditoría módulo Personal T1-T8: T1-T7 completos contra Supabase, T8 estaba solo UI. **Punto 1 (T8 export gestoría) CERRADO:** enum `vacations.type` alineado en cliente y BBDD, vacations leídas de Supabase en `InformesPage`, TXT manual migrado a CSV vía nueva función `exportPersonalReportCsv` en `exportGestoriaService`. **Punto 3 (config gestoría en BBDD por cuenta) CERRADO:** tabla `account_gestoria_config` con RLS + triggers + backfill, service `gestoriaConfigService`, `NotifConfig` limpio (5 campos `gestoria*` removidos), `AppContext` expone `gestoriaConfig` + `saveGestoriaConfig`, `StaffPage` migrado. **CHECK constraint** `vacations_type_valid` añadido. **Punto 2 (schema cuadrante duplicado):** informe escrito generado, ejecución diferida — bug funcional confirmado en `AhoraMismoPage` (siempre `'no_scheduled'`).

---

## 6. ESTADO DE EJECUCIÓN SPRINT 1 (19 MAYO 2026)

**🎉 SPRINT 1 EJECUTADO AL 100% — 19/19 MIGRATIONS COMPLETADAS.**

```
✅ M01 — alter_accounts_add_auth_columns          (Llorente29 noche 18/05, José)
✅ M02 — alter_user_profiles_add_auth_columns     (Llorente29 noche 18/05, José)
✅ M03 — create_platform_admins                   (Llorente29 noche 18/05, José)
✅ M04 — create_platform_admin_permissions        (Llorente29 noche 18/05, José)
✅ M05 — create_platform_admin_2fa                (mañana 19/05, Julio) [BUG FIX]
✅ M06 — create_auth_rate_limits                  (mañana 19/05, Julio)
✅ M07 — create_impersonation_sessions            (mañana 19/05, Julio)
✅ M08 — create_platform_audit_log                (mañana 19/05, Julio)
✅ M09 — create_platform_settings                 (mañana 19/05, Julio)
✅ M10 — create_permission_sets                   (mañana 19/05, Julio)
✅ M11 — create_permission_set_assignments        (mañana 19/05, Julio)
✅ M12 — fix_cascade_clock_entries_documents      (mañana 19/05, Julio)
✅ M14 — create_auth_helper_functions             (mañana 19/05, Julio)
✅ M15 — create_auth_rls_policies (23 policies)   (mañana 19/05, Julio)
✅ M16 — create_auth_triggers (+2 cron jobs)      (mañana 19/05, Julio)
✅ M17 — create_auth_indices                      (mañana 19/05, Julio)
✅ M18 — seed_default_permission_sets (4 sets)    (mañana 19/05, Julio) [BUG FIX]
✅ M19 — seed_first_platform_admin (Julio CEO)    (mañana 19/05, Julio)
✅ M13 — refactor_current_user_is_admin           (mañana 19/05, Julio) [ÚLTIMA]
```

### 3 bugs SQL detectados y corregidos en vivo

1. **M01**: `accounts_slug_format` ya existía en BBDD con regex distinta. Solución: quitar de M01, mantener el existente.
2. **M02**: `valid_role` ya existía (constraint role IN admin/manager/worker). Solución: quitar `user_profiles_role_valid` de M02.
3. **M05**: `CHECK (NOT EXISTS (SELECT...))` rechazado por PostgreSQL — no permite subqueries en CHECK. Solución: usar operador `<@` (array contenido en array).
4. **M06**: Índice parcial con `WHERE first_attempt < now() - 24h` rechazado — `now()` es función volátil. Solución: eliminar índice (cleanup hace seq scan, BBDD pequeña).
5. **M18**: `jsonb_build_object()` con 51 permisos = 102 args = falla. PostgreSQL acepta máximo 100 args. Solución: usar literal jsonb `'{...}'::jsonb`.

### Reglas técnicas aprendidas para futuras migrations

1. ❌ Nunca subqueries (`NOT EXISTS`, `SELECT`) en CHECK constraints.
2. ❌ Nunca funciones volátiles (`now()`, `random()`) en `WHERE` de índice parcial.
3. ❌ Nunca `jsonb_build_object()` con más de 50 pares clave-valor — usar literal `'{...}'::jsonb`.
4. ✅ Siempre preview-antes (consulta read-only) antes de cada migration.
5. ✅ Verificación post-ejecución obligatoria antes de pasar a siguiente migration.

---

## 7. PENDIENTE PRÓXIMAS SESIONES

### Inmediato (Sprint 0.2 restante)

1. **Limpiar repo Foodint actual** + crear branch `folvy-v1`.
2. **Actualizar 4 documentos maestros**: `folvy.com` → `folvy.app`.
3. **Generar addendum Sesión 2** con decisiones aprobadas (en curso, paralelo a este documento).
4. **Decidir email Folvy** (OVH Email Pro vs Zoho vs Google Workspace).
5. **Activar 2FA en Resend** (deuda).
6. **Llamada Llorente29** + calendario realista (pre-requisito CEO Sprint 0.1 pendiente).

### Sprint 2 (2-6 junio 2026): Edge Functions auth

Construir:
- `custom-access-token-hook` (JWT claims Folvy).
- `login-handler` (rate limit + audit log).
- `welcome-handler` (set password + accept T&C).
- `password-reset-handler`.
- `activate-platform-admin-2fa` (TOTP secret cifrado + 10 backup codes hash bcrypt).
- `verify-2fa`.
- `start-impersonation` + `end-impersonation`.

### Sprint 3 (16-20 junio 2026): Shell + Rebrand Folvy

- Shell base (`src/shell/*`, ModuleRegistry, EventBus).
- Rebranding Folvy completo (paleta, tipografías, logos, manifests, email templates).

### Roadmap módulo Personal (orden, sin plazos)

1. **Punto 2: unificar schema cuadrante.** `schedulerService` (canónico, `shift_templates` + `schedules.cells`) vs `calendarService` (paralelo, `shift_types`/`weekly_plans`/`shift_assignments`/`shift_minimums`). `AhoraMismoPage` tiene bug funcional latente (siempre `'no_scheduled'` porque nadie escribe en las tablas que lee). 3 páginas y 3 services huérfanos sin ruta (PlantillaLocalPage, TiposTurnoPage, ModificacionesPanel, calendarAutoGen, calendarSmartGen, calendarValidations) — eliminables en fase 2.B sin riesgo. Plan completo en informe escrito del 22/05.
   - **Estado 22/05/2026:** fase 2.B ejecutada (6 archivos huérfanos eliminados, build verde). Tablas legacy verificadas a 0 filas (`shift_types`, `weekly_plans`, `shift_assignments`, `shift_minimums`) y canónicas también a 0 (`shift_templates`, `schedules`, `employee_availability`). **Drop limpio confirmado para 2.C**, sin migración de datos. Pendiente: 2.A (reescribir `AhoraMismoPage` sobre `schedulerService`) + periodo de observación antes del rename-then-drop de 2.C. `shift_types` se conserva mientras `AvisosSettingsPage` siga usándola.
2. **Prueba E2E real de Personal en producción** (cuenta real o de prueba): alta empleado → fichaje → vacación → cuadrante → cambio de turno → bolsa de horas → informe gestoría CSV.
3. **Decisión de negocio:** producción Llorente29 vs siguiente módulo APPCC.
4. **Convenio español al planificar.** Igualar capacidades de Skello/Combo: restricciones por convenio colectivo, horas extra, descansos obligatorios entre turnos (ya existe `checkRestViolations` en `scheduler.ts` legacy).
5. **Comunicación en app del empleado.** Hueco actualmente cubierto por Combo/GuavaHR: chat, anuncios, encuestas.
6. **IA Nivel 1** (asistente conversacional sobre datos propios) y **Nivel 2** (heurísticas predictivas: cobertura, absentismo, horas extras). **Nivel 3** (ML real) diferido a 2027.

**Nota estratégica:** el foso real del producto no son las features individuales sino la **integración Personal–APPCC–Ventas**, ya construida sobre la base de datos compartida (75 tablas, RLS al 100%).

### Patrones decididos del módulo Personal (no son deuda)

- **`Employee.vacations/documents/formations` viven siempre `[]` desde `supabaseSync.rowToEmployee`.** Es el patrón del módulo — cualquier pantalla que necesite estos datos los carga vía service dedicado (`vacationsService.fetchVacations`, `documentsService.fetchDocuments`, formaciones). Razón: cargar masivamente en cada sync escala mal y `supabaseSync.rowToEmployee` es zona consolidada que no se toca. Decisión 22/05/2026.

### Deudas menores Personal (apuntadas 22/05/2026)

- **BOM cosmético en `exportPersonalReportCsv`** (`exportGestoriaService.ts:566`): carácter literal U+FEFF en lugar de `'﻿'`. **Cerrada como cosmética sin solución técnica vía Edit**: el harness equipara las dos formas como idénticas y no permite el cambio sin reescribir el fichero completo. Funcionalmente correcto (UTF-8 válido).
- **`scheduler.ts:735-736`**: heurística `notes.includes('Baja'|'Vacaciones')` legacy en `rebalanceCoverage` (interna de `applyModifications`). Pendiente eliminar junto con el código muerto de scheduler.ts (fase 1 punto 6).
- **Filtro de período en tabla en pantalla** de `InformesPage` — ✅ **RESUELTO 22/05/2026**: cambiado a regla canónica de solapamiento `start <= dateTo && end >= dateFrom`.

### Cuestiones a decidir más adelante

- Decidir destino columna `accounts.is_internal` (DROP COLUMN o mantener) tras auditar uso en frontend.
- Activar PITR Supabase add-on antes de Sprint 14 (migración Llorente29 producción).
- Limpiar 10 tablas backup del Bloque S (`_backup_20260516_*`) — confirmar con Julio.

---

## 8. REGLAS DE TRABAJO (consolidadas)

### Reglas no negociables del proyecto

1. **Archivos completos, NO diffs.** Si modifico un fichero, lo paso entero.
2. **Pedir fichero original ANTES de modificarlo.** No inventar código sobre suposiciones.
3. **NO modificar `App.tsx`** sin permiso explícito de Julio.
4. **NO sobrescribir `notificationsService.ts`** (firma posicional consolidada).
5. **Antes de cualquier decisión arquitectónica, consultar BBDD real vía `information_schema`.** La BBDD es la verdad. CONTEXTO_CLAUDE puede estar desactualizado.
6. **SQL transaccional (BEGIN/COMMIT)** cuando hay varios cambios relacionados.
7. **SQL revisable ANTES de ejecutar.** Yo (Claude) propongo, humano operando ejecuta y verifica.
8. **Yo (Julio) decido cuándo cerrar sesión.** Pero si Claude detecta riesgo o fatiga, lo recomienda con argumentos.
9. **Sin pelotismo.** Si Claude discrepa con decisión de Julio, lo dice.
10. **Al final de cada sesión técnica importante, ofrecer actualizar CONTEXTO_CLAUDE.md.**

### Reglas técnicas

- TypeScript strict, camelCase en cliente, snake_case en BBDD.
- Doble cast `as unknown as Json` para columnas jsonb.
- tsconfig.app.json: verbatimModuleSyntax + erasableSyntaxOnly → NO enums, NO parameter properties.
- Oxc parser Vite 8: NO mezclar `??` con `&&` sin paréntesis.

### Reglas de protocolo refuerzo

- **Identificación obligatoria del refuerzo** al inicio: "Soy [Nombre], el refuerzo técnico de Julio".
- Si Claude no sabe quién está al teclado, asume Julio por defecto.
- Refuerzo tiene autoridad delegada total para decisiones técnicas en su turno.
- Decisiones que cambian planos documentales aprobados merecen escalación a Julio aunque refuerzo tenga autoridad delegada.
- Para autorizaciones que llegan vía otro canal (WhatsApp, oral), exigir **trazabilidad escrita en chat** (screenshot o que Julio escriba directamente).

### Reglas de seguridad operativa

- **No ejecutar SQL en producción sin red de seguridad confirmada** (PITR o staging).
- **No ejecutar SQL borrador no probado en producción** sin auditoría preview-antes.
- **Verificar identidad** cuando entran decisiones de impacto presupuestario o producción.
- **Parar inmediatamente** ante cualquier output inesperado durante ejecución de migrations.

---

## 9. ENTREGABLES Y ASSETS

### Documentos maestros (Project Knowledge)

1. `CONTEXTO_CLAUDE.md` — este documento (actualizado 19/05/2026).
2. `folvy_arquitectura_reconciliada.md` (Sesión 0).
3. `folvy_v1_spec.md` (Sesión 1).
4. `folvy_auth_model.md` (Sesión 2).
5. `folvy_roadmap.md` (Sesión 3).
6. **Addendum Sesión 2** con decisiones aprobadas — pendiente subir al knowledge (generado hoy).

### Logos y assets

1. `folvy_logo_principal.png` — logo color sobre blanco.
2. `folvy_logo_oscuro.svg` — logo sobre fondo accent.
3. `folvy_isotipo_manager.svg` — app icon Manager 512×512.
4. `folvy_isotipo_empleados.svg` — app icon Empleados 512×512.

### Migrations SQL ejecutadas

Las 19 migrations están en `/home/claude/folvy-sprint1-migrations/` (versiones borrador) y en `/mnt/user-data/outputs/folvy-sprint1-migrations/` (versiones presentadas vía present_files). **Versiones realmente ejecutadas en producción incluyen los 5 bug fixes** documentados en §6.

---

## 10. CONTEXTO OPERATIVO

- **Cliente activo Llorente29.** Romper = pérdida de ingreso. Pero NO usa app actualmente (0 fichajes).
- **Estamos en Fase 0 de refactor** (Sprint 0.2 en curso, Sprint 1 cerrado anoche).
- **BBDD blindada con RLS** (75 tablas tras Sprint 1).
- **App actual sigue en Foodint legacy** (GitHub Pages). Folvy V1 no existe en código todavía.
- **Próximo paso técnico real**: Sprint 2 (9-13 junio) Edge Functions auth.

---

**Documento cerrado: 19 de mayo de 2026, ~08:30 UTC.**
**Próxima sesión:** Sprint 0.2 restante (limpiar repo + branch + actualizar docs `folvy.com`→`folvy.app`).
**Lectura obligatoria al arrancar:** este archivo + addendum Sesión 2.
