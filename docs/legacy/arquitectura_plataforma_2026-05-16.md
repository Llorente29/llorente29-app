# Arquitectura de plataforma Foodint
**Fecha**: 16 de mayo de 2026
**Versión**: 1.0 (documento de diseño, no de implementación)
**Stack objetivo**: React + TypeScript + Vite + Supabase (existente), evolucionado.
**Pregunta que responde**: *¿Qué arquitectura modular permite construir progresivamente lo mejor de cada competidor sin tener que rediseñar todo cada vez que añado un módulo?*

**Cómo leer este documento**:
- **(D)** = decisión arquitectónica firme.
- **(R)** = recomendación con alternativa explícita.
- **(P)** = decisión pendiente que requiere tu input antes de implementar.

---

## 0. Resumen ejecutivo (1 minuto)

Foodint deja de ser "una app con módulos en un Sidebar" y se convierte en **una plataforma con un Shell central + un Bus de Módulos**, donde cada módulo es una unidad autónoma que se enchufa al Shell vía un contrato estándar.

Hay 4 piezas y solo 4:

1. **Shell** — lo común a toda la plataforma. Routing, auth, multi-cuenta, multi-marca, layout de aplicación, navegación top-level, permisos, audit, settings. **Se construye UNA vez.**
2. **Module Contract** — la interfaz que todo módulo cumple para encajar en el Shell. Es lo que permite que el módulo Cocina, el TPV, una integración con Glovo o un add-on de terceros sean intercambiables.
3. **Service Layer compartido** — utilidades transversales que todos los módulos pueden usar: notificaciones, jobs en background, files, audit, search, IA, mensajería.
4. **Módulos** — cada uno independiente, registrado al Shell, con su sidebar propio. Construidos por Foodint, integrados con terceros, o ambas cosas.

La regla de oro: **el Shell no conoce los módulos por nombre. Los módulos no se conocen entre sí.** Toda interacción cruzada va por contratos públicos (eventos, hooks, APIs internas), nunca por imports directos.

Esto resuelve la deuda crítica registrada en CONTEXTO_CLAUDE_v19 y deja la plataforma preparada para 10-20 módulos sin colapsar.

---

## 1. Principios de arquitectura (las 8 reglas no negociables)

Si una decisión futura viola una de estas, hay deuda. Es así de simple.

### Principio 1 — Una sola plataforma, muchos módulos. Nunca al revés. (D)

No se construyen "apps separadas" que comparten login. Se construye **una sola aplicación** con un Shell que monta dinámicamente módulos. El usuario percibe un producto integrado, no una suite de productos.

**Consecuencia técnica**: una sola build, una sola URL, un solo deploy. Múltiples bundles vía code-splitting (cada módulo es un chunk perezoso), no múltiples repos.

### Principio 2 — El Shell no conoce los módulos por nombre. (D)

`App.tsx` (o lo que reemplace a `App.tsx` tras el refactor) **nunca** tiene `import { CocinaModule } from './modules/cocina'`. Tiene un **registry** que carga lo que esté registrado.

**Consecuencia**: añadir módulo nuevo = 1 fichero de registro + N ficheros del módulo. Quitar módulo = borrar 1 línea del registry. Cero modificaciones en el Shell.

### Principio 3 — Los módulos no se conocen entre sí. (D)

Cocina no importa nada de Personal. Personal no importa nada de APPCC. Si necesitan colaborar, lo hacen a través de **contratos públicos** publicados por el Shell:

- **Eventos** (bus de eventos del Shell): "se ha vendido un plato" → cualquier módulo suscrito lo recibe.
- **Hooks compartidos** (`useActiveAccount`, `useActiveLocation`, `useActiveBrandFilter`, `usePermissions`).
- **APIs internas del Shell** (`shell.notify()`, `shell.openModal()`, `shell.navigate()`).

**Consecuencia**: puedes borrar un módulo y la app sigue funcionando. Puedes sustituir el módulo TPV propio por una integración con Revo y nada cambia para los demás.

### Principio 4 — Construir o integrar es decisión por módulo, no por plataforma. (D)

El cliente decide si usa el TPV de Foodint o trae el suyo. El cliente decide si usa el módulo de fichajes de Foodint o ya tiene Sesame. El cliente decide si la contabilidad la lleva en el módulo PyG de Foodint o exporta a Holded.

**Cómo lo permite la arquitectura**:

- Para cada **dominio** (TPV, Personal, Contabilidad, etc.) hay un **adapter público**: una interfaz TypeScript con métodos del estilo `registerSale(...)`, `createEmployee(...)`, `pushInvoice(...)`.
- Foodint **siempre** publica un adapter propio (el módulo nativo).
- Foodint puede publicar adapters adicionales para terceros (Revo, Sesame, Holded, Glovo).
- El cliente activa **un** adapter por dominio en su cuenta. Si activa el de Revo, el módulo TPV propio de Foodint queda desactivado para esa cuenta.

