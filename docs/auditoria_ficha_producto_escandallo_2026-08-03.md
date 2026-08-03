# Auditoría — Ficha de producto + Editor de escandallo (para fusión en una ficha con pestañas)

> Encargo: inventario COMPLETO y exhaustivo de las dos pantallas que se van a fundir en una sola
> ficha con pestañas, antes de tocar nada. Cada pestaña, sección, campo, botón, acción y cálculo,
> con su fuente de datos exacta (servicio/RPC/tabla o "cálculo local" con la fórmula). Sin resumir,
> sin "etc.".
>
> Hecho por dos agentes de lectura exhaustiva en paralelo (uno por fichero, leyendo las 2004 +
> 2687 líneas completas), compilado y revisado aquí. Cero cambios de código — solo lectura.

## Nota estructural importante (corrige la premisa del encargo)

El encargo original describía la ficha del producto (`CatalogProductDetailPage.tsx`) como si tuviera
pestañas "Escandallo, Receta, Modificadores, Etiquetado, Histórico, Más ▾". **Esa barra de pestañas
no está en `CatalogProductDetailPage.tsx` — está en `RecipeEditorPage.tsx`** (el editor del
escandallo). Verificado en código, no supuesto:

- **`CatalogProductDetailPage.tsx`** (la ficha del producto de venta / `menu_item`): **no tiene barra
  de pestañas**. Es una sola página con scroll: hero+foto → tarjeta de identidad editable → hasta 12
  secciones plegables (`CollapsibleSection`, acordeón) en orden fijo.
- **`RecipeEditorPage.tsx`** (el editor del escandallo / `recipe_item`, cubre platos e ingredientes de
  reventa): **sí tiene una barra de pestañas real** — `Escandallo · Receta · Modificadores ·
  Etiquetado · Histórico · Más` — literal en el código (`type EditorTab`, constante `TABS`).

Esto es directamente relevante para el rediseño: fundir ambas fichas en "una sola con pestañas"
significa introducir una estructura de pestañas nueva que hoy solo existe (parcialmente) en el editor
de escandallo, no en la ficha de producto.

---

# PARTE 1 — `CatalogProductDetailPage.tsx` (ficha del producto de venta)

Componente: `CatalogProductDetailPage({ menuItemId, onBack })` — 2004 líneas. Patrón lista+detalle
(lo monta `KitchenMenuPage`). Sin barra de pestañas — página única de scroll: hero+foto → tarjeta de
identidad → hasta 12 `CollapsibleSection` → caja de guía IA → modales.

## Estados de carga (antes de cualquier render real)
- `loading` true → spinner centrado "Cargando producto…" — fuente: `getMenuItemById(menuItemId)` en vuelo.
- `error` seteado o `item` null → botón volver "Menú" + banner rojo con `error` o "Producto no encontrado." — fuente: catch de `getMenuItemById`.

## Barra superior (siempre visible una vez cargado)
- **Botón volver** "← Menú · {brandName}" → `onBack()` (prop, navegación la controla el padre). `brandName` — fuente: `supabase.from('brand').select('name').eq('id', item.brandId).single()` (query inline en el efecto de canales/economía, no una función de servicio).
- **Botón "Exportar"** (icono Download) — **sin `onClick`** — botón muerto/decorativo, no hace nada.
- **Botón "···" (MoreHorizontal)** — **sin `onClick`** — botón muerto/decorativo, no hace nada.

## Banner de error de foto
- Banner rojo descartable cuando `photoError` está seteado (fallo de subida o borrado) — botón X limpia `setPhotoError(null)`.

## Zona HERO (foto)
- `<input type="file" accept="image/*">` oculto (ref `fileInputRef`) — disparado por los botones de abajo; `onChange` → `onPhotoSelected(e)`.
- **Con foto** (`item.photoUrl`): imagen a sangre completa, clic abre `PhotoLightbox` (`lightboxOpen`) — overlay oscuro a pantalla completa con la imagen a tamaño máximo; clic en el fondo o botón X cierra.
- **Sin foto**: placeholder degradado (icono Camera) + botón **"Añadir foto"** → `fileInputRef.current?.click()` → selector de archivo → `onPhotoSelected`:
  - `uploadMenuPhoto(accountId, itemId, file)` (menuPhotoService.ts — compresión JPEG cliente a ≤1200px/calidad 0.7, sube al bucket `menu-photos`, devuelve URL pública)
  - luego `updateMenuItem(item.id, { photoUrl: url })` (menuItemService.ts)
  - luego borrado best-effort de `deleteMenuPhoto(prevUrl)` (limpia el fichero huérfano anterior del bucket)
  - luego `refreshItem()` (re-fetch vía `getMenuItemById`)
  - el botón muestra spinner + "Subiendo…" mientras `photoUploading` es true
- Degradado inferior — decorativo, sin datos ni interacción.
- **Badge de marca** (arriba-izquierda, sobre la foto): círculo avatar con la primera letra de `brandName || item.category || 'P'` + texto `brandName || item.category || 'Producto'` — cálculo local, sin llamada aparte.
- **Botones de acción de la foto** (arriba-derecha, solo si `item.photoUrl` existe):
  - **"Cambiar"** → reabre el selector de archivo → mismo flujo `onPhotoSelected` (reemplazar foto).
  - **Botón borrar (papelera)** → pone `photoConfirmDelete = true`, sustituyendo los dos botones por una **confirmación inline** ("¿Eliminar foto?" + "Sí" / "Cancelar"):
    - "Sí" → `onPhotoDelete()`: `updateMenuItem(item.id, { photoUrl: null })` luego borrado best-effort de `deleteMenuPhoto(url)` (limpieza del bucket) luego `refreshItem()`.
    - "Cancelar" → `setPhotoConfirmDelete(false)`.

## TARJETA DE IDENTIDAD (tarjeta blanca, se solapa con el hero)

### Modo vista (`!editing`)
- **H1 nombre** (`item.name`).
- **Sello de salud del enlace** (arriba-derecha del nombre) — label/tono/tooltip de `classifyMenuItemLink(linkHealth)` (menuLinkService.ts) cuando `linkHealth` está cargado; mientras carga, cae a "Revisando…" (ámbar) si `hasRecipe`, o "Sin casar" (rojo) si no hay receta en absoluto — fallback de cálculo local; la fuente real es `getMenuItemLinkHealth(accountId, brandId)` (RPC `menu_item_link_health`) filtrado a este ítem.
- **Línea marca · categoría** — `brandName` (query inline de marca) · `item.category`.
- **Chips de tags** (`item.tags[]`, estilo vía mapa local `TAG_STYLES`: best-seller/nuevo/temporada/promocional, resto neutro) — fuente: columna `menu_item.tags`, sin llamada aparte.
- **Precio**: `fmtEur(pvpSinIva)` grande mono + etiqueta "precio base sin IVA". `pvpSinIva = item.price ?? 0` — cálculo local.
- **Línea PVP con IVA**: `PVP cliente {fmtEur(pvpConIva)} · IVA {vatPct}%` — cálculo local: `pvpConIva = round(pvpSinIva * (1 + vatPct/100) * 100) / 100`, `vatPct = item.vatRate ?? 0`.
- **Párrafo de descripción** (`item.description`), solo si existe.
- **Fila de botones de acción**:
  - **"Editar"** (icono Pencil) → `openEdit()` — siembra los borradores `name`/`description`/`price` desde `item`, limpia `saveError`, pone `editing = true`.
  - **AiButton "Mejorar descripción con IA"** — subcomponente puramente decorativo, **sin `onClick` en absoluto** (el componente no lo acepta) — botón muerto.
  - Si **no hay receta enlazada** (`!hasRecipe`): botón **"Vincular escandallo"** (icono Link2) → `openRecipePicker()` → abre `RecipeLinkPickerModal`.
  - Si **hay receta enlazada**: **"Cambiar escandallo"** → `openRecipePicker()`; **"Quitar"** (rojo) → `setConfirmClear(true)` → abre `ConfirmDialog`; si `canApprove` (estado humano del link = `para_revisar`) también **"Aprobar escandallo"** (verde, icono Check, spinner mientras `linking`) → `approveLink()` → `approveMenuItemLink(item.id)` (RPC `approve_menu_item_link`) → `refreshItem()` + `reloadLinkHealth()`.
  - Banner `linkError` bajo los botones si falla alguna operación de enlace.

### Modo edición (`editing`)
- **Nombre** input texto — atado a `name`.
- **Precio base (€ sin IVA)** input texto (`inputMode="decimal"`) — atado a `price` (acepta coma decimal).
- **Descripción** textarea (3 filas) — atada a `description`.
- Banner `saveError` (validación o error de servidor).
- **"Cancelar"** → `setEditing(false)` (descarta el borrador sin guardar).
- **"Guardar"** (spinner mientras `saving`) → `save()`:
  - valida `name` no vacío ("El nombre es obligatorio.") y `price` número finito ≥ 0 ("El precio no es válido.")
  - `updateMenuItem(item.id, { name, description: trimmed-o-null, price })` (menuItemService.ts, `.from('menu_item').update()`)
  - éxito: `setEditing(false)`, `refreshItem()`.

## SECCIONES PLEGABLES (orden exacto en el JSX)

Contenedor blanco con borde; cada sección es un `CollapsibleSection` (icono, título, badge opcional, `defaultOpen`, clic-para-alternar con chevron). Orden de arriba a abajo:

### S0 — id `s-combo` — "Grupos del combo" (solo si `isCombo === true`, badge `"{N} grupo(s)"`, neutro, defaultOpen=true)
- **Estados**: `comboSlots === null` → "Cargando grupos…"; si no, renderiza `<ComboEditorSection>`.
- Fuente de `isCombo`/`comboBrandId`/`comboSlots`: `getComboContext(accountId, item.id)` (comboEditService.ts — lee `menu_item.product_type`+`brand_id`, luego `getComboDetail` para slots+opciones).
- **`ComboEditorSection` (editor completo embebido)**:
  - **Panel de coste** (arriba, solo si `cost` cargado) — fuente: `getComboCost(comboItemId)` (RPC `compute_combo_cost`), recargado al montar (`useEffect [comboItemId]`) y tras cada mutación (`reload()`):
    - 3 tiles: **Coste** (`cost.isIncomplete ? "≥ {fmtEur(cost.cost)}" : fmtEur(cost.cost)}`), **Margen** (`fmtEur(cost.margin)` o "—"), **FC %** (`{cost.fcPct}%` o "—") — todo calculado en servidor, mostrado tal cual.
    - Si `cost.isIncomplete`: panel ámbar "Coste incompleto. Falta costear:" listando cada slot requerido en `state ∈ {incomplete, empty}` con motivo ("sin opciones" / "«opción» sin escandallo" / "sin escandallo").
    - Si no, y `cost.slotsProvisional > 0`: nota azul "{N} grupo(s) con coste provisional (reventa pendiente de factura)…".
  - **Estado vacío**: "Este combo no tiene grupos todavía…" cuando `slots.length === 0`.
  - **Tarjeta por slot** (una por `ComboSlotDetail`):
    - Nombre del slot — clic para editar inline (input autofocus, guarda en blur/Enter vía `updateSlot(accountId, slotId, {name})`, Escape cancela) — sin confirmación.
    - Checkbox **"Obligatorio"** — `required = minSelections >= 1`; al cambiar llama `updateSlot(..., {minSelections: checked ? max(1,cur) : 0})`.
    - Input numérico **"Elige hasta"** (mín 1) → `setMax()` → `updateSlot(..., {maxSelections: max(1,val), minSelections: min(cur.min, val)})`.
    - Botón **borrar slot** (Trash2) → `deleteSlot(accountId, slotId)` — soft-delete del slot Y de todas sus opciones (`is_active=false`) — **sin diálogo de confirmación**, dispara al instante.
    - **Lista de opciones** (por opción): nombre (texto de solo lectura, no editable inline), checkbox **"Defecto"** → `toggleDefault()` → `updateOption(..., {isDefault: !cur})`, input **"+€" de impacto en precio** (guarda en blur) → `setPriceImpact()` → `updateOption(..., {priceImpact})`, botón **quitar (X)** → `deleteOption(accountId, optionId)` (soft-delete, sin confirmación).
    - Enlace **"Añadir opción"** → abre caja de búsqueda inline (`addingTo = slotId`): input de texto atado a `search`, busca en vivo vía `searchOptionCandidates(accountId, brandId, query)` (comboEditService.ts) → cada resultado como botón (nombre + `fmtEur(price)`) → clic → `pickOption()` → `addOption(accountId, slotId, candidateId, 0, false)`. Enlace "Cerrar" colapsa la caja. Si `!brandId`, muestra "Combo sin marca; no se puede buscar." en vez de resultados.
  - Botón **"Añadir grupo"** (abajo) → `addSlot()` → `createSlot(accountId, comboItemId, 'Nuevo grupo', 1, 1)`.
  - Banner de error (`err`) para cualquier mutación fallida.
  - Todas las mutaciones pasan por el helper local `wrap()`: pone `busy`, ejecuta la mutación, luego `reload()` (re-fetch de slots vía `getComboContext` + `getComboCost`) y llama a la prop `onChanged` (→ `reloadCombo()` en la página, que re-fetch `getComboContext`).

