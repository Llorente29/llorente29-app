# CONTEXTO_CLAUDE.md

> **Documento maestro de memoria persistente del proyecto Folvy.**
> Lectura obligatoria al inicio de cada sesión técnica.
> Última actualización: **22 de mayo de 2026, tras sesión APPCC + Comunicación (Arreglos 1-2, Despachador Fase A completa, Fase B paso 1).**

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
   - **Estado 22/05/2026:** fases ejecutadas y en producción — **2.B** (6 archivos huérfanos eliminados), **2.A** (`AhoraMismoPage` reescrita sobre `schedulerService` + `schedules.cells`), **2.A.2** (`horasComputo` agnóstico a `calendarService` vía tipos propios `ScheduledShift`/`ShiftTypeInfo`), **Fase 1** completa (`gestoriaLastSent` real, filtro de período corregido, patrón `vacations/documents/formations` documentado, botón "Validar cuadrante" en CalendarioPage, 348 líneas de código muerto eliminadas de `scheduler.ts`), **Cubo 2 A** (alerta `rest_12h` de descanso 12h entre jornadas en `validateSchedule`), **Cubo 2 B** (`PrediccionPersonalPage` oculta de la sidebar de Ventas; ruta accesible solo por URL directa). Tablas legacy verificadas a 0 filas el 22/05; drop limpio confirmado. **Pendiente:** **2.C** rename-then-drop SQL de `weekly_plans`/`shift_assignments`/`shift_minimums` tras periodo de observación, y **2.D** destino de `AvisosSettingsPage` (mientras viva, `shift_types` y `calendarService.ts` se conservan).
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
- **`scheduler.ts` heurística `notes.includes('Baja'|'Vacaciones')`** — ✅ **RESUELTA 22/05/2026** con la limpieza de 348 líneas de código muerto (Fase 1 punto 6). La función `rebalanceCoverage` y todo `applyModifications` fueron eliminados.
- **Filtro de período en tabla en pantalla** de `InformesPage` — ✅ **RESUELTO 22/05/2026**: cambiado a regla canónica de solapamiento `start <= dateTo && end >= dateFrom`.
- **Cruce medianoche en detector de solape mismo-día** (`scheduleGenerator.validateSchedule`, bloque "Solape temporal entre turnos del mismo empleado el mismo día"): si un empleado tiene un turno noche del día N (cerrando >24h) y otro turno madrugada del día N+1 (antes de la hora de cierre del anterior), no se detecta como solape porque el chequeo agrupa por día. Cota baja. Diferido.
- **Cruce domingo→lunes(+1) en `rest_12h`**: la alerta de descanso 12h opera intra-semana (`Schedule` cubre lunes-domingo). No valida el descanso entre el último turno del domingo y el primero del lunes de la semana siguiente. Requiere look-ahead a otra `Schedule` row. Diferido.
- **`manager_permissions.show_prediccion_personal`** ornamental tras ocultar la página (Cubo 2 B): la columna sigue en BBDD pero no controla nada. Retirar en migration futura junto al resto de `manager_permissions` cuando se migre a `permission_sets` jsonb (decisión D1).

### Estado del módulo APPCC tras sesión 22/05/2026

Auditoría completa realizada (8 áreas funcionales + portal trabajador). Veredicto general: **módulo maduro y coherente**, sin TODOs significativos antes de la sesión salvo los 3 cerrados hoy. Integración Personal↔APPCC verificada: `assignmentService` lee `clock_entries`/`employees`/`user_profiles` para asignación automática de checklists; portal trabajador filtra por `assigned_to`.

