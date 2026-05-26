# CONTEXTO_CLAUDE.md

> **Documento maestro único de memoria persistente del proyecto Folvy.**
> Lectura obligatoria al inicio de cada sesión técnica.
> **Última actualización: 25/05/2026 (noche) — Fase B cerrada (E2E real verde); rescate de `manage-employee` versionado; frente "Acceso del trabajador / Portal" abierto como bloqueante de producción.**
>
> Este es el ÚNICO documento de contexto. `CONTEXTO_ESTADO.md` y `CONTEXTO_REGLAS.md`
> quedaron retirados el 25/05/2026: estaban desincronizados (describían "Sesión 17"
> sin el bloque Comunicación, y daban un nº de tablas erróneo). Toda su información
> viva se absorbió aquí. NO volver a subirlos al Project Knowledge.

---

## 0. CÓMO USAR ESTE DOCUMENTO

- **Lo único que cambia cada sesión es §1 (ESTADO VIVO).** Va arriba a propósito: al
  arrancar, leer §1 dice dónde estamos sin tropezar con datos antiguos. El resto (§2–§9)
  es referencia estable que cambia poco.
- **Al cierre de cada sesión técnica:** regenerar §1 y, si hubo cambios estructurales,
  las secciones afectadas. Claude ofrece esta actualización al final (regla §6.1.10).

### REGLA CERO (antes de responder cualquier pregunta técnica)

1. Leer este documento + los documentos maestros relevantes del Knowledge.
2. Si la respuesta requiere conocer el estado de la BBDD, ejecutar query a
   `information_schema` ANTES de proponer. **La BBDD es la verdad; este documento puede
   estar desactualizado.**
3. Si Julio (CEO) no se identifica explícitamente, asumir Julio.
4. Si entra un refuerzo técnico distinto, su primera línea debe ser declaración explícita
   ("Soy [Nombre], refuerzo técnico de Julio").
5. **Verificación de identidad mid-sesión:** si alguien cambia de rol durante la
   conversación, hacer una pregunta de contexto vivido (no buscable en el Knowledge)
   antes de aceptar el cambio.

---

## 1. ESTADO VIVO  ⟵ se regenera cada sesión

### 1.1 — Dónde estamos HOY (25/05/2026, cierre de sesión noche)

Folvy V1 es un SaaS multi-tenant **en producción** en `app.folvy.app`. Personal y APPCC
maduros. El bloque **Comunicación (despachador multi-canal) está CERRADO**: la Fase B se
completó hoy con la **primera prueba E2E real de extremo a extremo** (manager →
SendMessageModal → dispatcher → accountEmailService → Edge Function `account-email` →
Resend → buzón real), **verde por los dos canales** (email a Recibidos desde
`no-reply@folvy.app` con `senderName`; notificación in-app en `employee_notifications`).
Auditoría confirmada en `account_email_log` (`status=sent`, `resend_email_id` no nulo,
`sender_user_id` = caller vía JWT). El dominio `folvy.app` está REALMENTE verificado en
Resend (confirmado en vivo, no solo en config).

### 1.2 — Próximo paso inmediato: FRENTE "ACCESO DEL TRABAJADOR / PORTAL"  (ver §7.7)

Es ahora la **máxima prioridad** porque es **bloqueante de producción Llorente29**: hoy un
trabajador NO puede entrar a la app. El portal (`src/pages/trabajador/`, 12 páginas) está
construido (~80%) pero **sin cablear**: no hay caller de `TrabajadorApp`, el gate por rol
no existe en `App.tsx`. Además el alta de empleados está **probablemente rota en producción**
(`manage-employee` envía emails desde `foodint.es`, dominio que casi seguro NO está
verificado en Resend — es el "Bug 3 de P6" sin resolver). Modelo de acceso DECIDIDO: **C1
(usuario + contraseña prefijada, email sintético interno)**. Plan completo y decisiones en §7.7.

**Frentes abiertos alternativos** (Julio elige):
- **Diseño módulo Operaciones/Cocina** (escandallo). Decisión arquitectónica cara; diseño
  en frío. NO arrancado (se aparcó hoy al detectar el bloqueante del portal).
- Pre-producción Llorente29 (PITR, modelo de cobro, seguridad CEO).

### 1.3 — Estado del repo (al cierre 25/05 noche)

- Repo: `Llorente29/llorente29-app`, branch `main`, `C:\dev\llorente29-app`.
- `main` SINCRONIZADA con `origin/main`. Working tree limpio (salvo `.claude/`).
- Commits de la sesión, ya pusheados:
  - `f1cab56` (B.6), `4b577c0` (B.7), `4d63074` (docs) — empujados a origin al inicio de sesión.
  - `a08b5f1` — **rescate de `manage-employee`** (Edge Function que estaba desplegada en
    producción con 10 deploys pero SIN versionar; "bomba" desactivada). Solo `index.ts`;
    falta el `deno.json` (añadir al tocar la función en C1).
- Fase B (Comunicación): NO requirió commit de cierre nuevo — el código ya vivía en
  f1cab56/4b577c0; la E2E solo generó datos en BBDD (ya limpiados, COMMIT verificado 0/0/0).

