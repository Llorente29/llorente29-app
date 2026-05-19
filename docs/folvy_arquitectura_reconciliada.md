# Arquitectura Folvy — documento reconciliado

**Fecha de cierre:** 18 de mayo de 2026
**Versión:** 2.0 (Sesión 0 de base sólida)
**Reemplaza:** `arquitectura_plataforma_2026-05-16.md` v1.0
**Estado de implementación:** documento de diseño + decisiones firmes. Fase 0 pendiente de ejecución.

---

## 0. Por qué existe este documento

El 16 de mayo de 2026 se redactó la primera versión de la arquitectura de plataforma. Dos días después, en una sesión de revisión, se detectó que:

1. El documento existía y era sólido conceptualmente.
2. **La implementación no reflejaba lo que el documento prescribía.** Se estaban añadiendo módulos sobre arquitectura monolítica anterior, no sobre el Shell + Module Contract.
3. Cuatro contradicciones críticas habían surgido entre las decisiones del documento y decisiones de producto posteriores (auth, permisos, dos apps, naming).
4. Varios elementos clave (panel superadmin, naming Folvy real, dos PWAs, MRP II como visión, agregador delivery propio) no estaban en el documento.

Este documento **reconcilia todo** y es la nueva referencia única de arquitectura. Sustituye al anterior. Es el punto de partida de Fase 0.

---

## 1. Resumen ejecutivo (2 minutos de lectura)

Folvy es una plataforma de gestión hostelera multi-tenant, multi-marca, multi-local, con arquitectura **Shell + módulos enchufables + adapters de terceros**.

**Visión a 5 años:** plataforma operativa profunda con MRP II adaptado a hostelería, agregador delivery propio (tipo Otter/Deliverect), TPV propio, contabilidad integrada con gestorías, módulos de IA distribuida y capacidades de visión artificial en cocina (inspirado en Bronze.vision).

**Folvy V1 (entrega a Llorente29):**
- Folvy Team (Personal): empleados, fichajes, turnos, vacaciones, kiosko PIN, portal del empleado.
- Folvy Safety (APPCC + Auditorías): 7 planes legales, plantillas, ejecuciones, auditorías.
- Folvy Sales (backend silencioso): adapter Last.app + tabla `sales` acumulando datos sin UI visible.
- Configuración de cuenta en Shell: marcas, locales, centros de coste, canales, cuentas de análisis, usuarios y permisos.
- Panel superadmin Folvy: gestión de cuentas cliente, impersonation con audit, 2FA.
- Dos PWAs: Folvy Manager (admin/manager) + Folvy Empleados (workers), con preparación Capacitor para nativa futura.

**Folvy V1.1+:** Operations (artículos, escandallos, proveedores), Sales dashboards visibles, trazabilidad básica APPCC.

**Folvy V2+:** Operations completo (inventario + compras + albaranes), adapters delivery directos (Glovo → Uber Eats → Just Eat), Sales predicción.

**Folvy V3+:** TPV propio condicional, agregador delivery propio, Folvy Procurement extraído, Books con adapters de gestoría, Verifactu via proveedor certificado, AI distribuido, Bronze.vision kitchen vision.

**Folvy V4-V5:** MRP II completo.

**Calendario inmediato:** Fase 0 se ejecuta **ANTES** de Llorente29 a producción (Escenario C1 de Sesión 0). Llorente29 entra con la arquitectura definitiva en finales junio / primera semana julio 2026.

---

## 2. Identidad de marca

### 2.1. Nombre y posicionamiento

- **Marca paraguas:** Folvy.
- **Naming en código:** uso de minúscula en wordmark visual (`folvy`), mayúscula en texto corrido (`Folvy`).
- **Marca anterior (Foodint):** descartada. Todo el rebranding entra en Fase 0.
- **Naming repositorios:** migración eventual `llorente29-app` → `folvy-app` apuntada como deuda baja.
- **Naming módulos comerciales:** estructura "Branded House" — Folvy Team, Folvy Safety, Folvy Sales, Folvy Operations, etc.
- **Naming técnico (id):** se mantiene en español/neutro (`personal`, `appcc`, `ventas`, `operaciones`) para cero migración BBDD.

### 2.2. Tagline

> Hostelería profesional. Software profesional.

### 2.3. Paleta de colores

La paleta del `tailwind.config` actual es la definitiva. Se añade un único token nuevo (`brand-accent`) para momentos de marca puros.

| Token | Hex | Uso |
|---|---|---|
| `page` | `#F5F4F0` | Fondo principal de página |
| `card` | `#FFFFFF` | Superficies, cards |
| `border-default` | `#E0DDD6` | Bordes 0.5px |
| `text-primary` | `#0C0A09` | Texto principal |
| `text-secondary` | `#6B6760` | Texto secundario, captions |
| `text-on-accent` | `#FFFFFF` | Texto sobre accent |
| `accent` | `#1E3A5F` | Acento principal: navegación, CTAs, logo |
| `accent-hover` | `#162E4A` | Hover sobre accent |
| `accent-bg` | `#EDECE6` | Backgrounds suaves de accent |
| `success` | `#3F5C2F` | Verde oliva |
| `success-bg` | `#E2E8DA` | Background suave success |
| `danger` | `#A32D2D` | Rojo ladrillo |
| `danger-bg` | `#FAECEC` | Background suave danger |
| `warning` | `#BA7517` | Ámbar/mostaza |
| `warning-bg` | `#FAEEDA` | Background suave warning |
| **`brand-accent`** | **`#D67442`** | **NUEVO: solo logo, favicon, splash, momentos de marca pura** |
| **`brand-accent-hover`** | **`#B85E32`** | **NUEVO: hover/active de brand-accent** |