**Deudas cerradas hoy:**
- ✅ `src/modules/appcc/services/notificationsService.ts` (168 líneas) **eliminado** — era huérfano duplicado del global. Todo el módulo usa `src/services/notificationsService.ts` (que escribe en `employee_notifications`, no `appcc_notifications`).
- ✅ **TODO `incidentsService:920`** resuelto — `notifyVerificationPending` ahora notifica a admins/managers de la cuenta tras aplicar correctiva (vía nuevo helper `getManagerEmployeeIdsForAccount` que resuelve `user_profiles` → `employee_id`). Filtra al propio aplicador para evitar autonotificación. Tipo `'generic'` con `kind: 'appcc_incident_action_applied'` en `data` (mismo patrón que `notifyAssignment`).
- ✅ **PDF CAPA con fotos embebidas** (`pdfExportService:1120`) — placeholder de conteo reemplazado por embebido real: helper `loadAndResizeImage` (fetch + canvas resize a 800px max width, JPEG quality 0.7), signed URLs batch sobre bucket `appcc-photos`, layout 1 foto por fila con caption (`Foto N — timestamp — caption original si lo tiene`), paginación automática, placeholder por foto si falla la descarga.

**Deudas menores apuntadas (no urgentes):**
- **EXIF rotation** en `loadAndResizeImage`: `canvas.drawImage` no aplica la rotación EXIF de las fotos. Las fotos verticales subidas desde móvil pueden salir rotadas en el PDF.
- **Uploader en caption del PDF**: `appcc_incident_photos.uploaded_by` es id sin resolver a nombre. Caption actual no lo incluye.
- **Límite de tamaño PDF CAPA**: sin tope explícito. Si gestoría rechaza PDFs >10MB con muchas fotos, añadir paginación/limit.
- **Reportador (`incident.created_by`) en notificación de correctiva**: pendiente clarificar si el campo guarda `user_id` o `employee_id`. Mientras tanto, solo se notifica a admins/managers, no al reportador.
- **Filtro de notificaciones APPCC por severidad**: si en producción real resulta ruidoso, añadir `if severity in ('alta','critica')` antes de notificar (acordado con CEO en diseño).
- **Tablas BBDD `appcc_audit_log` y `appcc_audit_schedules` sin consumidor en código cliente**: deuda inversa. Probable que `appcc_audit_log` se pueble por triggers BBDD; `appcc_audit_schedules` aparenta ser tabla preparada para "programación recurrente de auditorías" sin implementar.

**Test manual requerido en producción tras deploy:**
- Crear incidencia con 2-3 fotos adjuntas, aplicar correctiva, descargar PDF de CAPA. Verificar fotos visibles, captions correctos, peso < 5MB.
- Aplicar una correctiva siendo manager. Verificar que otros admins/managers de la cuenta reciben notificación in-app pero el propio aplicador no.

### Sesión Comunicación 22/05/2026 — sistema de notificaciones multi-canal

#### En producción (cerrado y verificado)

**APPCC (3 deudas cerradas):**
- ✅ `src/modules/appcc/services/notificationsService.ts` (168 líneas) eliminado — era huérfano duplicado del global.
- ✅ TODO `incidentsService:920` resuelto — `notifyVerificationPending` notifica admins/managers tras correctiva (filtra al propio aplicador para evitar autonotificación).
- ✅ PDF CAPA con fotos embebidas (`pdfExportService:1120`) — placeholder reemplazado por embedding real (helper `loadAndResizeImage`, signed URLs batch, layout 1×fila, paginación).

**Comunicación — Arreglos previos al despachador:**
- ✅ **Arreglo 1**: bug RLS `_update` de `employee_notifications` corregido. Policy nueva con doble rama: admin de la cuenta OR el propio user (via `user_profiles.user_id = auth.uid()` AND `up.employee_id = employee_notifications.employee_id`). WITH CHECK simétrico. **Aplicado y verificado en BBDD.** El empleado ahora marca sus propias leídas y persiste tras F5.
- ✅ **Arreglo 2**: bandeja del gestor. `NotificationBell` montado en `ShellTopBar` (sustituye el placeholder `<Bell>` previo). Si `userProfile?.employeeId` es null (platform admin, admin sin employee vinculado), la campana se esconde.