### 1.4 — Estado de los frentes tocados hoy (C, D)

- **D (docs):** `CLAUDE.md` raíz REVISADO y SANO (no fósil; coherente con CONTEXTO). El
  resto de la auditoría de docs (legacy/, src/docs/ revuelto) queda como deuda cosmética
  trivial, sin urgencia. Ver §7.6.
- **C (deuda Personal):** INSPECCIONADO. Las 3 tablas legacy (`weekly_plans`,
  `shift_assignments`, `shift_minimums`) están VACÍAS (0 filas) pero **el código las usa**:
  `calendarService.ts` (las 3) y `AvisosSettingsPage.tsx` (directo a `shift_minimums`).
  Conclusión: **la Fase 2.D (destino de AvisosSettingsPage) BLOQUEA la Fase 2.C** (no se
  pueden renombrar/dropear mientras esas piezas las lean). 2.C no es ejecutable hasta
  resolver 2.D. Ver §7.4.

### 1.5 — Tests manuales pendientes en producción (acumulados, sin cambios)

- PDF CAPA con fotos; notificación de correctiva APPCC; bandeja del gestor (Pamela ve
  campana, Julio CEO no); marcar leída persiste; botón "Validar cuadrante"; issue `rest_12h`.

---

## 2. PROYECTO Y EQUIPO

**Empresa:** Foodint (rebrand en curso a **Folvy SL**).
**CEO:** Julio Gascón Colón (`jgcolon@idasal.com`).
**Refuerzo técnico:** José (junior, autoridad delegada total cuando opera identificado).
**Producto:** Folvy V1 — SaaS multi-tenant modular para hostelería.

**Cliente activo:** Llorente29 (3 locales: Alcalá, Pza Castilla, Carabanchel + Pamela como
empleada). Firmado, **sin uso real todavía** (0 fichajes en BBDD). **Romper Llorente29 =
pérdida de ingreso.**
**Cartera comercial:** pendiente de actualizar (hubo discrepancia "Solo Llorente29" vs
"+1 esperando + cartera"). Revisar con Julio.

**Fecha producción objetivo Llorente29:** domingo 7 septiembre 2026.

### Organización de trabajo (equipo de tres)

- **Claude del chat = COORDINADOR.** Supervisa estrategia, revisa SQL y código ANTES de
  ejecutar, decide el plan, detecta riesgos. NO ejecuta: da a Julio las instrucciones
  exactas para Claude Code o para él. **Marca SIEMPRE cada acción operativa de forma
  explícita** (cuándo COMMIT/ROLLBACK, `npm run build`, `git commit`/`push`, deploy,
  restart del dev server, `git grep`). No asume que Julio ya las hizo.
- **Julio = PUENTE Y DECISOR.** Ejecuta en Claude Code lo que el coordinador indica y trae
  la salida. SQL en Supabase, deploy con CLI y manejo de credenciales/JWT reales los hace
  él. Aprueba cada paso. Decide cuándo cerrar.
- **Claude Code = EJECUTOR EN EL REPO.** Acceso directo a `C:\dev\llorente29-app`. Lee,
  escribe y edita ficheros. NO se le pasan a mano ficheros que ya están en el repo —
  los lee del disco.

---

## 3. STACK E INFRAESTRUCTURA

### Frontend
- React 19 + Vite 8 + TypeScript 6 strict + Tailwind 3.
- `react-router-dom@7.15.1` (D-S2.6), usando API v6 (`<Routes>`/`<Route>`).
- `@supabase/supabase-js`, `lucide-react`.
- Build/deploy: push a `main` → Vercel automático.

### Backend (Supabase)
- Plan **Pro**, proyecto `xzmpnchlguibclvxyynt`, **región `eu-west-1` (Ireland)**.
  (La región NO se puede cambiar; verificada en dashboard el 25/05. El `eu-west-3` que
  aparecía en una nota de la Fase B.4 era un typo, ya corregido.)
- PostgreSQL 15+ con RLS. Auth Hook activo: `custom_access_token_hook` (Postgres Function).
- **PITR NO activado** (add-on ~+100$/mes). Solo scheduled backups diarios (retención ~7d).
  Riesgo aceptado por Julio (D5). **Revisar antes de Sprint 14 / producción Llorente29.**

### Email transaccional (Resend)
- Proveedor Resend. Dominio `folvy.app` Verified (DKIM+SPF+DMARC+MX en OVH).
- Remitente `no-reply@folvy.app`. `reply_to: jgcolon@idasal.com`.
- API key como secret de Supabase (`RESEND_API_KEY`), NUNCA en repo. Se lee en runtime
  (cambiar el secret NO requiere re-deploy).
- 🟡 Pendiente CEO: 2FA en Resend; confirmar key nueva guardada en Bitwarden.

### Dominios / Hosting (Vercel)
- `folvy.app` apex → proyecto `folvy-landing`.
- `app.folvy.app` → proyecto `folvy-app-staging` (la app real). SSL Let's Encrypt auto.
- `folvy.es` registrado, sin configurar.
- 2FA GitHub activo (backup codes guardados por Julio).
- ⚠️ Documentos viejos mencionan `folvy.com` — ya no aplica.