**Consecuencia**: el modelo de negocio "todo propio + abierto a integrar" se sostiene técnicamente sin doble mantenimiento. Cada nuevo adapter es un fichero, no un fork.

### Principio 5 — Multi-tenant desde el dato, no como capa. (D)

Cada tabla en Supabase tiene `account_id` (la sociedad/grupo cliente). Todas las queries lo filtran. Row Level Security (RLS) lo aplica. **Esto ya lo tienes parcialmente — la deuda registrada `CURRENT_ACCOUNT_ID` hardcoded es justamente la grieta a cerrar.**

**Consecuencia**: cliente 2, 3, 10 entran sin migración. La separación de datos es del motor, no del código de aplicación.

### Principio 6 — Multi-marca y multi-local son ortogonales al módulo, no propiedad del módulo. (D)

Una marca virtual existe a nivel de cuenta, no a nivel del módulo Cocina. Un local existe a nivel de cuenta, no a nivel del módulo Personal. Cualquier módulo puede consultarlos vía hooks del Shell (`useActiveLocation`, `useBrands`).

**Consecuencia**: cuando construyas el módulo TPV, no tendrás que reinventar "marcas" o "locales". Ya están. Cuando integres Glovo, te conectas a marcas/locales existentes. **Llorente29 y su modelo ghost-kitchen están baked-in en la plataforma desde día uno.**

### Principio 7 — Cada módulo es activable/desactivable por cuenta. (D)

El plan comercial dicta qué módulos están activos para qué cuenta. La activación es **dato** (`account_modules` en BBDD), no código.

**Consecuencia técnica**: el Shell, al iniciar para un usuario, lee qué módulos tiene activos su cuenta, los carga, y solo muestra esos en la navegación. **Esto es el motor del modelo de cobro modular.**

### Principio 8 — Adapters de integración con terceros son módulos. (D)

"Conectar con Glovo" no es un parche en el módulo Cocina. Es un módulo de tipo `integration` que se enchufa al bus y publica/consume eventos. La integración con Holded es otro. La integración con Sesame, otro.

**Consecuencia**: la lista de integraciones crece linealmente con el equipo (o con Claude), no exponencialmente. Y cada integración se puede vender por separado.

---

## 2. El Shell de la plataforma

El Shell es lo que se construye UNA vez y nunca se duplica. Es el contenedor de toda la aplicación.

### 2.1. Layout visible — la metáfora "Microsoft 365"

Lo que el usuario ve siempre, en cualquier módulo:

```
┌─────────────────────────────────────────────────────────────────┐
│  [Foodint]   PERSONAL  COCINA  APPCC  VENTAS  ANALÍTICA  ...   │  ← Top bar (módulos)
├──────────┬──────────────────────────────────────────────────────┤
│          │  [Locale ▼] [Marca ▼]            [🔔] [⚙] [Usuario]│  ← Header
│ Sidebar  ├──────────────────────────────────────────────────────┤
│ del      │                                                       │
│ módulo   │                                                       │
│ activo   │            Contenido del módulo activo                │
│          │                                                       │
│          │                                                       │
└──────────┴──────────────────────────────────────────────────────┘
```

**Tres niveles de navegación, no más, no menos**:

1. **Top bar de módulos** — controlada por el Shell. Lista los módulos activos para la cuenta del usuario.
2. **Sidebar de módulo** — controlada por el módulo activo. Cada módulo lo declara.
3. **Header transversal** — controlado por el Shell. Selectores de contexto (local, marca), notificaciones, settings, usuario.

Este es exactamente el patrón "Apps de Microsoft 365" que registraste en el contexto como dirección a tomar.

### 2.2. Routing — React Router v6 con estructura de "outlet"

Estructura de rutas:

```
/                                  → redirección a /[módulo-default-del-usuario]
/login                             → fuera del Shell
/[account-slug]/                   → opcional, multi-cuenta visible en URL
/[account-slug]/personal/...       → módulo Personal
/[account-slug]/cocina/...         → módulo Cocina
/[account-slug]/cocina/marcas      → vista listado de marcas
/[account-slug]/cocina/marcas/llorente29  → vista detalle
/[account-slug]/settings           → settings de cuenta (Shell, no módulo)
```

**Decisiones de routing**:

- **(D)** React Router v6 con rutas anidadas y `<Outlet />`. La librería ya elegida en el catálogo es React.
- **(R)** `/[account-slug]/` en URL desde día uno, **default oculto** (cuando hay una sola cuenta se redirige sin mostrarlo, pero la ruta existe). Esto evita migraciones futuras cuando un usuario pertenezca a varias cuentas.
- **(D)** Deep-linking soportado de serie. Cualquier vista interna a cualquier módulo es URL.
- **(D)** El estado de selección (`activeLocationId`, `activeBrandFilter`) **no va en URL**. Va en localStorage + AppContext, como ya tienes. La URL identifica QUÉ ves, no en qué contexto.

### 2.3. Auth y multi-cuenta

Tres conceptos separados que hoy a veces se mezclan:

