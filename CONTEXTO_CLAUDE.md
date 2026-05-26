# CONTEXTO_CLAUDE.md

> **Documento maestro único de memoria persistente del proyecto Folvy.**
> Lectura obligatoria al inicio de cada sesión técnica.
> **Última actualización: 26/05/2026 (2ª sesión del día) — Módulo FOLVY KITCHEN: BBDD + función de coste + catálogo de ingredientes + FICHA DE ESCANDALLO funcional con COSTE Y % POR LÍNEA (desglose SQL). 2 de 4 pantallas. Todo en producción. Próximo frente acordado: Capa 2 (precio/margen).**
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

## 1. ESTADO VIVO ⟵ se regenera cada sesión
**Última actualización: 2026-05-26 (2ª sesión del día — cierre — Módulo FOLVY KITCHEN, primer frente visible y desplegado)**

### 1.1 — Dónde estamos HOY (2026-05-26, 2ª sesión)

Folvy V1 es un SaaS multi-tenant en producción en app.folvy.app. En esta sesión se construyó DESDE CERO el módulo **FOLVY KITCHEN** (escandallo / coste de recetas), el primer frente de Operaciones/Cocina. Resultado: módulo VISIBLE y FUNCIONAL en producción (4ª pestaña del TopBar, icono ChefHat). Detalle completo del frente en §7.9.

**Qué se hizo y está en producción:**
- **BBDD completa (6 tablas Kitchen)**, modelo de 3 capas, todas con RLS patrón Bloque S y campos nativo-IA. Conteo total subió de 87 → **93 tablas** (verificado vía information_schema). Ver §4.1 y §7.9.
- **Función de cálculo de coste** `kitchen_recompute_item(p_item_id uuid)` — SECURITY DEFINER, con guard de tenancy. Probada con 3 casos reales (conversión kg→g, merma bruto/neto, honestidad ante no-convertible). Ver §4.9.
- **Pantalla 1/4 — Catálogo de ingredientes** (`KitchenItemsPage`): listar + crear + editar + archivar ingredientes raw. Recálculo automático visible al editar precio.
- **Pantalla 2/4 — Ficha de escandallo** (`KitchenRecipePage`, sub-tandas A y B): crear platos/recetas (dish/recipe) con raciones; ficha con coste total + coste por ración en tarjetas; añadir/editar/quitar líneas de ingredientes (incl. sub-recetas, excluyendo autorreferencia) con cantidad/unidad/merma; el coste se recalcula EN VIVO tras cada mutación. VERIFICADO E2E en pantalla con datos reales: hamburguesa con carne(kg)+pan(ud)+queso(g) → coste correcto, con conversión g→kg dentro de la función.
- 2 services de líneas/items + kitchenUnitService. recipeLineService recalcula el PLATO PADRE tras tocar una línea (patrón fail-safe).
- **Coste y % POR LÍNEA en la ficha de escandallo** (función SQL `kitchen_recipe_breakdown`): cada ingrediente muestra su coste en € y su % del total del plato (ej. hamburguesa: carne 60,7%, pan 27,5%, queso 11,8%). El % se calcula en cliente (división simple); el coste viene del SQL (misma lógica de conversión que el total → las partes SUMAN el total, verificado al céntimo: 0,9265+0,42+0,18 = 1,5265 €). Líneas no convertibles (needs_review) en rojo con "sin coste" (patrón meez). Esto convierte el escandallo de "cuánto cuesta" a "dónde está el coste" (accionable). Ver §4.10.

**Decisiones de la sesión:**
- El recálculo automático (no manual) es la expectativa BASE del mercado (meez/WISK/Craftybase/DishCost), contrastado. Implementado en create/update de items y en add/update/delete de líneas.
- El PVP NO vive en el plato (recipe_item) sino en la marca virtual (Capa 2, menu_item, aún sin construir). Coste del plato vs precio de la marca. Diferenciador Folvy (marca virtual sobre cocina compartida) frente a tSpoonLab/Gstock.
- Coste por línea NO se muestra todavía (Claude Code evitó replicar las conversiones del SQL en cliente para no arriesgar un número distinto al real). Mejora futura clara: que la función SQL devuelva también el desglose por línea (no calcular en cliente).
- Catálogo inicial para clientes nuevos = fuente PROPIA o con licencia, NUNCA copia del catálogo de un competidor (tSpoonLab). Idea descartada por legal/práctica; las capturas de tSpoonLab valen solo como referencia de diseño.

