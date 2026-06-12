# Encargo para Claude Code — Scope de local en toda la app + Pantalla de casado por marca×local

> **Contexto para Code**: proyecto Folvy (`C:\dev\llorente29-app`, React 19/Vite/TS/Supabase, cuenta de pruebas Folvy Interno `00000000-0000-0000-0000-000000000001`). Stack y reglas en `CONTEXTO_CLAUDE.md`. Este encargo tiene DOS trabajos independientes (A y B). Hazlos en orden. Tras cada fichero tocado: build verde antes de seguir. NO toques `App.tsx` sin permiso explícito de Julio. Trabaja en rama `main`, commits pequeños y descriptivos.

---

## TRABAJO A — Conectar TODA la app al selector global de local

### Qué existe ya (no lo reconstruyas)
- Selector global de local en el header: `src/modules/multitenancy/components/LocationSelector.tsx` (YA puesto en `ShellTopBar.tsx`, funciona, persiste en `AppContext`).
- Hook que expone el local activo: `src/modules/multitenancy/hooks/useLocationScope.ts`. API:
  - `activeLocationId` (`'all'` | UUID)
  - `isConsolidated` (true si `'all'`)
  - `resolvedLocationId` (UUID o `null` si consolidado)
  - `requireLocation()` → UUID, lanza `ConsolidatedModeError` si consolidado (para páginas de ESCRITURA)
- Filtro de marca global: `activeBrandFilter` en `AppContext` + `BrandFilterSelector.tsx`.

### El problema
El selector global YA cambia el local activo, pero **las páginas no lo escuchan**. Verificado en vivo: cambias de local arriba y `PedidosPage`, `RecepcionesPage`, `PersonalPage`, etc. siguen mostrando todos los datos sin filtrar. El selector es, hoy, decorativo en la práctica.

### Qué hacer
Recorrer las páginas de lista/dashboard que muestran datos ligados a un local y **conectarlas a `useLocationScope()`** para que filtren por el local activo. Patrón:

1. En la página, llamar `const { resolvedLocationId, isConsolidated } = useLocationScope()`.
2. Pasar `resolvedLocationId` al service/query que carga los datos.
3. En el service, si `locationId` no es null → filtrar la query por ese `location_id`. Si es null (consolidado) → no filtrar (muestra todos / agrega).
4. Volver a cargar cuando cambie `resolvedLocationId` (añadirlo a las deps del `useEffect`).

### Reglas de NEGOCIO sobre qué se filtra por local y qué NO (CRÍTICO — no aplicar el patrón a ciegas)

**SÍ se filtra por local** (son operativos por ubicación):
- `src/modules/supply/pages/PedidosPage` (o equivalente de Supply > Pedidos): el pedido pertenece a un local.
- Supply > Recepciones: la recepción es de un local.
- Supply > Inventario: el stock es por local.
- Supply > Facturas: si la factura va a un local.
- Folvy Team > Personal / Empleados: los empleados se ligan a local vía `locations`.
- Folvy Team > Ahora mismo / Control horario / Kiosko: fichajes por local.
- APPCC (audits, incidents, today, reports): por local.
- Inicio / Home (`HomeGeneral`): las métricas ya leen `sale`; filtrar por local si hay uno activo.

**NO se filtra por local** (son de marca/cuenta, no de ubicación física):
- Folvy Kitchen > Recetas / Escandallos / Ingredientes: un escandallo es de la MARCA, no del local (el mismo plato se cocina igual en todos los locales). NO tocar el filtro de local aquí.
- Folvy Kitchen > Menú / carta: es de marca.
- Proveedores: de cuenta (compartidos entre locales), salvo que haya `article_supplier` por local — verificar antes.

**En DUDA sobre una página concreta → NO la toques y déjala anotada en un comentario `// TODO scope-local: ¿filtra por local? decidir con Julio`.** Mejor dejar una página sin tocar que romper su semántica.

### RECON antes de tocar cada página
Para cada página candidata: ver qué service usa, qué tabla consulta, y si esa tabla tiene `location_id` (o se liga a local vía `locations`). Si NO tiene forma de filtrar por local → no es candidata (anotar). Verificar contra `information_schema`, no asumir.

### Páginas de ESCRITURA
Las que CREAN algo ligado a un local (nuevo pedido, ajuste de inventario, nuevo empleado) deben usar `requireLocation()` al guardar: si está en consolidado, mostrar mensaje claro ("Selecciona un local antes de guardar") capturando `ConsolidatedModeError`. Varias YA lo hacen (Supply lo tenía previsto) — verificar y completar las que falten.

### Entregable A
- Lista de páginas tocadas + qué filtro se añadió a cada una.
- Lista de páginas candidatas NO tocadas y por qué (dudas para Julio).
- Build verde. Commits por módulo (`feat(supply): scope local en pedidos/recepciones/inventario`, etc.).

---

## TRABAJO B — Pantalla de casado de ventas POR MARCA × LOCAL