- **User** — la persona (Supabase auth).
- **Account** — la sociedad/grupo restaurador cliente de Foodint.
- **Membership** — relación entre user y account, con rol (owner, admin, manager, employee, viewer).

**Decisiones**:

- **(D)** Un user puede pertenecer a N accounts. La UI del Shell tiene un selector de cuenta si N>1.
- **(D)** El rol vive en `membership`, no en `user`. Esto resuelve el problema de "soy admin en mi grupo pero solo viewer en este otro".
- **(D)** Los permisos finos (qué puede hacer cada rol) viven en código del Shell + del módulo. **Roles son pocos (4-5), permisos son muchos.**
- **(P)** ¿Granularidad de permisos por módulo desde día uno, o solo por rol global? **Mi recomendación: solo por rol global hasta cliente 5. Después, permisos por módulo.** Sobre-diseñar permisos al inicio es un sumidero clásico.

### 2.4. Estado global del Shell

Lo que el Shell expone a todos los módulos vía hooks. **No hay otro estado global compartido entre módulos.**

```typescript
// Lo que el Shell publica:
useAuth()              // user, signOut, isLoading
useAccount()           // accountId, accountName, plan, activeModules
useMembership()        // role, permissions, isAdmin, isOwner
useActiveLocation()    // locationId | 'all', setActiveLocation
useActiveBrandFilter() // brandIds[], setActiveBrandFilter
useLocations()         // todos los locales de la cuenta
useBrands()            // todas las marcas de la cuenta
useNotifications()     // ver §3.1
usePermission(perm)    // ¿puedo hacer X?
useShellNavigation()   // navigate, openModal, openDrawer
```

Si un módulo necesita estado adicional que no está aquí, **lo gestiona internamente. No lo eleva al Shell.**

### 2.5. Settings de cuenta — propiedad del Shell, no de un módulo

Hay un módulo "Configuración" (icono ⚙ en el header) que es **parte del Shell**, no un módulo más en el top-bar. Contiene:

- Datos de la cuenta (razón social, NIF, dirección fiscal, logo).
- Locales (CRUD).
- Marcas (CRUD) — ya construido parcialmente.
- Centros de coste (CRUD) — ya construido.
- Canales de venta (CRUD) — ya construido.
- Cuentas de análisis (CRUD) — ya construido.
- Usuarios y permisos (CRUD).
- Plan y facturación de Foodint.
- **Activación/desactivación de módulos y adapters.**
- API keys y webhooks (para integraciones de terceros).
- Audit log.

**Razón**: estos datos son consumidos por TODOS los módulos. Si vivieran en un módulo, los demás dependerían de él, y eso viola el Principio 3.

**(I)** Esto explica por qué tu actual sección `STOCK > Marcas` debe migrar a `CONFIGURACIÓN > Marcas`. **Las marcas no son del módulo Cocina. Son de la cuenta.** El módulo Cocina las consume, no las posee.

### 2.6. Tabla de módulos activos

Nueva tabla `account_modules`:

```
account_id, module_id, adapter_id, status, activated_at, settings (jsonb)
```

Ejemplo:

```
acc_llorente29, 'personal',  'foodint-native',  active, 2026-01-15, {...}
acc_llorente29, 'appcc',     'foodint-native',  active, 2026-01-15, {...}
acc_llorente29, 'cocina',    'foodint-native',  active, 2026-05-20, {...}
acc_llorente29, 'tpv',       'tspoon-adapter',  active, 2025-09-01, {...}
acc_llorente29, 'delivery',  'glovo-adapter',   active, 2026-02-10, {...}
```

El Shell consulta esta tabla al inicio de sesión y construye la navegación.

---

## 3. El Module Contract

Esto es **lo más importante del documento**. Lee con calma.

Un módulo es un objeto que exporta una estructura estándar. El Shell lo registra y a partir de ahí lo trata como ciudadano de primera.

### 3.1. La interfaz `ModuleDefinition`

```typescript
interface ModuleDefinition {
  // Identidad
  id: string;                          // 'cocina', 'personal', 'appcc'
  name: string;                        // 'Cocina', 'Personal', 'APPCC'
  icon: ComponentType;                 // icono Lucide
  topBarOrder: number;                 // posición en top-bar (1, 2, 3...)

  // Permisos
  requiredRole?: Role;                 // rol mínimo para ver el módulo
  requiredPlan?: PlanId;               // plan mínimo (para gating comercial)

  // Routing
  basePath: string;                    // 'cocina'
  routes: RouteObject[];               // rutas React Router v6 anidadas

  // Navegación interna
  sidebar: SidebarDefinition;          // estructura del sidebar propio del módulo

  // Adapters (opcional)
  adapters?: AdapterRegistry;          // si este módulo soporta integraciones, lista de adapters disponibles

  // Eventos publicados/consumidos
  publishes?: EventDescriptor[];       // eventos que este módulo emite al bus
  subscribes?: EventDescriptor[];      // eventos que este módulo escucha del bus

  // Settings propios del módulo (opcional)
  settingsPanel?: ComponentType;       // panel de config en Configuración > Módulos > [Este]

  // Lifecycle (opcional)
  onActivate?: (ctx: ShellContext) => Promise<void>;   // se ejecuta al activar el módulo en una cuenta
  onDeactivate?: (ctx: ShellContext) => Promise<void>; // se ejecuta al desactivar
}
```