### 1.2 — Próximo paso inmediato

**PRÓXIMO FRENTE ACORDADO (decidido 26/05 2ª sesión): CAPA 2 — precio de venta + margen + food cost %.** Es el mayor salto de valor: convierte el módulo de "calculadora de costes" a "herramienta de rentabilidad". Tabla nueva `menu_item` que cuelga de `brand` (que YA existe). Aquí vive el PVP (NO en recipe_item). Permite la misma hamburguesa a 3 precios en 3 marcas virtuales = diferenciador Folvy. Coste (ya lo hay) + precio = margen y food cost %. NO se arrancó en la 2ª sesión a propósito: frente grande que toca `brand` en producción, mejor con cabeza despejada y CONTEXTO al día. Verificar estado real de `brand` vía information_schema antes de diseñar.

Estado de las 4 pantallas de Folvy Kitchen:
1. ✅ Catálogo de ingredientes (lista/crear/editar/archivar) — HECHO.
2. ✅ **Ficha de escandallo** (plato + líneas + coste/ración + coste y % por línea) — HECHO (sub-tandas A+B + breakdown).
3. ⏳ Pantalla de conversiones por ingrediente (recipe_item_unit_conversion; ej. 1 ud huevo = 60g). Hoy solo por SQL.
4. ⏳ Pantalla de ajustes (kitchen_settings).