**Despachador multi-canal — Fase A COMPLETA (4/4):**
- ✅ **A.1** SQL: columna `sender_employee_id` nullable en `employee_notifications` + policy INSERT anti-spoofing (3 ramas: cuenta accesible AND (sender NULL OR propio user OR admin)). **Aplicado tras un primer intento fallido que no se llegó a commitear** — segunda ejecución verificada con `information_schema` y `pg_policies` antes de avanzar.
- ✅ **A.2** `notificationsService.ts`: parámetro opcional `senderEmployeeId?` añadido AL FINAL en `createNotification` y `createNotificationsForEmployees`. **Regla v17.1 respetada** (los 5 parámetros posicionales originales NO se mueven). Los 6 consumidores legacy siguen compilando sin tocarse.
- ✅ **A.3** `src/services/dispatcherService.ts` (nuevo): API `dispatch(event, recipients, channels)` con tipos `Channel = 'in_app' | 'email'`. Canal `in_app` real (vía `createNotificationsForEmployees` con sender propagado). Canal `email` STUB en Fase A: recipients cuentan como `skipped`, no envía. El caller decide canales explícitamente; sin inferencia automática (Fase C).
- ✅ **A.4-Y** `EmployeeNotification` ampliado con `senderEmployeeId?: string` (cambio aditivo de tipo, coherente con v17.1 que aplica a firmas posicionales, no a tipos de retorno). `NotificationRow` y `rowToNotification` mapean la columna nueva. `NotificationBell` resuelve el sender vía `useApp().staff` y renderiza " · De {nombre}" junto al `timeAgo`. Best-effort si no se encuentra.

**Despachador multi-canal — Fase B paso B.1:**
- ✅ **B.1** SQL: tabla `account_email_log` creada con 12 columnas (id, account_id, sender_user_id, sender_employee_id, recipient_employee_id, to_email, template, subject, resend_email_id, status, error_message, sent_at). FKs con ON DELETE adecuado (account/recipient CASCADE; sender_employee SET NULL). CHECK `status IN ('sent', 'failed', 'rate_limited')`. RLS habilitado con **exactamente 1 policy**: SELECT solo para cuenta accesible. **Sin policies de escritura para `authenticated`** — solo service_role de la Edge Function escribe. Índice `(account_id, sent_at DESC)` para rate-limit y auditoría. **Verificado en BBDD** con 6 queries.

#### Pendiente inmediato próxima sesión — B.2 Edge Function `account-email`

**Estado:** código diseñado en chat (~280 líneas index.ts + ~110 líneas templates.ts), NO escrito ni desplegado.

**⚠️ FALLO CRÍTICO de seguridad a corregir antes de escribir:**

El borrador usa `decodeJwtSub(bearer)` — una función helper que solo **decodifica** el JWT en cliente sin verificar la firma. Un atacante podría fabricar un JWT con cualquier `sub`. El `send-email` legacy hace lo mismo (`decodeFolvyClaims`), aceptable allí porque `is_platform_admin` es un nivel más estricto y bajo control de Folvy; en `account-email` la superficie es mucho mayor (cualquier user de cuenta cliente).

**Corrección obligatoria antes de desplegar:** sustituir `decodeJwtSub` por `supabase.auth.getUser(jwt)` que verifica criptográficamente la firma contra el secret del proyecto. Si retorna error o user null → 401. La consulta posterior a `user_profiles` con service_role (para bypass RLS) se mantiene como está.

**Decisiones tomadas para B.2:**
1. **Rechazar batch entero** si falta `employees.email` en algún recipient (fail-closed, no skip parcial).
2. **Rate limit** vía conteo en `account_email_log` (no en `auth_rate_limits` — una tabla menos que tocar). 50/h, 200/día por cuenta.
3. **Una sola cuenta por llamada** — el batch debe ser todo de la misma cuenta. Simplifica rate-limit y autorización.
4. **Reply-To fijo** `jgcolon@idasal.com` en Fase B (no email del manager). Reply-to dinámico es Fase C tras validar UX.

**Recordatorio técnico para B.2:**
- Verificar el nombre exacto del campo en la API de Resend: `reply_to` vs `replyTo`. El código actual de `send-email` usa `reply_to`; confirmar contra doc oficial Resend antes de copiar al nuevo.