### 3.2. Ejemplo concreto — un módulo nuevo entra así

Cuando quieras añadir el módulo Cocina al sistema, escribirás:

```typescript
// src/modules/cocina/index.ts
import { ChefHat } from 'lucide-react';
import { cocinaRoutes } from './routes';
import { cocinaSidebar } from './sidebar';
import { cocinaAdapters } from './adapters';

export const cocinaModule: ModuleDefinition = {
  id: 'cocina',
  name: 'Cocina',
  icon: ChefHat,
  topBarOrder: 2,
  requiredRole: 'manager',
  requiredPlan: 'cocina-basic',
  basePath: 'cocina',
  routes: cocinaRoutes,
  sidebar: cocinaSidebar,
  adapters: cocinaAdapters,
  publishes: [
    { event: 'cocina.recipe.updated', schema: RecipeUpdatedSchema },
    { event: 'cocina.stock.low', schema: StockLowSchema },
  ],
  subscribes: [
    { event: 'tpv.sale.completed', handler: handleSaleForStockDeduction },
  ],
};
```

Y en el registry central:

```typescript
// src/shell/moduleRegistry.ts
import { personalModule } from '@/modules/personal';
import { appccModule } from '@/modules/appcc';
import { cocinaModule } from '@/modules/cocina';
// import { tpvModule } from '@/modules/tpv';  // futuro
// import { glovoIntegration } from '@/modules/integrations/glovo';  // futuro

export const moduleRegistry: ModuleDefinition[] = [
  personalModule,
  appccModule,
  cocinaModule,
];
```

**Eso es todo.** Añadir un módulo = 1 import + 1 línea en el array. Quitar un módulo = borrar la línea. **Cero modificaciones del Shell.**

### 3.3. El bus de eventos

`@/shell/eventBus` — singleton tipado.

```typescript
shell.events.publish('tpv.sale.completed', { saleId, items, total, ... });
shell.events.subscribe('tpv.sale.completed', (payload) => { ... });
```

**Decisiones del bus**:

- **(D)** Eventos son síncronos en cliente (un módulo emite, los suscritos reaccionan en el mismo tick).
- **(D)** Para procesamiento pesado o asíncrono, el evento dispara un **job en background** (ver §4.3), no se procesa inline.
- **(D)** Todos los eventos están tipados y documentados. No hay "eventos string sueltos".
- **(D)** El bus también persiste eventos críticos en BBDD (`event_log`) para audit y replay.

### 3.4. El catálogo de adapters

Algunos módulos (TPV, Personal, Contabilidad, Delivery...) admiten ser cubiertos por el módulo propio de Foodint O por un adapter de terceros.

```typescript
interface Adapter<TConfig = unknown> {
  id: string;                          // 'foodint-native', 'tspoon', 'revo', 'sesame'
  name: string;                        // 'TSpoon', 'Revo Cegid'
  vendor: 'foodint' | 'third-party';
  domain: ModuleDomain;                // 'tpv', 'personal', 'accounting'

  configure(config: TConfig): void;
  test(): Promise<{ ok: boolean; message: string }>;

  // Métodos del dominio (varía por dominio)
  // Para TPV:
  registerSale?(sale: Sale): Promise<void>;
  fetchSales?(range: DateRange): Promise<Sale[]>;

  // Para Personal:
  syncEmployees?(): Promise<Employee[]>;
  syncTimeEntries?(range: DateRange): Promise<TimeEntry[]>;

  // ...etc
}
```

**Consecuencia**: si un cliente tiene Revo como TPV y quiere conectarlo, activa el adapter `revo` para el dominio `tpv`. El Shell desactiva el módulo TPV propio para esa cuenta y enruta todas las llamadas TPV al adapter Revo. Los demás módulos no se enteran del cambio.

---

## 4. Service Layer compartido

Servicios transversales que **cualquier** módulo puede usar. Viven en el Shell. No son módulos.

### 4.1. Notificaciones unificadas

Un solo sistema de notificaciones para toda la plataforma:

- In-app (icono 🔔 en el header).
- Email.
- Push móvil (futuro).
- WhatsApp / SMS (futuro, vía Twilio o similar).

API:

```typescript
shell.notify({
  to: { user: 'u_123' } | { role: 'admin' } | { account: 'acc_456' },
  channels: ['in-app', 'email'],
  template: 'cocina.stock.low',
  data: { product: 'Tomate', current: 2, min: 10 },
  priority: 'normal',
});
```

**(R)** Implementación: tabla `notifications` + cola de envíos. El "in-app" se sirve por Supabase Realtime.

### 4.2. Audit log