### Variables de entorno
```
VITE_SUPABASE_URL=https://xzmpnchlguibclvxyynt.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...  (real, NO redactar en código)
VITE_APP_URL=http://localhost:5173    (local)
VITE_APP_URL=https://app.folvy.app    (Vercel)
```

### Tooling local
- Supabase CLI v2.100.1 (login vía Access Token; bug del navegador, mayo 2026).
- Node.js v18+. Git Windows con `core.autocrlf` activo. PowerShell 5.1.

---

## 4. ESTADO DE LA BBDD

### 4.1 — Conteo de tablas (VERIFICADO 25/05/2026 vía information_schema)

- **87 tablas totales** en schema `public`, de las cuales:
  - **77 operativas.**
  - **10 backups** (`_backup_20260516_*` y `_backup_20260517_*`) del Bloque S — pendientes
    de limpiar (confirmar con Julio).
- **RLS activo** en todas las tablas operativas.

> Histórico de la cifra: los docs viejos decían "75" (CONTEXTO_CLAUDE, conteo del 19/05) o
> "40" (ESTADO/REGLAS, obsoleto). Ninguno era correcto al 25/05. **Citar siempre 87 (77+10)**.

### 4.2 — Tablas auth creadas en Sprint 1 (18-19/05)

`platform_admins` (1 fila: Julio CEO), `platform_admin_permissions` (1), `platform_admin_2fa`
(0), `auth_rate_limits` (0), `impersonation_sessions` (0), `platform_audit_log` (1),
`platform_settings` (1), `permission_sets` (4 sets system globales, `account_id=NULL`),
`permission_set_assignments` (0).

### 4.3 — Columnas y constraints añadidos (Sprint 1)

- **`accounts`**: `suspended_at/by`, `suspension_reason`, `archived_at`, `deleted_at`.
  Constraints `suspended_consistency`, `lifecycle_order`. `status` CHECK =
  `trial | active | past_due | suspended | canceled`.
- **`user_profiles`**: `terms_accepted_at`, `welcome_completed_at`, `last_password_change_at`,
  `last_login_at`, `suspended_at/by`. Constraints `welcome_requires_terms`,
  `suspended_consistency`. Índices `idx_user_profiles_active`, `idx_user_profiles_login_resolution`.

### 4.4 — FK críticos (legal)

`clock_entries.employee_id` y `documents.employee_id`: `ON DELETE CASCADE` → **`RESTRICT`**
(D4, cumple Real Decreto-ley 8/2019). **Frontend: NUNCA DELETE físico de empleado; solo
soft delete `UPDATE employees SET active = false`.**

### 4.5 — Funciones RLS

- Del Bloque S (16/05): `current_user_is_admin_of(uuid)`, `current_user_is_admin_or_manager_of(uuid)`,
  `current_user_account_ids()`.
- Refactorizada (M13): `current_user_is_admin()` ahora consulta `platform_admins` (ya NO
  usa `accounts.is_internal`). Backup de la definición vieja en
  `platform_settings.key='backup_current_user_is_admin_pre_C2'`.
- Nuevas (M14): `has_permission(account_id, permission_key)` (cascada B: admin → columna
  legacy → permission_set jsonb → DENY), `current_user_has_platform_permission(flag)`,
  `belongs_to_account(uuid)`.

### 4.6 — Triggers y cron

- Triggers: `trg_protect_last_admin` (anti self-lockout del último CEO),
  `trg_replicate_system_permission_sets` (copia 4 sets a cada cuenta nueva), + varios
  `set_updated_at`.
- Cron (pg_cron): `cleanup_auth_rate_limits_daily` (03:00 UTC),
  `force_close_impersonations_5min` (cada 5 min).

### 4.7 — Edge Functions activas (Deno)

- `manage-employee` — legacy Sprint 1, no usado.
- `check-account-status` — Sprint 2, validado.
- `create-account` — portería (service-role + RPC `create_account_tx`). Crea `auth.user`
  con `email_confirm:true` y password temporal del wizard.
- **`send-email`** — motor de emails de **PLATAFORMA** (portería: avisos de impago/
  suspensión/cancelación/reactivación). Gating `is_platform_admin`. Envío vía fetch a
  Resend. Logging solo `console.log` (su tabla de audit `platform_email_log` está PENDIENTE).
- **`account-email`** — emails de **CUENTA** (manager → empleado). Auth vía
  `supabase.auth.getUser(jwt)`; `accountId` en payload validado server-side. Logging en
  tabla `account_email_log`. **Conviven con send-email: propósitos distintos.**

> Aprendizaje gateway Supabase: rechaza JWT por formato (`UNAUTHORIZED_INVALID_JWT_FORMAT`)
> y por algoritmo (`UNAUTHORIZED_LEGACY_JWT`; el proyecto usa claves asimétricas RS256/ES256
> con JWKS, HS256 no se acepta a nivel gateway). Por eso el `getUser` interno NO es testeable
> con curl externo: el gateway intercepta antes.

### 4.8 — RPCs y datos