**Regla de uso del `brand-accent`:** NO sustituye a `warning`. `warning` mantiene semántica de aviso en UI. `brand-accent` es identidad visual Folvy exclusivamente.

### 2.4. Tipografía

Estructura jerárquica con tres familias, ya configuradas en `tailwind.config`:

| Familia | Uso | Pesos |
|---|---|---|
| **Fraunces** (serif) | Wordmark logo + h1 hero + headers de sección importantes (login, dashboards, módulos) | 700 |
| **Inter** (sans) | UI corriente: botones, formularios, tablas, sidebars, body, h2/h3/h4 | 400, 500 |
| **JetBrains Mono** (mono) | Cifras en dashboards, IDs, timestamps, código, alineación tabular | 400, 500 |

### 2.5. Logo

**Concepto del isotipo:** círculo cerrado + arco superior derecho + punto central. El círculo simboliza completitud operativa, el arco simboliza tiempo/progreso, el punto el núcleo.

**Composición cromática:**
- Círculo: `accent` (`#1E3A5F`)
- Arco: `brand-accent` (`#D67442`)
- Punto: `brand-accent` (`#D67442`)

**Versiones obligatorias en Fase 0:**
1. Logo principal sobre fondo `page` (`#F5F4F0`).
2. Logo oscuro sobre fondo `accent` (`#1E3A5F`).
3. Isotipo cuadrado con esquinas redondeadas para favicons y app icons (manager + empleados, ambos con misma base pero distinguidos por color de fondo).

---

## 3. Los 8 principios de arquitectura (firmes)

Si una decisión futura viola uno de estos, hay deuda. Es así de simple.

### Principio 1 — Una sola plataforma, muchos módulos. Nunca al revés.

No se construyen "apps separadas que comparten login". Se construye **una sola aplicación** con un Shell que monta dinámicamente módulos. El usuario percibe un producto integrado.

**Consecuencia técnica:** una sola codebase, una sola URL base, un solo deploy. Múltiples bundles vía code-splitting (cada módulo es un chunk perezoso).

**Excepción aclarada en Sesión 0:** una sola codebase NO significa una sola "vista". Tras login, el sistema enruta:
- `admin`/`manager` → `/admin/...` (Shell completo con TopBar de módulos)
- `worker` → `/portal/...` (Shell simplificado, portal del empleado)
- Dos manifests PWA distintos: "Folvy Manager" y "Folvy Empleados" con iconos propios.
- Estructura de carpetas: `src/shell/*`, `src/admin/*`, `src/portal/*`.

### Principio 2 — El Shell no conoce los módulos por nombre.

`App.tsx` (o el reemplazo tras Fase 0) **nunca** tiene imports directos de módulos. Tiene un registry que carga lo que esté registrado.

**Consecuencia:** añadir módulo nuevo = 1 fichero de registro + N ficheros del módulo. Quitar módulo = borrar 1 línea del registry. Cero modificaciones en el Shell.

### Principio 3 — Los módulos no se conocen entre sí.

Si dos módulos necesitan colaborar, lo hacen vía contratos públicos del Shell: bus de eventos tipado, hooks compartidos (`useActiveAccount`, `useActiveLocation`, `usePermissions`, etc.), o APIs del Shell (`shell.notify()`, `shell.openModal()`).

**Consecuencia:** puedes borrar un módulo y la app sigue funcionando. Puedes sustituir un módulo propio por un adapter de tercero sin afectar a otros.

### Principio 4 — Construir o integrar es decisión por módulo, no por plataforma.

Cada **dominio** (TPV, Personal, Contabilidad, Delivery, etc.) tiene un adapter público. Foodint publica adapter nativo cuando construye el módulo, y/o adapters de terceros. El cliente elige cuál activa.

### Principio 5 — Multi-tenant desde el dato, no como capa.

Cada tabla en Supabase tiene `account_id`. Todas las queries lo filtran. RLS lo aplica. Esto ya está implementado tras Bloque S del 16/05/2026.

### Principio 6 — Multi-marca y multi-local son ortogonales al módulo.

Marcas, locales, centros de coste, canales y cuentas de análisis son del Shell (settings de cuenta). Los módulos los consumen vía hooks. **Esto migra del módulo Stock actual al Shell en Fase 0.**

### Principio 7 — Cada módulo es activable/desactivable por cuenta.

El plan comercial dicta qué módulos están activos para qué cuenta vía tabla `account_modules`. La activación es dato, no código.

### Principio 8 — Adapters de integración con terceros son adapters de dominio, no módulos sueltos.