Cualquier acción sensible se registra en `audit_log`:

```
id, account_id, user_id, module_id, action, entity_type, entity_id, before, after, ip, timestamp
```

Visible para owners y admins. Filtrable por módulo, usuario, fecha, entidad. **Es feature vendible y obligatoria para clientes profesionales.**

### 4.3. Background jobs

Algunos módulos necesitan procesos pesados (sincronización con Glovo, recálculo de escandallos masivos, generación de informes mensuales). El Shell ofrece una cola:

```typescript
shell.jobs.enqueue('cocina.recalc-recipes', { triggeredBy: 'price-change', ... });
```

**(R)** Implementación recomendada: **Supabase Edge Functions** o **un worker dedicado en un VPS pequeño**. Decisión técnica concreta en sesión futura, no aquí.

### 4.4. Storage de ficheros

Subir/descargar imágenes (logos, fotos de plato), PDFs (albaranes escaneados, contratos), documentos (manuales APPCC). Bucket centralizado en Supabase Storage. API:

```typescript
shell.storage.upload(bucket, file, { acl, metadata });
shell.storage.getUrl(path, { expiresIn });
```

### 4.5. Search global (fase futura)

Cuando el sistema crezca: barra de búsqueda en el header que busca transversalmente en todos los módulos activos. Cada módulo registra qué entidades indexa. **Para fase 1 esto no existe. Lo dejo como "preparado para añadir sin refactor".**

### 4.6. IA layer (fase futura)

Una capa que centralice todas las llamadas a modelos (OpenAI, Anthropic, lo que sea). Cualquier módulo que necesite IA (OCR de albaranes, sugerencia de pedido, generación de descripciones de plato) la consume a través de esta capa. **Razón**: no esparcir API keys, cambiar de proveedor sin tocar módulos, controlar coste.

### 4.7. Internacionalización (i18n)

`react-i18next` desde día uno, **aunque solo haya español al inicio**. Cada módulo declara sus traducciones. El Shell gestiona el idioma activo del usuario.

**Razón**: añadir inglés/portugués/catalán después es trivial si i18n está desde el principio. Es brutal si no.

### 4.8. Telemetría y errores

- **Sentry** (o equivalente) para errores.
- **PostHog** (o equivalente) para uso.
- **(D)** Decisión de proveedores concretos: pendiente. Lo importante es que el Shell tiene un único punto donde se inicializa, y los módulos no se enteran.

---

## 5. Catálogo completo de módulos previstos

Te lo doy ordenado por **dominio funcional**, no por orden de construcción. El orden de construcción está en §6.

| ID | Nombre | Dominio | Estrategia | Adapters previstos | Estado actual |
|---|---|---|---|---|---|
| `personal` | Personal | RRHH/turnos/fichaje | **Construir + integrar** | foodint-native, sesame-adapter, factorial-adapter, skello-adapter | Existe parcialmente |
| `appcc` | APPCC | Calidad/seguridad alimentaria | **Construir (no integrar)** | foodint-native | Existe parcialmente |
| `cocina` | Cocina (nombre pdte.) | Producto/escandallos/almacén | **Construir + integrar** | foodint-native, gstock-adapter, apicbase-adapter | A construir |
| `compras` | Compras | Pedidos/albaranes/proveedores | **Construir** (puede vivir dentro de Cocina inicialmente) | foodint-native | A construir |
| `tpv` | TPV | Punto de venta/comanderos/KDS | **Construir + integrar** | foodint-native, revo-adapter, tspoon-adapter, lightspeed-adapter, square-adapter | A construir (fase tardía) |
| `delivery` | Delivery | Integración con plataformas | **Solo integrar** | glovo-adapter, ubereats-adapter, last-adapter, deliveroo-adapter | A construir |
| `tienda-online` | Tienda online | E-commerce/marketplace propio | **Construir o integrar Shopify** | foodint-native, shopify-adapter, woocommerce-adapter | A construir (fase tardía) |
| `ofertas` | Ofertas y promociones | Programación de descuentos/combos | **Construir** | foodint-native | A construir |
| `fidelizacion` | Fidelización | Puntos/recompensas/CRM cliente | **Construir o integrar** | foodint-native, square-loyalty-adapter | A construir |
| `marketing` | Marketing | Campañas email/SMS/redes | **Solo integrar** | mailchimp-adapter, brevo-adapter, meta-business-adapter | A construir |
| `reservas` | Reservas | Mesa/horario/aforo | **Integrar** prioritario | covermanager-adapter, thefork-adapter, opentable-adapter | A construir |
| `analytics` | Analítica | BI/dashboards/informes | **Construir + integrar** | foodint-native, powerbi-adapter, looker-adapter | A construir |
| `pyg` | Cuenta de resultados | Finanzas operativas | **Construir** | foodint-native | A construir |
| `contabilidad` | Contabilidad | Asientos contables/IVA | **Solo integrar** | holded-adapter, sage-adapter, a3-adapter, contasol-adapter | A construir |
| `facturacion` | Facturación | Emisión Verifactu/TicketBAI | **Construir** (obligatorio España) | foodint-native | A construir |
| `reparto` | Reparto propio | Logística última milla propia | **Construir** (futuro) | foodint-native | A construir (fase tardía) |
| `redes-sociales` | Actividad redes | Publicación/monitorización | **Solo integrar** | hootsuite-adapter, buffer-adapter, meta-adapter | A construir |
| `reputacion` | Reputación | Gestión reseñas Google/TripAdvisor | **Construir + integrar** | foodint-native, mapal-reputation-adapter | A construir |
| `formacion` | Formación | LMS interno hostelería | **Construir o integrar Flow** | foodint-native, mapal-flow-adapter | A construir (futuro) |

