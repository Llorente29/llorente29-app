# CLAUDE.md

Este fichero lo lee Claude Code automáticamente al arrancar en este directorio. Define el contexto operativo del repo Foodint.

---

## Proyecto

**Foodint** — SaaS multi-tenant para hostelería mid-market (1-30 locales).

- **CEO / interlocutor:** Julio Gascón Colón (`jgcolon@idasal.com`).
- **Repo:** `C:\dev\llorente29-app` — branch `feat/branding-refactor`.
- **Stack:** React 19 + Vite 8 + TypeScript 6 strict + Tailwind 3 + Supabase EU.
- **Producción:** gh-pages (pendiente migrar a Vercel).

**Para detalles completos**: lee `CONTEXTO_CLAUDE.md` que está en `/mnt/user-data/uploads/` o en el knowledge del Proyecto Claude.ai (si tienes acceso). Si no, pídeselo al usuario antes de cualquier decisión arquitectónica.

---

## Estado actual (16/05/2026 al cierre de sesión)

- **BBDD multi-tenant funcional**: 2 cuentas reales (Foodint Interno `is_internal=true` + Llorente29 cliente).
- **BBDD blindada con RLS**: 40 tablas con policies correctas. Funciones helper rediseñadas (`current_user_account_ids`, `current_user_is_admin`, `current_user_is_admin_of`).
- **3 user_profiles activos** (Julio×2 cuentas + Llorente29Food×Llorente29).
- **`user_profiles` ahora soporta multi-cuenta** (1 user = N user_profiles). UNIQUE legacy eliminadas.
- **Catálogos preservados**: 8 módulos, 19 submódulos, 3 billing_plans.
- **Tablas operativas vacías** (borrón limpio de datos basura).
- **La app NO funciona** post-Bloque S hasta completar Bloque B. Razón: `supabaseSync.ts` hace queries sin filtro de `account_id` y RLS las bloquea. Es lo esperado.

---

## Próximo paso: Bloque B — Cableado AppContext al Shell

1. **Crear 3 services nuevos** siguiendo patrón consolidado (referencia: `src/modules/multitenancy/services/brandsService.ts`):
   - `src/modules/multitenancy/services/accountsService.ts`
   - `src/modules/multitenancy/services/userProfilesService.ts`
   - **Evaluar refactor** de `src/services/managerPermissionsService.ts` → mover a `multitenancy/services/` con patrón nuevo. Voto Claude: crear nuevo y deprecar viejo (consistencia con resto del módulo).

2. **Extender `AppContext.tsx`** (PEDIR PERMISO EXPLÍCITO antes de modificar):
   - `activeAccountId` (persistido en localStorage `foodint-active-account`).
   - `accounts` (lista de cuentas del user logueado).
   - `userProfile` (perfil en cuenta activa).
   - `permissions` (manager_permissions en cuenta activa).
   - `isAdmin` pasa a leer `userProfile.role === 'admin'`.

3. **Crear hooks:** `useActiveAccount()`, `usePermissions()`.

4. **Migrar `supabaseSync.ts`** al patrón con `accountId` en options. Funciones afectadas: `fetchLocations`, `fetchEmployees`, `fetchClockEntries`.

5. **Eliminar `CURRENT_ACCOUNT_ID` hardcoded** de 4 componentes: `BrandFilterSelector.tsx`, `BrandsListView.tsx`, `BrandCreateModal.tsx`, `BrandLocationsTab.tsx`.

6. **Auditar código** que asuma `user_profiles` 1:1 (ahora es 1:N con `account_id`).

---

## Reglas no negociables

### Sobre el código

1. **NO sobrescribir `src/App.tsx`** sin permiso explícito del usuario.
2. **NO sobrescribir `src/services/notificationsService.ts`** — firma posicional consolidada: `createNotification(employeeId, type, title, body, data?)`. Cuerpo SÍ modificable; firma NO.
3. **Archivos completos, NO diffs.** Cuando modifiques un fichero, escríbelo entero.
4. **Pedir el fichero original ANTES de modificarlo.** No inventar código sobre suposiciones.
5. **Paso a paso, no avalanchar archivos.** Una cosa a la vez, esperar confirmación.
6. **Deploy solo cuando el usuario dice `deploy`.**
7. **NO pedir credenciales en chat.** Usar `.env` local que el usuario crea él mismo.
8. **NO usar Last.app API ni Tspoon** (descartados).

### Sobre el proceso