### S1 — id `s-escandallo` — "Escandallo y elaboración" (badge = label del sello del enlace, badgeColor mapeado del tono; defaultOpen = `hasRecipe`)
- **Estado vacío** (`!hasRecipe`): "Sin escandallo vinculado…" + botón **"Vincular escandallo"** (→ `openRecipePicker()`) + AiButton **"Crear escandallo con IA"** (decorativo, muerto).
- **Estado poblado** (`hasRecipe`):
  - Franja de aviso si el tono es rojo/naranja — texto de `linkBadge.text` (es decir `classifyMenuItemLink(linkHealth).text`).
  - "Coste calculado desde: **{linkHealth.recipeName}**" (enlace clicable) → `navigate('/kitchen/recetas?recipe=' + item.recipeItemId)`.
  - "Este escandallo se comparte con {N} ítem(s) más de la cuenta." cuando `linkHealth.sharedWith > 1` — fuente: `menu_item_link_health.shared_with` (RPC).
  - **Grid de métricas (5 tiles)**: **Coste** = `fmtEur(recipeCost)`; **FC %** = `{foodCostPct}%` o "—"; **Ingredientes** = "—" estático (nunca calculado); **Pasos** = "—" estático (nunca calculado); **Tiempo** = "—" estático (nunca calculado). `recipeCost` — cálculo local: `econ.find(e => e.costAvailable)?.cost ?? null` (primera fila de canal de `getMenuItemChannelEconomics` con coste válido). `foodCostPct` — cálculo local: `round(recipeCost / pvpSinIva * 10000) / 100` (es decir `recipeCost/pvpSinIva*100`), solo cuando `hasCost && pvpSinIva>0`.
  - Texto estático "Merma estimada incluida en el coste del escandallo." (no ligado a datos).
  - Fila de enlaces: **"Ver escandallo completo →"** → `navigate('/kitchen/recetas?recipe=' + item.recipeItemId)`; **"Cambiar"** → `openRecipePicker()`; **"Quitar"** → `setConfirmClear(true)`; **"Aprobar"** (solo si `canApprove`) → `approveLink()`.

### S2 — id `s-economia` — "Economía por canal" (badge = `"Mejor {bestMarginPct}%"` cuando existe mejor canal, `ok`/verde; defaultOpen=true)
- **4 tiles de métrica**:
  - **PVP cliente** = `fmtEur(pvpConIva)` + "IVA {vatPct}% incluido" — cálculo local (igual que la tarjeta de identidad).
  - **Food cost** = `fmtEur(recipeCost)` (color ámbar) o "—" si no hay coste, subtexto `"{foodCostPct}% del PVP"` o "Pendiente de escandallo".
  - **Mejor margen** = `fmtEur(bestMargin)` (verde) o "—", subtexto `"{bestChannel} · {bestMarginPct}%"` o "Configura un canal" — cálculo local: recorre `econ[]` buscando la fila con `netMargin` máximo.
  - **Stock para** = "—" estático siempre, subtexto estático "Pendiente de inventario" — **nunca calculado, placeholder permanente**.
- **Bloque de margen por canal** (uno por fila de `econ`, fuente `getMenuItemChannelEconomics(item.id)` — RPC `menu_item_channel_economics` — menuOverrideService.ts):
  - **Badge de canal** — pastilla con logo si `channelLogos[slug]` existe (fuente: query inline propia de la página `supabase.from('connector').select('code, logo_url')`) si no, pastilla coloreada con icono adivinado por subcadena del slug (`glovo/uber/justeat` → Bike, `shop/takeaway` → ShoppingBag, si no → Store) — heurística local `channelIcon()`.
  - **Si el canal no tiene tarifa configurada** (`serviceType == null && commissionPct == null`): caja punteada "{badge} · sin configurado" + texto **"Configurar en Ajustes"** — con estilo de enlace (`cursor-pointer hover:underline`) pero **sin `onClick` — no es clicable de verdad**, UI muerta.
  - **Si está configurado**: margen alineado a la derecha `fmtEur(margin)` (verde si ≥0, rojo si <0) + `"{marginPct}% del PVP"` (+ "· sin food cost" si `!costAvailable`); fila de leyenda con chips de color para Food cost / Comisión (+%) / "Canal ≈{orderCost}" (solo para `own_delivery` con orderCost>0, tooltip explica la fórmula de estimación) / Margen; barra horizontal apilada con 4 segmentos (cost%/commission%/transport%/margin%).
    - Fórmulas de cálculo local: `cost = costAvailable ? (e.cost ?? 0) : 0`; `commAmt = e.commissionAmount ?? 0`; `orderCost = e.orderCostsPerItem ?? 0`; `costPct = costAvailable && price>0 ? round(cost/price*100) : 0`; `commPctBar = price>0 ? round(commAmt/price*100) : 0`; `transPctBar = price>0 ? round(orderCost/price*100) : 0`; `marginPctBar = max(0, 100 - costPct - commPctBar - transPctBar)`. Los valores subyacentes `cost/commissionAmount/orderCostsPerItem/netMargin/netMarginPct` en sí vienen del servidor (RPC).
  - Párrafo al pie (solo si alguna fila de `econ` tiene `serviceType === 'own_delivery'`) explicando la metodología de estimación de coste de reparto propio — texto estático.
- **Línea de target food cost** (abajo): `item.targetFoodCostPct != null ? "Target FC: {X}% · {Dentro/Fuera del objetivo}" : "Sin target de food cost configurado."` — comparación `foodCostPct <= item.targetFoodCostPct` es cálculo local; `targetFoodCostPct` en sí es columna de `menu_item`.

### S3 — id `s-precios` — "Precios y disponibilidad" (sin badge)
- **Tabla** (cabeceras: Canal / Ubicación / Precio / PVP / Margen neto / Activo) — **solo renderiza UNA fila jamás**, "Base marca / Todas / {pvpSinIva} / {pvpConIva} / {bestMargin} / {toggle}" — pese a que la cabecera multi-columna sugiere filas por canal/ubicación, no se puebla ninguna otra fila (parece un stub/tabla incompleta).
  - **Celda "Activo"** — máquina de estados con 4 renderizados mutuamente excluyentes:
    1. `item.isAvailable === true` → punto verde botón "Disponible" → `openAvailConfirm()` (abre el panel de confirmar-agotar, y llama `previewScope(accountId, item.id, null)` de `availabilityService.ts` para precargar el alcance afectado).
    2. `mirror.role === 'original' && mirror.usingMirror` (original oculto a propósito porque su espejo promo está activo) → punto ámbar botón "Oculto · versión promo" → `handleSwapMirror(false)` (volver al original).
    3. `mirror.role === 'mirror' && !mirror.usingMirror` (esta ficha ES el espejo, en espera) → punto ámbar botón "En espera · versión promo" → `handleSwapMirror(true)` (activar el espejo).
    4. Si no, (genuinamente agotado) → punto gris botón "Agotado · reactivar" → `handleToggleAvailability(true)`.
- **Caja de info de espejo** (mostrada cuando `mirror.role !== 'none'`): título ("Esta ficha es la versión promo" / "Versión promo (artículo espejo)"), texto explicativo según `mirror.usingMirror`, línea "Original: {visible/oculto} · Promo: {visible/oculto}", y un botón — **"Volver al original"** (si usando el espejo) o **"Usar versión promo"** (si no) → ambos llaman `handleSwapMirror(!usingMirror)`; si `mirror.role === 'mirror'` también muestra el hint "Promo de «{originalName}». Ponle aquí su precio promo." `mirrorError` banner en fallo.
  - Fuente de `mirror`: `getMirrorState(accountId, item.id)` (mirrorService.ts, RPC `mirror_state`).
  - `handleSwapMirror(useMirror)` → `swapMirror(accountId, originalId, useMirror)` (RPC `swap_mirror`, siempre ejecutado contra el id del original incluso desde la ficha del propio espejo) → `refreshItem()` + re-fetch `getMirrorState`.
- **Panel de confirmación inline "¿Marcar como agotado?"** (`availConfirm`, abierto por el botón "Disponible"): texto "...en {N marca(s)} · {N canal(es)} de Glovo/Uber/JustEat" — `availScope` de `previewScope()`, muestra "calculando alcance…" mientras carga. Botones: **"Sí, agotar"** (spinner mientras `availSaving`) → `handleToggleAvailability(false)`; **"Cancelar"** → resetea `availConfirm`/`availScope`.
- **`handleToggleAvailability(next)`** → `setProductAvailability(item.id, next, 'manual')` (menuOverrideService.ts, RPC `set_product_availability` — el servidor propaga entre marcas y empuja a los canales) → al agotar (`next=false`) guarda el resultado en `availResult` para mostrar; siempre cierra el panel de confirmación y `refreshItem()`.
- **Caja de resultado** (`availResult`, mostrada solo mientras `!item.isAvailable`): "Agotado en **{brands}** marca(s) · **{channels}** canal(es) ({affectedItems} ficha(s))." — fuente: valor de retorno de `setProductAvailability`.
- Banner `availError` (rojo) en fallo.
- Enlace/botón **"Editar precios"** → `setShowPrices(true)` → abre `EditPricesModal`.

### [Modal] `EditPricesModal` (renderizado como hermano justo después de S3, pero visualmente un overlay — `src/modules/kitchen/components/EditPricesModal.tsx`)
- Abierto desde el botón "Editar precios" de S3; props: `menuItemId`, `productName`, `basePrice = item.price`, `vatRate = item.vatRate`.
- **Cabecera**: título "Editar precios" + nombre del producto; botón cerrar X (también tecla Escape, vía su propio listener `useEffect` de `keydown`) — deshabilitado mientras guarda.
- **Estado de carga**: spinner mientras resuelve la llamada inicial a `getMenuItemChannelEconomics(menuItemId)`.
- **Panel "Precio por defecto"**: "PVP cliente" de solo lectura (derivado: `defNum*(1+vatRate/100)`, redondeado) + input de precio editable (`defaultPrice`, decimal).
- **Filas por canal** (una por `ChannelEconomics`), columnas: Canal (nombre + hint "+canal est. {X}" para own_delivery con costes de pedido) / Precio (input editable, placeholder = precio por defecto, en blanco = "hereda base", subtexto muestra `PVP {live.priceWithVat}` cuando hay override) / Margen neto (en vivo, verde/rojo según signo, con flag "· sin coste") / Disp. (interruptor de agotado, estado local `avail` por canal).
- **Preview en vivo del margen**: `useEffect` con debounce (300ms) que vuelve a llamar `getMenuItemChannelEconomics(menuItemId, previewKey)` con los precios actualmente tecleados como override de preview (`previewKey` = mapa de cálculo local channelId→precio efectivo, el propio si está tecleado, si no el precio por defecto) — el servidor recalcula el margen sin persistir, así que la fórmula en sí vive en el servidor.
- **"Guardar"** → `handleSave()`:
  - si cambió el precio por defecto: `updateMenuItem(menuItemId, { price: defNum })`
  - por canal: si precio en blanco Y disponible → `clearMenuItemOverride({menuItemId, channelId})`; si no → `setMenuItemOverride({menuItemId, channelId, price, isAvailable})` (ambas RPC en menuOverrideService.ts)
  - éxito llama a la prop `onSaved()` → en el padre: cierra el modal, incrementa `econReload` (fuerza que el `useEffect` de economía de la página se re-dispare), y `refreshItem()`.
- **"Cancelar"** / clic en el fondo → `onClose()` (deshabilitado mientras guarda).
- Banner `error` en fallo.