"Conectar con Glovo" no es un parche. Es un `Adapter<delivery-platform>` que implementa la interfaz pública del dominio Delivery. Mismo patrón para TSpoon (TPV), Holded (accounting), Sesame (payroll), etc.

---

## 4. El Shell de la plataforma

### 4.1. Layout — el patrón "Microsoft 365"

```
┌─────────────────────────────────────────────────────────────────────┐
│  [folvy] PERSONAL  APPCC  VENTAS  OPERACIONES   [Local▼][🔔][JG]   │  ← TopBar + Header
├──────────┬──────────────────────────────────────────────────────────┤
│ Empleados│                                                          │
│ Fichajes │                                                          │
│ Turnos   │          Contenido del módulo activo                     │
│ Vacacs.  │                                                          │
│ Kiosko   │                                                          │
└──────────┴──────────────────────────────────────────────────────────┘
```

**Tres niveles de navegación:**
1. **TopBar de módulos** (controlado por Shell, lista los módulos activos para la cuenta).
2. **ModuleSidebar** (cada módulo declara su sidebar propio en su `ModuleDefinition.sidebar`).
3. **Header transversal** (Shell: selectores de local/marca, notificaciones, perfil).

**Cambio firme respecto al estado actual:** el sidebar lateral único actual desaparece y se reemplaza por TopBar + ModuleSidebar. **Resuelve la queja explícita de Sesión 0: "no se puede trabajar con un menú lateral desplegable tan amplio".**

### 4.2. Routing

React Router v6 con outlet anidado. Estructura de rutas:

```
/login                                    → fuera del Shell
/welcome?token=XXX                        → set-password tras invitación
/reset-password                           → recuperación
/_admin/...                               → panel superadmin Folvy (URL oculta)
/[account-slug]/                          → entrada al Shell del cliente
/[account-slug]/personal/...              → módulo Folvy Team
/[account-slug]/personal/empleados        → listado de empleados
/[account-slug]/personal/empleados/:id    → detalle empleado
/[account-slug]/appcc/...                 → módulo Folvy Safety
/[account-slug]/ventas/...                → módulo Folvy Sales (V1.1+)
/[account-slug]/operaciones/...           → módulo Folvy Operations (V1.1+)
/[account-slug]/configuracion/...         → Settings de cuenta (Shell, no módulo)
/portal/...                               → app del empleado (worker)
```

**Decisiones de routing firmes:**
- `[account-slug]` visible desde día uno. Si el usuario tiene una sola cuenta, redirect transparente.
- Deep linking soportado en todas las rutas.
- El estado de selección (`activeLocationId`, `activeBrandFilter`) NO va en URL: persiste en localStorage + AppContext. La URL identifica QUÉ ves, no en qué contexto.

### 4.3. Autenticación y multi-cuenta

**Modelo:**
- `auth.users` (Supabase Auth) — identidad.
- `user_profiles` — vinculación user ↔ account con `role` (admin/manager/worker).
- `manager_locations` — qué locales gestiona cada manager.
- `manager_permissions` — flags individuales de permisos finos.

**Auth primario:** email + password.

**Magic link:** mecanismo secundario para:
- Welcome email tras invitación (primer login → set-password).
- Recuperación de password olvidado.

**Flujo Supabase:** cambiar `flowType: 'implicit'` actual a configuración compatible con password.

### 4.4. Panel superadmin Folvy (firme desde Fase 0)

Sistema **separado** del flujo de usuarios de cuenta cliente. Razón: separación de plano de control (Folvy) y plano de cliente, requisito RGPD/legal/comercial.

**Componentes:**
- Tabla `platform_admins` (separada de `user_profiles`).
- URL oculta: `app.folvy.app/_admin` o subdominio dedicado.
- **2FA TOTP obligatorio** (Google Authenticator/Authy) desde día uno.
- **Impersonation controlada:** el platform_admin puede entrar "como" admin de una cuenta cliente, pero todas las acciones quedan registradas en `audit_log` como hechas por el platform_admin, NO por el admin real.
- **CRUD de cuentas cliente:** alta de empresa nueva (razón social, NIF, slug, plan, primer admin), edición, suspensión, archivo.
- **Modalidad de alta de empresas V1:** Modalidad 3 manual (yo creo la cuenta desde el panel, el sistema envía welcome email al primer admin). Roadmap V2: Modalidad 2 con invitación token.

### 4.5. Permisos finos con sets predefinidos

**Rol base** (3 niveles): admin / manager / worker.

**Sets predefinidos** (templates configurables por superadmin):
- `gerente_total`
- `encargado_sala`
- `encargado_appcc`
- `gestor_rrhh`
- (ampliables sin migración)

**Override individual:** flags booleanos en `manager_permissions` (`can_see_salaries`, `can_approve_vacations`, `can_edit_schedule`, `can_close_audits`, `can_manage_employees`, etc.).

**Catálogo inicial:** 10-15 flags. Ampliable según necesidad sin migración de schema.

### 4.6. Estado global del Shell

Hooks que el Shell expone a todos los módulos:

```typescript
useAuth()              // user, signOut, isLoading
useAccount()           // accountId, accountName, plan, activeModules
useMembership()        // role, permissions, isAdmin, isOwner
useActiveLocation()    // locationId | 'all', setActiveLocation
useActiveBrandFilter() // brandIds[], setActiveBrandFilter
useLocations()         // todos los locales de la cuenta
useBrands()            // todas las marcas de la cuenta
useSuppliers()         // proveedores de cuenta (NUEVO desde V1.1)
useNotifications()
usePermission(perm)
useShellNavigation()   // navigate, openModal, openDrawer
```

Si un módulo necesita estado adicional, lo gestiona internamente. No lo eleva al Shell.

### 4.7. Settings de cuenta (Shell, no módulo)

Vive en `/[slug]/configuracion/` (icono engranaje en header). Contiene:

- **V1:** Datos cuenta (razón social, NIF, dirección fiscal, logo) · Locales · Marcas · Centros de coste · Canales de venta · Cuentas de análisis · Usuarios y permisos (incluye sets predefinidos) · Plan y facturación · Activación/desactivación de módulos · API keys y webhooks · Audit log.
- **V1.1:** + Proveedores.
- **V2+:** + Integraciones avanzadas (adapters delivery, OCR, etc.).

### 4.8. Tabla `account_modules`

```
account_id, module_id, adapter_id, status, activated_at, settings (jsonb)
```

Ejemplo Llorente29:

```
acc_llorente29, 'personal',  'folvy-native',     active, 2026-07-01
acc_llorente29, 'appcc',     'folvy-native',     active, 2026-07-01
acc_llorente29, 'ventas',    'last-app-adapter', active, 2026-07-01
acc_llorente29, 'operaciones','folvy-native',    pending, null         // V1.1
```

El Shell consulta esta tabla al inicio de sesión y construye TopBar + permisos de navegación.

---

## 5. El Module Contract

### 5.1. Interfaz `ModuleDefinition`

```typescript
interface ModuleDefinition {
  // Identidad
  id: string;                          // 'personal', 'appcc', 'ventas', 'operaciones'
  name: string;                        // 'Folvy Team', 'Folvy Safety', etc.
  icon: ComponentType;                 // icono Tabler outline
  topBarOrder: number;                 // posición en TopBar

  // Permisos y gating
  requiredRole?: Role;                 // rol mínimo para ver el módulo
  requiredPlan?: PlanId;               // plan mínimo (gating comercial)

  // Routing
  basePath: string;                    // 'personal'
  routes: RouteObject[];               // React Router v6 anidadas

  // Navegación interna
  sidebar: SidebarDefinition;          // ModuleSidebar del módulo

  // Adapters opcionales (si el módulo soporta integraciones)
  adapters?: AdapterRegistry;

  // Eventos publicados/consumidos
  publishes?: EventDescriptor[];
  subscribes?: EventDescriptor[];

  // Settings propios del módulo
  settingsPanel?: ComponentType;

  // Lifecycle
  onActivate?: (ctx: ShellContext) => Promise<void>;
  onDeactivate?: (ctx: ShellContext) => Promise<void>;
}
```

### 5.2. Ejemplo de registro

```typescript
// src/admin/modules/personal/index.ts
export const personalModule: ModuleDefinition = {
  id: 'personal',
  name: 'Folvy Team',
  icon: UsersIcon,
  topBarOrder: 1,
  requiredRole: 'manager',
  basePath: 'personal',
  routes: personalRoutes,
  sidebar: personalSidebar,
  publishes: [
    { event: 'personal.employee.created', schema: EmployeeCreatedSchema },
    { event: 'personal.clock.in', schema: ClockInSchema },
  ],
};

// src/shell/moduleRegistry.ts
export const moduleRegistry: ModuleDefinition[] = [
  personalModule,
  appccModule,
  ventasModule,
  // operacionesModule (V1.1+)
];
```

### 5.3. Bus de eventos

Singleton tipado del Shell.

- Síncronos en cliente (un módulo emite, los suscritos reaccionan en mismo tick).
- Procesamiento pesado → dispara job background, no inline.
- Eventos críticos se persisten en `event_log` para audit y replay.

### 5.4. Catálogo de adapters

```typescript
interface Adapter<TDomain, TConfig = unknown> {
  id: string;                          // 'folvy-native', 'last-app', 'glovo', etc.
  name: string;                        // 'Folvy nativo', 'Last.app', 'Glovo'
  vendor: 'folvy' | 'third-party';
  domain: ModuleDomain;

  configure(config: TConfig): void;
  test(): Promise<{ ok: boolean; message: string }>;

  // Métodos específicos del dominio
  // ...
}
```

---

## 6. Catálogo de módulos Folvy

### 6.1. Tabla resumen