- RPCs `create_account_tx`, `delete_account_tx` (SECURITY DEFINER). **OJO con
  `delete_account_tx(p_account_id, p_admin_user_id)`:** el 2º arg es el user_id del admin
  DE LA CUENTA a borrar (hace `DELETE FROM auth.users WHERE id = p_admin_user_id`). Pasar
  el del CEO lo bloquea `protect_last_admin`.
- Cuentas hoy: Llorente29 + "Folvy Interno". RLS puede dar falsos "0 filas" en el SQL
  Editor para borrados → verificar con SELECT aparte.

---

## 5. DECISIONES ARQUITECTÓNICAS CERRADAS

### 5.1 — Sprint 1 (D1-D5, aprobadas 18-19/05 por Julio CEO)

- **D1 — Permisos (Opción B):** `manager_permissions` (columnas legacy) + `permission_sets`
  + `permission_set_assignments` jsonb. Cascada en `has_permission()`: admin → override
  legacy → permission_set jsonb → DENY. Migración gradual.
- **D2 — Feature flags / plan_id:** tabla `feature_flags` separada + `subscriptions.plan_id`
  como fuente única. NO añadir `accounts.feature_flags` ni `accounts.plan_id`.
- **D3 — Platform admin (Opción C2):** tabla `platform_admins` separada;
  `current_user_is_admin()` refactorizada; Julio migrado a fila con `role='ceo'`.
  `accounts.is_internal` mantenida por compat — pendiente decidir DROP.
- **D4 — CASCADE legal (Opción α):** ver §4.4.
- **D5 — PITR NO activado:** ver §3.

### 5.2 — Sprint 2 (D-S2.x) — RESCATADAS de los docs retirados

**Cerradas:**
- **D-S2.1** flowType `pkce` (commit `02b6f3e`).
- **D-S2.2** Magic link deprecation gradual (`@deprecated` Sprint 2, borrado físico Sprint 3).
- **D-S2.4** Persistencia `current_account_id` con prioridad JWT. Fresh login: JWT gana,
  escribe localStorage. Navegación: lee localStorage, fallback JWT. Logout: borra.
  Clave `folvy.activeAccountId`.
- **D-S2.5** Host de emails desde `VITE_APP_URL` (`getRedirectBaseUrl()`), NUNCA hardcoded.
- **D-S2.6** `react-router-dom@7.15.1`, API v6 en Sprint 2; migración a `createBrowserRouter`
  se valora Sprint 3.
- **D-S2.7** `resolveCurrentAccount` por `created_at DESC`, desempate `id DESC`. En el hook.
- **D-S2.8** `session_max_age` emitido pero NO aplicado hasta Sprint 4.
- **D-S2.9** Tests integration con Vitest, NO Playwright (Playwright V1.1+).
- **D-S2.14** Password policy: lower+upper+digits, min 8, símbolos NO requeridos (NIST 2020),
  leaked passwords ON.
- **D-S2.16** Claims sin `account_name`; JWT lleva `current_account_slug`; nombre vía query.
- **D-S2.18** `account_id` en `permission_set_assignments` vía JOIN con `user_profiles`.
- **D-S2.19** Hook defensivo: sin profile activo ni platform_admin → emite `folvy.*` neutros,
  NO falla.
- **D-S2.20** Un solo proyecto Supabase hasta Sprint 14.
- **D-S2.24** Hook como Postgres Function (NO Edge Function): 10-20× más rápido, cero deploy.
- **D-S2.25** Pantalla "Crear cuenta cliente" en Sprint 4 (hasta entonces SQL ad-hoc).
  **(Superada: la portería con wizard ya está en producción.)**
- **D-S2.29** LoginPage Foodint archivado como `LoginPageMagicLink.tsx`, no importado.
- **D-S2.30 (Opción B)** AuthRouter separado en `src/auth/AuthRouter.tsx`; App.tsx renderiza
  `<AuthRouter />` cuando `!authUserId`.
- **D-S2.31** UI tokens auth Sprint 2 = reusar Foodint, rebrand Sprint 3.
- **Modelo welcome — A (active-by-default):** profile con `active=true`; welcome trackeado
  por `welcome_completed_at IS NOT NULL`; CHECK `user_profiles_welcome_requires_terms`.

**Pendientes (sin sprint asignado):**
- **D-S2.3** `/select-account` stub → diseño final pendiente.
- **D-S2.13** caducidad tokens invite (7d) vs reset (24h).
- **D-S2.15** crear `.env.example` formal.
- **D-S2.22** bucket `employee-documents` PUBLIC vs PRIVATE (Sprint 14).
- **D-S2.28** cada modificación de App.tsx requiere nueva autorización explícita.

### 5.3 — Bloque Comunicación (Fase B, verificadas contra BBDD)

- **Auth**: `supabase.auth.getUser(jwt)`, 401 si falla. NO `decodeJwtSub`. Dos clientes:
  anon para `getUser`, `service_role` para queries (bypass RLS).
- **`accountId` en el PAYLOAD (requerido)**, validado contra las cuentas del caller. NO
  `profiles[0]`. `callerEmployeeId` se resuelve del profile concreto de esa cuenta.
- **Pertenencia empleado→cuenta** vía `employees.location_id → locations.account_id`
  (Opción A). `assigned_locations` NO se usa.
