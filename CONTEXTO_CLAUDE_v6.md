# CONTEXTO_CLAUDE_v6.md

> **Para Claude:** Este documento contiene todo el estado del proyecto Foodint hasta ahora.
> Cuando empieces una nueva sesión, lee esto primero antes de cualquier otra cosa.
> Las decisiones tomadas y los archivos clave están aquí.

---

## 🏢 EL NEGOCIO

**Foodint** — SaaS de gestión de hostelería para 3 locales en Madrid.

| Local | Empleados reales |
|---|---|
| Foodint Alcalá | Natacha (T1, 43.5h, partido) · Yohanny (T2, 40.25h, tarde/noche) · Pamela (T3, 40.5h, mañana) |
| Foodint Carabanchel | Marlon, Mirle |
| Foodint Pza Castilla | Martín, Fabiola |

**Usuario admin**: jgcolon@idasal.com (UID `e298629b-9d34-4d62-9a00-ff7c3fa29a1a`)
**Usuario admin 2**: llorente29food@gmail.com

---

## 🛠️ STACK TÉCNICO

- React + TypeScript + Vite + Tailwind
- Supabase (Postgres + Auth + Storage + Edge Functions)
- Hosting: GitHub Pages (rama `source` → `gh-pages`)
- Repo: `Llorente29/llorente29-app`
- SMTP: Resend (dominio verificado `foodint.es`)
- Branding: granate `#7C1A1A`, beige `#F5E9D9`

---

## 📐 ESTADO ACTUAL DE LA APP

### Auth + Roles (FASE 2 COMPLETA en esta sesión)

✅ **Sistema completo end-to-end:**
- Magic Link login con SMTP propio Resend
- 3 roles: `admin` / `manager` / `worker`
- Routing automático por rol (worker → TrabajadorApp, manager/admin → Gestor)
- Sesión persistente 7 días
- Header con info del usuario (nombre + badge rol)
- Logout con click en logo

### Tablas Auth en Supabase

```sql
user_profiles (user_id, employee_id, role, active, display_name)
manager_locations (user_profile_id, location_id)
security_audit_log (actor_user_id, target_user_id, action, details)
manager_permissions (user_profile_id, 27 flags booleanos)
```

### Edge Function `manage-employee`

URL: `https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/manage-employee`

Acciones:
- `create`: crea employee + auth.user + user_profile + Magic Link vía Resend
- `deactivate`: marca empleado y profile como inactivos
- `reactivate`: reactiva + envía email "Cuenta reactivada"
- `delete_permanent`: borra TODO (employee + profile + auth.user + manager_locations + manager_permissions)

Secrets configurados:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (defaults Supabase, deprecated pero funcionan)
- `RESEND_API_KEY` (añadido manualmente)

### Pantalla "👥 Usuarios y Accesos" (solo admin)

Botón en header arriba derecha. Permite:
- Ver listado completo de usuarios con rol y email
- Cambiar rol de un usuario (admin ↔ manager ↔ worker) — bloqueado para admins
- Asignar locales a managers
- Activar/desactivar usuarios — bloqueado para admins y para uno mismo
- **🔐 Configurar permisos individuales por manager** (26 pantallas + 1 acción)

### Permisos individuales por manager

Tabla `manager_permissions` con 26 columnas `show_xxx` + 1 `can_manage_employees`.

| Defaults |
|---|
| TRUE: dashboard, staff, ahora_mismo, fichajes_global, kiosko_fichaje, solicitudes, turnos_abiertos, cambios_pendientes, calendario, plantilla_turnos, bolsa_horas, tasks, scheduled, incidents, audits, history, tspoon, ventas_analisis, prediccion_personal, inventory, can_manage_employees |
| FALSE: informes_personal, templates, zonas_pedido, locations, tspoon_settings, salaries |

### Aplicación en frontend

- **Sidebar**: filtra NAV según `manager_permissions`
- **BottomNav**: idem para móvil
- **StaffPage**: oculta campo Salario si no `show_salaries`; oculta botones "+ Nuevo Empleado", "Dar de baja", "Reactivar", "Eliminar permanente" si no `can_manage_employees`
- **Botón "👤 Modo trabajador"**: visible solo si role=manager Y tiene employee_id (entra a TrabajadorApp con botón de volver al modo gestor)

---

## 📦 ARCHIVOS CLAVE

### Servicios (`src/services/`)
- `authService.ts` — `getCurrentProfile`, `signOut`, `onAuthStateChange`, `isWorker`, `isManagerOrAdmin`, `isAdmin`
- `employeeAuthService.ts` — `createEmployeeWithAccount`, `deactivateEmployeeAccount`, `reactivateEmployeeAccount`, `deletePermanentEmployee`
- `userManagementService.ts` — `listUsers`, `changeUserRole`, `setManagerLocations`, `setUserActive`
- `managerPermissionsService.ts` — `getManagerPermissions`, `saveManagerPermissions`, `resetManagerPermissions`