### 5.1. Filosofía de elección "construir / integrar"

He marcado cada módulo con una de tres estrategias. La lógica detrás:

- **Construir (sin integrar)** — cuando es el **core diferencial** de Foodint o no hay competencia decente que integrar. Ejemplos: APPCC, Facturación Verifactu, PyG. Reemplazar esto por un tercero diluye la propuesta.

- **Construir + integrar** — cuando Foodint quiere ofrecer una versión propia COMPETENTE pero también dejar que el cliente traiga su herramienta de cabecera. Ejemplos: TPV (porque hay clientes con Revo, Lightspeed o Tspoon legacy), Personal (porque Sesame/Factorial son competidores serios), Cocina (porque Gstock es muy potente y algunos clientes lo querrán seguir usando).

- **Solo integrar** — cuando construir es suicidio (años de trabajo + competencia masiva) y la integración es la única jugada sensata. Ejemplos: Delivery (Glovo no se reemplaza), Contabilidad (Holded/Sage tienen 20 años de regulación incrustada), Marketing (Mailchimp es Mailchimp).

### 5.2. La regla "lo mejor de cada uno"

Para cada módulo donde Foodint construye su propia versión, aquí va el extracto de qué copiar de cada competidor analizado:

#### Módulo `cocina`
**De Gstock**: escandallo dinámico recalculado al recibir albarán; bloqueo de tarifas + alertas de variación de precios; predicción IA de pedidos (fase 2); OCR de albaranes (fase 2); ingeniería de menús con simulación de rentabilidad.
**De Apicbase**: modelo de "single source of truth" de F&B con API pública; menu engineering y planificación de producción multi-centro; carbon tracking (fase 3, atractivo ESG).
**De Marketman**: cookbook digital con sub-recetas profundas; AI invoice scan (fase 2).
**Diferencial Foodint**: producto compuesto profundo (artículo → intermedio → final con packaging + herramientas + MO + variaciones por marca/canal). Esto es lo que ninguno hace bien.

#### Módulo `tpv`
**De Square**: simplicidad + UX + freemium real (un plan "Foodint TPV Free" para captar pequeño operador).
**De Toast**: integración profunda con todo el ecosistema (cocina, online, loyalty, payroll) — la lección es "TPV no es módulo aislado, es nervio central".
**De Lightspeed**: 40% fewer clicks como obsesión por UX, soporte 24/7 telefónico desde el primer plan.
**De Revo (español)**: Verifactu/TicketBAI baked-in, fiscalidad española nativa.
**Diferencial Foodint**: nativamente multi-marca (un terminal sirve cobros de N marcas virtuales).

#### Módulo `personal`
**De Combo/Skello**: detección automática de incumplimientos de convenio al planificar turnos; app móvil del empleado cuidada; comunicación en la propia app.
**De Mapal Workforce**: planificación basada en ventas históricas (sugerencia inteligente de cuadrante).
**Diferencial Foodint**: integración nativa con APPCC (el empleado ficha y a la vez registra tareas APPCC pendientes de su turno).

#### Módulo `appcc`
**De Mapal Compliance**: checklists digitales por puesto; documentación en cloud preparada para auditorías.
**Diferencial Foodint**: integración con módulo Personal (asignación automática de tareas APPCC al turno fichado) y con Cocina (trazabilidad de lotes desde el artículo hasta el plato vendido).

#### Módulo `delivery`
**De ningún competidor — es el hueco más claro**: hub centralizado de menús por marca y canal, con publicación a Glovo/Uber/Last desde una sola configuración, escandallos con variación de precio por canal, sincronización de pedidos entrantes al módulo Cocina y al TPV. **Este es probablemente el módulo con mayor ROI comercial de toda la plataforma.**

#### Módulo `reputacion`
**De Mapal Reputation**: agregar reseñas Google/TripAdvisor/Glovo/Uber, responder desde la plataforma, sentiment analysis.
**Diferencial Foodint**: cruce con datos de venta del TPV (¿la mala reseña de hoy corresponde a un turno específico? ¿a un plato concreto?).

---

## 6. Roadmap de fases

Las fases tienen **condiciones de salida**: criterios objetivos para considerar la fase cerrada y pasar a la siguiente. **No se pasa de fase por intuición.**