- **`reply_to` snake_case** (fetch directo a Resend, no el SDK).
- **Rate limit estricto**: `currentCount + batchSize > LIMIT` (50/h, 200/día por cuenta).
- **`to_email` recalculado server-side** desde `employees.email`. Fail-closed si falta.
- **PATRÓN AUTH (regla general):** NUNCA debilitar la query de decisión para conseguir más
  info de logging. La query estricta DECIDE fail-closed; si hace falta logging rico, query
  de diagnóstico SEPARADA, solo en el camino de rechazo, solo alimenta `console.error`.

### 5.4 — Patrones del módulo Personal (no son deuda)

- **`Employee.vacations/documents/formations` viven siempre `[]`** desde
  `supabaseSync.rowToEmployee`. Cada pantalla que los necesite los carga vía service
  dedicado (`vacationsService`, `documentsService`, formaciones). `supabaseSync.rowToEmployee`
  es zona consolidada, no se toca.

---

## 6. REGLAS DE TRABAJO

### 6.1 — No negociables

1. **Archivos completos** cuando aplique, no diffs sueltos sin contexto.
2. **Pedir el fichero original** (o que Claude Code lo lea) ANTES de modificarlo. No
   inventar sobre suposiciones.
3. **NO modificar `App.tsx`** sin permiso explícito de Julio (D-S2.28).
4. **NO sobrescribir `notificationsService.ts`** (firma posicional v17.1 consolidada: los 5
   parámetros originales no se mueven; lo nuevo va al final).
5. **Antes de cualquier decisión arquitectónica, verificar BBDD vía `information_schema`.**
   La BBDD es la verdad; este documento puede estar desactualizado.
6. **SQL transaccional (BEGIN/COMMIT) solo con varios cambios relacionados.** Para un cambio
   único en el SQL Editor de Supabase, INSERT/UPDATE directo (el BEGIN/COMMIT separado en el
   editor descarta la transacción — aprendido a las malas).
7. **SQL y código revisables ANTES de ejecutar.** El coordinador propone/revisa, Julio
   ejecuta y verifica.
8. **Julio decide cuándo cerrar.** Si el coordinador detecta riesgo o fatiga, lo recomienda
   con argumentos UNA vez; si Julio insiste, sigue y registra la reserva como nota técnica.
9. **Directo, sin pelotismo.** Si el coordinador discrepa, lo dice UNA vez con argumentos;
   si Julio insiste, ejecuta y registra reserva.
10. **NUNCA "don't ask again"** en Claude Code para `git`/`curl`/comandos sensibles: cada
    uno se aprueba a mano.
11. **Al final de cada sesión técnica, ofrecer actualizar este documento.**

### 6.2 — Técnicas

- TypeScript strict, camelCase en cliente, snake_case en BBDD.
- Doble cast `as unknown as Json` para columnas jsonb.
- `tsconfig.app.json`: `verbatimModuleSyntax + erasableSyntaxOnly` → NO enums, NO parameter
  properties.
- Oxc parser Vite 8: NO mezclar `??` con `&&` sin paréntesis.
- Patrón canónico de services CRUD multi-tenancy: ver `brandsService.ts` del Knowledge.
- **Edge Functions corren en Deno, NO en el toolchain Vite del cliente:** `npm run build`
  NO las compila. Su check real es que el deploy no falle.
- **D-S2.26 (encoding archivos config):** UTF-8 SIN BOM, LF. En PowerShell:
  ```powershell
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
  ```
  NUNCA `Set-Content -Encoding UTF8` (añade BOM) ni `Out-File` (puede UTF-16 LE).
- **D-S2.27:** verificar hooks existentes (`Get-ChildItem -Recurse src -Filter "use*.ts"`)
  antes de crear uno nuevo.
- **D-S2.21:** NUNCA cargar PII reales como datos de prueba sin consentimiento firmado.

### 6.3 — SQL aprendidas (Sprint 1)

1. ❌ Subqueries (`NOT EXISTS`, `SELECT`) en CHECK constraints.
2. ❌ Funciones volátiles (`now()`, `random()`) en `WHERE` de índice parcial.
3. ❌ `jsonb_build_object()` con más de 50 pares (>100 args) — usar literal `'{...}'::jsonb`.
4. ✅ Preview SELECT antes de cada migration / DELETE.
5. ✅ Verificación post-ejecución obligatoria.
6. **D-S2.23 (limpieza):** DELETE topológico manual en orden inverso de dependencias. NO
   TRUNCATE CASCADE. NO soft delete si el objetivo es limpieza física.

### 6.4 — Protocolo de refuerzo

- Identificación obligatoria al inicio ("Soy [Nombre], el refuerzo técnico de Julio").
- Si no se sabe quién está al teclado, asumir Julio.
- El refuerzo tiene autoridad delegada total en su turno.
- Decisiones que cambian planos documentales aprobados se escalan a Julio aunque el refuerzo
  tenga autoridad delegada.
- Autorizaciones vía otro canal (WhatsApp, oral): exigir trazabilidad escrita en chat.

### 6.5 — Seguridad operativa

