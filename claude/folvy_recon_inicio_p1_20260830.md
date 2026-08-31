# RECON — Inicio P1, la cáscara del centro de mando (30/08/2026)

**No se ha construido la cáscara.** El encargo pide RECON antes de construir «si algo
del catálogo choca con lo existente». Choca en tres sitios, y dos de ellos cambian
decisiones de diseño, no sólo de implementación.

---

## 0. La ventana de hoy ya se cerró

El encargo fija «terminado antes de las 12:15». Se recibió a las **17:41**, con la
cocina en servicio. Se puede construir, commitear y empujar; **no se despliega hoy**.
La siguiente ventana es tras las 23:45 o mañana antes de las 12:15.

---

## 1. Ya existe un Inicio, y se construyó pensando en este encargo

`src/shell/home/` — 422 líneas:

| fichero | qué es |
|---|---|
| `HomeGeneral.tsx` (160) | la pantalla de Inicio actual |
| `homeMetricsService.ts` (136) | ventas de hoy, % vs ayer, trabajando ahora, ticket/pedidos 7d |
| `widgets/MetricCard.tsx` (67) | la tarjeta de KPI |
| `widgets/ModuleSummaryCard.tsx` (59) | resumen por módulo |

Su propia cabecera lo dice: *«Los widgets siguen siendo autocontenidos y reciben todo
por props: **preparado para configurabilidad por usuario (drag&drop + persistencia +
reset) en el frente siguiente, sin reescribir los widgets**»*.

**Este encargo ES ese frente siguiente.** No hay que rehacer los widgets: hay que
cablearlos al catálogo y al layout. Reescribirlos sería tirar el trabajo que se hizo
justamente para no tener que hacerlo dos veces.

También hereda una regla ya escrita ahí y que coincide con la 7: *«Lo que aún NO tiene
fuente fiable se muestra como "—" — NO se inventa»*.

---

## 2. 🔴 Decisión 1 · `KpiCard` ya existe dos veces, con dos nombres

El encargo dice «todo KPI nace como componente embebible (`KpiCard`)». Hoy hay **dos**
implementaciones de esa idea y ninguna se llama así de forma canónica:

- `src/shell/home/widgets/MetricCard.tsx` — la del Inicio, por props, embebible.
- `src/modules/kitchen/pages/AvailabilityReportsPage.tsx:97` — un `KpiCard` **local y no
  exportado**, con `prevValue`, `betterWhen` y `format`: justo el contrato de espejo y
  delta que el encargo pide en la garantía (b).

Crear un tercero sería repetir el pecado de la regla de Glovo del 27/08: la misma regla
escrita a mano en tres sitios y arreglada sólo en uno.

**Propuesta:** el canónico es `MetricCard` (ya es del shell y ya es embebible); se le
sube el contrato del `KpiCard` de kitchen (`prevValue` + `betterWhen` + `format`, que es
la garantía b), se exporta como `KpiCard` y `AvailabilityReportsPage` pasa a consumirlo.
Un solo hogar, cero copias nuevas. **Requiere tu OK porque toca una pantalla de módulo**,
y el encargo dice explícitamente no rediseñar dashboards de módulo — esto no lo rediseña,
le quita una copia privada.

---

## 3. 🔴 Decisión 2 · el catálogo en BBDD sería una segunda verdad

El encargo pide `home_card_catalog` con `rpc/fuente` y `drill_route`. Pero una tarjeta
no es una fila: es **un componente más una consulta**. La «gráfica 14 días» no se pinta
desde un nombre de RPC.

Y `moduleRegistry.ts` ya es exactamente el sitio donde «los módulos aportan»: un array de
`ModuleDefinition`, nueve módulos, con el principio escrito en su cabecera — *«añadir un
módulo = añadir una línea aquí»*.

Si el catálogo vive en BBDD, una fila puede apuntar a un `rpc` que ya no existe, o un
componente puede quedarse sin fila. Es la clase de deriva que ha costado toda la semana
(`_set_product_availability_core`, las tres funciones del 28/08, el vigía sin desplegar).

**Propuesta — híbrido, y creo que es lo que el encargo quiere de verdad:**

- La **definición** de la tarjeta (componente, consulta, `drill_route`) vive en el módulo,
  en `ModuleDefinition.homeCards`. Es código, y no puede desincronizarse de sí misma.
- `home_card_catalog` **sí existe**, pero como **espejo + interruptor por cuenta**: se
  siembra desde el registro al arrancar, y sus columnas útiles son `active` y el gating.
  Una fila huérfana (sin componente) se marca, no se pinta — regla 7.
- Verificación 5 se cumple igual: añadir una `homeCard` a un módulo la hace aparecer en el
  cajón sin tocar el Inicio.

---

## 4. 🟠 Decisión 3 · «Dueño / Encargado» no existen en el dato

`user_profiles.role` sólo tiene dos valores vivos en la cuenta: **`admin` (3)** y
**`worker` (9)**. No hay `owner` ni `manager`.

El encargo dice «Roles Dueño/Encargado como plantillas de defecto». O `home_role_default`
se llavea por `admin`/`worker` (y entonces «Encargado» hoy es `worker`, que también es
quien no debería ver ventas), o hace falta un rol nuevo antes. **No lo decido yo.**

Nota aparte: `staff_role` (por cuenta, con `kind`) es otra cosa — es el rol de cuadrante,
no el de acceso. No confundirlos.

---

## 5. ✅ Lo que NO choca, y el precedente bueno de RLS

Hay dos tablas de preferencia por usuario, con **dos patrones opuestos**:

- `user_item_unit_pref` → `auth.uid() = user_id`. **Directo, sin joins.** Es el que pide
  el encargo («políticas sin joins») y el que se copia.
- `user_saved_view` → `EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = user_id AND
  up.user_id = auth.uid())`. Con join, y además ahí `user_id` es `user_profiles.id`, no
  `auth.uid()`. Es el anti-patrón que el encargo nombra. No se copia.

Las seis tarjetas tienen fuente viva y sin sorpresas: ventas (`sale`), gráfica 14 días
(`sale`), **en cocina ahora** (`employee_clock_status`, aplicada anoche — la lógica del
último fichaje no anulado, que es justo lo que el encargo exige), 86 por local
(`product_availability`, ya por local), cuadrantes (`schedules` + `vacations`).

---

## 6. Lo que hace falta de ti para que arranque

1. `KpiCard` canónico: ¿unifico `MetricCard` + el `KpiCard` de kitchen, tocando esa
   pantalla para que consuma el común?
2. Catálogo: ¿híbrido (definición en el registro, `home_card_catalog` como espejo y
   gating) o BBDD pura como está escrito?
3. Roles del defecto: ¿`admin`/`worker` tal cual, o rol nuevo antes?

Con esas tres, el orden de sub-lotes del encargo se mantiene: (datos+RLS) →
(cáscara+cajón) → (6 tarjetas) → (garantías d/e).