### Fase 0 — Refactor del Shell (DEUDA CRÍTICA)

**Duración estimada**: 3-5 sesiones de trabajo (estimo, no garantizo).

**Qué se hace**:
1. Implementar React Router v6 con estructura de outlet anidada. `useState<Page>` muere.
2. Construir el `moduleRegistry` y migrar lo existente (Personal, APPCC, Marcas, etc.) a `ModuleDefinition`.
3. Implementar el layout top-bar de módulos + sidebar por módulo + header transversal.
4. Eliminar `CURRENT_ACCOUNT_ID` hardcoded. Multi-cuenta real lee de `membership`.
5. Mover `marcas`, `locales`, `centros de coste`, `canales de venta`, `cuentas de análisis` a Settings de cuenta (Shell), no a módulo Stock.
6. Bus de eventos básico (publish/subscribe síncrono).
7. Limpiar tipos huérfanos del union `Page`.
8. Verificar fix de `TOKEN_REFRESHED` en uso real.

**Condiciones de salida**:
- ☐ URL refleja navegación siempre. Recargar mantiene página.
- ☐ Hay al menos un módulo "secundario" cargado dinámicamente (code-split) para validar el contract.
- ☐ `CURRENT_ACCOUNT_ID` no existe en código.
- ☐ Multi-cuenta funcional (puedes crear un user con membership en 2 accounts y cambiar entre ellas).
- ☐ Tests 33/33 siguen verdes. Build verde. Bundle main < 1.5 MB.

**Importante**: durante esta fase NO se construye ningún módulo nuevo. Es exclusivamente Shell. **Tentación a evitar.**

---

### Fase 1 — Vender Personal + APPCC al cliente 2

**Duración estimada**: 1-2 sesiones tras Fase 0.

**Qué se hace**:
- Pulir módulos Personal y APPCC existentes para que estén "vendibles" sobre la nueva arquitectura.
- Onboarding documentado de un cliente nuevo.
- Settings de cuenta funcional (CRUD de locales, marcas, usuarios).

**Condiciones de salida**:
- ☐ Cliente 2 firmado y operando con Personal + APPCC.
- ☐ Tiempo de onboarding documentado.

**Por qué esta fase aquí**: porque el contexto registra que cliente 2 está esperando y puede arrancar con esto. **Cualquier mes que tarde es un mes perdido de ingreso.**

---

### Fase 2 — Cocina v1 + Delivery v1

**Duración estimada**: 4-8 sesiones.

**Qué se hace**:
- Módulo Cocina v1: marcas (ya hecho), artículos, almacenes, escandallo plano (artículo → final, sin intermedios todavía), recepción de albaranes manual, inventario, mermas básicas.
- Módulo Delivery v1: adapter Glovo. Push de menús desde Cocina a Glovo. Pull de pedidos desde Glovo al Shell (que los notifica a Cocina + TPV cuando exista). **Glovo primero porque es Llorente29.**
- Sistema de notificaciones in-app funcional.

**Condiciones de salida**:
- ☐ Llorente29 opera con Cocina v1 + Delivery Glovo.
- ☐ Un plato dado de alta en Foodint Cocina aparece en Glovo en menos de 10 minutos.
- ☐ Un pedido recibido en Glovo aparece en Foodint en menos de 30 segundos.

---

### Fase 3 — Cocina v2 (profundidad) + Delivery extendido + Analytics v1

**Duración estimada**: 6-12 sesiones.

**Qué se hace**:
- Cocina v2: producto intermedio + escandallo de profundidad N + packaging + variaciones por marca/canal + bloqueo de tarifas + alertas de variación de precios.
- Delivery: adapters Uber Eats y Last.
- Módulo Analytics v1: dashboard básico con ventas, costes, márgenes por marca/local/periodo.
- Audit log.
- Background jobs (cola).

**Condiciones de salida**:
- ☐ Llorente29 ha apagado Tspoon.
- ☐ 5+ clientes activos.

---

### Fase 4 — TPV propio (CONDICIONAL) y otros módulos

**Esta fase NO empieza automáticamente.** Tiene **condiciones de entrada**:

- Foodint tiene **al menos 8-10 clientes activos** facturando.
- Hay **demanda explícita** de TPV propio (no asumida).
- El cliente está dispuesto a **pagar el coste de migrar** desde su TPV actual.
- Equipo/capacidad para mantener TPV (que es nervio central — caer es perder ventas en vivo).

Si **alguna** de estas condiciones no se cumple, **la decisión correcta es seguir integrando TPVs de terceros**, no construir el propio. Lo registro como tal.

Otros módulos candidatos a esta fase, en este orden recomendado:

1. **Facturación Verifactu** (obligatorio a partir de 2027 en España — esto sube a Fase 3 si llegamos a 2027 sin tenerlo).
2. **Reservas** (integración con CoverManager / TheFork).
3. **Reputación** (cruce reseñas + ventas, alto valor percibido, bajo esfuerzo).
4. **Contabilidad** (adapter Holded).
5. **Ofertas y promociones**.
6. **Marketing** (adapter Mailchimp/Brevo).