- No ejecutar SQL en producción sin red de seguridad confirmada (PITR o staging).
- No ejecutar SQL borrador no probado sin auditoría preview-antes.
- Verificar identidad ante decisiones de impacto presupuestario o de producción.
- Parar inmediatamente ante cualquier output inesperado durante migrations.

---

## 7. DEUDA TÉCNICA Y PENDIENTES

### 7.1 — Infraestructura / producción
- **404 SPA en Vercel** — RESUELTO 22/05 y verificado 25/05: `vercel.json` (raíz del repo)
  con rewrite catch-all `/(.*)` → `/index.html`.
- **PITR** antes de Sprint 14 (§3, D5).
- **Limpiar 10 tablas backup** del Bloque S (`_backup_*`) — confirmar con Julio.
- **`accounts.is_internal`**: decidir DROP COLUMN o mantener tras auditar uso en frontend.

### 7.2 — Comunicación / emails
- **Tabla de audit de emails de PLATAFORMA** (`platform_email_log` o similar) sin crear.
  Las tablas APPCC (`appcc_audit_log`, `appcc_notifications`) son de dominio cliente, NO usar.
  Hoy `send-email` solo deja `console.log` + log de Resend.
- **`GRACE_PERIOD_DAYS = 7` duplicado** en `accountsService.ts` y `AccountStatusGate.tsx`.
  Unificar en constante compartida.
- Fase C: `user_notification_preferences`, webhooks Resend bounce/complaint, reply-to
  dinámico, broadcast a cuenta entera. Fase D: chat 1-a-1 (`threads`, `messages`), V1.1.

### 7.3 — Portería / cuentas
- **Catálogo de submódulos hardcodeado** en `NuevaCuentaPage.tsx` (el alta); la edición ya
  lee de BBDD (`getCatalog()`). Migrar el alta.
- **Nomenclatura `status`** `trial` vs `trialing`: verificar que `create-account` no escribe
  `trialing` (el CHECK usa `trial`).
- **Nombre CEO**: `platform_admins.full_name` dice "Julio Gascón"; correcto "Julio G. Colón"
  (UPDATE 1 línea).
- Posible "Foodint" residual en `billing_plans.description` (no verificado).
- Slug en URL (al abrir raíz redirige a /folvy, sin resolver).

### 7.4 — Personal (deudas menores)
- **EXIF rotation** en `loadAndResizeImage` (PDF CAPA): fotos verticales de móvil pueden
  salir rotadas.
- **Uploader/reportador en captions/notificaciones** sin resolver id→nombre.
- **Cruce medianoche / domingo→lunes** en detector de solape y `rest_12h`: diferido.
- **`manager_permissions.show_prediccion_personal`** ornamental (página oculta); retirar al
  migrar a `permission_sets`.
- **Fase 2.C** (Personal): rename-then-drop de `weekly_plans`/`shift_assignments`/
  `shift_minimums` tras observación. **Fase 2.D**: destino de `AvisosSettingsPage` (mientras
  viva, `shift_types` y `calendarService.ts` se conservan).
- **Punto 2 (schema cuadrante duplicado):** RESUELTO/verificado 25/05. `AhoraMismoPage`
  reescrita sobre `schedulerService`; `no_scheduled` es ahora un estado legítimo del tipo
  discriminado en `horasComputo.ts` ("no le toca hoy"), no el bug latente. Pendiente solo la
  Fase 2.C (rename-then-drop de tablas legacy del cuadrante, ver arriba).

### 7.5 — Pendientes operativos CEO
- 2FA Bitwarden; password CEO en gestor + master en papel; 2FA Resend; archivar repo GitHub
  staging; guardar nueva API key Resend en Bitwarden.
- **Decidir modelo de cobro** (Holded / Stripe / manual) — condiciona ficha (IBAN) y
  facturación. Hoy módulos `unit_price_eur=0` (precio desacoplado).

### 7.6 — Documentación
- **Auditar docs sueltos (deuda acotada, sesión futura).** El repo tiene **18 `.md`
  trackeados**. Prioridad de revisión por riesgo de envenenar el contexto de arranque:
  1. **`CLAUDE.md` (raíz)** — lo lee Claude Code automáticamente al arrancar. Si está
     desactualizado, parte de contexto fósil cada sesión. **Revisar primero.**
  2. **`docs/legacy/`** (3 ficheros: `CLAUDE.md` antiguo, `PROMPT_ARRANQUE_NUEVA_SESION.md`,
     `arquitectura_plataforma_2026-05-16.md`) — pre-rebrand, candidatos a borrar o archivar.
  3. `src/docs/` mezcla manual de usuario (`MANUAL.md`, `gestor/`, `trabajador/`) con docs
     técnicos históricos (`ESTADO_AUTH_FASE1_COMPLETA.md`, `PLAN_AUTH_ROLES.md`). Separar
     públicos.
  Los 5 maestros `docs/folvy_*` existen todos y son correctos (el addendum Sesión 2 ya está
  en el repo; el doc viejo lo marcaba erróneamente como "pendiente de subir").