| Módulo | id | Display | V1 | V1.1 | V2 | V3 | V4+ |
|---|---|---|---|---|---|---|---|
| Personal | `personal` | Folvy Team | ✅ Todo | mejoras | mejoras | mejoras | mejoras |
| APPCC + Auditorías | `appcc` | Folvy Safety | ✅ APPCC + Audit | trazab. básica | trazab. avanzada | | |
| Ventas | `ventas` | Folvy Sales | ✅ backend Last.app | dashboards | predicción + webhooks | TPV propio inicio | TPV completo |
| Operaciones | `operaciones` | Folvy Operations | — | ✅ artículos + escandallos + proveedores | inventario + compras + albaranes | MRP I + extracción Procurement | MRP II |
| Procurement | `procurement` | (naming pendiente) | — | — | — | extracción de Operations | avanzado + B2B + EDI |
| Books | `books` | (naming diferido) | — | — | — | (decisión diferida) | contabilidad + adapters gestoría |
| Delivery | `delivery` | Folvy Delivery | — | — | — | adapter directo Glovo (post-TPV) | agregador completo (Otter/Deliverect equivalente) |
| Reservas | `reservas` | Folvy Reservations | — | — | — | adapter CoverManager/TheFork | propio |
| Reputación | `reputacion` | Folvy Reputation | — | — | — | cruce reseñas + ventas | |
| Marketing | `marketing` | Folvy Marketing | — | — | — | adapter Mailchimp/Brevo | |
| Verifactu | `verifactu` | Folvy Verifactu | — | — | regulatorio España | adapter proveedor certificado | |
| AI | `ai` | Folvy AI | — | — | — | decisión diferida (distribuido vs módulo) | |
| Kitchen Vision | `kitchen-vision` | (Folvy QA o similar) | — | — | — | adapter Bronze.vision | propio |

### 6.2. Módulos V1 — detalle

**Folvy Team (`personal`)** — cubre:
- Empleados (alta, edición, baja, asignación a locales)
- Control horario / fichajes
- Turnos y calendario laboral
- Vacaciones
- Cambios de turno
- Plantilla y bolsa de horas
- Kiosko PIN (para fichaje rápido en local)
- Portal del empleado (vista worker en app Folvy Empleados)
- Export de resúmenes mensuales para gestoría externa

**Folvy Safety (`appcc`)** — cubre:
- 7 planes APPCC obligatorios (limpieza, control plagas, agua, formación, mantenimiento, proveedores, trazabilidad documental)
- Plantillas de checklists
- Ejecuciones diarias con schedules
- Frecuencias configurables
- Auditorías (checklists internos o normativos)
- Replicación automática a cuentas vía trigger (ya operativo en P6)

**Folvy Sales (`ventas`) — backend silencioso V1:**
- Adapter Last.app: lectura de ventas via API
- Tabla `sales` (campos `sale_id`, `location_id`, `brand_id`, `channel_id`, `datetime`, `total`, `items[jsonb]`)
- Job programado: sync diario via Edge Function + pg_cron
- Mapeo Last.app stores ↔ locations Folvy
- UI mínima en Settings: "Integraciones → Last.app → API key + estado conexión"
- **Sin dashboards visibles para cliente en V1.** Los datos se acumulan desde día uno.

### 6.3. Configuración cuenta V1 (Shell, no módulo)

Migra del actual módulo Stock al Shell:
- Marcas
- Locales
- Centros de coste
- Canales de venta
- Cuentas de análisis

Añade:
- Usuarios y permisos con sets predefinidos
- Datos fiscales de cuenta
- Plan y facturación Folvy
- Activación/desactivación de módulos
- Audit log
- (V1.1) Proveedores

---

## 7. Catálogo de dominios de adapter

Esto **NO se construye** en Fase 0. Lo que se construye es la **infraestructura de adapter en el Shell** que admite cualquiera de estos sin reescribir nada.

| Dominio | Descripción | Cuándo se usa | Adapter Folvy | Adapters terceros |
|---|---|---|---|---|
| `tpv` | Punto de venta | V3+ Folvy TPV propio | (V3+) | TSpoon, Revo, Last.app, Toast, Lightspeed |
| `sales-reader` | Lectura de ventas de TPV | V1 (Last.app) | — | Last.app, futuro otros |
| `delivery-aggregator` | Agregador delivery completo | V3+ Folvy propio | (V3+) | Otter, Deliverect, Last.app (incluido) |
| `delivery-platform` | Plataforma delivery individual | V2+ adapters directos | (V3+) | Glovo → Uber Eats → Just Eat → Deliveroo |
| `accounting` | Contabilidad/gestoría | V3+ adapters | (V4+ propio Books) | Holded, Anfix, Quipu, Contasol |
| `payroll` | Nóminas | V3+ adapters | — | A3nom, Sage Nómina |
| `messaging` | Mensajería masa | V2+ | (V2 nativo email/SMS) | Twilio, WhatsApp Business |
| `reservations` | Reservas | V2+ | (V4+ propio) | CoverManager, TheFork, OpenTable |
| `reviews` | Reseñas | V3+ | — | Google, TripAdvisor, Glovo reviews |
| `b2b-catalog` | Catálogos B2B distribuidores | V3+ | — | Makro, Coviran, distribuidores locales |
| `procurement-edi` | EDI con grandes distribuidores | V4+ | — | Fluctúa según cliente |
| `kitchen-vision` | Visión artificial cocina | V3+ | (V4+ propio) | Bronze.vision |
| `verifactu` | Facturación electrónica certificada | V3 (obligatorio España) | — | Proveedor certificado |
| `email-marketing` | Email marketing | V3+ | — | Mailchimp, Brevo |