### Pages (`src/pages/`)
- `LoginPage.tsx` — Magic Link
- `UsuariosAccesosPage.tsx` — Admin gestiona usuarios
- `StaffPage.tsx` — Personal (con permisos aplicados)
- `trabajador/TrabajadorApp.tsx` — App empleado (recibe employeeId del Auth global)

### Components (`src/components/`)
- `ManagerPermissionsModal.tsx` — Modal 26 checkboxes para configurar permisos

### App raíz (`src/`)
- `App.tsx` — Routing, header con info usuario, filtro NAV por permisos, modo trabajador para manager

### Edge Functions (Supabase)
- `manage-employee/index.ts` — Toda la gestión de empleados con cuenta

### SMTP Templates en Resend (vía Edge Function)
- Bienvenida: "🍽️ Bienvenido a Foodint - Activa tu cuenta"
- Reactivación: "🍽️ Tu cuenta de Foodint está reactivada"
- Login normal: "🍽️ Tu enlace para entrar a Foodint" (template Supabase + Resend SMTP)

### Branding emails
- `from: "Foodint <noreply@foodint.es>"`
- Header granate #7C1A1A con "Foodint" en Georgia serif
- Botón "Entrar a Foodint" granate
- Fondo beige #F5E9D9

---

## 🐛 BUGS CONOCIDOS

| Bug | Severidad | Estado |
|---|---|---|
| Disponibilidad en ficha vs scheduler desincronizadas | 🟡 Bajo | No usado en producción aún |
| Catch-all en `idasal.com` confunde tests (los emails se reenvían) | 🔵 Workaround | Usar Gmail para tests |

---

## 🔐 CREDENCIALES Y SECRETS

### Supabase
- URL: `https://xzmpnchlguibclvxyynt.supabase.co`
- API Keys en `Settings → API Keys` (publishable + secret)
- Las legacy `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` siguen funcionando aunque marcadas DEPRECATED

### Resend
- Dominio: `foodint.es` VERIFIED (DKIM/SPF DNS en OVH)
- Región: Ireland (eu-west-1)
- API Key guardada como secret `RESEND_API_KEY` en Edge Functions

### Legacy hardcodeado (PENDIENTE ROTAR)
- `LASTAPP_TOKEN` (`247ef137-...`) en `api/webhook.js` y `api/debug.js` — usado para sync con Last.app

---

## 🛣️ ROADMAP / PENDIENTES

### Cercanos
- 🟡 Bug Disponibilidad UI vs scheduler
- 🧹 Limpieza ocasional de empleados de prueba residuales

### Medios
- 🔵 RLS estricto en tablas (pospuesto hasta tener varios trabajadores)
- 🔵 OTP estilo Last.app (código 6 dígitos en lugar de Magic Link) — documentado en MEJORA_PENDIENTE_OTP.md
- 🔵 Rotar LASTAPP_TOKEN hardcodeado

### Largo plazo
- Más mejoras a definir según uso real

---

## ⚙️ FLUJO DE TRABAJO TÍPICO

1. Claude genera tarjeta de código (con `present_files`)
2. Usuario descarga
3. Sube a GitHub vía web (lápiz ✏️ → Ctrl+A → Ctrl+V → commit)
4. CI/CD despliega automáticamente (1-2 min)
5. Usuario recarga app con Ctrl+Shift+R y prueba

Para Edge Functions:
1. Claude genera el código
2. Usuario va a Supabase → Edge Functions → manage-employee → Code
3. Ctrl+A → Ctrl+V → Deploy function

Para cambios en BD:
1. Claude genera SQL
2. Usuario ejecuta en SQL Editor de Supabase
3. Si añades columnas nuevas: ejecutar `NOTIFY pgrst, 'reload schema';` para refrescar cache

---

## 🎯 ESTADO PRE-PRODUCCIÓN

✅ **Módulo Personal listo para producción real**:
- CRUD empleados completo
- Sistema Auth con 3 roles
- Permisos individuales por manager
- Cuentas auth automáticas (alta/baja/eliminación)
- Salarios protegidos
- Modo trabajador para managers
- Audit log completo

⏳ **Cuando se quiera abrir la app a managers reales**:
1. Crear el manager como empleado normal
2. En Usuarios y Accesos: cambiar rol a manager + asignar local
3. Configurar permisos individuales (🔐 Configurar permisos)
4. Empleado recibe Magic Link y entra a su app

---

**Última actualización**: 2026-05-12 (sesión v6)