- **Notas de proceso:** mantener confirmación manual en cada `git commit`/`curl` (no "don't
  ask again"). Revisar piezas sensibles código-a-código antes de commitear.

### 7.7 — FRENTE: Acceso del trabajador / Portal del empleado (BLOQUEANTE producción)

**Resumen:** el portal del empleado existe pero no es usable de extremo a extremo. Sin
esto, los trabajadores de Llorente29 no pueden entrar a la app → bloquea producción 7/09.

**Qué está construido (✅):**
- `src/pages/trabajador/` — 12 páginas: `TrabajadorApp.tsx` (orquestador, 209 líneas, sub-
  páginas por `useState`, sin React Router), `LoginEmpleado.tsx`, `HomeEmpleado`,
  `PortalEmpleado`, `FichajeEmpleado`, `MisFichajes`, `MiHorario`, `MisTurnos`,
  `CambiosTurnoPage`, `MisChecklistsPage`, `MisDocumentos`, `MisVacaciones`.
- `AppContext` ya expone `roleInActiveAccount` y `userProfile.employeeId` (string|null).
  La línea 242 ya maneja `role === 'worker'` para permisos.
- `manage-employee` (Edge Function, ahora versionada en a08b5f1) ya crea el empleado con
  `role='worker'` + `employee_id`.

**Qué falta / está roto (❌):**
- **Gate de rol en `App.tsx` NO existe.** Hoy todo cae a `<Shell />` por defecto;
  `App.tsx` ni menciona `role`. `TrabajadorApp` no tiene caller (ningún `<TrabajadorApp/>`
  ni `import` en todo el repo). Zona protegida (regla 3): requiere permiso explícito.
- **Alta de empleados probablemente ROTA en producción:** `manage-employee` envía welcome
  desde `from: "Foodint <noreply@foodint.es>"` (branding viejo + dominio NO verificado en
  Resend). Si `foodint.es` no está verificado, el trabajador no recibe acceso. = "Bug 3 P6".
- **Mismatch magiclink vs recovery:** `manage-employee` emite `type:'magiclink'`,
  `WelcomePage` espera `type:'recovery'`. El welcome puede romper aunque llegue el email.
- **No existe pantalla de login por usuario** (solo login por email y el PIN-kiosko de
  `LoginEmpleado`, que es para tablet compartida, NO login individual del trabajador).
- Falta `manifest.json` separado de "Folvy Empleados" (solo hay uno, el de Manager).

**Decisiones de diseño tomadas (sesión 25/05):**
- **Modelo C1:** acceso por **usuario + contraseña prefijada**, con **email sintético
  interno** (`{username}@trabajador.folvy.app` o similar) que el trabajador nunca ve.
  Reutiliza auth real de Supabase (RLS intacta). Elegido sobre email-real (modelo A) y
  sobre SMS, por menor fricción y cero infraestructura nueva. Confirmado contra
  competencia (7shifts, Skello, Combo usan email/SMS; ninguno usa "usuario+pass sin email"
  → C1 es diferenciador real).
- **D1 — contraseña:** la elige el manager, con sugerencia autogenerada editable.
- **D2 — el trabajador NO puede cambiar su contraseña en V1** (solo el manager la regenera).
- **D3 — C1 ÚNICO en V1** (email real diferido a V1.1; el campo email del empleado deja de
  ser la llave de acceso).
- **Rol dual (encargado):** los accesos se SUMAN. Tiene `employee_id` → puede ver el Portal;
  tiene `role` manager/admin → puede ver Gestión. El encargado tiene ambos. (Julio admin sin
  `employee_id` → solo Gestión. Worker puro → solo Portal.) `TrabajadorApp.onExitMode` ya
  anticipa esta dualidad (entrar/salir del modo trabajador sin logout).
- **Q2 — el encargado aterriza en GESTIÓN por defecto**, con botón "Ver como trabajador"
  (botón a ubicar en el Shell, no en App.tsx).

**Implicación clave para C1:** hay que **reescribir el corazón de `manage-employee`** —
email sintético en vez de real, fijar la contraseña elegida por el manager (no passwordless),
marcar `welcome_completed_at` + `terms_accepted_at` en el alta (el constraint
`user_profiles_welcome_requires_terms` EXIGE que si welcome != null, terms != null y
terms <= welcome → hay que poner ambos), y eliminar el magic link (en C1 no hace falta: el
trabajador entra con usuario+contraseña). C1 de paso resuelve los bugs de branding y de
magiclink/recovery. DECISIÓN LEGAL PENDIENTE: ¿quién/cuándo acepta los T&C si el trabajador
no pasa por pantalla de welcome? (probable: el manager acepta en su nombre al dar de alta).

**Plan de construcción C1 (orden por dependencias):**
1. Reescribir `manage-employee` para C1 (+ añadir `deno.json`). Verificar BBDD antes.
2. Pantalla de login por usuario (traduce usuario → email sintético → `signInWithPassword`).
3. Gate de rol en `App.tsx` (permiso explícito de Julio). No binario: rol+employee_id.
4. E2E real del trabajador: alta → login como él → ve su portal → ficha. (Nunca ejecutado.)
5. Pulido: convención de username/desambiguación, botón "Ver como trabajador" en Shell,
   manifest PWA Empleados, gestión/regeneración de contraseña por el manager.

**Deudas menores reveladas al explorar este frente (apuntar, arreglar en sesión dedicada):**
- `create-account` y `manage-employee` usan `decodeFolvyClaims` SIN verificar firma del JWT
  (patrón inferior al de `account-email`; mitigado por el gateway de Supabase, pero deuda).
- `getFunctionUrl` en `employeeAuthService.ts` hace hack de internals del cliente Supabase
  (`@ts-expect-error supabase.supabaseUrl`); debería usar `VITE_SUPABASE_URL` como
  `accountEmailService`/`platformEmailService`.
- `CreateEmployeeResult.magicLinkSent` — naming a alinear (será recovery/welcome, no magic).
- `security_audit_log` — tabla a la que `manage-employee` escribe 4 veces, NO documentada en
  §2. Auditar si está viva/duplicada con `platform_audit_log`.
- `manage-employee` rescatada solo con `index.ts`; falta `deno.json` (añadir al tocarla).

---

## 8. HISTORIAL DE SESIONES (arqueología — rara vez se consulta)

- **P1-P3:** construcción inicial app cliente Llorente29 (APPCC, employees, locations, brands).
- **P4 (16/05):** Bloque C Fase 1 (URL slug + BrowserRouter). **Bloque S** blindó RLS en las
  40 tablas iniciales + 4 funciones auxiliares.
- **P5-P6 (17/05):** preparación Bloque C; catálogo APPCC seed + locales Llorente29 + Pamela.
- **Sesión 0 (18/05):** reconciliación arquitectónica, rebrand Folvy, 4 documentos maestros.
- **Sesiones 1-3 (18/05):** Sprint 0.1, pre-requisitos CEO cerrados.
- **Sesión 4 (18/05):** auditoría BBDD; decisiones D1-D4; 19 migrations en borrador.
- **Sesión 5 (18-19/05):** Sprint 1 ejecutado (19 migrations en producción, 5 bugs SQL en
  vivo, D5).
- **Sesión 6 (Sprint 2):** decisiones D-S2.x (auth: PKCE, AuthRouter, hook, password policy…).
- **Portería (Ses 15-17):** alta/listado/detalle/estado de cuentas, bloqueo efectivo, edición
  de módulos, borrado, motor de emails `send-email` + Capa C (4 avisos automáticos).
- **Sesión Personal T8 + APPCC + Comunicación (22/05):** onboarding sin password temporal;
  export gestoría CSV; config gestoría por cuenta; auditoría Personal T1-T8 y APPCC; PDF CAPA
  con fotos; notificación de correctiva; despachador Fase A completa + Fase B (B.1, B.2, B.4).
- **Frente B — consolidación documental (25/05):** verificado nº real de tablas (87=77+10);
  consolidados los tres docs de contexto en este maestro único; retirados ESTADO y REGLAS.
- **Fase B pasos B.5/B.6/B.7 (25/05):** wrapper `accountEmailService` (B.5, `85e84aa`),
  canal email real en el dispatcher con `accountId` en `DispatchEvent` (B.6, `f1cab56`),
  y UI manager `SendMessageModal` + botón en StaffPage (B.7, `4b577c0`). Build verde en
  cada paso. B.6+B.7 sin push. Pendiente B.8 (prueba E2E real + push de cierre).

### Migrations Sprint 1 (19/19) y bugs corregidos en vivo
M01-M19 ejecutadas. Bugs: M01 (`accounts_slug_format` ya existía), M02 (`valid_role` ya
existía), M05 (subquery en CHECK → operador `<@`), M06 (`now()` en índice parcial → eliminar
índice), M18 (`jsonb_build_object` >100 args → literal `::jsonb`).

---

## 9. ASSETS Y DOCUMENTOS MAESTROS

### Documentos maestros del Knowledge (lectura al arrancar)
1. `CONTEXTO_CLAUDE.md` — **este documento (único de contexto)**.
2. `folvy_arquitectura_reconciliada.md` (Sesión 0).
3. `folvy_v1_spec.md` (Sesión 1).
4. `folvy_auth_model.md` (Sesión 2) — D-S2.24 cambia el hook a Postgres Function.
5. `folvy_roadmap.md` (Sesión 3).
6. `folvy_addendum_sesion2_decisiones.md` — D1-D5 + bugs SQL (en `docs/`, ya en el repo).
7. (Retirados: `CONTEXTO_ESTADO.md`, `CONTEXTO_REGLAS.md`.)

### Código de referencia en el Knowledge
`brandsService.ts` (patrón CRUD multi-tenancy), `supabase.ts`, `authService.ts`,
`supabaseSync.ts`, `AppContext.tsx` (NO modificar sin permiso), `StaffPage.tsx`,
`OtherPages.tsx`.

### Logos y assets (PNG)
`folvy_logo_principal.png` (color sobre blanco), `Folvy_Logo_Oscuro.png` (sobre fondo
accent), `folvy_isotipo_manager.png` (app icon Manager 512×512), `folvy_isotipo_empleados.png`
(app icon Empleados 512×512).

---

**Documento consolidado: 25 de mayo de 2026 (Frente B).**
**Único documento de contexto. Próxima actualización: al cierre de la próxima sesión técnica
(regenerar §1).**