---

## 8. Service Layer compartido

Servicios transversales que cualquier módulo puede usar. Viven en el Shell. No son módulos.

### 8.1. Notificaciones unificadas

```typescript
shell.notify({
  to: { user: 'u_123' } | { role: 'admin' } | { account: 'acc_456' },
  channels: ['in-app', 'email', 'push'],  // 'whatsapp' V2+
  template: 'appcc.task.due',
  data: { taskName: 'Limpieza vitrina', dueIn: '2h' },
  priority: 'normal',
});
```

- Tabla `notifications` + cola de envíos.
- In-app servido por Supabase Realtime.
- Email via servicio (Resend / Postmark / similar) — decisión técnica pendiente.

### 8.2. Audit log

Cualquier acción sensible se registra en `audit_log`:

```
id, account_id, user_id (o platform_admin_id), module_id, action,
entity_type, entity_id, before (jsonb), after (jsonb), ip, timestamp,
impersonating_user_id (nullable, para superadmin)
```

### 8.3. Background jobs

Cola de trabajos para procesamiento asíncrono: sync TPV, generación de reportes, envíos masivos, etc.

Implementación: pg_cron de Supabase Pro + Edge Functions.

### 8.4. Files y storage

Adjuntos, fotos APPCC, albaranes escaneados, logos, etc. Supabase Storage.

---

## 9. Hoja de ruta — fases reorganizadas

### Fase 0 — Shell + Auth + Branding Folvy (ANTES de Llorente29)

**Estimación:** 30-50 horas reales, 4-6 semanas a ritmo intermitente.

**Bloques:**

1. **Shell base**
   - `src/shell/*`: App, Router, Layout, TopBar, ModuleSidebar, Header, ModuleRegistry, EventBus.
   - React Router v6 con outlet anidado.
   - Estructura `src/admin/*` y `src/portal/*` separadas.
   - Tabla `account_modules` en Supabase.

2. **Auth email + password**
   - Cambiar Supabase `flowType` a compatible con password.
   - `authService.ts`: `signInWithPassword`, `resetPasswordForEmail`, `updatePassword`.
   - `LoginPage` rediseñada (email + password como primario, magic link como recuperación).
   - `SetPasswordPage` para welcome email.
   - `ResetPasswordPage`.
   - Smoke test con Llorente29.

3. **Panel superadmin Folvy**
   - Tabla `platform_admins` separada.
   - URL oculta `/_admin` o subdominio.
   - 2FA TOTP obligatorio.
   - Impersonation con audit.
   - CRUD de cuentas cliente.
   - Welcome email + flujo set-password.

4. **Permisos finos con sets predefinidos**
   - Tabla `permission_sets` con templates.
   - UI gestión de usuarios en Settings de cuenta.
   - Wizard de alta diferenciado por rol.

5. **Migración Marcas/Locales/Centros/Canales/Cuentas al Shell**
   - Mover del módulo Stock actual a Settings.
   - Cero cambios en BBDD (tablas siguen igual, cambia la UI de gestión).

6. **Rebranding Folvy completo**
   - Tailwind config: añadir `brand-accent`, `brand-accent-hover`.
   - Cargar fuentes Fraunces + Inter + JetBrains Mono.
   - Logos en SVG (principal + oscuro + isotipo app icon).
   - Favicon.
   - Manifests PWA: "Folvy Manager" + "Folvy Empleados".
   - Naming UI "Folvy" en todos los textos.
   - Email templates branded (welcome, reset password, notificaciones).
   - Preparación Capacitor (configuración compatible, sin compilar nativa todavía).

**Condiciones de salida Fase 0:**
- ☐ Login email + password operativo.
- ☐ Panel superadmin Folvy operativo con 2FA + impersonation + audit.
- ☐ Una cuenta nueva puede crearse desde el panel.
- ☐ TopBar + ModuleSidebar + Header renderizan correctamente.
- ☐ Dos manifests PWA instalables como apps con icono propio.
- ☐ Rebranding Folvy aplicado en todos los lugares visibles.

### Fase 1 — Migración módulos existentes + Llorente29 a producción

**Estimación:** 20-30 horas, 3-4 semanas.

**Bloques:**

1. Migrar módulos `personal` y `appcc` al patrón `ModuleDefinition`.
2. Verificar deuda detectada en P6: setters expuestos en AppContext (`setStaff`, `setTasks`, `setTemplates`, `setIncidents`, `setAudits`, `setNotifConfig`, `setSchedules`) → revisar y retirar con patrón `saveX/removeX`.
3. Fix Edge Function `manage-employee` (Bug 3 PGRST116).
4. Backend Sales con adapter Last.app + job de sync diario.
5. Configurar schedules APPCC vía Wizard para los 3 locales Llorente29.
6. Smoke test end-to-end exhaustivo.
7. Llorente29 entra a producción vía panel superadmin Folvy.