### S4 — id `s-modificadores` — "Modificadores" (badge = `groups.length` si >0, neutro; defaultOpen = `groups.length > 0`)
- Fuente del contador del badge: estado de la página `groups` = `getProductModifierGroups(accountId, item.id)` (brandCatalogService.ts, resumen **de solo lectura**, cargado una vez en un `useEffect [item?.id, item?.accountId]` de nivel superior). **Nota**: es una carga *separada* de la del editor de abajo — el editor gestiona su propia copia independiente de los grupos y puede desincronizarse en el contador hasta que se refresque `groups` de la página (no se refresca tras editar dentro de `ModifierEditorSection`).
- Cuerpo = `<ModifierEditorSection accountId brandId menuItemId recipeItemId>`:
  - **Estado de carga**: "Cargando modificadores…" mientras su propia llamada a `getProductModifierGroupsEditable(accountId, menuItemId)` (modifierEditService.ts) está en vuelo (`useEffect [accountId, menuItemId]` propio).
  - **Estado vacío**: "Este producto no tiene modificadores. Crea un grupo o asigna uno existente."
  - **Tarjeta por grupo**:
    - Nombre del grupo editable inline (input autofocus, guarda en blur/Enter vía `updateGroup(...,{name})`, Escape cancela).
    - Botón **borrar grupo** → `unassignGroupFromProduct(accountId, groupId, menuItemId)` — quita la asignación solo de *este* producto (el grupo en sí, y su uso en otros productos, intacto) — sin confirmación.
    - Aviso de reutilización: "Este grupo se usa en {usageCount} productos. Los cambios afectan a todos." mostrado cuando `usageCount > 1`.
    - Select **tipo de grupo** (Elegir/Extras/Quitar/Tamaño = choice/extras/removal/size) → `updateGroup(...,{groupType})`.
    - Checkbox **"Obligatorio"** → `updateGroup(...,{minSelections})`.
    - Input numérico **"Elige hasta"** → `updateGroup(...,{maxSelections, minSelections: min(cur,max)})`.
    - **Bloque preview "Así lo ve cocina"** (estilo ticket oscuro), una línea por opción, coloreada por tono (rojo negrita = quitar, ámbar = añadir, gris = neutro) — calculado por `kitchenPreview(optName, groupType)` local, que construye un `OrderFeedChild` mínimo y llama **`childVisual()`** importado de `@/modules/orders/services/ordersFeedService` — es decir, reutiliza la MISMA función que pinta el ticket real de cocina, así que el preview no puede desviarse de los tickets de producción.
    - **Fila por opción**: nombre editable inline (`updateModifierOption(...,{name})`), checkbox **"Defecto"** (`updateModifierOption(...,{isDefault})`), input **"+€" de impacto en precio** (`updateModifierOption(...,{priceImpact})`), botón **quitar (X)** (`deleteModifierOption`, sin confirmación).
    - **Línea de estado de impacto en coste por opción** (capa C, de `modifierImpactService.ts` vía mapa `impacts` cargado con `listOptionsWithImpacts(menuItemId)`):
      - sin impacto (`imp === null`) → "Coste sin definir" (gris).
      - `status === 'proposed'` → "IA propone" (con `confidence%` y `rationale` si existe) + botón **"Confirmar"** → `confirmImpact(impactId, 'Confirmado en ficha')` (modifierImpactService.ts) + botón **"Rechazar"** → `rejectImpact(impactId)`.
      - `status === 'confirmed'` → "Coste confirmado" (+ `confirmedByName` si existe).
    - Botón **"Añadir opción"** por grupo → `addModifierOption(accountId, groupId, 'Nueva opción', 0, false)`.
  - **Acciones al pie**: botón **"Nuevo grupo"** (deshabilitado sin `brandId`) → `createGroupForProduct(accountId, brandId, menuItemId, 'Nuevo grupo', 'choice', 0, 1)`; botón **"Asignar grupo existente"** (deshabilitado sin `brandId`) → abre picker inline vía `listAssignableGroups(accountId, brandId, menuItemId)`, listando nombre/optionCount/usageCount, clic → `assignExistingGroup(accountId, groupId, menuItemId)`, enlace "Cerrar" colapsa; botón **"Pedir coste con IA"** (solo si `groups.length>0`, deshabilitado sin `recipeItemId` o mientras ocupado) → `requestAIProposals(accountId, recipeItemId)` (modifierImpactService.ts — llama a la Edge Function `propose-modifier-impacts` con el token del usuario) → muestra banner de resumen "IA: {N} propuestas en {N} opciones ({N} sin propuesta)." y recarga impactos.
  - Banner `err` para cualquier mutación fallida; todas las mutaciones pasan por un `wrap()` local (flag busy → mutación → `reload()` que re-fetch grupos + impactos).

### S5 — id `s-alergenos` — "Alérgenos y nutrición" (sin badge)
- **`!hasRecipe`**: `EmptyState` "Necesita escandallo para calcular alérgenos automáticamente."
- **`hasRecipe`**: renderiza los 14 `EU_ALLERGENS` (lista hardcodeada: Gluten, Crustáceos, Huevos, Pescado, Cacahuetes, Soja, Lácteos, Frutos de cáscara, Apio, Mostaza, Sésamo, Sulfitos, Altramuces, Moluscos) como chips grises **todos leyendo permanentemente "{alérgeno}: no"** — **no calculado de ningún dato real de alérgenos, placeholder estático sin importar el contenido real de la receta** — más AiButton **"Verificar alérgenos"** (decorativo, muerto, sin handler).

### S6 — id `s-proveedores` — "Proveedores" (sin badge)
- `!hasRecipe` → `EmptyState` "Conecta un escandallo para ver qué proveedores suministran este plato."
- `hasRecipe` → texto estático "Resumen de impacto por proveedor (próximamente)." — sin fuente de datos, stub sin implementar.

### S7 — id `s-ventas` — "Ventas" (badge hardcodeado `"0"`, neutro)
- Texto estático "Sin ventas registradas para este producto." — **sin query, sin fuente de datos en absoluto**, stub totalmente hardcodeado (el badge "0" es un literal, no calculado de ninguna tabla de ventas).

### S8 — id `s-notas` — "Notas internas" (sin badge; defaultOpen = `!!item.notesInternal`)
- **Textarea** (3 filas, placeholder "Notas del equipo (no visibles al cliente)…") atada a `notesVal`, inicializada desde `item.notesInternal` en el `useEffect` de siembra de borradores.
- Botón **"Guardar nota"** — mostrado solo cuando `notesVal` difiere de `item.notesInternal` (chequeo de "sucio") — spinner mientras `fieldSaving === 'notes'` → `saveField('notes', { notesInternal: trimmed-o-null })` → `updateMenuItem(item.id, patch)` → `refreshItem()`.
- Línea de pie: `"{Creado por X ·} Actualizado {fmtDate(item.updatedAt)}"` — columnas `item.createdByName` / `item.updatedAt`.

### S9 — id `s-packaging` — "Packaging delivery" (sin badge; defaultOpen = `!!(item.packagingDescription || item.packagingCost)`)
- Si ambos vacíos: hint "Sin información de packaging."
- **"Descripción del envase"** textarea (2 filas) atada a `packDesc`, inicializada desde `item.packagingDescription`.
- **"Coste packaging (€/unidad)"** input decimal atado a `packCost`, inicializado desde `item.packagingCost`.
- Botón **"Guardar packaging"** — mostrado solo si algún campo está "sucio" — spinner mientras `fieldSaving === 'pack'` → `saveField('pack', { packagingDescription: trimmed-o-null, packagingCost: parsed-o-null })` → `updateMenuItem` → `refreshItem()`.

### S10 — id `s-marcas` — "Marcas y categoría" (sin badge; defaultOpen = true)
- Cuerpo = `<ProductPlacementSection accountId menuItemId recipeItemId currentBrandId productName basePrice onChanged={refreshItem}>` (`src/modules/kitchen/components/ProductPlacementSection.tsx`), que tiene su propio `useEffect [menuItemId, recipeItemId, currentBrandId, accountId]` de carga (`Promise.all` de 4 llamadas) — spinner "Cargando…" mientras carga:
  - **Lista de chips "Marcas donde se vende"**:
    - Fuente: `listBrandsForRecipe(accountId, recipeItemId)` (menuItemService.ts) — un chip por marca donde se vende esta receta/producto (avatar-letra + nombre de marca + `fmtEur(price)`); el chip de `currentBrandId` muestra "actual" (no se puede quitar); los demás muestran botón quitar (X).
    - **Quitar (X)** en un chip que no es el actual → `handleRemove()` → `archiveMenuItem(p.menuItemId)` (archiva en soft el `menu_item` de esa marca) → recarga + `onChanged()` (→ `refreshItem` de la página) — sin diálogo de confirmación.
    - Select **"añadir a marca…"** (solo marcas donde aún no está, `addableBrands`) + botón **"Añadir"** → `handleAdd()` → `addRecipeToBrand({accountId, recipeItemId, brandId, price: basePrice, name: productName})` (crea/reactiva un `menu_item` para esa marca, copiando el precio base) → recarga + `onChanged()`.
    - Texto hint: "Está en todas tus marcas." cuando `addableBrands.length === 0`.
    - Nota al pie: "Comparten el mismo escandallo (coste único). Cada marca tiene su precio; al añadir se copia {fmtEur(basePrice)} como punto de partida."
    - **Estado sin receta**: caja de info ámbar "Vincula un escandallo… para vender este producto en varias marcas" (en vez de la lista de chips/controles de añadir) cuando `!recipeItemId`.
  - Select **"Categoría en esta marca"** — opciones de `listMenuCategories(accountId, currentBrandId)` (menuCategoryService.ts, no leído en profundidad pero confirmado por el import) atado a `currentCatId` (fuente: `getMenuItemCategoryId(menuItemId)`) — `onChange` → `handleCategory(catId)` → `setMenuItemCategory(menuItemId, catId||null)` (menuItemService.ts) → `onChanged()` (set local optimista antes de que resuelva la llamada; en error recarga para revertir).
  - Sección **"Disponibilidad por local y canal"** — puramente informativa, texto estático "Próximamente: agotar/activar y precio por local y por canal (Glovo · Uber · JustEat · Shop)." — sin datos, sin interacción.
  - Banner `err` para cualquier mutación fallida.

### S11 — id `s-avanzado` — "Avanzado" (sin badge)
- **"Nombre de cocina (kitchen name)"** input texto atado a `kitchenNameVal`, inicializado desde `item.kitchenName`. Sucio → botón **"Guardar"** (spinner mientras `fieldSaving==='kn'`) → `saveField('kn', {kitchenName: trimmed-o-null})`.
- **"Nombre corto (short name)"** input texto atado a `shortNameVal`, inicializado desde `item.shortName`. Sucio → botón **"Guardar"** (spinner mientras `fieldSaving==='sn'`) → `saveField('sn', {shortName: trimmed-o-null})`.
- **"Código interno"** — solo lectura, `item.id.slice(0, 8)` — cálculo local (UUID truncado), no un campo aparte.
- **"External ID (Last.app)"** — solo lectura, muestra siempre "—" estático — **nunca conectado a ningún campo/columna real, placeholder permanente** (aunque `menu_item.external_id` existe en el esquema según `availabilityService.ts`, esta UI nunca lo lee ni lo muestra).
- Línea de pie: `"Creado: {fmtDate(item.createdAt)}"` y `"Actualizado: {fmtDate(item.updatedAt)}"`.

## CAJA DE GUÍA IA (después de todas las secciones, antes de los modales)
- Panel decorativo morado: "Folvy te ayuda a completar la ficha" + subtexto + botón **"Empezar con IA →"** — **sin `onClick`** — completamente decorativo/muerto, sin funcionalidad.

## Modales / diálogos (ficha de producto)

1. **`PhotoLightbox`** (subcomponente local) — overlay oscuro a pantalla completa mostrando `item.photoUrl` a tamaño máximo; clic en el fondo o botón X cierra (`setLightboxOpen(false)`). Se abre al hacer clic en la foto del hero.
2. **Confirmación inline "¿Eliminar foto?"** (no es un modal real — sustitución inline de los botones de acción de foto) — ver zona HERO arriba.
3. **Panel de confirmación inline "¿Marcar como agotado?"** (no es un modal real, inline en S3) — ver S3 arriba.
4. **`RecipeLinkPickerModal`** (`src/modules/kitchen/components/RecipeLinkPickerModal.tsx`) — abierto vía `openRecipePicker()` (botones Vincular/Cambiar escandallo de la tarjeta de identidad y S1). Props: `accountId`, `itemName`, `wasApproved` (= el estado humano actual del enlace es 'bien', muestra un aviso ámbar de que cambiarlo lo revierte a "Para revisar"), `busy`, `error`.
   - Carga `listRecipeItems({accountId, types:['dish','raw'], includeInactive:false})` (recipeItemService.ts) al montar.
   - El input de búsqueda filtra la lista cargada en cliente por nombre (subcadena, sin distinguir mayúsculas).
   - Cada fila de resultado: nombre, `r.code` si existe, `fmtEur(r.computedCost)`, clic → `onChoose(id, name)` → `linkRecipe(recipeItemId)` del padre → `setMenuItemRecipe(item.id, recipeItemId)` (RPC `set_menu_item_recipe` — resetea la aprobación en cualquier cambio de receta) → `refreshItem()` + `reloadLinkHealth()`.
   - Botón **"Crear escandallo nuevo «{itemName}»"** → `onCreateNew()` → `createDishFromProduct()` del padre → `createDishAndLinkToMenuItem(accountId, item.id, item.name)` (menuLinkService.ts — crea un `recipe_item` type='dish' con unidad base, luego lo enlaza) → `refreshItem()` + `reloadLinkHealth()`.
   - X / "Cancelar" / clic en el fondo → `onClose()` (deshabilitado mientras `busy`).
   - Estados de carga/error propios de su llamada a `listRecipeItems` (`loading`, `loadError`), separados de `linking`/`linkError` del padre.