DEUDAS DE ALTA PRIORIDAD que conviven (de sesiones previas + esta):
- **GUARD DE RUTA POR URL** (heredada, §7.8): el gating oculta menús pero NO bloquea acceso por URL directa. Aplica también a /kitchen/*. NO dar acceso a más encargados (más allá de Pamela) hasta cerrar esto.
- **Función de propagación de coste** `kitchen_recompute_dependents` (§7.9): al cambiar el precio de un ingrediente, recalcular hacia arriba los platos que lo usan. Necesaria para el "automático de verdad" entre platos. Aquí se resolverá el acceso de procesos de sistema sin sesión.

### 1.3 — Estado del repo (cierre 2026-05-26, 2ª sesión)

- Repo: Llorente29/llorente29-app, branch main, C:\dev\llorente29-app.
- main SINCRONIZADA con origin/main (HEAD = **827d3e0**). Working tree: solo `CONTEXTO_CLAUDE.md` modificado (esta actualización) + .claude/.
- 8 commits de Folvy Kitchen, todos en origin: `2cf3cb7` (BBDD Capa 1), `559660e` (BBDD Capa 1.1-1.3), `f13e1a8` (frontend base), `5a82b6f` (módulo+catálogo), `ce123ed` (edición/archivado ingredientes), `0c6ff54` (escandallo A: read-only + recipeLineService), `aa520af` (escandallo B: CRUD líneas en vivo), `827d3e0` (coste y % por línea: RPC kitchen_recipe_breakdown + columnas).
- 5 migrations Kitchen versionadas en supabase/migrations/: `20260526_folvy_kitchen_capa1.sql` … `_capa1_4.sql` (la 1_3 = función de coste; la 1_4 = función de desglose).
- Ficheros frontend Kitchen: `src/types/kitchen.ts`; `src/modules/kitchen/services/` (recipeItemService, kitchenUnitService, recipeLineService con getRecipeBreakdown); `src/modules/kitchen/pages/` (KitchenItemsPage, KitchenRecipePage); `src/modules/kitchen/module.tsx`; registro en `src/shell/moduleRegistry.ts`.

### 1.4 — Cómo funciona el control de permisos (para el CEO)

1. Configuración → Usuarios y Accesos → editar un encargado (manager) → botón "Configurar permisos individuales".
2. Se abre el modal de checkboxes (23 pantallas agrupadas). Marca/desmarca lo que el encargado debe ver. Guardar.
3. El encargado debe SALIR y VOLVER A ENTRAR para que el cambio surta efecto (los permisos se cargan al iniciar sesión).
4. Admin (Julio) ve todo siempre, ignora los checkboxes.

> NOTA sobre Folvy Kitchen y Pamela: el item de sidebar de Kitchen tiene `requiredRole:'manager'` sin clave granular en manager_permissions todavía. Pamela (manager) VERÁ la pestaña Folvy Kitchen en producción. Si NO se quiere que la vea aún (módulo a medias de cara al cliente), hay que añadir una clave granular (ej. show_kitchen_*) y filtrarla. DECISIÓN PENDIENTE de Julio.

### 1.5 — Tests manuales pendientes en producción (acumulados)

PDF CAPA con fotos; notificación de correctiva APPCC; marcar leída persiste; botón "Validar cuadrante"; issue rest_12h. (Sin cambios respecto a sesiones previas.)

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

### 4.1 — Conteo de tablas (VERIFICADO 26/05/2026, 2ª sesión, vía information_schema)

- **93 tablas totales** en schema `public`, de las cuales:
  - **83 operativas.**
  - **10 backups** (`_backup_20260516_*` y `_backup_20260517_*`) del Bloque S — pendientes
    de limpiar (confirmar con Julio).
- **RLS activo** en todas las tablas operativas.

> Histórico de la cifra: 87 (77+10) al 25/05; subió a 93 (83+10) el 26/05 al añadir las 6
> tablas del módulo Folvy Kitchen (ver §7.9). Docs muy viejos decían "75" o "40" — obsoletos.
> **Citar siempre 93 (83+10)** salvo verificación posterior.

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

### 4.9 — Función de coste de Folvy Kitchen (26/05, 2ª sesión)

`kitchen_recompute_item(p_item_id uuid) → numeric`. SECURITY DEFINER, `search_path=public`.
Calcula y GUARDA el coste de UN item (raw/recipe/dish), devolviéndolo. Lógica:
- Si `type IN ('raw','tool')`: coste desde su estrategia (hoy solo `fixed` calculable → `fixed_cost`).
- Si `type IN ('recipe','dish')`: suma de líneas (`recipe_line`). Por línea: coste del hijo
  (lee `computed_cost` cache, NO recursa hacia abajo) × cantidad convertida × (bruto si existe).
  Conversión: misma dimensión → `kitchen_unit.factor_to_base` (universal); distinta dimensión
  → busca `recipe_item_unit_conversion` (por-ingrediente); sin vía → NO inventa, marca
  `needs_review=true` y esa línea aporta 0 (diseño honesto).
- **GUARD de tenancy** (imprescindible porque SECURITY DEFINER salta RLS):
  `IF NOT (current_user_is_admin() OR current_user_is_admin_or_manager_of(v_item.account_id))
  THEN RAISE EXCEPTION`. Acepta admin de plataforma (CEO) o admin/manager de la cuenta.
- Versionada en `supabase/migrations/20260526_folvy_kitchen_capa1_3.sql`. Tipada en
  `database.ts` como `kitchen_recompute_item: { Args: { p_item_id: string }; Returns: number }`.
- PROBADA en producción (Folvy Interno) con 3 casos: harina 500g a 2€/kg → 1.00€; solomillo
  300g brutos a 20€/kg → 6.00€ (merma usa bruto); huevo 2ud sin conversión → 0 + needs_review.
- NOTA de diseño futura (NO bug): el guard bloquea llamadas SIN sesión (auth.uid() null —
  cron/OCR/IA/propagación). Correcto para el frontend hoy. El acceso de procesos de sistema
  se resolverá al construir la propagación `kitchen_recompute_dependents` (ver §7.9). Opciones
  apuntadas: (A) Edge Function con service_role JWT —verificar cómo lo trata
  current_user_is_admin()—; (B) tercer canal en el guard —más complejo, riesgo de bypass—.

### 4.10 — Función de desglose de coste por línea (26/05, 2ª sesión)

`kitchen_recipe_breakdown(p_item_id uuid) → TABLE(line_id, child_item_id, child_name,
quantity, unit_abbr, line_cost, needs_review)`. SECURITY DEFINER, `search_path=public`,
MISMO guard de tenancy que kitchen_recompute_item. Solo lectura (no muta nada).
- Devuelve una fila por línea del plato con el coste de esa línea, calculado con LA MISMA
  lógica de conversión que kitchen_recompute_item (copiada, NO reinventada). INVARIANTE clave:
  `SUM(line_cost) == recipe_item.computed_cost`. Test de regresión: si alguien toca una función
  sin la otra, el invariante se rompe → `SELECT SUM(line_cost) FROM kitchen_recipe_breakdown(id)`
  debe igualar `SELECT computed_cost FROM recipe_item WHERE id=...`.
- needs_review por línea = true si esa línea no se pudo convertir (coste 0). La pantalla la
  marca en rojo con "sin coste" (patrón meez).
- El % de cada línea lo calcula la PANTALLA (line_cost / suma), división simple sin
  conversiones → no compromete la honestidad (a diferencia de calcular el coste en cliente).
- Versionada en `supabase/migrations/20260526_folvy_kitchen_capa1_4.sql`. Tipada en database.ts
  (Args { p_item_id: string }; Returns array de 7 campos). Consumida por recipeLineService.getRecipeBreakdown.
- VERIFICADA en producción: hamburguesa → carne 0,9265€ (60,7%) + pan 0,42€ (27,5%) + queso
  0,18€ (11,8%) = 1,5265€ = computed_cost del plato. Cuadra al céntimo, en SQL y en pantalla.
- NOTA: el guard también bloquea el SQL Editor (auth.uid() null), igual que kitchen_recompute_item.
  Para verificar el cuadre desde el editor sin sesión se usó una query SELECT equivalente (sin
  guard) que replica la lógica — confirmó el cuadre. La función real funciona desde la app (con sesión).

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

### 7.8 — FRENTE: Permisos del encargado (estado y deudas)

ESTADO: el frente está FUNCIONAL y verificado en producción. El control de permisos por checkboxes funciona de punta a punta (modal → manager_permissions → get_effective_permissions → usePermissions → gating de menús/pestañas/engranaje). Deudas vivas:

- [IMPORTANTE — prioridad alta] Guard de ruta por URL. El gating oculta los menús pero NO bloquea el acceso por URL directa. Un encargado podría ver páginas fuera de su menú tecleando la dirección. Falta un guard en el router que valide el permiso antes de renderizar cada página. NO dar acceso a más encargados (más allá de Pamela, de confianza) hasta cerrar esto. Primera tarea de la próxima sesión.
- Refrescar permisos en vivo. Hoy, cambiar los permisos de un encargado requiere que él salga y vuelva a entrar. Mejora futura: refrescar sin re-login.
- 4 items de APPCC sin clave granular elevados temporalmente a requiredRole: 'admin' (appcc_audits, appcc_reports, appcc_templates). Si se quiere que un encargado los vea sin ser admin, añadir claves nuevas a manager_permissions y cambiar requiredRole por requiredPermission en appcc/module.tsx.
- permission_sets quedó sin uso. Las tablas existen con 4 sets de sistema sembrados, pero NO se usan. has_permission y get_effective_permissions ya NO los leen. Candidatos a limpieza futura. El assignment de Julio (admin) a gerente_total quedó en permission_set_assignments — inocuo, limpiable.
- show_prediccion_personal sigue ornamental (página oculta). Sin acción.

Notas técnicas (referencia rápida):
- Funciones SQL: has_permission(p_account_id uuid, p_permission_key text) y get_effective_permissions(p_account_id uuid). Ambas SECURITY DEFINER, leen manager_permissions, admin → bypass.
- Service: src/services/effectivePermissionsService.ts (getEffectivePermissions, tipo EffectivePermissions = Record<string,boolean>).
- Hook: src/modules/multitenancy/hooks/usePermissions.ts (diccionario dinámico, isFullAccess por rol real).
- Gating: requiredPermission?: string y requiredRole?: ShellRole en ModuleSidebarItem (shell/types.ts), filtrado en ModuleSidebar.tsx; pestañas+engranaje en ShellTopBar.tsx (helper isModuleVisible).
- Modal: src/components/ManagerPermissionsModal.tsx (escribe en manager_permissions).

Commits de la sesión 2026-05-26 (todos en origin/main, HEAD=3ab55e4):
Acceso C1: 70aeb89, 614eef3, 1793111, 5a35e0e, b370816, 1346b20, dba7b3a.
Permisos: d12c886, d7f0b3c, 6609593, 822a5a8, cb46299, 3ab55e4.

Limpieza pendiente de pruebas: borrar zz.foodint (6b687b5d), zz.foodint1 (ad32b762), ZZ Prueba Worker C1/C2, ZZ_PRUEBA_E2E_B8. Pamela NO se borra.

---

### 7.9 — FRENTE: FOLVY KITCHEN (escandallo / coste de recetas) — Capa 1 EN PRODUCCIÓN

**Qué es:** módulo de escandallo (coste de recetas) para cocina. Nombre comercial Folvy
Kitchen (patrón Folvy Team/Safety/Sales), prefijo de tablas `kitchen_*` / `recipe_*`. Primer
frente de Operaciones. Construido desde cero el 26/05 (2ª sesión). Estado: BBDD + función de
coste + catálogo de ingredientes EN PRODUCCIÓN y verificados.

**Modelo de datos — 3 capas (Capa 1 construida; Capas 2-3 diseñadas, NO construidas):**
- **Capa 1 = producto base** (receta + coste, definido una vez). CONSTRUIDA. 6 tablas:
  - `recipe_item` — núcleo. Campo `type` (raw/recipe/tool/dish) unifica ingrediente y plato.
    `cost_strategy` (fixed/last_purchase/average_weighted/average_window; hoy solo fixed
    operativo), `fixed_cost`, `computed_cost` (cache calculado por la función), `cost_updated_at`,
    `indirect_cost_pct` (override por plato; modelo prime cost), `cost_window_days`. Ficha
    técnica: prep/cook_time_minutes, procedure_text, plating_notes, kitchen_photo_url,
    yield_portions, conservation_type (fridge/freezer/dry/hot), service_temp_c. Nativo-IA:
    `source` (manual/ai_recipe/ocr_invoice/import), `ai_confidence`, `needs_review`.
    EL PVP NO VA AQUÍ (es de la marca, Capa 2).
  - `recipe_line` — padre→hijo (ambos recipe_item; autorreferencia habilita sub-recetas).
    `quantity_net`, `quantity_gross` (merma de despiece: la función usa bruto si existe),
    `unit_id`, `cut_type_id`, `position`. Constraint no_self_reference.
  - `kitchen_unit` — unidades + conversiones universales. `dimension` (weight/volume/unit),
    `factor_to_base`, `is_seed` (globales account_id NULL). Semilla: g, kg, ml, L, ud.
  - `kitchen_cut_type` — cortes/despiece por cuenta.
  - `kitchen_settings` — 1 fila/cuenta (UNIQUE account_id). indirect_cost_pct_default,
    target_food_cost_pct, currency EUR.
  - `recipe_item_unit_conversion` — conversiones pieza↔peso POR INGREDIENTE (NO universales:
    "1 ud huevo = 60g" ≠ universal, a diferencia de kg↔g). `from_unit_id`, `qty_in_base`
    (en base del ingrediente). Varias por ingrediente. Nativo-IA. UNIQUE (item_id, from_unit_id).
- **Capa 2 = ítem de carta por marca** (menu_item: nombre/foto/PVP/categoría por marca virtual,
  cuelga de la tabla `brand` que YA existe). DISEÑADA, NO CONSTRUIDA. Aquí vive el precio.
- **Capa 3 = disponibilidad por canal.** Futura.

**Decisiones de arquitectura (todas contrastadas con competencia europea/mundial):**
- Coste calculado en SQL (no en cliente) + cache en `computed_cost`, síncrono. Ver función §4.9.
- Conversiones en DOS sitios: universales (kg↔g) en `kitchen_unit.factor_to_base`; ambiguas
  (pieza↔peso) por-ingrediente en `recipe_item_unit_conversion`. Patrón confirmado en
  tSpoonLab y Apicbase (la conversión vive EN el ingrediente; "1 botella ≠ 750ml universal").
- Costes indirectos jerárquicos: global por cuenta (kitchen_settings) + override por plato
  (recipe_item.indirect_cost_pct). Modelo prime cost.
- **Recálculo automático** (no manual): create/update de un item dispara el recálculo de su
  coste. Es la expectativa BASE del mercado (meez, WISK, Craftybase, DishCost lo venden como
  estrella), NO un lujo. El "automático de verdad" (cambiar precio → propagar a platos) llega
  con la propagación (pendiente). Verificado E2E en pantalla: editar precio recalcula solo.
- Nativo-IA desde el minuto 0: campos source/ai_confidence/needs_review en las tablas que la
  IA escribirá (recipe_item, recipe_item_unit_conversion). NINGUNA función de IA construida aún
  (raíles puestos, tren no circula). "Coste computado" NO es IA, es la función SQL.

**Mapa de IA del mercado (para cuando se aborde el frente IA — NO empezado):**
4 apoyos vistos en competencia: (1) OCR de albaranes (foto→precios, actualiza coste), (2)
creación de recetas por IA (foto/lista→receta casada con inventario), (3) previsión de
demanda/pedidos sugeridos, (4) verificación visual/food safety. Hueco de Folvy: nativo europeo
(IVA, cumplimiento ES/EU, implementación rápida) frente a americanos lentos; marca virtual nativa.

**Frontend construido (patrón APPCC/brandsService):**
- `src/types/kitchen.ts` — dominio camelCase de las 6 tablas + Insert/Update. Deriva Row* de
  database.ts. Uniones de literales (NO enums, por verbatimModuleSyntax/erasableSyntaxOnly).
- `src/modules/kitchen/services/recipeItemService.ts` — CRUD de recipe_item + recálculo
  automático (recomputeRecipeItem llama RPC; tryRecompute fail-safe: si el recompute falla,
  loguea pero NO revierte el guardado; create/update releen tras recompute).
- `src/modules/kitchen/services/kitchenUnitService.ts` — lectura de unidades (listUnits NO
  filtra account_id: la RLS ya da seed globales + de cuenta; filtrar ocultaría las seed).
- `src/modules/kitchen/pages/KitchenItemsPage.tsx` — catálogo de ingredientes raw: tabla
  (nombre/unidad/coste fijo/coste computado) + modal dual crear/editar + archivar. Usa
  useApp() + useActiveAccount() (patrón APPCC). Recálculo visible al editar.
- `src/modules/kitchen/module.tsx` — kitchenModule (id 'kitchen', icon ChefHat, topBarOrder 4,
  requiredRole 'manager', basePath 'kitchen', publishes kitchen.item.recomputed).
- Registrado en `src/shell/moduleRegistry.ts` (1 línea, tras ventasModule).

**Deudas / pendientes del frente Kitchen (orden sugerido):**
- ✅ [HECHO] Catálogo de ingredientes (pantalla 1/4) y **Ficha de escandallo** (pantalla 2/4,
  sub-tandas A+B): crear platos, añadir/editar/quitar líneas (incl. sub-recetas), coste total
  y coste/ración EN VIVO. Verificado E2E. Ver §1.1.
- ✅ [HECHO] **Coste y % por línea**: función SQL `kitchen_recipe_breakdown` (§4.10) +
  columnas Coste/% en la ficha, con líneas no convertibles en rojo. Verificado (cuadra al
  céntimo). Mejora futura: gráfico de tarta de distribución de coste (tSpoonLab/meez lo tienen).
- [PRÓXIMO FRENTE ACORDADO] **Capa 2 — menu_item / carta por marca** (sobre tabla `brand`
  existente). Aquí vive el PVP. Coste (ya hay) + precio = MARGEN y food cost %. Convierte el
  módulo en herramienta de rentabilidad. Diferenciador: misma receta a varios precios en varias
  marcas virtuales. Verificar estado real de `brand` antes de diseñar.
- **Función de propagación** `kitchen_recompute_dependents`: al cambiar precio de un ingrediente,
  recalcular hacia arriba los platos que lo usan (de abajo a arriba). Resuelve aquí el acceso de
  procesos de sistema sin sesión (ver nota §4.9).
- **Ciclos en sub-recetas**: el constraint no_self_reference impide A→A, pero NO el ciclo
  indirecto A→B→A. Hoy se mitiga en UI (el selector excluye el plato actual). Blindar en BBDD o
  validación al añadir línea. Deuda menor, no bloqueante.
- **Capa 2** (menu_item / carta por marca, sobre tabla brand existente). Aquí vive el PVP.
- Huecos de Operaciones (diseñados, no construidos): allergen/item_allergen, supplier/
  supplier_price (base del OCR), nutrition (tabla aparte, herencia como alérgenos).
- Services restantes: kitchenCutTypeService (selector "tipo de corte" en líneas),
  recipeItemUnitConversionService, kitchenSettingsService (patrón ya establecido).
- Seed automático de `kitchen_settings` al crear cuenta (idea de Claude Code; iría en
  create_account_tx).
- Frente IA (el más diferenciador, NO empezado): abordar sobre cimientos sólidos (catálogo +
  escandallo manual funcionando — YA cumplido — antes de poner IA encima).
  - **[PRIORIZADO — origen: petición de cocinero real, 26/05 2ª sesión]** "Foto de cuaderno →
    receta/escandallo": el cocinero fotografía una receta escrita a mano y la IA la sube a la
    ficha de escandallo. Es uno de los 4 usos de IA del mercado (meez lo vende). Cimientos YA
    puestos: recipe_item.source contempla 'ai_recipe', + ai_confidence + needs_review (la IA
    propone con needs_review=true, el cocinero valida). Dos partes técnicas: (1) visión
    foto→texto estructurado de ingredientes/cantidades; (2) CASAR ese texto con el catálogo
    real (recipe_item existentes, o crearlos) — la parte (2) da el valor y exige catálogo +
    escandallo maduros (YA disponibles). Los pasos de elaboración leídos irían a
    recipe_item.procedure_text. Abordar como sesión propia.
- Decisión Pamela/Kitchen (ver §1.4): clave granular para ocultar Kitchen a managers si se quiere.

Commits del frente (todos en origin/main, HEAD=827d3e0): 2cf3cb7, 559660e, f13e1a8, 5a82b6f, ce123ed, 0c6ff54, aa520af, 827d3e0.

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
7. `Folvy_Modulo_Menu_por_Marca.docx` — doc comercial del modelo de 3 capas de Folvy Kitchen
   (producto base → ítem de carta por marca → disponibilidad por canal). Fuente de la decisión
   "el PVP es de la marca, no del plato". Relevante para construir la Capa 2 (menu_item).
8. (Retirados: `CONTEXTO_ESTADO.md`, `CONTEXTO_REGLAS.md`.)

### Código de referencia en el Knowledge
`brandsService.ts` (patrón CRUD multi-tenancy), `supabase.ts`, `authService.ts`,
`supabaseSync.ts`, `AppContext.tsx` (NO modificar sin permiso), `StaffPage.tsx`,
`OtherPages.tsx`.

### Logos y assets (PNG)
`folvy_logo_principal.png` (color sobre blanco), `Folvy_Logo_Oscuro.png` (sobre fondo
accent), `folvy_isotipo_manager.png` (app icon Manager 512×512), `folvy_isotipo_empleados.png`
(app icon Empleados 512×512).

---

**Documento actualizado: 26 de mayo de 2026 (2ª sesión — Folvy Kitchen: escandallo funcional con coste y % por línea, 2/4 pantallas. Próximo frente: Capa 2 precio/margen).**
**Único documento de contexto. Próxima actualización: al cierre de la próxima sesión técnica
(regenerar §1).**