9. **NUNCA fiarse solo de la documentación.** Antes de decisión arquitectónica: consultar `information_schema` de Supabase. **La BBDD es la verdad.** El contexto puede estar desactualizado.
10. **SQL transaccional** (`BEGIN`/`COMMIT`) cuando hay varios cambios relacionados.
11. **SQL revisable ANTES de ejecutar.** Claude propone, usuario ejecuta y verifica con SELECT.
12. **Sé directo, sin pelotismo.** Si discrepas con una decisión del usuario, dilo con argumentos.
13. **Usuario decide cuándo cerrar la sesión.** Pero si detectas riesgo o fatiga, recomiéndalo con argumentos.
14. **Al final de cada sesión técnica importante**, ofrece actualizar `CONTEXTO_CLAUDE.md` con lo nuevo.

---

## Convenciones técnicas

### Naming

- TS cliente: **camelCase** (`isActive`, `employeeId`).
- BBDD Postgres: **snake_case** (`is_active`, `employee_id`).
- Constantes: SCREAMING_SNAKE.
- **Mappers explícitos** en services (`rowToBrand`, `brandInsertToRow`). NO snake_case end-to-end.

### TypeScript estricto

- `verbatimModuleSyntax: true` + `erasableSyntaxOnly: true` → **NO enums, NO parameter properties**.
- `noUnusedLocals` activo. Imports no usados rompen el build.
- **Doble cast** `as unknown as Json` para columnas jsonb con shape rígido.
- Inserts/updates Supabase: `Database['public']['Tables']['<tabla>']['Insert']` y `['Update']`.

### Oxc parser (Vite 8)

- **NO mezclar `??` con `&&` sin paréntesis.** Es error de parseo.

### Patrón consolidado services CRUD multi-tenant

Referencia obligatoria: `src/modules/multitenancy/services/brandsService.ts`.

Características:
- `requireSupabase()` guard al inicio.
- Mappers `rowToX` / `xInsertToRow` / `xUpdateToRow` explícitos.
- `rowToX` exportado solo para tests.
- Errores con `throw Error` (NO `return null`).
- `ListXOptions` con **`accountId` obligatorio** en options.
- Soft delete (`is_active=false` + `archived_at=now()`).
- Validación de unicidad scope cuenta.
- Validación cross-tenant explícita de FKs.

### Comandos útiles

```powershell
# Dev
npm run dev

# Build (TS strict)
npm run build

# Tipos BBDD (regenerar tras tocar esquema)
$env:SUPABASE_ACCESS_TOKEN = "sbp_XXX"  # NO commitear este token
npm run types:gen
```

---

## Identidad dual admin / empleado

- **Admins:** `auth.users.id` (Supabase Auth, email + Magic Link). NO row en `employees`.
- **Trabajadores:** `employees.id` (UUID independiente). NO row en `auth.users`. PIN para login.
- **NO hay FK** entre `auth.users` y `employees`.
- **Vinculación opcional:** `user_profiles.employee_id` si un empleado además es admin/manager.

En Bloque B: `isAdmin` pasa a leer `userProfile.role === 'admin'` en cuenta activa (en lugar de "hay sesión Supabase").

---

## Cómo arrancar cada sesión

1. **Confirma que has leído este `CLAUDE.md`.**
2. Si necesitas detalles que no están aquí, **pide al usuario el `CONTEXTO_CLAUDE.md`** (lo tiene en el Proyecto Claude.ai web).
3. **Resume en 5-10 líneas dónde estamos** según lo que has leído.
4. **Pregunta al usuario qué quiere hacer** en esta sesión.
5. **NO toques nada** hasta confirmación.

---

## Estructura del repo (resumen)

```
src/
├── lib/supabase.ts                                ← Cliente tipado <Database>
├── types/
│   ├── database.ts                                ← Auto-generado (npm run types:gen)
│   ├── multitenancy.ts                            ← Capa dominio camelCase
│   └── index.ts                                   ← Union Page
├── modules/
│   ├── appcc/                                     ← Módulo APPCC (auditorías, checklists, incidentes)
│   └── multitenancy/                              ← Bloque Stock Fase 0
│       ├── services/                              ← 5 services consolidados
│       │   └── brandsService.ts                   ← REFERENCIA DEL PATRÓN
│       ├── hooks/useLocationScope.ts
│       ├── components/
│       └── pages/BrandsPage.tsx                   ← Patrón consolidado CRUD con tabs
├── services/
│   ├── supabaseSync.ts                            ← REFACTOR EN BLOQUE B
│   ├── notificationsService.ts                    ← Firma posicional consolidada (NO TOCAR)
│   └── ...
├── context/AppContext.tsx                         ← EXTENDER EN BLOQUE B (pedir permiso)
├── App.tsx                                        ← NO TOCAR sin permiso explícito
└── config/constants.ts                            ← CURRENT_ACCOUNT_ID (ELIMINAR en Bloque B)
```

---

**Última actualización:** 16/05/2026 al cierre de sesión Bloque A + Bloque S. Próximo arranque: Bloque B.