5. **`ConfirmDialog`** (`src/components/ConfirmDialog.tsx`, componente genérico reutilizable) — usado una vez, para **"Quitar" escandallo**: `open={confirmClear}`, título "Quitar escandallo", mensaje `«{item.name}» quedará sin coste y sin descontar del almacén hasta que le asignes otra receta.`, `tone="danger"`, `busy={linking}`. `onConfirm` → `unlinkRecipe()` → `clearMenuItemRecipe(item.id)` (RPC `clear_menu_item_recipe`) → `refreshItem()` + `reloadLinkHealth()` + `setConfirmClear(false)`. `onCancel` → `setConfirmClear(false)`.
6. **`EditPricesModal`** — descrito completo arriba, bajo S3.

## Inventario de estado (`useState` no puramente transitorio)

| Estado | Tipo | Cargado/sembrado por |
|---|---|---|
| `item` | `MenuItem \| null` | `getMenuItemById(menuItemId)` |
| `groups` | `CatalogModifierGroup[]` | `getProductModifierGroups(accountId, item.id)` — solo lectura, alimenta solo el contador del badge de S4 |
| `comboSlots` | `ComboSlotDetail[] \| null` | `getComboContext(accountId, item.id).slots` |
| `comboBrandId` | `string \| null` | `getComboContext(...).brandId` |
| `isCombo` | `boolean` | `getComboContext(...).isCombo` |
| `error` | `string \| null` | catch de la carga del ítem |
| `econ` | `ChannelEconomics[]` | `getMenuItemChannelEconomics(item.id)` |
| `econReload` | `number` | bump manual (en `EditPricesModal.onSaved`) para forzar el re-disparo del `useEffect` de economía |
| `salesChannels` | `SalesChannelType[]` | `listSalesChannels(accountId)` |
| `brandName` | `string` | query inline `supabase.from('brand').select('name')...` |
| `channelLogos` | `Record<string,string>` | query inline `supabase.from('connector').select('code, logo_url')...` |
| `name`, `description`, `price` | `string` (borradores de edición) | sembrados desde `item` en `openEdit()` |
| `saveError` | `string \| null` | catch de `save()` |
| `photoError` | `string \| null` | catch de subida/borrado |
| `notesVal` | `string` | sembrado desde `item.notesInternal` |
| `availScope` | `ScopePreview \| null` | `previewScope(accountId, item.id, null)` |
| `availResult` | `ProductAvailabilityResult \| null` | retorno de `setProductAvailability` |
| `availError` | `string \| null` | catch de `handleToggleAvailability` |
| `mirror` | `MirrorState \| null` | `getMirrorState(accountId, item.id)` |
| `mirrorError` | `string \| null` | catch de `handleSwapMirror` |
| `packDesc`, `packCost` | `string` | sembrados desde `item.packagingDescription`/`packagingCost` |
| `kitchenNameVal`, `shortNameVal` | `string` | sembrados desde `item.kitchenName`/`shortName` |
| `linkError` | `string \| null` | catch de cualquier operación de enlace de receta |
| `linkHealth` | `MenuItemLinkHealthRow \| null` | `getMenuItemLinkHealth(accountId, brandId)` filtrado a este ítem |

(Booleanos/refs omitidos por ser puramente transitorios de UI: `loading`, `editing`, `saving`, `photoUploading`, `photoDeleting`, `photoConfirmDelete`, `lightboxOpen`, `showPrices`, `availSaving`, `availConfirm`, `fieldSaving`, `recipePickerOpen`, `linking`, `confirmClear`, `mirrorBusy`, `fileInputRef`.)

## Inventario de `useEffect` (nivel de página, en orden del código)

1. **Cargar ítem** — `getMenuItemById(menuItemId)` → setea `item`/`error`/`loading`. Deps: `[menuItemId]`.
2. **Cargar grupos de modificadores de solo lectura** (contador del badge de S4) — `getProductModifierGroups(item.accountId, item.id)`. Deps: `[item?.id, item?.accountId]`.
3. **Cargar salud del enlace** — `getMenuItemLinkHealth(item.accountId, item.brandId)`, filtra a la fila de este ítem. La misma lógica se expone como `reloadLinkHealth()` para invocación manual tras mutaciones. Deps: `[item?.id, item?.accountId, item?.brandId, item?.recipeItemId]`.
4. **Cargar estado de espejo** — `getMirrorState(item.accountId, item.id)`. Deps: `[item?.id, item?.accountId]`.
5. **Cargar contexto de combo** — `getComboContext(item.accountId, item.id)` → setea `isCombo`/`comboBrandId`/`comboSlots`. También expuesto como `reloadCombo()` para invocación manual (pasado como `onChanged` a `ComboEditorSection`). Deps: `[item?.id, item?.accountId]`.
6. **Cargar canales + economía + nombre de marca + logos de canal** — `Promise.all([listSalesChannels(accountId), getMenuItemChannelEconomics(item.id)])` + dos queries inline independientes a Supabase (`brand`, `connector`). Deps: `[item?.id, item?.accountId, item?.recipeItemId, item?.brandId, econReload]` — el bump de `econReload` es el mecanismo que usa `EditPricesModal` para forzar un refresco tras guardar overrides.
7. **Sembrar borradores de edición inline** — copia `item.notesInternal/packagingDescription/packagingCost/kitchenName/shortName` a sus respectivos estados de borrador cada vez que el ítem (o esos campos específicos) cambian. Deps: `[item?.id, item?.notesInternal, item?.packagingDescription, item?.packagingCost, item?.kitchenName, item?.shortName]`.

Efectos anidados (para completitud):
- `ComboEditorSection`: `useEffect [comboItemId]` → `getComboCost(comboItemId)`.
- `ModifierEditorSection`: `useEffect [accountId, menuItemId]` → `getProductModifierGroupsEditable` + `loadImpacts()` (`listOptionsWithImpacts`).
- `ProductPlacementSection`: `useEffect [menuItemId, recipeItemId, currentBrandId, accountId]` → `Promise.all` de `listBrandsForRecipe`/`listAccountBrands`/`listMenuCategories`/`getMenuItemCategoryId`.
- `EditPricesModal`: `useEffect [menuItemId]` inicial `getMenuItemChannelEconomics`; `useEffect [menuItemId, previewKey, channels.length]` con debounce (300ms) de preview en vivo; `useEffect [saving, onClose]` listener global de `keydown` para Escape.
- `RecipeLinkPickerModal`: `useEffect [accountId]` → `listRecipeItems({accountId, types:['dish','raw'], includeInactive:false})`.

## Notas transversales a tener en cuenta para el rediseño (ficha de producto)
- **Cargas duplicadas de grupos de modificadores**: `groups` de la página (solo lectura, solo badge) vs. la copia editable propia de `ModifierEditorSection` — pueden desincronizarse ya que editar dentro de la sección nunca actualiza el `groups` de la página (el contador del badge puede quedar obsoleto hasta un remount/refresh completo).
- **Controles muertos/decorativos sin handler**: "Exportar", "···" (MoreHorizontal), los 3 `AiButton` ("Mejorar descripción con IA", "Crear escandallo con IA", "Verificar alérgenos"), "Empezar con IA →" de la caja de guía, y el texto "Configurar en Ajustes" en la fila de canal sin configurar de S2.
- **Placeholders estáticos permanentes (nunca calculados)**: los tiles "Ingredientes"/"Pasos"/"Tiempo" de S1, el tile "Stock para" de S2, toda la lista de chips de alérgenos de S5 (siempre "no"), S6 ("próximamente"), S7 ("Ventas", badge "0" hardcodeado), "External ID (Last.app)" de S11.
- **La tabla de S3** está estructurada para mostrar múltiples filas (por canal/ubicación) pero solo renderiza jamás una fila "Base marca".
- **Borrados sin confirmación**: borrar slot de combo, borrar opción de combo, quitar asignación de grupo de modificador, borrar opción de modificador — todos disparan al instante vía `wrap()`/`unassignGroupFromProduct` sin `ConfirmDialog`, a diferencia del flujo "Quitar" del escandallo que sí usa uno.

---

# PARTE 2 — `RecipeEditorPage.tsx` (editor del escandallo)

Archivo: `src/modules/kitchen/pages/RecipeEditorPage.tsx` (2687 líneas). Props: `recipeId?`, `onBack?`
(si no se pasa, no hay botón "Volver al listado"), `onOpenRecipe?` (lo usa "Duplicar" para abrir la
copia).

## Cabecera (fuera de las pestañas)

La cabecera entera (foto, título, chips, acciones, banner de revisión) está **fuera del bloque de
pestañas**, por tanto es visible en TODAS las pestañas, no solo en "Escandallo". Igualmente el diálogo
de borrar/archivar, el lightbox de foto y el modal "Añadir a carta" están montados a nivel raíz del
componente (fuera del `if (activeTab === …)`), así que pueden abrirse/estar abiertos desde cualquier
pestaña.

- **Foto del plato** (96×96px, `recipe.kitchenPhotoUrl`):
  - Si no hay foto: icono cámara, clic abre el selector de archivo (`openPhotoPicker` → `photoInputRef.current?.click()`).
  - Si hay foto: clic abre el **lightbox** (`photoLightbox=true`) a tamaño completo, overlay negro 80%, botón X para cerrar.
  - Input de archivo oculto (`accept="image/*"`) → `handlePhotoSelected`: sube con `uploadDishPhoto(activeAccountId, recipe.id, file)` (bucket privado, `recipePhotoService.ts`), guarda el **path** (no URL) con `updateRecipeItem(recipe.id, { kitchenPhotoUrl: path })`, borra la foto anterior del bucket con `deleteDishPhoto(previousPath)` (no bloqueante si falla), y muestra spinner mientras sube (`photoUploading`).
  - Error de subida: banner rojo inline junto a los botones, autodesaparece a los 5s.
  - La URL firmada se resuelve aparte con `getDishPhotoUrl(stored)` (la BBDD guarda el path, no la URL; la URL firmada caduca y se regenera en cada carga/cambio — efecto con dep `[recipe?.kitchenPhotoUrl]`).
  - Botón secundario "Añadir foto" / "Ver / cambiar foto" (mismo `openPhotoPicker`), con icono cámara, deshabilitado mientras sube.
- **Nombre del plato** (`recipe.name`):
  - Es un `<h1>` clicable ("Haz clic para cambiar el nombre"), con icono lápiz que aparece al hover. Clic → `startEditName()` → input inline con autofocus.
  - Guardar: `onBlur` o Enter → `saveName()` → `updateRecipeItem(recipe.id, { name: next })`, solo si cambió y no está vacío; tras guardar, `reloadTick++` para refrescar `recipe`.
  - Escape cancela sin guardar.
- **Chips junto al nombre**:
  - **Chip IA** (`isAi = recipe.source === 'ai_recipe' || recipe.source === 'ocr_invoice'`): icono `Sparkles`, fondo `bg-accent`, texto "IA".
  - **Chip de estado**: `dishNeedsReview` → "Revisar" (ámbar, icono `AlertTriangle`) vs "Validado" (verde, icono `Check`). `dishNeedsReview = (recipe.needsReview ?? false) || dishHasIncompleteLine`, donde `dishHasIncompleteLine = lines.some(l => l.childNeedsReview || l.needsReview)` (cálculo cliente sobre las líneas ya cargadas).
- **Línea tipo/código**: icono `ChefHat` + `recipe.type === 'dish' ? 'Plato' : recipe.type` (es decir, muestra el tipo crudo si no es 'dish' — p. ej. "raw", "recipe", "packaging"); si `recipe.code` existe, se añade tras un separador `·` en fuente monoespaciada.
- **Fila de acciones rápidas** (bajo el tipo/código):
  - **"Añadir foto"/"Ver / cambiar foto"** (ver arriba).
  - **"Duplicar"** (icono `Copy`): `handleDuplicate()` → `window.confirm(...)` → `duplicateRecipeItem(recipe.id)` (RPC `duplicate_recipe_item`, server-side atómica: copia plato + líneas + pasos, marca `needs_review=true`, nuevo `folvy_code` por trigger) → si hay `onOpenRecipe`, navega a la copia; si no, `reloadTick++`. Error se muestra en chip rojo junto a los botones.
  - **"Eliminar"** (icono `Trash2`, texto/borde rojo): `openDeleteDialog()` → abre el modal de confirmación (ver Modales).
  - Chips de error de duplicado / de foto se muestran en línea junto a los botones (fondo rojo sólido, texto blanco).