**Condiciones de salida Fase 1:**
- ☐ Llorente29 operando en producción.
- ☐ Adapter Last.app sincronizando ventas (datos en BBDD, sin UI).
- ☐ Cero deuda residual de setters expuestos en AppContext.
- ☐ Edge Function `manage-employee` funcionando para empleados con email.

### Fase 2 — Folvy Operations V1.1 + Folvy Sales V1.1

**Estimación:** 30-50 horas, 4-6 semanas.

- Operations: artículos, escandallos básicos, proveedores.
- Sales: dashboards visibles, filtros multi-local, comparativas básicas.
- APPCC: trazabilidad básica.

**Condiciones de salida:**
- ☐ Cliente 2 firmado y operando con Personal + APPCC + Sales dashboards + Operations.
- ☐ Tiempo de onboarding de cuenta nueva ≤ 2 horas.

### Fase 3 — Folvy Operations V2 + adapters delivery directos + Sales predicción

**Estimación:** 60-100 horas.

- Operations: inventario por almacén, órdenes de compra, recepción albaranes manual.
- (V2.1 opcional) OCR de albaranes.
- Adapter directo Glovo → Uber Eats → Just Eat (uno a uno).
- Sales: predicción de ventas + webhooks tiempo real.
- Notificaciones in-app + email funcionales.
- Background jobs queue establecido.

**Condiciones de salida:**
- ☐ 5+ clientes activos.
- ☐ Operations cubriendo gestión real de inventario en al menos un cliente.

### Fase 4 — Folvy TPV propio + Folvy Delivery propio + extracción Procurement + Books + Verifactu + MRP I

**Estimación:** 200+ horas.

**TPV propio condicional a:**
- 8-10 clientes activos facturando.
- Demanda explícita.
- Equipo/capacidad para mantener TPV (nervio operativo 24/7).

**Folvy Delivery propio (agregador):** se construye cuando el cliente puede dejar Last.app/Otter/Deliverect y migrar a Folvy completo. **Requisito:** Folvy TPV propio + clientes que valgan el coste de certificación partner con Glovo/Uber/Just Eat.

**Books:** posicionamiento NO Nivel 3-5 propio. Adapters Holded/Anfix/Quipu para mandar resúmenes y facturas. Decisión diferida sobre alcance exacto.

**Verifactu:** adapter via proveedor certificado. NO desarrollo propio.

**MRP I:** generación automática de órdenes de compra basadas en stock mínimo + previsión Sales.

### Fase 5 — MRP II completo + IA distribuida + resto

Visión 4-5 años. Cuando llegue.

---

## 10. Decisiones (P) — estado actualizado al 19/05/2026

Esta sección reflejaba decisiones pendientes en la Sesión 0 (18/05/2026). Tras Sprint 0.1 y Sprint 1, varias quedan resueltas. Estado actualizado:

### ✅ Hosting frontend — RESUELTO (18/05/2026)
- **Decisión**: Vercel.
- 2 proyectos creados con SSL Let's Encrypt automático: `folvy-landing` (apex) y `folvy-app-staging` (`app.folvy.app`).
- Repos GitHub asociados.

### ✅ Provider de email transaccional — RESUELTO (18/05/2026)
- **Decisión**: Resend.
- Workspace "Folvy" activo. Dominio `folvy.app` verificado (DKIM + SPF + DMARC + MX en OVH).
- API key `folvy-production-v1` generada.
- 🟡 Deuda menor pendiente: activar 2FA en Resend.

### ⚠️ PITR / red de seguridad BBDD — DECISIÓN D5 (18/05/2026, Opción B)
- PITR descubrió ser **add-on de pago adicional al plan Pro** (~+100$/mes), no incluido como inicialmente se creía.
- **Decisión Julio CEO vía WhatsApp 23:16 UTC 18/05/2026**: aceptar riesgo con scheduled backups diarios. NO activar add-on por ahora.
- Justificación: Llorente29 no usa la app actualmente (BBDD prácticamente vacía).
- 🟡 **Reabrir antes de Sprint 14 (1-7 septiembre 2026)**, antes de migrar Llorente29 a producción.

### ✅ Dominios Folvy — RESUELTO (18/05/2026)
- **Decisión**: dominio principal `folvy.app` (apex + subdominio `app.folvy.app`).
- `folvy.es` registrado como secundario, sin configurar todavía.
- `folvy.com` **descartado** (no registrado, no se usa).

### (P) Folvy Books — naming y nivel de profundidad
- Pendiente. "Folvy Books" del BrandBook puede confundir (Nivel 3-5 contable).
- Alternativas: Folvy Finance, Folvy P&L, Folvy Costes.
- Caso operativo único confirmado: export mensual a gestoría externa (puede vivir en Personal en V1.1+ sin requerir módulo Books).

### (P) Folvy AI — distribuido vs módulo propio
- Decisión arquitectónica diferida a V2+.
- Recomendación inicial: distribuido (capacidades dentro de otros módulos) + asistente conversacional flotante en Shell. NO módulo propio con pestaña.