**Otras validaciones diseñadas (mantener tal cual):**
- Auth: JWT firma-verificada + `user_profile.active=true` + `role IN ('admin','manager')`.
- `template === 'account_message'` único permitido.
- Longitudes: title 1-200, body 1-5000, recipients 1-50.
- Cross-tenant fail-closed: cada `employeeId` ∈ `employees` JOIN `locations.account_id` ∈ cuentas del caller. Si alguno no, rechaza batch.
- `to_email` recalculado server-side desde `employees.email` — NO se confía en el payload (defensa contra relay SMTP).
- From fijo `'Folvy <no-reply@folvy.app>'`. `senderName` solo en body (mitiga phishing por display name).
- `escapeHtml` en title/body/senderName. Sin links cliqueables. Sin attachments.
- Cada intento (sent/failed/rate_limited) registrado en `account_email_log`.

**Pasos restantes Fase B:**
- **B.2** Edge Function `account-email` (con la corrección de JWT). Escribir `index.ts` + `templates.ts`.
- **B.3** templates.ts (incluido en el bloque B.2 según diseño; mantener separado por trazabilidad).
- **B.4** Deploy `supabase functions deploy account-email` (lo hace Julio; Claude no tiene credenciales).
- **B.5** `src/services/accountEmailService.ts` wrapper cliente sobre la Edge Function.
- **B.6** Ampliar `dispatcherService` canal `'email'` (eliminar stub, llamar `accountEmailService`).
- **B.7** UI modal manager "Enviar mensaje a [empleado]" (en StaffPage o sitio TBD).
- **B.8** Build + commit + push.

**Fases futuras (no en este bloque):**
- C: preferencias por usuario (`user_notification_preferences`), webhooks Resend bounce/complaint, reply-to dinámico, broadcast a cuenta entera.
- D: chat 1-a-1 con réplica (`threads`, `messages`). Posible Folvy V1.1.

#### Tests manuales pendientes en producción

Acumulados de esta sesión, pendientes de validar por Julio en navegador con datos reales:

- **PDF CAPA con fotos**: crear incidencia con 2-3 fotos, aplicar correctiva, descargar PDF. Verificar fotos visibles + captions + peso < 5MB.
- **Notificación de correctiva APPCC**: aplicar correctiva siendo Pamela → otros admins/managers de la cuenta reciben notificación en su campana; Pamela NO se autonotifica.
- **Bandeja del gestor**: Pamela (manager con `employee_id`) ve campana en TopBar. Julio CEO (platform admin sin `employee_id`) NO ve campana.
- **Marcar notificación leída persiste**: tras Arreglo 1, pulsar item en la campana del worker → recargar F5 → sigue marcada leída.
- **Botón "Validar cuadrante"** en CalendarioPage: pulsar sobre cuadrante con/sin asignaciones → lista de issues color-coded o "Sin avisos".
- **Issue `rest_12h`**: asignar a un empleado turno noche del día N (cierra tarde, ej. 19-02) + turno mañana día N+1 (ej. 10:00). Validar → debe aparecer issue rojo "rest_12h" con cálculo correcto de horas de descanso.

#### Frente 3 pendiente tras canal — Folvy AI Capa 1

Cuando se cierre el bloque comunicación (Fase B completa), siguiente frente: **Folvy AI Capa 1** (asistente conversacional). Arquitectura del bloque comunicación está pensada también para preparar terreno a futuros agentes (eventos semánticos `kind`, dispatcher como punto de orquestación, registro auditable en `account_email_log` aplicable a `agent_actions_log` con el mismo patrón). Diseño detallado pendiente.

#### Riesgos consolidados del bloque comunicación

| Vector | Estado |
|---|---|
| Sender spoofing in-app | ✅ Mitigado en producción (policy INSERT con 3 ramas) |
| Email a destinatario arbitrario (relay SMTP) | Mitigación diseñada en B.2 (to_email server-side) |
| Email cross-tenant | Mitigación diseñada en B.2 (validación fail-closed) |
| **JWT no verificado (B.2 borrador)** | **⚠️ pendiente corregir antes de escribir/desplegar** |
| Spam outbound — reputación dominio | Rate limit en B.2; webhooks Resend en Fase C |
| XSS en cliente de email | escapeHtml diseñado en B.2 |
| Manager despedido | Filtro `active=true` diseñado en B.2 |
| Phishing por display name | From fijo + senderName en body, diseñado en B.2 |

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