- **Banner "Marcado para revisar"** (solo si `ownNeedsReview = recipe?.needsReview ?? false`, es decir el flag PROPIO del plato, no el de una línea incompleta):
  - Icono `AlertTriangle`, texto "Marcado para revisar" + motivo construido client-side por `reviewReasonText(recipe.reviewNotes)` a partir de campos estructurados (`kind`/`deltaPct`), NUNCA de `summary` ni de la fuente de referencia (deliberado, para no filtrar detalles de implementación):
    - `kind === 'cost_suspect'`: sin `deltaPct` → "El coste calculado parece no cuadrar…"; con `|deltaPct| >= 15` → "sale un X% por encima/debajo de lo esperado. Probablemente falte un ingrediente…"; `>= 5` → "...Puede faltar gramaje o no estar contabilizada la merma."; si no → "...Diferencia pequeña; conviene revisar los gramajes finos."
    - `kind === 'missing_recipe'` → "Este plato no tiene la receta completamente modelada…"
    - cualquier otro → "Este plato está marcado para revisar."
  - Botón **"Dar por revisado"** (icono `ShieldCheck`): `handleDismissReview()` → `window.confirm(...)` → `dismissReview(recipe.id, 'Revisado manualmente desde el editor', authUserId ?? null)` (baja `needs_review`, registra `review_dismissed_at/by/reason` — con fallback a `by=null` si el actor no tiene `user_profiles` válido) → `reloadTick++`.

**NOTA IMPORTANTE (verificada):** no existe ningún elemento "Usado por N ítems" ni "Platos de venta
que usan esta receta" en la cabecera. Esa sección solo existe en la **columna derecha de la pestaña
"Escandallo"** (ver más abajo) — es decir, es invisible cuando el usuario está en cualquier otra
pestaña.

## Barra de pestañas (`TABS`, verificado literal en código)

```ts
type EditorTab = 'escandallo' | 'receta' | 'modificadores' | 'etiquetado' | 'historico' | 'mas'
const TABS = [
  { id: 'escandallo', label: 'Escandallo' },
  { id: 'receta', label: 'Receta' },
  { id: 'modificadores', label: 'Modificadores' },
  { id: 'etiquetado', label: 'Etiquetado' },
  { id: 'historico', label: 'Histórico' },
  { id: 'mas', label: 'Más' },
]
```

- Las 6 pestañas se renderizan **siempre**, sin ninguna condición de visibilidad (`TABS.map(...)` sin filtro). No hay lógica de "solo se muestra si…" para ninguna.
- La pestaña "Más" lleva un icono `ChevronDown` pegado al label (sugiere desplegable), pero **no es un desplegable ni un menú overflow**: es una pestaña normal que, al activarse, cae en la rama por defecto (ver abajo). El chevron es puramente decorativo/engañoso hoy.
- **Hallazgo crítico verificado en el switch de contenido** (líneas 2618-2641): solo 3 pestañas tienen componente real cableado — `'receta'` → `RecipeStepsTab`, `'modificadores'` → `ModifierImpactsTab`, `'historico'` → `RecipeHistoryTab`. `'escandallo'` tiene su propio bloque de grid de dos columnas. **`'etiquetado'` Y `'mas'` NO tienen ninguna rama propia**: ambas caen en el `else` final, que renderiza únicamente:
  ```
  Solapa «{TABS.find(t => t.id === activeTab)?.label}» — pendiente.
  ```
  Es decir, hoy "Etiquetado" y "Más ▾" son pantallas vacías con un texto placeholder centrado ("Solapa «Etiquetado» — pendiente." / "Solapa «Más» — pendiente."). No hay ningún contenido real, ni siquiera un esqueleto, detrás de ninguna de las dos.

## Pestaña "Escandallo" (`activeTab === 'escandallo'`)

Grid de 2 columnas en desktop (`lg:grid-cols-[minmax(0,1fr)_320px]`), 1 columna apilada en móvil.

### Columna izquierda — composición

**Cabecera de la columna** ("Escandallo" + acciones rápidas):
- **"Sugerir mermas con IA (N)"** — solo visible si `linesWithoutWaste.length > 0` (líneas cuya `effectiveWastePct()` calculada es 0). Botón con icono `Sparkles`/`Loader2` (girando si `aiBatchRunning`). `suggestWasteBatchAI()`:
  - Una única llamada a `streamMessage()` (`folvyAIService.ts`, edge function `folvy-ai`, endpoint `${VITE_SUPABASE_URL}/functions/v1/folvy-ai`, `surface: 'background'`) pidiendo un JSON array `{"nombre","merma"}` para TODOS los nombres de `linesWithoutWaste` a la vez (para no gastar N llamadas).
  - Al terminar (`evt.type === 'done' | 'partial_end'`) parsea el JSON del texto acumulado, mapea por nombre normalizado (lowercase+trim) y rellena `aiWasteSuggestions` por `lineId` — solo sugiere, no guarda nada hasta que el usuario aplique cada chip.
  - Si no puede parsear o no encuentra nada válido: `aiWasteError` (banner rojo, autodesaparece a 4s).
- **Botón "Mic" (dictar por voz)**: `title="Dictar por voz (próximamente)"`, sin `onClick` — **es un placeholder inerte, no hace nada**.
- **Botón "MessageCircle" (Pedir a Folvy)**: `title="Pedir a Folvy (próximamente)"`, sin `onClick` — **también placeholder inerte**.
- **"Importar ficha"** (icono `Camera`/`Loader2` si `importing`): abre el selector de archivo oculto (`accept="image/*,application/pdf,.pdf,.xlsx,.xls,.csv,.docx"`). `handleImportRecipe(file)`:
  - `setImportStage('uploading')`, tras 800ms pasa a `'reading'` (solo feedback visual).
  - `extractRecipeSession(activeAccountId, file, { targetRecipeId: recipeId })` (`recipeImportService.ts`): sube la imagen/PDF comprimidos al bucket de `recipe-sources` o convierte Excel/Word a texto, invoca la Edge Function `extract-recipe` (`supabase.functions.invoke`) con `kind: 'photo'|'conversational'`, `target_recipe_id` (rellena ESTE plato, no crea otro), deduplica líneas por nombre normalizado.
  - Abre el modal `RecipeImportReviewModal` (`review` state) con las líneas parseadas — ver Modales.
  - Errores: `importError` (modal aparte).

**Barra "Producción"** (escalado NO destructivo, solo de vista):
- Icono `Scale` + label "Producción".
- Si `recipe.yieldPortions > 0` (⇒ `baseYield`): texto "Rinde X raciones · para" + input numérico (objetivo en raciones) → `applyProdTarget(text)`: `prodFactor = objetivo / baseYield`.
- Si no hay `yieldPortions`: texto "Multiplicar por" + input = multiplicador directo → `prodFactor = n`.
- Botones rápidos `×2`, `×3`, `½` → `applyProdMultiplier(mult)`.
- Si `prodFactor !== 1`: chip "Producción · N raciones (×factor) · solo lectura" + botón "Restaurar" (`resetProd()` → factor=1).
- **Efecto de la producción**: mientras `prodFactor !== 1`, cada línea es de **solo lectura** (no editable, sin botón borrar, sin chip de merma editable) y las cantidades/costes mostrados se multiplican por `prodFactor` client-side (`netQty = (line.quantityNet ?? line.quantity) * prodFactor`, `dispCost = (line.lineCost ?? 0) * prodFactor`); no escribe nada en BBDD.
- Se resetea automáticamente a `factor=1` al cambiar de `recipeId` (efecto con dep `[recipeId]`).

**Aviso de error de edición/IA**: banner rojo combinado `editError ?? aiWasteError` (solo si alguno está seteado).

**Tres secciones del escandallo** (renderizadas por la función `Section({title, icon, kind, sectionLines, emptyHint})`, invocada como función, no `<Section/>`, para no perder el foco de los inputs de edición inline al re-renderizar):

1. **"Ingredientes"** (acento terracota, icono `ChefHat`) — `ingredientLines = lines.filter(l => l.childType !== 'recipe' && l.childType !== 'packaging')` (raw, tool, o cualquier tipo desconocido cae aquí — nada se oculta). Vacío: "Sin ingredientes todavía." (o "Este escandallo aún no tiene ingredientes." si el plato está totalmente vacío).
2. **"Sub-recetas"** (acento verde éxito, icono `ChefHat`) — `subRecipeLines = lines.filter(l => l.childType === 'recipe')`. Vacío: "Sin sub-recetas."
3. **"Packaging"** (acento info/azul, icono `ShoppingBag`) — `packagingLines = lines.filter(l => l.childType === 'packaging')`. Vacío: "Sin envases. Añade la caja, bolsa, etc."

Si el plato no tiene NINGUNA línea, solo se muestra la sección "Ingredientes" (con hint distinto); en cuanto hay ≥1 línea, se muestran las tres siempre (aunque estén vacías individualmente).

Cada sección tiene: cabecera con icono+título+contador (`· N`), y botón "+" (fondo terracota) que abre el alta filtrada a ese `kind` (`openAdd(kind)`).

**Cada línea individual** (`renderLine`), de izquierda a derecha:
- **Punto de estado** (30×30px, círculo interior): rojo (`bg-danger`) si `line.needsReview` (línea no medible: unidad sin conversión); ámbar (`bg-warning`) si `line.childNeedsReview` (ingrediente sin terminar); terracota si ok.
- **Cantidad NETA editable inline** (lo que va al plato, campo primario — E3): botón que muestra `formatQty(netQty) + unitAbbr`; clic → input de texto (`inputMode="decimal"`, autofocus, seleccionado). Enter/blur → `commitEdit(line)`:
  - Valida número ≥ 0; si inválido, `editError` (3s) y no guarda.
  - Calcula `waste = effectiveWastePct(line)` y `gross = grossFromNet(net, waste)` (fórmula cliente: `bruto = neto / (1 - merma/100)`, o `= neto` si `waste<=0` o `>=100`).
  - Optimista: actualiza `lines` local antes de la respuesta del servidor.
  - `updateLine(line.lineId, { quantityNet: net, quantityGross: gross })` → `recipeLineService.ts` → `.from('recipe_line').update(...)`, tras lo cual recalcula el coste del padre vía `recomputeRecipeItem(parentItemId)` (RPC `kitchen_recompute_item`).
  - Refresca con `getRecipeBreakdown(recipeId)` (RPC `kitchen_recipe_breakdown`), dispara "latido" (`triggerLatido`) y `econReloadTick++`.
  - Si falla: revierte `lines` al estado previo, muestra `editError` (4s).
  - Escape cancela sin guardar.
  - Si `prodFactor !== 1` (vista de producción), el campo se muestra como texto no editable (`title="Cantidad escalada (vista de producción)"`).
- **Nombre del ingrediente** (`line.childName`), con chips inline:
  - "sin terminar" (ámbar, `AlertTriangle`) si `line.childNeedsReview`.
  - "falta convertir la unidad" (rojo, `AlertTriangle`) si `line.needsReview` — **clicable** (navega a `/kitchen?item=<childItemId>&return=<recipeId>`) si `recipeId` existe; si no, es un `<span>` no clicable con el mismo texto.
  - **Chip de merma** (E3, solo si `!scaled`):
    - Si `waste > 0`: chip "↘ merma X%" (fondo `accent-bg`), clic → `openWaste(line)` (abre panel expandido).
    - Si `waste === 0` y hay `aiSuggestion` pendiente para esa línea: chip ámbar "IA sugiere X% · aplicar" (icono `Sparkles`), clic → `applyAiWaste(line, pct)`.
    - Si está consultando IA para esa línea (`aiWasteLineId === line.lineId`): chip "consultando IA…" con spinner.
    - Si no hay nada: botón fantasma "+ merma" (visible siempre en móvil; en desktop solo al hover del grupo o focus), clic → `openWaste(line)`.