### (P) Folvy Delivery propio — cuándo y cómo
- Compromiso firme: SÍ se construye como agregador propio en V3+.
- Sin fecha. Condicionado a tracción comercial y migración del cliente Last.app → Folvy completo.

### (P) Naming módulos específicos
- Folvy Procurement (cuando se extraiga).
- Folvy QA / Folvy Vision (kitchen-vision).
- Folvy Books o alternativa.
- Folvy Delivery (confirmado).

---

## 11. Lo que este documento NO resuelve

Por honestidad:

1. **El modelo de datos detallado de cada módulo.** Cada módulo se modela cuando se construye, con la visión MRP II en mente.

2. **Estrategia comercial y precios.** Planes paquete, precios por módulo, condiciones para clientes early-adopter. Documento aparte, sesión propia.

3. **Stack de pagos.** Stripe / Redsys / Lemon Squeezy. Decisión técnico-comercial.

4. **Equipo y operación.** Quién construye qué, cadencia, soporte clientes, formación. CEO/COO.

5. **Testing/CI/CD/observabilidad detallado.** Decisión técnica posterior.

6. **Migración legal de marca.** Registro de Folvy como marca, dominios, propiedad intelectual. Tarea legal.

---

## 12. Anexo — Diferencias respecto al documento v1.0 (16/05/2026)

Para trazabilidad:

| Aspecto | v1.0 (16/05/2026) | v2.0 (18/05/2026 — esta) |
|---|---|---|
| Naming | Foodint | Folvy |
| Auth | "magic link suficiente hasta cliente 10" | Email + password primario desde día uno |
| Permisos | "solo rol global hasta cliente 5" | Granulares con sets predefinidos desde día uno |
| Apps | Una sola app | Dos PWAs (Manager + Empleados) con preparación Capacitor |
| Panel superadmin | No mencionado | Firme con `platform_admins`, 2FA, impersonation, audit |
| Módulo Stock | "Cocina" recomendado | `operaciones` / Folvy Operations |
| Folvy Sales | TPV propio Fase 4+ | Backend Last.app V1 + dashboards V1.1 + TPV propio V3+ |
| Folvy Delivery | Adapter Glovo Fase 2 | NO módulo en V1-V2. Agregador propio V3+. Last.app cubre Llorente29 temporalmente. |
| Kitchen Vision | No mencionado | Adapter Bronze.vision V3+ |
| MRP II | No mencionado | Visión firme V4-V5 |
| Cuándo Fase 0 | Implícito antes de cliente 2 | Firme: ANTES de Llorente29 a producción (Escenario C1) |
| TopBar + ModuleSidebar | Mencionado en §2.1 | Decisión firme. Reemplaza sidebar único actual. |
| Suppliers | No mencionado | Tabla del Shell, UI en Operations V1.1 |
| Compras | No mencionado explícitamente | Vive en Operations V2, extracción a Procurement V3-V4 |

---

## 13. Próximos pasos inmediatos

1. **CEO (Julio):**
   - Comunicar a Llorente29 que la entrada a producción se retrasa 4-6 semanas a cambio de arquitectura definitiva. Fecha objetivo: finales junio / primera semana julio 2026.
   - Comunicar a cliente 2 y cartera la misma mejora.
   - Decidir PITR Supabase Pro (bloqueante para Fase 1).
   - Confirmar dominios Folvy registrados y elegir hosting (Vercel recomendado).

2. **Sesiones técnicas pendientes:**
   - Sesión 1 — Spec funcional detallada V1 por módulo (`folvy_v1_spec.md`).
   - Sesión 2 — Modelo de auth y permisos detallado (`folvy_auth_model.md`).
   - Sesión 3 — Roadmap inverso a producción con sprints (`folvy_roadmap.md`).
   - Sesión 4 — Actualizar `CONTEXTO_CLAUDE.md` con todas las decisiones de Sesión 0.

3. **Después:** ejecución técnica de Fase 0, bloque a bloque, con disciplina.

---

**Documento cerrado el 18 de mayo de 2026 en sesión de reconciliación arquitectónica.**
**Reemplaza completamente al anterior `arquitectura_plataforma_2026-05-16.md`.**
**Próxima revisión:** al completar Fase 0 (estimada finales junio 2026).

---

## 📝 Nota de revisión — 19 de mayo de 2026

Este documento se reviso el 19/05/2026 tras la ejecución del Sprint 1 (auth backend BBDD).

**Cambios aplicados:**
1. URLs actualizadas: `folvy.com` → `folvy.app` (dominio principal definitivo).
2. §10 (decisiones P) actualizado: marcadas como ✅ resueltas: Hosting (Vercel), Email (Resend), Dominios (folvy.app + folvy.es). Marcada como ⚠️ D5: PITR Supabase aceptado riesgo Opción B.

**NO modificado** (mantiene histórico de planificación):
- Sprints 0.1-14 originales.
- Arquitectura técnica.
- Texto principal de cada sección.

**Para estado real implementado**, consultar:
- `CONTEXTO_CLAUDE.md` versión 19/05/2026 (post-Sprint 1).
- `folvy_addendum_sesion2_decisiones.md` (decisiones D1-D5 + 5 bugs SQL).