### Qué existe ya
- `src/modules/kitchen/pages/SalesExceptionsPage.tsx` — pantalla actual "Casado de ventas — excepciones". Hoy agrupa por RAZÓN (`no_recipe`/`no_brand`/`otros`), muestra solo lo SIN casar, y NO filtra por marca ni local.
- `src/modules/kitchen/services/salesReliabilityService.ts` — funciones: `getReliability(accountId, from, to)`, `listBlindLines(accountId, from, to)`, `resolveUnmapped`, `classifyUnmappedProduct`, `createDishFromUnmapped`, `suggestMatch`, `listCostlessSoldProducts`. **Ninguna filtra por marca ni local.**
- Mapa estable de marca: tabla `external_brand_map` (poblada y validada — `(source, external_brand_id, external_location_id) → brand_id`). Cada `sale` YA tiene `brand_id` (marca de Folvy, estable) y `external_location_text` (UUID de local de Last).
- Traducción local: `lastapp_location_map` (UUID de Last → `location_id` de Folvy). 6 UUID de Last → 3 locales físicos (cada local físico tiene 2 UUID: cuenta propia + cuenta CTB cedidas).

### El diseño (VALIDADO con Julio en maquetas — respétalo)

**Ejes:**
- **Local**: del selector GLOBAL de arriba (`useLocationScope().resolvedLocationId`). NO un selector propio. Si consolidado → todos los locales.
- **Marca**: selector DENTRO de la pantalla (dropdown: "Todas" + cada marca, etiqueta propia/cedida). Es el eje principal de esta pantalla.

**Por la marca elegida (y local activo), su HISTORIA COMPLETA:**

1. **Tarjeta resumen de la marca**: % casado, nº pendiente, % con coste, nº ignorado.

2. **Pendiente de casar** (sección desplegable):
   - Agrupado POR PRODUCTO (no una fila por venta): nombre del producto + nº de ventas + importe.
   - Cada producto muestra su **marca y local** (atado, del ticket). El motivo (ej. "sin id de producto en el ticket").
   - Botón **"Casar a plato de [marca]"** → abre buscador que ofrece SOLO platos de esa marca (acotado: imposible casar en otra marca por error). Reutiliza la lógica de `resolveUnmapped`/`classifyUnmappedProduct`.
   - Botones secundarios: "Es un combo", "Ignorar" (con motivo, ver abajo).

3. **Casado** (sección desplegable, COMPLETA — no "muestra"):
   - Todos los productos casados de esa marca, agrupados por producto + nº ventas.
   - Distinguir visualmente "con coste" (verde) vs "casado pero sin coste / falta escandallo" (ámbar).

4. **Ignorado** (sección desplegable):
   - Qué productos se ignoraron, con **MOTIVO y FECHA visibles** (hoy se ignora sin motivo → AÑADIR: al ignorar, pedir un motivo corto obligatorio).
   - Botón "Deshacer" (vuelve a pendiente).

**Vista general**: el selector de marca en "Todas" mantiene la vista general actual (todas las marcas). NO se elimina.

### Benchmark (golear a tspoon)
tspoon muestra los no-vinculados POR cliente/marca (lista lateral de marcas, producto único con volumen agregado, "no vinculados" arriba + catálogo debajo). Folvy debe IGUALAR eso (por marca, producto agregado) y SUPERARLO en: (a) el "por qué" de lo ignorado visible (tspoon no lo muestra), (b) el casado acotado a marca+local (imposible error de atribución), (c) distinguir "casado sin coste" (food cost ciego) que tspoon no separa.

### Qué construir
1. **Service**: añadir a `salesReliabilityService.ts` (o nuevo `salesByBrandService.ts`):
   - `listBrandsWithSales(accountId, locationId?)` → marcas con ventas (id, nombre, ownership_type, contadores).
   - `getBrandReliability(accountId, brandId, locationId?, from?, to?)` → resumen de esa marca (casado/pendiente/ignorado/con-coste).
   - `listBrandLines(accountId, brandId, locationId?, status)` → líneas de esa marca por estado (`pending`/`matched`/`ignored`), AGRUPADAS POR PRODUCTO con nº ventas e importe.
   - Filtrar SIEMPRE por `sale.brand_id = brandId` y, si `locationId` no es null, por el `location_id` resuelto (vía `lastapp_location_map` o el `location_id` que tenga la sale).
2. **Modificar `resolveUnmapped`/`classify`** para que "Ignorar" acepte y guarde un MOTIVO (`unmapped_reason='ignored'` ya existe; añadir columna/campo de motivo si no hay — verificar `sale_line`; si no hay campo, usar uno de notas o añadir `ignore_reason text`).
3. **Pantalla**: reescribir/extender `SalesExceptionsPage.tsx` (o nueva `SalesByBrandPage.tsx`) con el diseño de arriba. Lee `useLocationScope()` para el local, selector de marca propio, 4 secciones desplegables.

### Entregable B
- Service con las funciones nuevas.
- Pantalla por marca×local funcionando, conectada al selector global de local.
- "Ignorar" pide motivo; "Ignorado" muestra motivo+fecha+deshacer.
- Build verde. Commit `feat(kitchen): casado de ventas por marca×local con historia completa`.

---

## Verificaciones finales (ambos trabajos)
- `npm run build` verde.
- Regenerar `src/types/database.ts` si se tocó esquema (`npx supabase gen types ... --yes` + reconvertir a UTF-8 sin BOM).
- Commits pequeños y descriptivos, push a `main`.
- Dejar un resumen de lo hecho + dudas pendientes para Julio.

## Lo que NO debe hacer Code solo
- Decidir qué páginas filtran por local en los casos DUDOSOS (dejar anotado para Julio).
- Tocar `App.tsx`.
- Cambiar la semántica de Kitchen/escandallos (son de marca, no de local).
- Inventar marcas o casar líneas automáticamente (anti-invención: si no hay certeza, queda pendiente).