- **Barra de proporción visual** (solo desktop, `!isMobile`): barra de 38px con relleno terracota proporcional a `lineCost / maxLineCost` (cálculo cliente).
- **Coste de línea**: `formatEur(dispCost)` en monoespaciada; si `line.needsReview` muestra "—" en rojo (nunca "0,00 €", para no disfrazar un cero) con tooltip explicando la falta de conversión; si tiene merma, tooltip muestra "Coste sobre bruto X unidad".
- **Botón borrar** (icono `Trash2`, solo si `!scaled`): `handleDelete(line)` → `window.confirm(...)` → optimista quita la línea de `lines`, `deleteLine(line.lineId)` (`.from('recipe_line').delete()` + recompute del padre) → refresca con `getRecipeBreakdown`, `econReloadTick++`. Si falla, revierte y muestra `editError` (4s).
- **Panel expandido de merma** (si `wasteOpenLineId === line.lineId`, solo si `!scaled`): input numérico (%) → Enter/blur → `commitWaste(line)`:
  - Valida `0 ≤ waste < 100`; si inválido, `editError` (3s).
  - Calcula `gross = grossFromNet(net, waste)`, guarda igual que `commitEdit` (misma llamada `updateLine`), refresca y latido.
  - Si `waste === 0`: botón "Sugerir con IA" (icono `Sparkles`/`Loader2`) → `suggestWasteAI(line)`: llamada individual a `streamMessage()` (edge `folvy-ai`, surface `background`) pidiendo un único número de merma típica para ese ingrediente; extrae el primer número de la respuesta con regex; si válido, guarda en `aiWasteSuggestions[lineId]` (no persiste hasta aplicar).

**Alta de ingrediente/sub-receta/packaging (E2a/E2b)** (`addOpen`), panel inline con 3 pasos:

1. **Paso 1 — Buscador** (`!addPicked && !addCreating`):
   - Input de búsqueda (autofocus) + botón cerrar (`closeAdd()`).
   - Al abrir (`openAdd(kind)`), si no se han cargado datos: `listRecipeItems({accountId, includeInactive:false})` filtrado a `raw|recipe|packaging` (según `addKind`) + `listUnits({})`, y en paralelo (no bloqueante) `getRawUsageCounts(accountId)` (RPC `kitchen_raw_usage_counts`) para el orden por uso real; si falla el orden por uso, `usageNotice` = "No se pudo ordenar por uso (orden alfabético)." sin bloquear el alta.
   - `candidates` (cálculo cliente, `useMemo`): filtra por `type === addKind`, por tokens de búsqueda (`matchesTokens` — todas las palabras, cualquier orden, sin acentos, sobre `name`+`code`), ordena por `usageCounts` descendente y luego alfabético, tope 8.
   - Cada candidato muestra: nombre (+"(preparación)" si `type==='recipe'`), código+coste por unidad base (`formatEurPrecise`, hasta 4 decimales) o "sin coste", "· ya en la receta" si `existingChildIds.has(item.id)`, y "en N platos" si tiene uso.
   - Búsqueda vacía: etiqueta "Más usados en tus platos" sobre la lista.
   - Sin resultados: "Sin coincidencias…" + botón "Crear «X» como {kind} nuevo" (excepto para `addKind==='recipe'`, que no permite crear al vuelo).
   - Con resultados: al final, botón "¿No está? Crear «X» como nuevo" (mismo excepto para `recipe`).
2. **Paso 2b — Crear nuevo** (`addCreating`, `openCreate()`):
   - Formulario: nombre (prellenado con el texto buscado), selector de unidad base agrupado por dimensión (`unitsGrouped`, optgroups Peso/Volumen/Unidades vía `DIM_LABEL`), coste opcional (€/unidad).
   - `confirmCreate()`: valida nombre y unidad obligatorios; coste opcional debe ser ≥0 si se rellena. `createRecipeItem({..., type: addKind==='packaging'?'packaging':'raw', costStrategy:'fixed', fixedCost: cost, source:'manual', needsReview:true, createdBy, createdByName})` (`.from('recipe_item').insert(...)` + recompute automático). El creado queda seleccionado y pasa al Paso 2 para indicar cantidad.
   - Nota fija: "Se marcará para revisar; completa coste y formato cuando puedas."
3. **Paso 2 — Cantidad + preview** (`addPicked`):
   - Input de cantidad (unidad base fija del ingrediente, `baseUnitAbbr(item)`), botón "Añadir" (deshabilitado si `!previewValid`), botón X para volver al buscador.
   - **Preview de impacto exacto** (cálculo cliente, sin llamada al servidor): `previewLineCost = costPerBase(addPicked) * previewNum` donde `costPerBase(item) = item.computedCost ?? item.fixedCost ?? 0`. Muestra "+€X · el plato pasaría a €(totalCost+previewLineCost)". Es EXACTO porque usa la unidad base (sin conversiones); no es el caso general de E3 (que sí permite conversión).
   - `confirmAdd()`: `listLinesByParent(recipeId)` (para calcular `position = max+1`) → `addLine({accountId, parentItemId, childItemId, quantityNet:num, quantityGross:num, unitId: picked.baseUnitId, position})` (`.from('recipe_line').insert(...)` + recompute del padre) → refresca con `getRecipeBreakdown`, latido, `econReloadTick++`, y vuelve al buscador (listo para añadir otro).

**Modal B2 anti-duplicados** (`review` state, si `review && activeAccountId`): renderiza `<RecipeImportReviewModal>` — ver Modales. **Nota de scope**: este modal, y todo el flujo de importar ficha (botón, input oculto, modal de progreso, modal de error), solo existen dentro del bloque JSX de la pestaña 'escandallo' — si el usuario cambia de pestaña mientras la IA está extrayendo, el flujo pierde su punto de montaje.

**Modal de progreso/resultado de importación** (`importStage !== 'idle'`, overlay fijo):
- `uploading`/`reading`: spinner + "Subiendo la ficha…" / "Leyendo tu ficha con IA…".
- `done` (tras completar el modal de revisión): resumen — nombre del plato, "N ingrediente(s) en el escandallo", si `newArticlesCreated>0` aviso de cuántos ingredientes nuevos se crearon (marcados para completar coste/proveedor), si `linesSkipped>0` aviso ámbar de líneas sin cantidad/unidad clara. Botón "Ver escandallo" cierra el modal (`closeImportModal`).

**Modal de error de importación** (`importError`, overlay fijo, clic fuera cierra): icono `AlertTriangle` + mensaje + botón "Cerrar".

### Columna derecha — "Coste en vivo"

- **Título de sección**: "Coste en vivo" (uppercase, pequeño).
- **Etiqueta**: "Plate cost" si `packagingCost > 0`, si no "Coste total".
- **Cifra hero**: `formatEur(totalCost * prodFactor)` en 34px monoespaciada, con animación de escala (`scale-110`) 800ms al latir (`flashHero`). `totalCost = lines.reduce((acc,l) => acc + (l.lineCost ?? 0), 0)` — **cálculo 100% cliente** sobre las líneas ya traídas por `getRecipeBreakdown`.
- **Subtítulo**: "por porción · N ración(es)", `N = Math.round((recipe.yieldPortions ?? 1) * prodFactor)`.
- **Aviso "Coste incompleto"** (solo si `unconvertibleLineCount > 0`, `= lines.filter(l => l.needsReview).length`): chip ámbar "Coste incompleto · falta convertir N línea(s)", tooltip explicando que el total infra-cuenta.
- **Desglose Comida/Packaging** (solo si `packagingCost > 0`): dos filas — "Comida" = `foodCost * prodFactor` (`foodCost = totalCost - packagingCost`), "Packaging" = `packagingCost * prodFactor` (`packagingCost = packagingLines.reduce(...)`). Todo cálculo cliente sobre `lines`.
- **Separador.**
- **Bloque "Food cost" por marca/canal** (`economics`, cargado con `listMenuItems({accountId})` filtrado a `mi.recipeItemId === recipeId`, luego por cada marca distinta `getMenuItemEconomics(brandId)` — RPC `menu_item_economics(p_brand_id)` — filtrado de nuevo a `recipeItemId===recipeId`; nombres de marca vía `listBrands({accountId})`; efecto con dep `[accountsLoading, activeAccountId, recipeId, econReloadTick]`):
  - Si `econLoading`: "Calculando food cost…".
  - Si `economics.length === 0`: "Este plato aún no está en ninguna carta. Añádelo para ver su food cost y margen." + botón **"Añadir a carta"** (icono `Plus`) → `setShowAddToMenu(true)`.
  - Si hay filas: agrupadas por marca (`econByBrand`, ordenadas: `flowType==='own'` primero, luego alfabético por nombre de marca), cada grupo:
    - Cabecera clicable (colapsa/expande, `collapsedBrands[brandId]`, por defecto colapsado si `flowType==='licensed'`): chevron, nombre de marca, chip "cedida" (ámbar) o "propia" (verde) según `flowType`, y si colapsado, "N canal(es)" a la derecha.
    - Filas por canal (si expandido): icono según `channelIcon(channelName)` (heurística por palabras: "local/shop/tienda/sala"→`Store`, "glovo/uber/just/deliver"→`Bike`, si no→`ShoppingBag`), nombre del canal, y a la derecha:
      - Si es marca cedida (`licensed`): `formatPct(e.revenueSharePct)` + "cesión" (color texto neutro).
      - Si es propia: `formatPct(e.foodCostPct)` coloreado por `statusColor(e.foodCostStatus)` (verde si `'under'`, rojo si `'over'`, gris si otro) — o "s/objetivo"/"sin coste" si `mainValue` es null.
      - Debajo, si `e.netMargin != null`: "margen €X" en gris pequeño.
      - Debajo (solo si NO licensed y `packagingCost>0` y `e.plateCostPct != null`): "plate X%" coloreado por `statusColor(e.plateCostStatus)`.
- **Separador.**
- **"Platos de venta que usan esta receta"** (`usedByItems`, cargado con `listMenuItemsUsingRecipe(recipeId)` — `.from('menu_item').select('id,name,brand_id').eq('recipe_item_id', recipeId).is('archived_at', null)`; efecto dep `[recipeId, reloadTick, activeAccountId]`). Solo se renderiza si `usedByItems !== null` (evita parpadeo mientras carga):
  - Vacío: "Ningún plato de la carta usa este escandallo todavía."
  - Con filas: lista clicable, cada fila navega a `/kitchen/casado?item=<id>` (cockpit "Casado"). Nombre + **sello de casado** por ítem: `usedByHealth` (mapa cargado con `getMenuItemLinkHealth(activeAccountId)`, RPC `menu_item_link_health`) clasificado con `classifyMenuItemLink(h)` de `menuLinkService.ts` — 5 estados humanos posibles: `bien` (verde, "Confirmado por oficina"), `para_revisar` (ámbar), `falta_escandallo`/`falta_precio` (naranja), `sin_casar` (rojo). El chip muestra `meta.label` con color por `meta.tone`.

## Pestaña "Receta" (`RecipeStepsTab.tsx`, 656 líneas)

Prop: `recipeItemId`.

- **Cabecera**: icono `ListOrdered`, "Pasos de elaboración" + "· N paso(s)" (si hay pasos). Toggle **Ver/Editar** (solo si `steps.length > 0`): por defecto abre en `'view'` si ya hay pasos, `'edit'` si está vacía (se decide al cargar).
- **Carga**: `listStepsByRecipe(recipeItemId)` → `.from('recipe_item_step')`. En paralelo: `getRecipeAccountId(recipeItemId)` (para subir media) y `getStepMediaMap(recipeItemId)` (media de foto/vídeo por paso), resolviendo URLs firmadas para archivos subidos (`getStepMediaSignedUrl`, `.storage.from(STEP_MEDIA_BUCKET).createSignedUrl(...)`); los enlaces externos (http/https) se usan tal cual sin firmar.
- **Vacío**: caja punteada "Aún no hay pasos…" + botón "Añadir primer paso" → `handleAddStep()` → `createStep({recipeItemId, text:'', position: steps.length})` (`.from('recipe_item_step').insert`).
- **Modo VER**: tarjetas de solo lectura, numeradas, con texto del paso (o "Paso sin texto" en cursiva si vacío), chips de duración (`Clock`, "N min") y temperatura (`Thermometer`, "N °C") si existen, y la foto/vídeo del paso si hay (imagen 28×28 inline o enlace "Ver foto"/"Ver vídeo" si es URL externa; vídeo con controles nativos si es archivo subido).
- **Modo EDITAR** (por paso):
  - Número + botones **subir/bajar** (`ChevronUp`/`ChevronDown`, deshabilitados en extremos) → `handleMove(index, dir)`: reordena localmente y persiste con `reorderSteps(orderedIds)`; si falla, recarga desde servidor.
  - `<textarea>` del texto → `onBlur` → `handleSaveText(step)` → `updateStep(step.id, {text})`.
  - Input numérico de duración (min) y de temperatura (°C) → `onBlur` → `handleSaveNumber(step, field, value)` → `updateStep(step.id, {[field]: value})`.
  - Indicador "Guardando…" (spinner) mientras `busyId === step.id`.
  - **Foto del paso**: si no hay, label "Añadir foto" (input file oculto, valida tipo JPG/PNG/WebP y tamaño ≤10MB) → `handleUploadMedia(step,'photo',file)` → `uploadStepMedia(accountId, step.id, 'photo', file)` (sube al bucket `STEP_MEDIA_BUCKET`) → `setStepMedia` guarda el path. Si hay foto: miniatura 20×20 + botón "Quitar foto" (`handleRemoveMedia`, borra del storage vía `removeStepMedia`).
  - **Vídeo del paso**: opción "Subir vídeo" (valida MP4/WebM/MOV, ≤50MB) o "Pegar enlace" (input URL que debe empezar por `http(s)://`) → `handleSaveVideoLink(step)` → `setStepMedia(step.id, 'video', url)`. Si hay vídeo: reproductor nativo o enlace externo + botón "Quitar vídeo".
  - **Borrar paso**: icono papelera → confirmación inline (2 botones "Borrar"/"Cancelar", sin `window.confirm`) → `handleDelete(id)` → `deleteStep(id)`.
  - Botón final "Añadir paso" (`handleAddStep`).