### Fase 5+ — Resto del catálogo

Tienda online, fidelización, formación, reparto propio, redes sociales. Cada uno se evalúa con la lógica de Fase 4: condiciones de entrada, no calendario.

---

## 7. Decisiones pendientes que requieren tu input

Estas no las decido yo en este documento. Te las dejo planteadas con mi recomendación:

### (P) Nombre del módulo "Stock"
Candidatos del contexto: Cocina, Producto, Operations, Catálogo.
**Mi recomendación**: **Cocina**. Razones: es el término del oficio, traduce internacionalmente bien (Kitchen), no choca con "Stock" como concepto técnico interno. Pero si te suena pequeño, "Operaciones" es la segunda mejor.

### (P) ¿`/[account-slug]/` visible en URL desde día uno o tras cliente 2?
**Mi recomendación**: **visible desde día uno, oculto cuando hay una sola cuenta** (redirect). Te ahorra una migración futura. Coste: una sesión.

### (P) ¿Permisos granulares por módulo o solo rol global?
**Mi recomendación**: **solo rol global hasta cliente 5**. Después, granularidad. Sobre-diseñar permisos al inicio es sumidero clásico.

### (P) ¿Verifactu / TicketBAI propio o integrado vía proveedor (Verifactu, Hacienda directo, terceros tipo BizkaiBai)?
**Mi recomendación**: **integrado vía proveedor certificado**. Construir Verifactu propio es masivamente regulado y arriesgado. Aunque digamos "todo propio", Verifactu es la excepción.

### (P) ¿Auth solo Supabase o también SSO empresa?
**Mi recomendación**: **Supabase auth únicamente hasta cliente 10**. SSO (Google Workspace, Azure AD) cuando lo pida un cliente enterprise.

### (P) ¿Hosting actual (lo que sea que tengas) seguirá o vamos a Vercel/Netlify para frontend + Supabase managed?
**Decisión técnica**: pendiente, no la fuerzo aquí.

---

## 8. Lo que este documento NO resuelve

Por honestidad:

1. **El modelo de datos detallado de cada módulo.** Solo está el del Shell (account, membership, account_modules, audit_log, event_log). Cada módulo se modela cuando se construye.

2. **La estrategia comercial y de precios.** Cuáles serán los planes paquete, qué incluye cada uno, cuánto cuesta cada módulo. **Documento aparte, próxima sesión si quieres.**

3. **El stack final de adapters de pago/cobro.** Stripe, Redsys, Lemon Squeezy, etc. Decisión técnico-comercial pendiente.

4. **El equipo y la operación.** Quién construye qué, con qué cadencia, soporte de clientes, formación. Esto es CEO/COO, no arquitectura.

5. **El detalle de tooling de testing/CI/CD/observabilidad.** Hay un sistema de tests verde hoy (33/33). Cuando crezca habrá que reforzar. Decisión técnica posterior.

---

## 9. Próxima sesión técnica — qué hacer concretamente

(Esto es lo que evita que el documento muera en el cajón.)

**Tarea 1** — Crear el esqueleto del Shell:
- `src/shell/` (nuevo): `App.tsx` rediseñado, `Router.tsx`, `Layout.tsx` (top-bar + sidebar + header), `ModuleRegistry.ts`, `EventBus.ts`.
- React Router v6 instalado y configurado con outlet anidado.

**Tarea 2** — Definir la interfaz `ModuleDefinition` y migrar 1 módulo existente (sugerencia: empezar por el módulo más simple, p. ej. APPCC si está más cerrado, para validar el contrato).

**Tarea 3** — Crear las tablas `accounts`, `memberships`, `account_modules` en Supabase y migrar `CURRENT_ACCOUNT_ID` hardcoded a lectura desde `membership` activa.

**Tarea 4** — Mover el CRUD de Marcas/Locales/Centros de Coste/etc. del actual "módulo Stock" a Settings de cuenta (Shell).

**Tarea 5** — Verificar que tests siguen 33/33 verdes y bundle no se ha disparado.

Estas 5 tareas son **una fase 0 mínima**. Si las cierras, tienes el Shell y puedes empezar a construir módulos sin miedo a romper nada.

---

## 10. Cierre

Esta arquitectura te permite:

- Construir TPV propio cuando estés listo (Fase 4+), sin que nada de lo construido antes haya que rehacerlo.
- Integrar el TPV existente de un cliente desde el día uno con un adapter.
- Vender al cliente 2 con Personal + APPCC sin esperar a Cocina.
- Llegar al cliente 30 sin reescribir nada del Shell.
- Permitir que el cliente decida módulo a módulo si usa Foodint propio o trae el suyo.

La inversión está concentrada en el Shell (Fase 0). Si haces esa fase bien, el resto es construcción lineal de módulos, no rediseño. Si la haces mal o la saltas, todo lo que construyas encima será deuda.

**Lo importante de este documento es la Fase 0.** El resto es consecuencia.