- **Fuente de datos**: `recipeStepService.ts` — tablas `recipe_item_step`, `recipe_item_step_line` (esta última tiene funciones exportadas `setStepLines` pero NO se usa desde esta pestaña hoy), bucket de storage para media (constante `STEP_MEDIA_BUCKET`).

## Pestaña "Modificadores" (`ModifierImpactsTab.tsx`, 778 líneas)

Props: `recipeItemId`, `accountId` (= `activeAccountId ?? ''`), `actorName` (= `userProfile?.displayName ?? 'Usuario'`).

- **Filosofía del producto** (documentada en el código): el modificador es un cambio de preparación en lenguaje natural ("SALE esto → ENTRA esto"), nunca jerga técnica en pantalla; el coste NO cambia hasta que un humano confirma (`status='confirmed'`); el sistema no vuelve a preguntar lo ya confirmado.
- **Carga**: `listOptionsByRecipe(recipeItemId, accountId)` — usa `.from('modifier_group_assignment')` + `.from('modifier_recipe_impact')` internamente. Autónomamente carga también `ingredients` (`listRecipeItems({accountId, includeInactive:false})` filtrado a raw/recipe, salvo que el padre ya se los pase por prop) y `units` (`listUnits({})`), buscando además el id del gramo (`unitGramId`) para crear ingredientes al vuelo.
- Si `options.length === 0`: caja punteada "Este plato no tiene grupos de modificadores en su carta."
- **Cabecera de cobertura**: contador "N conocidos" (verde, `CircleCheck`), "N por revisar" (ámbar, si >0), "N% cobertura" — todo cálculo cliente (`coverage = useMemo` sobre `options`, `confirmed = status==='confirmed'`).
- **Botón "Sugerir con IA"** (solo si `coverage.pending > 0`): `handleSuggestAI()` → `requestAIProposals(accountId, recipeItemId)` → fetch directo (Bearer token) a la Edge Function **`propose-modifier-impacts`** (`${VITE_SUPABASE_URL}/functions/v1/propose-modifier-impacts`). Escribe propuestas con `status='proposed'` (no toca coste). Resultado textual: "La IA propuso N modificador(es)…" o "La IA no encontró nada claro…".
- **Agrupado por grupo de modificador** (`groups`, cliente): cabecera con nombre del grupo + "elige N" o "elige N–M" (`minSelections`/`maxSelections`).
- **Tarjeta de opción** (`OptionCard`), borde verde sutil si `confirmed`, punteado si sin impacto:
  - Nombre de la opción + chip de suplemento (`+X,XX €`, `priceImpact`).
  - Badge "Confirmado" (verde) o "Propuesta IA" (`Sparkles`, ámbar).
  - Si es propuesta con `rationale`: caja con el razonamiento de la IA.
  - **Resumen del impacto** (`ImpactSummary`, sin jerga): "Sin definir" (itálica) si no hay impacto; `add_item`/`bundle` → chip verde "+ ingrediente [· cantidad]"; `remove_item` → chip rojo "− ingrediente"; `replace_item` → chip verde + "(sustituye al ingrediente base)"; `multiply` → "Multiplica la receta ×N"; con aviso ámbar "sin terminar — su coste aún no cuenta" si el ingrediente objetivo tiene `needsReview`.
  - Acciones: **"Ajustar"/"Definir"** (abre editor inline), y si es propuesta: **"Descartar"** (`handleReject` → `rejectImpact(impact.id)`) y **"Confirmar"** (`handleConfirm` → `confirmImpact(impact.id, actorName)` + `recomputeAffectedSales(accountId, optionId)` — recorre `sale_line` con ese `modifier_option_id`, y por cada línea padre afectada llama RPC `compute_sale_line_cost`).
  - **Modo Ajustar** (`ImpactEditor`):
    - Selector "Esta opción [añade|quita|cambia (sustituye)|multiplica el plato|no cambia nada]" (`impactType`).
    - Si necesita ingrediente: buscador con picker (matches por nombre normalizado, tope 8) + opción **"¿No está? Crear «X» como nuevo"** → `handleCreateIngredient(name)` → `createRecipeItem({accountId, type:'raw', name, baseUnitId: unitGramId, source:'manual', needsReview:true, createdByName})` (nace sin coste, marcado para revisar).
    - Si necesita cantidad: input numérico + selector de unidad (excepto para `multiply`, que solo pide el factor).
    - **Latido de coste en vivo** (server-side, debounce 350ms): `previewImpactCost({recipeItemId, impactType, targetRecipeItemId, quantity, unitId})` → RPC `preview_modifier_impact_cost` (misma lógica `_impact_cost` que el guardado real, así que el preview siempre coincide con lo que se guardará). Muestra "Coste del plato": base → delta (+/−) → total; si `totalCost == null`, aviso ámbar "El plato o el ingrediente no tienen coste todavía — no puedo calcular el latido."
    - "Guardar y confirmar" (`onSave`, deshabilitado si falta ingrediente cuando se requiere) → `handleSaveManual` → `upsertImpact({..., status:'confirmed', source:'human', actorName})` (`.from('modifier_recipe_impact')`) + `recomputeAffectedSales`.

## Pestaña "Etiquetado"

**No implementada.** Cae en la rama por defecto del switch de pestañas (líneas 2635-2640 del archivo
principal): muestra únicamente el texto centrado "Solapa «Etiquetado» — pendiente." No hay componente,
no hay estado, no hay servicio asociado desde esta pantalla.

## Pestaña "Histórico" (`RecipeHistoryTab.tsx`, 296 líneas)

Props: `recipeItemId`, `createdByName` (= `userProfile?.displayName ?? null`), `onRestored` (callback:
al restaurar, el padre hace `reloadTick++` y `econReloadTick++`).

Modelo **hito manual + snapshot recuperable** (comparable a meez/Apicbase), con el diferenciador de
guardar el coste por versión para mostrar el **impacto económico** del cambio, no solo qué ingrediente
cambió.

- **Carga**: `listRecipeVersions(recipeItemId)` → `.from('recipe_item_version')`; en paralelo `listUnits({})` para abreviaturas.
- **Bloque "Guardar versión"**: input "Etiqueta (opcional)", input "Qué cambió (opcional)", checkbox "Marcar como hito" (icono `Star`), botón "Guardar versión" → `handleSave()` → `createRecipeVersion(recipeItemId, {label, note, isMilestone, createdByName})` → RPC `create_recipe_version`.
- **Lista de historial**: cada versión muestra `v{versionNumber}`, badge "Hito" con `milestoneLabel` si `isMilestone`, badge "actual" si `validTo === null` (es la versión activa = referencia del diff), fecha+autor (`fmtDate`+`createdByName`), coste (`fmtEur(computedCost)`) a la derecha, y `changeNote` si existe.
  - **"Comparar con la actual"** (solo si hay `diff`, es decir si no es ya la activa): expande/colapsa (`expandedId`) un panel con `diffSnapshots(v.snapshot, active.snapshot)` — **función 100% cliente**, sin llamada a servidor: compara los `lines` de dos snapshots JSON (`RecipeVersionSnapshot`) y calcula `costDelta`/`costFrom`/`costTo` y un array de diffs por línea (`added`/`removed`/`changed`) con cantidad neta/bruta y unidad. Se pinta: "Coste: X → Y [+/−Δ]" y por cada línea, icono `Plus`(verde)/`Minus`(rojo)/`ArrowRight`(ámbar) + nombre + "nuevo · cantidad" / "quitado · cantidad" / "cantidad_antes → cantidad_después".
  - **"Restaurar"** (icono `RotateCcw`, solo si no es la versión activa): confirmación inline ("¿Restaurar vN?" Sí/No, sin `window.confirm`) → `handleRestore(v)` → `restoreRecipeVersion(v.id, createdByName)` → RPC `restore_recipe_version` (con red: hace snapshot del estado actual antes de restaurar, según el comentario del servicio) → recarga versiones y llama `onRestored()` (que hace que el editor recargue plato+líneas+coste).
- Vacío: "Aún no hay versiones. Guarda la primera cuando esta receta esté como quieres."

## "Más ▾" — contenido real (verificado)

**No hay contenido.** Como se detalló arriba, `'mas'` no tiene rama propia en el switch de la pestaña
activa; cae exactamente en el mismo `else` genérico que "Etiquetado" y muestra el texto centrado
"Solapa «Más» — pendiente." El icono `ChevronDown` en el tab-label es el único indicio visual de que
"debería" ser un desplegable, pero en el código actual es simplemente otra pestaña plana, sin
submenú, sin popover, sin ningún array de opciones asociado. No hay ningún otro archivo en el repo que
inyecte contenido en esta pestaña desde `RecipeEditorPage.tsx`.

## Modales / diálogos (editor de escandallo)

1. **Confirmar eliminar/archivar el plato** (`deleteOpen`, overlay fijo, clic fuera cierra si no está ocupado):
   - Al abrir: `openDeleteDialog()` → `checkItemDeletable(recipe.id)` (RPC `kitchen_item_delete_check`) → `deleteCheck = {deletable, reasons[], name, type}`.
   - Mientras `deleteCheck === null`: "Comprobando…" con spinner.
   - Si `deletable`: icono papelera roja, "¿Eliminar «nombre»?", "Se eliminará definitivamente. Esta acción no se puede deshacer."
   - Si NO `deletable` (branching real, no cosmético): icono `Archive` ámbar, "«nombre» está en uso", "No se puede eliminar porque: {reasons.join(' · ')}. Se archivará en su lugar (podrás recuperarlo)."
   - Botón de acción cambia texto/color según el caso: "Eliminar" (rojo) vs "Archivar" (accent) → `confirmDelete()` → `deleteOrArchiveItem(recipe.id)` (RPC `kitchen_delete_or_archive_item`, re-evalúa en servidor sin fiarse del check de la UI; borra o archiva según corresponda) → cierra el modal y `onBack?.()`.
   - Error de comprobación o de acción: banner rojo inline (`deleteError`).
2. **Lightbox de foto del plato** (`photoLightbox`, overlay negro 80%): imagen a tamaño completo, botón X para cerrar, clic fuera de la imagen también cierra.
3. **Añadir a carta** (`showAddToMenu`, `AddToMenuModal.tsx`, 387 líneas): dos modos conmutables ("Crear nuevo" / "Enlazar existente"):
   - **Crear nuevo**: selector de marca (`listAccountBrands(accountId)` — si solo hay 1 marca, se preselecciona), nombre visible al cliente (prellenado con `recipeName`), precio sin IVA (parseado con coma decimal), IVA (10%/4%/21%/0%), categoría opcional (`listMenuCategories(accountId, brandId)`, recargada al cambiar de marca). `handleCreate()` → `addRecipeToBrand({...})` (crea `menu_item` base con `channel_id NULL`, enlazando `recipe_item_id`) + `setMenuItemCategory` si se eligió categoría (no bloqueante si falla). Nota: "El precio por canal se ajusta luego en «Editar precios»."
   - **Enlazar existente**: buscador con debounce (250ms) sobre `listLinkableMenuItems(accountId, search)` (productos de la carta SIN escandallo aún), ordenados por parecido de nombre a la receta (`similarity()`, heurística cliente: igual=0, uno contiene al otro=1, si no=2). Selección única → `handleLink()` → `updateMenuItem(selectedLinkId, { recipeItemId: recipeId })`.
   - Si la cuenta no tiene marcas: aviso ámbar "Esta cuenta aún no tiene marcas. Crea una marca antes de añadir productos a la carta." (anti-invención, no se crea nada por defecto).
   - Al terminar con éxito: `onDone()` → cierra el modal y `econReloadTick++` en el padre.
4. **Revisar receta importada** (`RecipeImportReviewModal.tsx`, 473 líneas, anti-duplicados B2), abierto tras `extractRecipeSession`:
   - Carga en paralelo: mapa de coste (`listRecipeItems` raw+recipe) + `listUnits`, y por cada línea parseada busca candidatos con `findIngredientMatches(accountId, rawText, 6, 0.2)` → RPC `run_mapping` (`p_target_types: ['raw','recipe']`).
   - **Preselección por umbral**: `PRESELECT_CONFIDENCE = 0.85` — si el mejor candidato supera ese umbral, la línea nace resuelta (verde) automáticamente; si no, obliga a elegir a mano.
   - Cada línea, colapsada si resuelta: "Usando [nombre] · [coste]" (verde) o "Se creará nuevo · sin coste, lo completa Pamela" (ámbar) + botón "Cambiar"/"Buscar existente".
   - Picker abierto: lista de candidatos difusos (`run_mapping`) + buscador libre que combina **literal** (`listRecipeItems({type:'raw', search})`, `ilike`) con **difuso** (`run_mapping` de nuevo), literales primero sin duplicar; botón "Crear nuevo" por línea (`chooseNew`).
   - **No se puede "Terminar y crear"** hasta que TODAS las líneas estén resueltas (`allResolved`), contador "N de M resueltos" en el pie.
   - `handleFinish()` → construye `ImportDecisions` (clave = nombre normalizado, valor = uuid existente o `null` para nuevo) → `materializeRecipeSession(sessionId, rows.length, decisions)` → RPC `materialize_recipe_session` (vuelca a `recipe_item`(dish)+`recipe_line`; respeta las decisiones humanas con prioridad sobre cualquier `mapping_proposal` previa) → `onCompleted(result)` cierra este modal y abre el modal de resultado "done" en la pantalla principal.
5. **Modal de progreso de importación** (2 estados: `uploading`/`reading`) y **modal de resultado** (`done`), y **modal de error de importación** — descritos arriba en la pestaña Escandallo (todos overlays fijos, `fixed inset-0 z-50`).

## Estado (`useState`) no puramente transitorio, y qué lo carga

| Estado | Carga / origen |
|---|---|
| `recipe` | `getRecipeItemById(recipeId)` |
| `lines` | `getRecipeBreakdown(recipeId)` (RPC `kitchen_recipe_breakdown`) |
| `photoUrl` | `getDishPhotoUrl(recipe.kitchenPhotoUrl)` |
| `usedByItems` | `listMenuItemsUsingRecipe(recipeId)` |
| `usedByHealth` | `getMenuItemLinkHealth(activeAccountId)` (RPC `menu_item_link_health`) |
| `economics` | `listMenuItems` + `getMenuItemEconomics(brandId)` por marca (RPC `menu_item_economics`) |
| `brandNames` | `listBrands({accountId})` |
| `collapsedBrands` | derivado de `econByBrand` (default: colapsado si `flowType==='licensed'`) |
| `addableItems`, `units`, `unitsById` | `listRecipeItems` + `listUnits` (al abrir el alta) |
| `usageCounts` | `getRawUsageCounts(accountId)` (RPC `kitchen_raw_usage_counts`) |
| `deleteCheck` | `checkItemDeletable(recipe.id)` (RPC `kitchen_item_delete_check`) |
| `aiWasteSuggestions` | respuestas de `streamMessage` (edge `folvy-ai`), no persistidas hasta aplicar |
| Resto (`editingLineId`, `draftQty`, `flashLineId`, `addOpen`, `deleteOpen`, `showAddToMenu`, `review`, `importStage`, `prodFactor`, etc.) | estado transitorio de interacción/UI, sin carga de servidor propia |

## Efectos (`useEffect`) — 6 en total, con disparadores

1. **L360-393**: `Promise.all([getRecipeItemById, getRecipeBreakdown])` → `recipe`+`lines`. Deps: `[accountsLoading, activeAccountId, recipeId, reloadTick]`. `reloadTick` se incrementa tras: guardar nombre, "dar por revisado", terminar import (B2), restaurar versión.
2. **L397-425**: `listMenuItemsUsingRecipe` → luego `getMenuItemLinkHealth`. Deps: `[recipeId, reloadTick, activeAccountId]`.
3. **L429-476**: `listMenuItems` (filtrado por `recipeId`) → `listBrands` (nombres) + `getMenuItemEconomics` por marca. Deps: `[accountsLoading, activeAccountId, recipeId, econReloadTick]`. `econReloadTick` se incrementa tras: editar/añadir/borrar línea, editar merma, importar (B2), "Añadir a carta", restaurar versión.
4. **L481-498**: `getDishPhotoUrl(recipe.kitchenPhotoUrl)` → `photoUrl`. Deps: `[recipe?.kitchenPhotoUrl]`.
5. **L530-533**: resetea `prodFactor=1`/`prodTargetText=''` al cambiar de receta. Deps: `[recipeId]`.
6. **L749-758**: inicializa `collapsedBrands` por defecto (licensed=colapsado) cuando aparecen grupos nuevos en `econByBrand`. Deps: `[econByBrand]` (memo derivado de `economics`+`brandNames`, no una llamada de red).

## Referencia de servicios y fuentes de datos exactas (confirmado en código)

- **`recipeItemService.ts`**: tabla `recipe_item`. RPCs: `kitchen_raw_usage_counts`, `kitchen_dishes_incomplete`, `kitchen_recompute_item`, `duplicate_recipe_item`, `kitchen_recompute_users_of`, `kitchen_item_delete_check`, `kitchen_delete_or_archive_item`.
- **`recipeLineService.ts`**: tabla `recipe_line`. RPC `kitchen_recipe_breakdown`.
- **`kitchenUnitService.ts`**: tabla `kitchen_unit`.
- **`menuItemService.ts`**: tabla `menu_item`, tabla `brand` (nombres), tabla `modifier_group_assignment`. RPC `add_existing_product_to_brand`, RPC `menu_item_economics`.
- **`menuLinkService.ts`**: RPCs `set_menu_item_recipe`, `clear_menu_item_recipe`, `approve_menu_item_link`, `menu_item_link_health`, `menu_item_shared_recipe_review`; lectura directa `.from('menu_item')` para `listMenuItemsUsingRecipe`. `classifyMenuItemLink` es 100% cliente (sin red).
- **`recipePhotoService.ts`**: bucket de storage (`BUCKET`) para `uploadDishPhoto`/`getDishPhotoUrl`/`deleteDishPhoto`.
- **`recipeImportService.ts`**: Edge Function `extract-recipe` (invoke), RPC `run_mapping`, tabla `mapping_proposal` (solo en la función legacy `resolveImportProposal`, ya no en el camino principal), RPC `materialize_recipe_session`.
- **`brandsService.ts`**: tabla `brand`.
- **`folvyAIService.ts`**: `streamMessage` → fetch directo (no `functions.invoke`, por streaming SSE) a `${VITE_SUPABASE_URL}/functions/v1/folvy-ai`, con reintentos (2), timeout 60s, backoff 500ms/1000ms en 502/503/504.
- **`modifierImpactService.ts`**: tablas `modifier_group_assignment`, `modifier_recipe_impact`, `menu_item`, `sale_line`. RPCs `compute_sale_line_cost`, `preview_modifier_impact_cost`. Edge Function `propose-modifier-impacts` (fetch directo con Bearer).
- **`recipeStepService.ts`**: tablas `recipe_item_step`, `recipe_item_step_line`, `recipe_item` (para `getRecipeAccountId`); bucket `STEP_MEDIA_BUCKET` para foto/vídeo.
- **`recipeVersionService.ts`**: tabla `recipe_item_version`. RPCs `create_recipe_version`, `restore_recipe_version`. `diffSnapshots` es 100% cliente.
- **`menuCategoryService.ts`** (usado por `AddToMenuModal`): categorías de menú (tabla no confirmada por grep directo, pero expuesta vía `listMenuCategories`/`createMenuCategory`/etc.).

## Cálculos puramente cliente (fórmulas, sin llamada a servidor)

- `totalCost = Σ line.lineCost` sobre `lines`.
- `foodCost = totalCost - packagingCost`; `packagingCost = Σ` de las líneas de tipo `packaging`.
- `grossFromNet(net, wastePct) = wastePct<=0||>=100 ? net : net / (1 - wastePct/100)`.
- `effectiveWastePct(line)`: si hay `quantity`(bruto) y `quantityNet` válidos y `bruto>neto`, `= round(((bruto-neto)/bruto)*1000)/10`; si no, cae a `childDefaultWastePct ?? 0`.
- `dishNeedsReview = recipe.needsReview || lines.some(l => l.childNeedsReview || l.needsReview)`.
- `unconvertibleLineCount = lines.filter(l => l.needsReview).length`.
- `previewLineCost` del alta E2a = `costPerBase(item) * cantidad` (exacto, unidad base sin conversión).
- Producción: `netQty/dispCost = valor_real * prodFactor` (vista, no persiste).
- `classifyMenuItemLink`, `diffSnapshots`, `matchesTokens`, `channelIcon`, `statusColor`, `similarity` (en `AddToMenuModal`) — todas funciones puras de cliente.

---

# HALLAZGOS TRANSVERSALES (las dos pantallas juntas — para decidir el rediseño)

1. **Solapamiento real de contenido entre ambas fichas — riesgo de duplicar si se funden sin cuidado**:
   - **"Coste calculado desde / Ver escandallo completo"** (S1 de la ficha de producto) y **"Platos de venta que usan esta receta"** (columna derecha del editor) son las DOS mitades de la misma relación bidireccional ítem↔escandallo — es el enlace natural para fundir en pestañas (una ficha → pestaña "Escandallo" que muestra ambas direcciones a la vez).
   - **La economía por canal existe en LAS DOS pantallas, con datos parcialmente distintos**: S2 de la ficha de producto (`getMenuItemChannelEconomics`, por canal de ESTE menu_item/marca) vs. la columna derecha del editor (`getMenuItemEconomics` por marca, agregando TODOS los menu_items de todas las marcas que comparten este `recipe_item`). Al fundir, hay que decidir cuál es la fuente única — probablemente conviene conservar ambos niveles (por canal de esta marca Y resumen cross-marca) pero dejarlo explícito, no fundirlos sin más.
   - **El sello de casado (`classifyMenuItemLink`)** aparece en 3 sitios distintos hoy: tarjeta de identidad de la ficha de producto, S1 de la misma ficha, y por cada fila de "Platos que usan esta receta" en el editor — los tres ya comparten la misma función de clasificación (correcto, es la única fuente), pero al fundir en una ficha hay que decidir dónde vive el sello "canónico" una sola vez.

2. **Pestañas reales vs. simuladas**: de las 6 pestañas del editor, **solo 4 tienen contenido real** (Escandallo, Receta, Modificadores, Histórico); **Etiquetado y "Más ▾" son placeholders vacíos** ("— pendiente."), sin ningún componente ni servicio detrás. La ficha de producto, en cambio, no tiene pestañas — sus 12 secciones son todas plegables y la mayoría SÍ tienen contenido real, salvo los stubs listados abajo.

3. **Inventario de "contenido no real" a decidir explícitamente en el rediseño** (implementarlo, quitarlo, o mantenerlo como placeholder consciente):
   - Ficha de producto: S1 tiles "Ingredientes"/"Pasos"/"Tiempo" (siempre "—"), S2 tile "Stock para" (siempre "—"), S5 alérgenos (los 14 siempre "no"), S6 "Proveedores" ("próximamente"), S7 "Ventas" (hardcodeado a "0", sin query), S11 "External ID" (siempre "—"), tabla de S3 (solo pinta una fila pese a las columnas Canal/Ubicación).
   - Editor de escandallo: pestaña "Etiquetado" completa, pestaña "Más ▾" completa, botones "Mic"/"Pedir a Folvy" (inertes).
   - Botones decorativos sin `onClick` en ambas pantallas: "Exportar", "···", los `AiButton` ("Mejorar descripción con IA", "Crear escandallo con IA", "Verificar alérgenos"), "Empezar con IA →", "Configurar en Ajustes".

4. **Confirmaciones inconsistentes**: la ficha de producto usa `ConfirmDialog` (componente Folvy) solo para "Quitar escandallo"; todo lo demás (borrar slot/opción de combo, quitar/borrar modificador) dispara sin confirmar. El editor de escandallo usa `window.confirm()` nativo en varios sitios (duplicar, borrar línea, dar por revisado) y confirmaciones inline sin modal en otros (borrar paso, restaurar versión). Al fundir, es buen momento para unificar todo a `ConfirmDialog`.

5. **Cargas de datos duplicadas/desincronizables** dentro de la MISMA pantalla (no solo entre las dos): grupos de modificadores en la ficha de producto (badge de solo lectura vs. copia editable de la sección) — ver nota en la Parte 1.

6. **Ambas pantallas cargan su propia copia de `getMenuItemLinkHealth`/`classifyMenuItemLink`** de forma independiente (la ficha de producto para SU ítem, el editor para TODOS los ítems que usan la receta) — al fundir en una sola ficha con pestañas, esto se puede consolidar en una única carga compartida entre pestañas.
