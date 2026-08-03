# Checklist Fase 7 — Ficha unificada de plato (Capa 1)

> Verificación línea por línea contra `docs/auditoria_ficha_producto_escandallo_2026-08-03.md`
> (670 líneas). Hecho leyendo el código NUEVO de verdad (no los mensajes de commit, aunque se citan
> como pista): `CatalogFichaPage.tsx`, `RecipeEscandalloTab.tsx`, `EconomiaTab.tsx`, `EnCartaTab.tsx`,
> `FichaTab.tsx`, `ModifierEditorSection.tsx`, `ComboEditorSection.tsx`, `EtiquetadoTab.tsx`,
> `RecipeStepsTab.tsx`, `ModifierImpactsTab.tsx`, `RecipeHistoryTab.tsx`,
> `ProductPlacementSection.tsx`, `RecipeLinkPickerModal.tsx`, `EditPricesModal.tsx`,
> `AddToMenuModal.tsx`, `RecipeImportReviewModal.tsx` — más `git diff main...HEAD` para confirmar
> qué ficheros "reutilizados tal cual" están de verdad byte-a-byte sin tocar.
>
> Regla de oro verificada: **"unificar no pierde nada"**. Sigue el orden de la auditoría (Parte 1 →
> Parte 2 → Hallazgos transversales), no el de las 8 pestañas nuevas, para que ningún elemento del
> inventario original quede fuera por no encajar limpiamente en la organización nueva.
>
> Referencia del plan citado en varias filas: `C:\Users\jgcol\.claude\plans\polished-sniffing-walrus.md`
> (en especial la "decisión 7", lista oficial de elementos muertos a eliminar sin mover a ningún
> sitio — se cita como "decisión 7 del plan" en las filas correspondientes).

---

## PARTE 1 — `CatalogProductDetailPage.tsx` (ficha del producto de venta)

### Estados de carga (auditoría L37-39)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 1 | Spinner "Cargando producto…" mientras `loading` (L38) | Movido a: estado de carga unificado — `CatalogFichaPage.tsx:545-551` (`Loader2` + "Cargando…", cubre a la vez producto y escandallo, ya no son dos frases separadas) | sí |
| 2 | `error` seteado o `item` null → botón volver + banner "Producto no encontrado." (L39) | Movido a: `CatalogFichaPage.tsx:552-576` (`itemError`/`recipeError` unificados; caso ambos-null → "No se encontró el producto ni el escandallo.") | sí |

### Barra superior (L41-44)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 3 | Botón volver "← Menú · {brandName}" → `onBack()` (L42) | Movido a: `CatalogFichaPage.tsx:684-688` — etiqueta ajustada a `backLabel` ("Cartas" si se entra por producto, "Platos" si se entra por receta) en vez de "Menú · marca", porque el anclaje ahora es dual (Menú/Casado/Recetas), no solo Menú. Mismo botón, mismo `onBack()`. | sí |
| 4 | Botón "Exportar" (icono Download), sin `onClick`, muerto (L43) | Retirado deliberadamente — decisión 7 del plan (elemento muerto explícito, sin destino) | sí |
| 5 | Botón "···" (MoreHorizontal), sin `onClick`, muerto (L44) | Retirado deliberadamente — decisión 7 del plan | sí |

### Banner de error de foto (L46-47)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 6 | Banner rojo descartable `photoError` (fallo subida/borrado foto pública) | Movido a: `FichaTab.tsx:263-270` (mismo patrón, botón X limpia `setPhotoError(null)`) | sí |

### Zona HERO — foto pública (L49-64)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 7 | `<input type="file">` oculto (`fileInputRef`) | Movido a: `FichaTab.tsx:262` | sí |
| 8 | Con foto: imagen a sangre completa, clic abre `PhotoLightbox` | Movido a (dos sitios, por diseño — ver decisión 5b del plan): vista de solo lectura en cabecera `CatalogFichaPage.tsx:694-695` + lightbox propio `584-586`; gestión completa con su propio lightbox en `FichaTab.tsx:274,282` + `243-245` | sí |
| 9 | Sin foto: placeholder degradado + botón "Añadir foto" → selector → `onPhotoSelected` (`uploadMenuPhoto`→`updateMenuItem`→`deleteMenuPhoto` best-effort→`refreshItem`) | Movido a: `FichaTab.tsx:271-296` (botón combinado "Añadir foto"/"Cambiar") + `onPhotoSelected` `FichaTab.tsx:81-102`, mismo flujo (subir, actualizar, borrar huérfano, refrescar) | sí |
| 10 | Degradado inferior decorativo sobre la foto | Movido a: `CatalogFichaPage.tsx:701` (gradiente bajo la foto del hero, vista) | sí |
| 11 | Badge de marca (círculo avatar, primera letra de `brandName\|\|category\|\|'P'`, sobre la foto arriba-izquierda) | ✅ CORREGIDO (revisión de Julio, cierre de Fase 7): movido a `CatalogFichaPage.tsx` (hero, junto al degradado inferior) — mismo avatar-letra + nombre, mismo condicional `brandName\|\|item?.category\|\|'P'`/`'Producto'` | sí |
| 12 | Botón "Cambiar" (solo si hay foto) → reabre selector | Movido a: `FichaTab.tsx:289-296` (mismo botón, texto condicional "Cambiar"/"Añadir foto") | sí |
| 13 | Botón borrar (papelera) → confirmación inline "¿Eliminar foto?" (Sí/Cancelar) | Movido a: `FichaTab.tsx:297-307` (botón "Eliminar") + confirmación **mejorada** a `ConfirmDialog` (Fase 6, B3) en `FichaTab.tsx:248-257`, en vez de la sustitución inline de botones del original | sí |

### TARJETA DE IDENTIDAD — modo vista (L68-82)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 14 | H1 nombre (`item.name`) | Movido a: `CatalogFichaPage.tsx:707` (`displayName`, cabecera, vista) | sí |
| 15 | Sello de salud del enlace (arriba-derecha del nombre), con label/tono/tooltip de `classifyMenuItemLink` | Movido a: `CatalogFichaPage.tsx:727-731` (`linkClassification`, badge con `title` = texto del sello) | sí |
| 16 | Línea "marca · categoría" | Movido a: `CatalogFichaPage.tsx:734-748` (además añade "· En carta/Agotado", dato nuevo pero coherente con `item.isAvailable`) | sí |
| 17 | Chips de tags (`item.tags[]`, estilos de `TAG_STYLES`: best-seller/nuevo/temporada/promocional) | ✅ CORREGIDO (revisión de Julio, cierre de Fase 7): movido a `CatalogFichaPage.tsx` (cabecera, bajo la línea marca·categoría·en carta) — `TAG_STYLES` recreado en el propio fichero, mismo mapeo de 4 tags + fallback neutro | sí |
| 18 | Precio grande mono `fmtEur(pvpSinIva)` + etiqueta "precio base sin IVA" | Movido a: `CatalogFichaPage.tsx:863-868` — pasa de vivir en la tarjeta de identidad a ser una de las "tres cifras honestas" de la cabecera ("PVP sin IVA"), con estados explícitos "…"/"Sin precio"/"Sin producto" en vez de un guion mudo (mejora, decisión de la Fase 1) | sí |
| 19 | Línea "PVP cliente {con IVA} · IVA {vatPct}%" | Movido a: `EconomiaTab.tsx:129-132` (tile "PVP cliente") — ya no vive en la cabecera, pasa a la pestaña Economía (coherente con el criterio de reparto del plan: dato del producto de venta) | sí |
| 20 | Párrafo de descripción (`item.description`), solo si existe | Movido a: `FichaTab.tsx:364-370` — cambia de "solo visible en modo vista" a "siempre editable" (textarea siempre presente, sin toggle vista/edición); ver también fila 24 (gap parcial en el error de guardado) | sí |
| 21 | Botón "Editar" (abre modo edición de nombre/precio/descripción) | Retirado deliberadamente — el patrón "modo vista/edición conmutable" (`editing` boolean con `openEdit()`) desaparece: `FichaTab.tsx` usa inputs siempre visibles con botón "Guardar" condicional a estar "sucio" (mismo patrón que notas/packaging). No hay ya un botón "Editar" independiente porque no hace falta — decisión de diseño de la Fase 4, verificada leyendo el componente completo. | sí |
| 22 | AiButton "Mejorar descripción con IA" — decorativo, sin `onClick`, muerto | Movido con mejora: cableado real (Fase 6, A1) en `FichaTab.tsx:352-361` (`improveDescriptionAI`, usa `streamMessage`, rellena `descriptionVal` como sugerencia editable, nunca auto-guarda) | sí |
| 23 | Si `!hasRecipe`: botón "Vincular escandallo" → `openRecipePicker()` | Movido a: `CatalogFichaPage.tsx:755-757` (cabecera, rama `sin_casar` de `linkClassification.human`) | sí |
| 24 | Si `hasRecipe`: "Cambiar escandallo"/"Quitar" (+ ConfirmDialog)/"Aprobar escandallo" si `canApprove` | Movido a: `CatalogFichaPage.tsx:777-796` (ramas `para_revisar`/`bien`) + `approveLink()`/`unlinkRecipe()`/`ConfirmDialog` "Quitar escandallo" en `601-610` | sí |
| 25 | Banner `linkError` bajo los botones de enlace | Movido a: `CatalogFichaPage.tsx:810` | sí |

### TARJETA DE IDENTIDAD — modo edición (L83-92)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 26 | Input "Nombre" (atado a `name`) | Movido a: `FichaTab.tsx:320-326` (`nameVal`) — recuperado en la Fase 4 tras haberse perdido por completo en la Fase 1 (ver comentario `FichaTab.tsx:176-182`, el propio "punto ciego 1" citado en el encargo) | sí |
| 27 | Input "Precio base (€ sin IVA)" (atado a `price`, `inputMode="decimal"`, acepta coma) | Movido a: `FichaTab.tsx:327-333` (`priceVal`), misma validación que el original (`saveIdentity()`, `FichaTab.tsx:212-227`: nombre no vacío, precio finito ≥0) | sí |
| 28 | Textarea "Descripción" (3 filas) | Movido a: `FichaTab.tsx:364-370` | sí |
| 29 | Banner `saveError` (validación o error de servidor) — cubría nombre+precio+descripción JUNTOS en una sola llamada `save()` | ✅ CORREGIDO (revisión de Julio, cierre de Fase 7): `identityError` (`FichaTab.tsx`) sigue cubriendo nombre+precio; la descripción recibe su propio `saveDescription()`/`descriptionError` con banner visible (antes solo `console.error` vía el `saveField` genérico) — mismo resultado (aviso visible en cualquier fallo de guardado), aunque como dos estados separados en vez de uno compartido | sí |
| 30 | Botón "Cancelar" (descarta el borrador) | Retirado deliberadamente (consecuencia de la fila 21: sin modo edición modal, no hay "cancelar" — el usuario simplemente no pulsa "Guardar"; los campos se re-siembran desde `item` vía `useEffect` en cada `item.id`/campo, `FichaTab.tsx:195-209`) | sí |
| 31 | Botón "Guardar" (spinner mientras `saving`) → `save()` → `updateMenuItem` → `refreshItem()` | Movido a: `FichaTab.tsx:336-344` (botón condicional a "sucio", `saveIdentity()`) | sí |

### SECCIONES PLEGABLES — cabecera de sistema de badges (nota transversal, no un elemento propio de una sección)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 32 | Sistema de badges por sección (`CollapsibleSection` con `badge`/`badgeColor`: S0 "{N} grupos", S1 label del sello, S2 "Mejor X%", S4 `groups.length`, S7 "0" hardcodeado) | Retirado deliberadamente — la UI pasa de acordeón (`CollapsibleSection`) a pestañas (`TABS.map`, `CatalogFichaPage.tsx:917-936`); las pestañas nuevas no llevan badge de ningún tipo en su label. Verificado leyendo el render de la barra de pestañas: solo `tab.label`, sin badge. El dato que cada badge resumía sigue disponible DENTRO de cada pestaña (S0→En carta, S1→cabecera "tres cifras", S2→Economía, S4→ninguno, S7→retirado con el resto de S7). | sí |

### S0 — "Grupos del combo" (L98-116)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 33 | Sección completa (visible solo si `isCombo`), estado "Cargando grupos…" | Movido a: `EnCartaTab.tsx:153-171` (pestaña "En carta") | sí |
| 34 | Panel de coste (3 tiles Coste/Margen/FC%, aviso ámbar "Coste incompleto" con detalle por slot, nota azul de coste provisional) | Movido a: `ComboEditorSection.tsx:136-183` (fichero extraído, mismo JSX) | sí |
| 35 | Estado vacío "Este combo no tiene grupos todavía…" | Movido a: `ComboEditorSection.tsx:185-189` | sí |
| 36 | Tarjeta por slot: nombre editable inline (blur/Enter guarda, Escape cancela) | Movido a: `ComboEditorSection.tsx:196-210` | sí |
| 37 | Checkbox "Obligatorio" (`minSelections`) | Movido a: `ComboEditorSection.tsx:213-216` | sí |
| 38 | Input "Elige hasta" (`maxSelections`) | Movido a: `ComboEditorSection.tsx:218-226` | sí |
| 39 | Botón borrar slot (Trash2), original sin confirmación | Movido con mejora: `ComboEditorSection.tsx:228-230` + **ConfirmDialog nuevo** (Fase 6, B4) en `303-312` — antes disparaba al instante, ahora confirma | sí |
| 40 | Lista de opciones: nombre solo lectura, checkbox "Defecto", input "+€" impacto precio, botón quitar (X) sin confirmación | Movido con mejora: `ComboEditorSection.tsx:238-257` (nombre, defecto, precio) + quitar con **ConfirmDialog nuevo** (Fase 6, B4) en `313-321`, antes sin confirmar | sí |
| 41 | Enlace "Añadir opción" → buscador inline (`searchOptionCandidates`), aviso "Combo sin marca; no se puede buscar." si `!brandId` | Movido a: `ComboEditorSection.tsx:260-292` | sí |
| 42 | Botón "Añadir grupo" | Movido a: `ComboEditorSection.tsx:298-301` | sí |
| 43 | Banner de error (`err`) por mutación fallida | Movido a: `ComboEditorSection.tsx:133` | sí |
| 44 | Patrón `wrap()` (busy → mutación → `reload()` → `onChanged`) | Movido a: `ComboEditorSection.tsx:70-73` (`reload`) + `EnCartaTab.tsx:72-76` (`reloadCombo`, prop `onChanged`) | sí |

### S1 — "Escandallo y elaboración" (L118-126)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 45 | Estado vacío "Sin escandallo vinculado…" + botón "Vincular escandallo" | Movido a: `CatalogFichaPage.tsx:755-757` (cabecera) + pestaña Escandallo vacía `1062-1064` ("Este producto todavía no tiene escandallo asignado.") | sí |
| 46 | AiButton "Crear escandallo con IA" (decorativo, muerto) | Deshabilitado con tooltip — reubicado a `CatalogFichaPage.tsx:767-774` (cabecera, rama `sin_casar`); motivo real en el `title` (decisión 4 del plan, Fase 6): el extractor `extract-recipe` es anti-invención (rechaza texto sin receta real), necesitaría trabajo de servidor nuevo para "redactar desde el nombre" — antes fingía funcionar (sin `onClick`), ahora lo dice explícitamente | sí |
| 47 | Franja de aviso si tono rojo/naranja — TEXTO VISIBLE de `linkBadge.text` | ✅ CORREGIDO (revisión de Julio, cierre de Fase 7): `CatalogFichaPage.tsx`, franja visible bajo la línea marca·categoría cuando `linkClassification.tone !== 'green'` (rojo/naranja/ámbar) — el `title` tooltip se mantiene en el badge pequeño, pero ahora el texto también es siempre visible, no solo en hover | sí |
| 48 | "Coste calculado desde: {recipeName}" enlace clicable → navega a `/kitchen/recetas?recipe=…` | Retirado deliberadamente — el destino de esa navegación (un editor de escandallo en pantalla aparte) ya no existe como concepto separado: la fusión Capa 1 hace que "Escandallo" sea una pestaña de la MISMA ficha, no otra pantalla. Verificado que no queda ningún `navigate('/kitchen/recetas?recipe='...)` de este tipo en los ficheros nuevos — la razón de negocio del elemento (ver el escandallo) se cubre entrando en la pestaña "Escandallo" de la misma ficha, no con un enlace. | sí |
| 49 | "Este escandallo se comparte con {N} ítem(s) más de la cuenta" (`shared_with`) | Movido con mejora: en vez de un contador de texto, `RecipeEscandalloTab.tsx:2277-2315` ("Platos de venta que usan esta receta") lista los productos reales que comparten el escandallo, con su sello de casado — cubre el mismo hecho con más detalle (es, de hecho, el "hallazgo transversal 1" de la propia auditoría: las dos mitades de la misma relación bidireccional se funden en la pestaña Escandallo) | sí |
| 50a | Grid de 5 tiles — tiles "Coste" y "FC%" (con dato real) | Movido a: `CatalogFichaPage.tsx:842-869` ("tres cifras honestas" de cabecera: coste del plato / food cost / PVP) | sí |
| 50b | Grid de 5 tiles — tiles "Ingredientes"/"Pasos"/"Tiempo" (siempre "—", nunca calculados, placeholders permanentes) | Retirado deliberadamente, decisión 7 del plan | sí |
| 51 | Texto estático "Merma estimada incluida en el coste del escandallo." | ✅ CORREGIDO (revisión de Julio, cierre de Fase 7): movido a `RecipeEscandalloTab.tsx`, junto al desglose Comida/Packaging del "Coste en vivo" | sí |
| 52 | "Ver escandallo completo →" enlace | Retirado deliberadamente — mismo motivo que la fila 48 (la fusión hace innecesaria la navegación a una pantalla aparte; la pestaña Escandallo YA es lo que se estaba enlazando) | sí |
| 53 | "Cambiar"/"Quitar"/"Aprobar" (duplicados de los de la tarjeta de identidad) | Movido a: `CatalogFichaPage.tsx:777-796` (mismos botones que la fila 24 — el sello canónico ahora vive en un solo sitio, la cabecera, en vez de repetirse en 2-3 lugares como diagnosticó el hallazgo transversal 1 de la auditoría) | sí |

### S2 — "Economía por canal" (L128-140)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 54 | Tile "PVP cliente" (`fmtEur(pvpConIva)` + "IVA {vatPct}% incluido") | Movido a: `EconomiaTab.tsx:129-132` | sí |
| 55 | Tile "Food cost" (`fmtEur(recipeCost)` ámbar o "—", subtexto `%` o "Pendiente de escandallo") | Movido a: `EconomiaTab.tsx:133-137` | sí |
| 56 | Tile "Mejor margen" (`fmtEur(bestMargin)` verde o "—", subtexto canal+% o "Configura un canal") | Movido a: `EconomiaTab.tsx:138-142` | sí |
| 57 | Tile "Stock para" — siempre "—", placeholder permanente | Retirado deliberadamente, decisión 7 del plan (confirmado en el propio comentario de cabecera de `EconomiaTab.tsx:8-9`: "el tile 'Stock para'… NO se mueve — dead") | sí |
| 58 | Bloque de margen por canal, uno por fila de `econ` (`getMenuItemChannelEconomics`) | Movido a: `EconomiaTab.tsx:145-207` | sí |
| 59 | Badge de canal (logo si existe vía `connector.logo_url`, si no pastilla coloreada + icono heurístico) | Movido a: `EconomiaTab.tsx:63-69` (query `connector`) + `102-118` (`channelBadge`) | sí |
| 60 | Canal sin tarifa: caja punteada "{badge} · sin configurado" + texto "Configurar en Ajustes" (parecía enlace, sin `onClick`, muerto) | Movido con limpieza: `EconomiaTab.tsx:153-159` mantiene "{badge} · sin configurar" pero **quita el texto muerto "Configurar en Ajustes"** — confirmado retirado, decisión 7 del plan (citado explícitamente en el commit de Fase 4: "También quitado 'Configurar en Ajustes' (dead, decisión 7)") | sí |
| 61 | Canal configurado: margen a la derecha (verde/rojo) + "% del PVP" (+ "sin food cost" si aplica) | Movido a: `EconomiaTab.tsx:173-180` | sí |
| 62 | Leyenda de chips (Food cost/Comisión/"Canal ≈{orderCost}" con tooltip/Margen) | Movido a: `EconomiaTab.tsx:182-191` (incluye el tooltip de la fórmula de estimación de reparto propio) | sí |
| 63 | Barra horizontal apilada de 4 segmentos (cost%/commission%/transport%/margin%) | Movido a: `EconomiaTab.tsx:193-198` | sí |
| 64 | Párrafo al pie (metodología de estimación de coste de reparto propio, solo si hay `own_delivery`) | Movido a: `EconomiaTab.tsx:202-206` | sí |
| 65 | Línea "Target FC: {X}% · Dentro/Fuera del objetivo" o "Sin target configurado" | Movido a: `EconomiaTab.tsx:212-219` (lee `item.targetFoodCostPct`; la edición del valor se mueve a Ficha — ver fila 106 — sin ventana de desincronización porque comparten el mismo `item` por prop) | sí |

### S3 — "Precios y disponibilidad" (L142-157)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 66 | Tabla-stub (cabeceras Canal/Ubicación/Precio/PVP/Margen neto/Activo, solo pinta 1 fila "Base marca") | Retirado deliberadamente, decisión 7 del plan (tabla-stub simplificada; quedan solo los controles reales) | sí |
| 67 | Celda "Activo" estado 1: `isAvailable===true` → punto verde "Disponible" → `openAvailConfirm()` | Movido a: `EnCartaTab.tsx:181-189` | sí |
| 68 | Celda "Activo" estado 2: original oculto por espejo activo → punto ámbar "Oculto · versión promo" → `handleSwapMirror(false)` | Movido a: `EnCartaTab.tsx:190-199` | sí |
| 69 | Celda "Activo" estado 3: es el espejo en espera → punto ámbar "En espera · versión promo" → `handleSwapMirror(true)` | Movido a: `EnCartaTab.tsx:200-209` | sí |
| 70 | Celda "Activo" estado 4: agotado → punto gris "Agotado · reactivar" → `handleToggleAvailability(true)` | Movido a: `EnCartaTab.tsx:210-219` | sí |
| 71 | Caja de info de espejo (título, texto explicativo, línea Original/Promo visible-oculto, botón "Volver al original"/"Usar versión promo", hint si es el espejo) | Movido a: `EnCartaTab.tsx:226-264` | sí |
| 72 | `handleSwapMirror` → `swapMirror` RPC, siempre contra el original | Movido a: `EnCartaTab.tsx:93-110` | sí |
| 73 | Panel de confirmación inline "¿Marcar como agotado?" (texto de alcance, botones "Sí, agotar"/"Cancelar") | Movido a: `EnCartaTab.tsx:267-293` — **sigue siendo confirmación inline, NO se convirtió a `ConfirmDialog`** (la lista de 9 confirmaciones unificadas de la Fase 6 no incluye esta); no es una pérdida (el elemento sigue existiendo tal cual), solo una nota de que no recibió la mejora que sí tuvieron otras confirmaciones inline de la misma fase | sí |
| 74 | `handleToggleAvailability(next)` → `setProductAvailability` RPC | Movido a: `EnCartaTab.tsx:132-146` | sí |
| 75 | Caja de resultado "Agotado en N marca(s) · N canal(es) (N ficha(s))" | Movido a: `EnCartaTab.tsx:294-300` | sí |
| 76 | Banner `availError` | Movido a: `EnCartaTab.tsx:301-303` | sí |
| 77 | Enlace/botón "Editar precios" → abre `EditPricesModal` | Movido a: `EnCartaTab.tsx:221-223` (botón) + modal montado en `306-315` | sí |

### Modal `EditPricesModal.tsx` (L158-170)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 78 | Fichero completo (cabecera, panel precio por defecto, filas por canal, preview en vivo con debounce, Guardar/Cancelar, banner error) | Reutilizado tal cual — **confirmado por `git diff main...HEAD -- EditPricesModal.tsx` = sin cambios**, 0 líneas de diferencia. Montado ahora desde `EnCartaTab.tsx:306-315` (antes desde `CatalogProductDetailPage.tsx`), mismas props (`menuItemId`, `productName`, `basePrice`, `vatRate`, `onClose`, `onSaved`) | sí |

### S4 — "Modificadores" (L172-192)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 79 | Badge de la sección (`groups.length`, carga de solo-lectura separada de la del editor — fuente de desincronización ya señalada por la propia auditoría) | Retirado deliberadamente — confirmado en el propio commit de Fase 3: "No se replicó el contador de badge de página que tenía la ficha vieja… era la fuente de desincronización que la propia auditoría ya señalaba, no aplica aquí". Verificado leyendo `ModifierEditorSection.tsx` completo: no existe ninguna segunda carga de solo lectura, solo `getProductModifierGroupsEditable` (línea 112) | sí |
| 80 | Estado de carga "Cargando modificadores…" | Movido a: `ModifierEditorSection.tsx:209` | sí |
| 81 | Estado vacío "Este producto no tiene modificadores…" | Movido a: `ModifierEditorSection.tsx:216` | sí |
| 82 | Nombre del grupo editable inline | Movido a: `ModifierEditorSection.tsx:226-236` | sí |
| 83 | Botón borrar grupo (sin confirmación en el original) | Movido con mejora: `ModifierEditorSection.tsx:237-239` + **ConfirmDialog nuevo** (Fase 6, B5) en `398-407`, antes disparaba al instante | sí |
| 84 | Aviso de reutilización "Este grupo se usa en {N} productos…" | Movido a: `ModifierEditorSection.tsx:243-247` | sí |
| 85 | Select tipo de grupo (Elegir/Extras/Quitar/Tamaño) | Movido a: `ModifierEditorSection.tsx:250-256` | sí |
| 86 | Checkbox "Obligatorio" | Movido a: `ModifierEditorSection.tsx:257-260` | sí |
| 87 | Input "Elige hasta" | Movido a: `ModifierEditorSection.tsx:261-266` | sí |
| 88 | Bloque preview "Así lo ve cocina" (reutiliza `childVisual` del ticket real) | Movido a: `ModifierEditorSection.tsx:53-63` (`kitchenPreview`, reutiliza `childVisual` importado de `ordersFeedService`, línea 43) + render `270-282` | sí |
| 89 | Fila por opción: nombre editable inline, checkbox "Defecto", input "+€", botón quitar (X) sin confirmación en el original | Movido con mejora: `ModifierEditorSection.tsx:292-317` (nombre/defecto/precio) + quitar con **ConfirmDialog nuevo** (Fase 6, B5) en `408-417` | sí |
| 90 | Línea de estado de impacto en coste por opción (sin definir / IA propone + Confirmar/Rechazar / confirmado) | Movido a: `ModifierEditorSection.tsx:319-343` | sí |
| 91 | Botón "Añadir opción" por grupo | Movido a: `ModifierEditorSection.tsx:347-350` | sí |
| 92 | Botón "Nuevo grupo" (deshabilitado sin `brandId`) | Movido a: `ModifierEditorSection.tsx:358-361` | sí |
| 93 | Botón "Asignar grupo existente" + picker inline | Movido a: `ModifierEditorSection.tsx:362-365` (botón) + `377-396` (picker) | sí |
| 94 | Botón "Pedir coste con IA" (Edge Function `propose-modifier-impacts`) + banner de resumen | Movido a: `ModifierEditorSection.tsx:366-372` (botón) + `askAI()` `131-141` + banner `375` | sí |
| 95 | Banner `err` + patrón `wrap()` | Movido a: `ModifierEditorSection.tsx:213` + `121-128` | sí |
| 96 | Puente `onGroupsChanged` (NUEVO respecto al original, no existía) | Añadido explícitamente por el plan (decisión de Fase 3): `ModifierEditorSection.tsx:72` (prop) + `CatalogFichaPage.tsx:994` (consumo, incrementa `modifiersTick` que fuerza remount de `ModifierImpactsTab` vía `key`, línea 1015) | sí |

### S5 — "Alérgenos y nutrición" (L194-196)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 97 | Estado `!hasRecipe`: "Necesita escandallo para calcular alérgenos automáticamente." | Movido a: `CatalogFichaPage.tsx:1069-1073` (pestaña Etiquetado, estado sin escandallo: "Necesita escandallo para declarar alérgenos.") | sí |
| 98 | 14 `EU_ALLERGENS` mostrados como chips SIEMPRE "no" — mentira hardcodeada, riesgo Reglamento UE 1169/2011 | Movido con corrección de fondo (Fase 5, sustituye la mentira por dato real): `EtiquetadoTab.tsx` completo — lee/escribe `recipe_item_allergen` vía `recipeItemAllergenService.ts`, 4 estados reales (`contains`/`may_contain`/`free`/`unknown`) + 5º estado solo-UI "Sin declarar" (líneas 311-369). Verificado que se muestran SIEMPRE los 14 (`EU_ALLERGENS.map`, línea 312), nunca una lista parcial. | sí |
| 99 | AiButton "Verificar alérgenos" — decorativo, muerto | Movido con mejora superior a lo planeado: el plan (decisión 4) preveía "deshabilitado con tooltip honesto"; en Fase 6 se decidió cablear de verdad como "Verificar con IA" (`EtiquetadoTab.tsx:293-302`, `verifyAllergensAI()` en `223-267`) — sugiere estados solo para alérgenos "Sin declarar" (fill-only, nunca pisa una declaración ya guardada), pendiente de "Guardar alérgenos" para persistir | sí |

### S6 — "Proveedores" (L198-200)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 100 | Estado `!hasRecipe`: "Conecta un escandallo para ver qué proveedores suministran este plato." | Retirado deliberadamente, decisión 7 del plan ("S6 'Proveedores' (próximamente, sin dato)") | sí |
| 101 | Estado `hasRecipe`: "Resumen de impacto por proveedor (próximamente)." — stub sin implementar, sin fuente de datos | Retirado deliberadamente, decisión 7 del plan | sí |

### S7 — "Ventas" (L202-203)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 102 | Badge "0" hardcodeado + texto "Sin ventas registradas para este producto." — sin query, stub total | Retirado deliberadamente, decisión 7 del plan ("S7 'Ventas' (badge '0' hardcodeado, sin query)") | sí |

### S8 — "Notas internas" (L205-208)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 103 | Textarea notas (3 filas), atada a `notesVal` | Movido a: `FichaTab.tsx:385-391` | sí |
| 104 | Botón "Guardar nota" (condicional a "sucio") → `saveField('notes', …)` | Movido a: `FichaTab.tsx:392-400` | sí |
| 105 | Línea de pie "{Creado por X ·} Actualizado {fecha}" | Movido a: `FichaTab.tsx:401-403` | sí |

### S9 — "Packaging delivery" (L210-214)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 106 | Hint "Sin información de packaging." si ambos vacíos | Movido a: `FichaTab.tsx:409-411` | sí |
| 107 | Textarea "Descripción del envase" | Movido a: `FichaTab.tsx:413-422` | sí |
| 108 | Input "Coste packaging (€/unidad)" | Movido a: `FichaTab.tsx:423-428` | sí |
| 109 | Botón "Guardar packaging" (condicional a "sucio") | Movido a: `FichaTab.tsx:430-441` | sí |

### S10 — "Marcas y categoría" (L216-227, `ProductPlacementSection`)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 110 | Fichero `ProductPlacementSection.tsx` completo (lista de chips "Marcas donde se vende" con avatar-letra, quitar (X) sin confirmación → `archiveMenuItem`, select "añadir a marca…" + botón "Añadir" → `addRecipeToBrand`, hint "Está en todas tus marcas", nota de coste único, estado sin receta, select "Categoría en esta marca" → `setMenuItemCategory`, sección "Disponibilidad por local y canal" estática "Próximamente…", banner `err`) | Reutilizado tal cual — **confirmado por `git diff main...HEAD -- ProductPlacementSection.tsx` = sin cambios**, 0 líneas de diferencia. Montado ahora desde `EnCartaTab.tsx:322-330` (antes desde `CatalogProductDetailPage.tsx`), mismas props | sí |

### S11 — "Avanzado" (L229-234)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 111 | Input "Nombre de cocina (kitchen name)" + botón Guardar condicional | Movido a: `FichaTab.tsx:474-489` | sí |
| 112 | Input "Nombre corto (short name)" + botón Guardar condicional | Movido a: `FichaTab.tsx:490-505` | sí |
| 113 | "Código interno" (solo lectura, `item.id.slice(0,8)`) | Movido a: `FichaTab.tsx:506-509` | sí |
| 114 | "External ID (Last.app)" — siempre "—", placeholder permanente nunca conectado | Retirado deliberadamente, decisión 7 del plan (confirmado explícitamente en el comentario de cabecera `FichaTab.tsx:14-16`: "SIN 'External ID (Last.app)' (dead…)") | sí |
| 115 | Línea de pie "Creado: {fecha}" / "Actualizado: {fecha}" | Movido a: `FichaTab.tsx:511-514` | sí |

### CAJA DE GUÍA IA (L236-237)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 116 | Panel morado "Folvy te ayuda a completar la ficha" + botón "Empezar con IA →" — sin `onClick`, decorativo | Retirado deliberadamente, decisión 7 del plan ("Empezar con IA →" nombrado explícitamente); confirmado con `grep -rn "Folvy te ayuda\|Empezar con IA"` — solo aparece en `CatalogProductDetailPage.tsx` (fichero viejo), cero apariciones en los ficheros nuevos | sí |

### Modales / diálogos de la ficha de producto (L239-252)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 117 | `PhotoLightbox` (foto pública) — overlay, clic fondo/X cierra | Movido a: `FichaTab.tsx:52-64` (definición local) + `243-245` (uso) — además una segunda instancia de solo-vista combinada en la cabecera, `CatalogFichaPage.tsx:125-137` | sí |
| 118 | Confirmación inline "¿Eliminar foto?" (sustitución de botones, no modal real) | Movido con mejora a `ConfirmDialog` real (Fase 6, B3): `FichaTab.tsx:248-257` | sí |
| 119 | Panel de confirmación inline "¿Marcar como agotado?" (no modal real) | Movido a: `EnCartaTab.tsx:267-293` (ver también fila 73 — sigue inline, no convertido) | sí |
| 120 | `RecipeLinkPickerModal.tsx` (buscador, "Crear escandallo nuevo «X»", X/Cancelar) | Reutilizado tal cual — **confirmado por `git diff` = sin cambios**. Montado ahora desde `CatalogFichaPage.tsx:588-599` (antes desde `CatalogProductDetailPage.tsx`), mismas props (`accountId`, `itemName`, `wasApproved`, `busy`, `error`, `onChoose`, `onCreateNew`, `onClose`) | sí |
| 121 | `ConfirmDialog` "Quitar escandallo" (título, mensaje, tono `danger`) | Movido a: `CatalogFichaPage.tsx:601-610`, mismo texto de mensaje | sí |
| 122 | `EditPricesModal` (ver fila 78) | Ver fila 78 | sí |

### Inventario de estado y de `useEffect` (L254-300)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 123 | Inventario de `useState` (26 variables) y de `useEffect` (7 efectos de página + 4 anidados) | No son elementos de UI independientes — son documentación de origen de datos. Verificado que cada fuente de datos listada (`item`, `groups`, `comboSlots`, `econ`, `brandName`, `channelLogos`, `linkHealth`, `mirror`, etc.) reaparece en el componente nuevo correspondiente citado en las filas de arriba, con su misma llamada de servicio/RPC. No se encontró ninguna fuente de datos "huérfana" (cargada en el original sin que ningún elemento de UI la usara) que no esté ya cubierta por una fila de esta tabla. | sí |

### Notas transversales de Parte 1 (L302-307)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 124 | "Cargas duplicadas de grupos de modificadores" (badge solo-lectura vs. copia editable, podían desincronizarse) | Resuelto — ver fila 79 (el problema deja de existir porque el badge duplicado se retiró, no se arregló manteniendo dos fuentes) | sí |
| 125 | Lista de "controles muertos/decorativos" (Exportar, ···, 3 `AiButton`, "Empezar con IA →", "Configurar en Ajustes") | Cubierto por las filas individuales 4, 5, 22, 46, 60, 99, 116 arriba — de los 6 originalmente muertos, 3 se cablearon de verdad (22, 46-parcial como deshabilitado honesto, 99) y el resto se retiró | sí |
| 126 | Lista de "placeholders estáticos permanentes" (S1 tiles, S2 Stock, S5 alérgenos, S6, S7, S11 External ID) | Cubierto por las filas 50, 57, 98, 100-102, 114 arriba | sí |
| 127 | Tabla de S3 (estructurada para multi-fila, solo pinta una) | Cubierto por la fila 66 | sí |
| 128 | "Borrados sin confirmación" (slot/opción combo, quitar grupo/opción modificador) | Cubierto por las filas 39, 40, 83, 89 — los 4 pasaron a `ConfirmDialog` en la Fase 6 (mejora respecto al hallazgo original) | sí |

---

## PARTE 2 — `RecipeEditorPage.tsx` (editor del escandallo)

### Cabecera — foto (L325-331)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 129 | Foto de cocina 96×96px, sin foto→selector, con foto→lightbox | Movido a: `RecipeEscandalloTab.tsx:1524-1546` (80×80px — tamaño ajustado, mismo comportamiento) | sí |
| 130 | Input de archivo oculto → `handlePhotoSelected` (`uploadDishPhoto`→`updateRecipeItem`→`deleteDishPhoto` best-effort) | Movido a: `RecipeEscandalloTab.tsx:530-555` | sí |
| 131 | Error de subida: banner rojo inline, autodesaparece a 5s | Movido a: `RecipeEscandalloTab.tsx:1572-1576` (chip) + timeout `551` | sí |
| 132 | URL firmada resuelta aparte (`getDishPhotoUrl`), regenerada en cada carga/cambio | Movido a: `RecipeEscandalloTab.tsx:420-438` | sí |
| 133 | Botón "Añadir foto"/"Ver / cambiar foto" | Movido a: `RecipeEscandalloTab.tsx:1552-1560` | sí |
| 134 | **AÑADIDO respecto al original**: eliminar la foto de cocina sin reemplazo (el editor viejo solo permitía sustituirla) | Añadido explícitamente por decisión de Julio (ver comentario `RecipeEscandalloTab.tsx:557-559,1561-1571`): botón "Eliminar" + `handleDeletePhoto()` + **ConfirmDialog** (Fase 6, B3) en `2363-2372` — mejora deliberada, no parte del inventario original pero documentada como tal | sí |

### Cabecera — nombre y chips (L332-339)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 135 | Nombre del plato clicable, icono lápiz al hover, clic→input inline, blur/Enter guarda, Escape cancela | Movido a: `RecipeEscandalloTab.tsx:1491-1519` — cambia de "nombre de venta editable en cabecera" (editor viejo, ambiguo con `menu_item.name`) a "nombre PROPIO del escandallo" explícitamente distinto del nombre de venta (que ahora se edita en Ficha, fila 26); recuperado en revisión de Fase 4 (decisión 5 del plan, comentario `226-229`) tras haberse perdido en la Fase 1 | sí |
| 136 | Chip IA (`Sparkles`, "IA") si `source` es `ai_recipe`/`ocr_invoice` | Movido a: `CatalogFichaPage.tsx:709-713` | sí |
| 137 | Chip de estado "Revisar"/"Validado" (`dishNeedsReview` agregado con líneas incompletas) | Retirado deliberadamente (Fase 5, bug cazado en vivo por Julio, documentado en el propio código `CatalogFichaPage.tsx:714-726`): el chip duplicaba/contradecía visualmente al sello de casado (dos preguntas distintas con el mismo vocabulario "Para revisar"); el dato equivalente sigue disponible vía el banner "Marcado para revisar" (que usa solo `recipe.needsReview`, no el agregado) + los puntos rojo/ámbar por línea dentro de la pestaña Escandallo | sí |
| 138 | Línea tipo/código: icono `ChefHat` + "Plato"/tipo crudo + `· {recipe.code}` si existe | ✅ CORREGIDO (revisión de Julio, cierre de Fase 7): movido a `RecipeEscandalloTab.tsx`, bajo el nombre editable del escandallo — mismo icono, mismo condicional de tipo/código | sí |

### Cabecera — fila de acciones rápidas (L340-344)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 139 | "Añadir foto"/"Ver / cambiar foto" (repetido de la fila 133) | Ver fila 133 | sí |
| 140 | "Duplicar" → `window.confirm` → `duplicateRecipeItem` RPC | Movido con mejora: `CatalogFichaPage.tsx:874-882` (botón) + `handleDuplicate()`/`doDuplicate()` `440-466` + **ConfirmDialog** (Fase 6, B1) en `613-622`, reemplaza `window.confirm` | sí |
| 141 | "Eliminar" → abre modal de confirmación | Movido a: `CatalogFichaPage.tsx:883-888` (botón) + diálogo `636-681` | sí |
| 142 | Chips de error de duplicado/foto en línea junto a los botones | Movido a: `CatalogFichaPage.tsx:889` (`duplicateError`) + `RecipeEscandalloTab.tsx:1572-1576` (`photoError`) | sí |

### Cabecera — banner "Marcado para revisar" (L345-350)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 143 | Banner (solo si `ownNeedsReview`), icono, texto de `reviewReasonText(reviewNotes)` (4 ramas: `cost_suspect` con 3 umbrales de `deltaPct`, `missing_recipe`, genérico) | Movido a: `CatalogFichaPage.tsx:895-912` (render) + `reviewReasonText()` `79-101` — **misma lógica de 4 ramas, literal** | sí |
| 144 | Botón "Dar por revisado" → `window.confirm` → `dismissReview` RPC | Movido con mejora: `CatalogFichaPage.tsx:903-910` (botón) + `handleDismissReview()`/`doDismissReview()` `506-523` + **ConfirmDialog** (Fase 6, B2) en `625-634` — recuperado tras haberse perdido en la Fase 1 (nota explícita en el comentario `500-503`), reemplaza `window.confirm` | sí |

### Nota importante de la auditoría (L352-355)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 145 | Confirmación de que "Usado por N ítems" NO vive en la cabecera vieja, solo en la columna derecha de Escandallo | Verificado que se mantiene igual en la ficha nueva: la cabecera (`CatalogFichaPage.tsx`) no muestra la lista de "platos que usan esta receta" (solo el selector ligero cuando hay ≥2 productos ancla, líneas 815-833, que es un dato distinto —qué producto se está viendo, no la lista completa—); el detalle completo con sellos sigue solo en `RecipeEscandalloTab.tsx:2277-2315`, igual que en el original | sí |

### Barra de pestañas (L357-377)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 146 | 6 pestañas originales (`Escandallo·Receta·Modificadores·Etiquetado·Histórico·Más`), todas visibles sin condición | Movido con reestructuración a 8 pestañas (`CatalogFichaPage.tsx:110-123`): `Escandallo·Receta·Modificadores·Economía·En carta·Etiquetado·Histórico·Ficha` — Economía y En carta son pestañas NUEVAS que agrupan contenido que antes vivía en `CatalogProductDetailPage.tsx` (S2/S3/S0/S10), no lógica de negocio nueva | sí |
| 147 | Icono `ChevronDown` decorativo/engañoso en "Más" (sugiere desplegable sin serlo) | Retirado junto con toda la pestaña — ver fila 149 | sí |
| 148 | Pestañas con contenido real vs. placeholder ("Escandallo"/"Receta"/"Modificadores"/"Histórico" reales; "Etiquetado"/"Más" placeholder "— pendiente.") | Resuelto: verificado que las 8 pestañas nuevas tienen TODAS componente real montado en `CatalogFichaPage.tsx:945-1107` (ningún `else` genérico tipo "Solapa — pendiente." en ningún caso); Etiquetado pasa de placeholder a real (Fase 5). El propio comentario de cabecera del fichero (`CatalogFichaPage.tsx:18-23`) declara la regla: esta ficha no se despliega hasta que las 8 pestañas tengan contenido real, a diferencia de "Etiquetado"/"Más" del editor viejo que sí estaban muertas en producción. | sí |
| 149 | Pestaña "Más ▾" — sin rama propia, cae en el `else` genérico, sin contenido en ningún fichero del repo | Retirado deliberadamente, decisión 7 del plan ("pestaña 'Más ▾' completa del editor (vacía, sin contenido real en ningún archivo del repo)"); confirmado que `FichaTab` (tipo `type FichaTab = 'escandallo'|'receta'|'modificadores'|'economia'|'en_carta'|'etiquetado'|'historico'|'ficha'`, `CatalogFichaPage.tsx:110-112`) no incluye ningún id `'mas'` | sí |

### Pestaña "Escandallo" — cabecera de columna izquierda (L385-397)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 150 | "Sugerir mermas con IA (N)" (visible si `linesWithoutWaste.length>0`) → `streamMessage` batch | Movido a: `RecipeEscandalloTab.tsx:1587-1603` (botón) + `suggestWasteBatchAI()` (implementación en el bloque ~900-955, verificado por grep de "merma" batch) | sí |
| 151 | Botón "Mic" (dictar por voz) — `title="…próximamente"`, sin `onClick`, inerte | Movido con mejora, **cableado real** (Fase 6, A2, distinto de lo previsto originalmente por el plan que solo hablaba de deshabilitar el resto): `RecipeEscandalloTab.tsx:1605-1628` — usa `useVoice` (STT nativo), fallback deshabilitado honesto ("no disponible en este navegador") si `!voice.sttSupported`; el transcrito reutiliza EXACTAMENTE el flujo de "Importar ficha" (`handleVoiceTranscript` → `importFromFile`, líneas 619-625) | sí |
| 152 | Botón "MessageCircle" (Pedir a Folvy) — `title="…próximamente"`, sin `onClick`, inerte | Deshabilitado con tooltip — reubicado a `RecipeEscandalloTab.tsx:1629-1634`; motivo real documentado (decisión 4 del plan, Fase 6): el estado del bubble de chat (`aiOpen`) vive solo en `Shell.tsx`, sin mecanismo para abrirlo desde una página anidada ni sembrarle contexto. Nota: sigue sin atributo `disabled` explícito (igual de inerte que el original, sin `onClick`), a diferencia de la fila 46 que sí quedó con `disabled` real | sí |
| 153 | "Importar ficha" (imagen/PDF/Excel/Word) → `extractRecipeSession` → `RecipeImportReviewModal` | Movido a: `RecipeEscandalloTab.tsx:1635-1651` (botón+input) + `handleImportRecipe`/`importFromFile` `586-613` | sí |

### Pestaña "Escandallo" — barra "Producción" (L398-405)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 154 | Icono Scale + label, texto "Rinde X raciones · para" o "Multiplicar por" | Movido a: `RecipeEscandalloTab.tsx:1656-1666` | sí |
| 155 | Input numérico objetivo/multiplicador → `applyProdTarget` | Movido a: `RecipeEscandalloTab.tsx:1667-1674` | sí |
| 156 | Botones rápidos ×2/×3/½ → `applyProdMultiplier` | Movido a: `RecipeEscandalloTab.tsx:1676-1687` | sí |
| 157 | Chip "Producción · N raciones (×factor) · solo lectura" + botón "Restaurar" | Movido a: `RecipeEscandalloTab.tsx:1688-…` (`resetProd()` en `460-463`) | sí |
| 158 | Efecto de producción: líneas solo lectura, cantidades/costes escalados client-side, sin escribir en BBDD | Movido a: mismas fórmulas locales, verificado en el render de línea (`dispCost`/`netQty` multiplicados por `prodFactor`) | sí |
| 159 | Reset automático de `prodFactor=1` al cambiar de `recipeId` | Movido a: efecto correspondiente en el componente (mismo patrón, dependencia `recipeId`) | sí |

### Pestaña "Escandallo" — banner de error combinado (L407)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 160 | Banner rojo `editError ?? aiWasteError` | Movido a: `RecipeEscandalloTab.tsx:1705-1708` | sí |

### Pestaña "Escandallo" — las tres secciones (L409-417)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 161 | Sección "Ingredientes" (raw/tool/desconocido, nada se oculta) | Movido a: `RecipeEscandalloTab.tsx:1802-1821` (`ingredientLines`, filtro `470-475`) | sí |
| 162 | Sección "Sub-recetas" (`childType==='recipe'`) | Movido a: `RecipeEscandalloTab.tsx:1824-1828` (`subRecipeLines`, filtro `476-479`) | sí |
| 163 | Sección "Packaging" (`childType==='packaging'`) | Movido a: `RecipeEscandalloTab.tsx:1830-1835` (`packagingLines`, filtro `480-483`) | sí |
| 164 | Regla: plato totalmente vacío → solo "Ingredientes" con hint distinto; con ≥1 línea, las tres siempre | Movido a: mismo patrón condicional verificado en el bloque de render de secciones (~1800-1840) | sí |
| 165 | Cabecera de sección: icono+título+contador "· N" + botón "+" → `openAdd(kind)` | Movido a: función `Section(...)` del componente, invocada como función (no `<Section/>`) para no perder foco — mismo patrón que el original, confirmado en el comentario `1445` | sí |

### Pestaña "Escandallo" — línea individual `renderLine` (L419-444)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 166 | Punto de estado (rojo/ámbar/terracota según `needsReview`/`childNeedsReview`/ok) | Movido a: `RecipeEscandalloTab.tsx` render de línea (mismos 3 estados, mismas condiciones) | sí |
| 167 | Cantidad neta editable inline (`formatQty`+unidad, clic→input, Enter/blur→`commitEdit`) | Movido a: `startEdit()`/`commitEdit()` `702-756` | sí |
| 168 | Validación ≥0, cálculo `waste`+`gross`, optimista, `updateLine`+`recomputeRecipeItem` implícito, refresco con `getRecipeBreakdown`, latido, revertir en error | Movido a: `commitEdit()` `710-756` — misma lógica, mismas fórmulas (`grossFromNet`/`effectiveWastePct`, `132-150`) | sí |
| 169 | Campo solo-lectura si `prodFactor!==1` | Movido a: mismo condicional verificado en el render | sí |
| 170 | Nombre del ingrediente + chip "sin terminar" (ámbar) | Movido a: render de línea, verificado (grep "sin terminar", línea 1301) | sí |
| 171 | Chip "falta convertir la unidad" (rojo), clicable si `recipeId` existe (navega a `/kitchen?item=…&return=…`) | Movido a: render de línea, verificado (grep "falta convertir la unidad", línea 1312) | sí |
| 172 | Chip de merma: "↘ merma X%" / "IA sugiere X% · aplicar" / "consultando IA…" / "+ merma" fantasma | Movido a: render de línea, verificado (líneas 1324, 1330, 1339, 1345-1348) | sí |
| 173 | Barra de proporción visual (solo desktop, `!isMobile`) | Movido a: `RecipeEscandalloTab.tsx:1353` (`!isMobile &&`), cálculo `maxLineCost` en `465-468`/`1217` | sí |
| 174 | Coste de línea (`formatEur(dispCost)`, "—" rojo si `needsReview`, tooltip de merma) | Movido a: render de línea, mismo patrón | sí |
| 175 | Botón borrar (`window.confirm` en el original) | Movido con mejora: `handleDelete`/`doDeleteLine` + **ConfirmDialog nuevo** (Fase 6, B4) en `2374-2388`, reemplaza `window.confirm` | sí |
| 176 | Panel expandido de merma (input %, validación 0-99, `commitWaste`, botón "Sugerir con IA" individual) | Movido a: `openWaste()`/`commitWaste()` `758-…`, panel expandido verificado en el render (línea ~1397) | sí |

### Pestaña "Escandallo" — alta de ingrediente E2a/E2b (L446-465)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 177 | Paso 1 — Buscador: input + botón cerrar, carga `listRecipeItems`+`listUnits`+`getRawUsageCounts` (no bloqueante), aviso "No se pudo ordenar por uso" | Movido a: `openAdd()`, `RecipeEscandalloTab.tsx:1035-1039` (`usageNotice`) | sí |
| 178 | `candidates` (filtro tipo+tokens, orden por uso, tope 8) | Movido a: `RecipeEscandalloTab.tsx:665-678` | sí |
| 179 | Cada candidato: nombre (+"(preparación)"), código+coste o "sin coste", "· ya en la receta", "en N platos" | Movido a: verificado por grep — líneas 2063 ("(preparación)"), 2067 (código), 2069 ("ya en la receta") | sí |
| 180 | Búsqueda vacía: "Más usados en tus platos" | Movido a: `RecipeEscandalloTab.tsx:2044` | sí |
| 181 | Sin resultados: "Sin coincidencias…" + "Crear «X» como {kind} nuevo" (excepto `recipe`) | Movido a: `RecipeEscandalloTab.tsx:2026,2036` | sí |
| 182 | Con resultados: "¿No está? Crear «X» como nuevo" | Movido a: `RecipeEscandalloTab.tsx:2087` | sí |
| 183 | Paso 2b — Crear nuevo: form (nombre, unidad agrupada por dimensión, coste opcional), `confirmCreate()` → `createRecipeItem` | Movido a: `openCreate()`/`confirmCreate()` `1055-1103`, agrupación `unitsGrouped`/`DIM_LABEL` `681-689`/`96-100` | sí |
| 184 | Nota fija "Se marcará para revisar; completa coste y formato cuando puedas." | Movido a: `RecipeEscandalloTab.tsx:1975` | sí |
| 185 | Paso 2 — Cantidad+preview: input cantidad, preview exacto `previewLineCost`, `confirmAdd()` → `addLine` | Movido a: `RecipeEscandalloTab.tsx:1180-1181` (preview) + `1886-1912` (render) | sí |

### Pestaña "Escandallo" — modales de importación (L465-471)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 186 | `RecipeImportReviewModal` (anti-duplicados B2) | Reutilizado tal cual — **confirmado por `git diff` = sin cambios**. Montado desde `RecipeEscandalloTab.tsx:1713` | sí |
| 187 | Modal de progreso ("Subiendo…"/"Leyendo con IA…") | Movido a: `RecipeEscandalloTab.tsx:1733,1767-1772` | sí |
| 188 | Modal de resultado ("done": resumen, ingredientes nuevos, líneas saltadas, "Ver escandallo") | Movido a: `RecipeEscandalloTab.tsx:1735-1761` | sí |
| 189 | Modal de error de importación | Movido a: `RecipeEscandalloTab.tsx:1783-…` | sí |
| 190 | Nota de scope del original: el flujo de importar solo existía dentro del JSX de la pestaña 'escandallo' | Se mantiene igual en la ficha nueva — verificado que todo el flujo de importación (input, modales) sigue viviendo exclusivamente dentro de `RecipeEscandalloTab.tsx`, no a nivel del contenedor `CatalogFichaPage.tsx` — mismo comportamiento que el original (si se cambia de pestaña durante la extracción, el flujo pierde su punto de montaje, igual que antes) | sí |

### Pestaña "Escandallo" — columna derecha "Coste en vivo" (L473-495)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 191 | Título "Coste en vivo" + etiqueta "Plate cost"/"Coste total" | Movido a: `RecipeEscandalloTab.tsx:2101-2105` | sí |
| 192 | Cifra hero `formatEur(totalCost*prodFactor)`, animación `scale-110` al latir | Movido a: `RecipeEscandalloTab.tsx:2106-2113` | sí |
| 193 | Subtítulo "por porción · N ración(es)" | Movido a: `RecipeEscandalloTab.tsx:2114-2117` | sí |
| 194 | Aviso "Coste incompleto · falta convertir N línea(s)" | Movido a: `RecipeEscandalloTab.tsx:2118-2129` | sí |
| 195 | Desglose Comida/Packaging (solo si `packagingCost>0`) | Movido a: `RecipeEscandalloTab.tsx:2130-2141` | sí |
| 196 | Bloque "Food cost" por marca/canal (`listMenuItems`+`getMenuItemEconomics` por marca), agrupado, colapsable, cabecera con chip "cedida"/"propia" | Movido a: `RecipeEscandalloTab.tsx:2184-2273` | sí |
| 197 | Filas por canal: icono, nombre, %/margen coloreado, "plate %" si aplica | Movido a: `RecipeEscandalloTab.tsx:2227-2267` | sí |
| 198 | Estado vacío "Este plato aún no está en ninguna carta…" + botón "Añadir a carta" | Movido con **fix documentado en vivo**: `RecipeEscandalloTab.tsx:2159-2176` — corregido para decidir "¿existe producto?" con `usedByItems` (misma fuente que la cabecera) en vez de `economics` (fuente propia que podía contradecir a la cabecera); ver commit `18879af` y comentario `2145-2156` | sí |
| 199 | "Platos de venta que usan esta receta" (`listMenuItemsUsingRecipe`), clicable a `/kitchen/casado?item=…`, sello de casado por fila | Movido a: `RecipeEscandalloTab.tsx:2277-2315` | sí |

### Pestaña "Receta" (`RecipeStepsTab.tsx`, L497-514)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 200 | Fichero completo (cabecera, toggle Ver/Editar, carga de pasos+media, vacío, modo VER, modo EDITAR: mover/texto/duración/temperatura/foto/vídeo, borrar paso, "Añadir paso") | Reutilizado con retoques de Fase 6 — **confirmado por `git diff main...HEAD -- RecipeStepsTab.tsx`**: único cambio es la confirmación de borrado de paso, que pasa de inline (Borrar/Cancelar, líneas -21 del diff) a `ConfirmDialog` (+11 líneas, nuevo bloque al final del fichero). Todo lo demás (toggle, carga, modo ver/editar, media, mover, "Añadir paso") permanece byte-idéntico. Montado desde `CatalogFichaPage.tsx:970` | sí |

### Pestaña "Modificadores" (`ModifierImpactsTab.tsx`, L516-537)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 201 | Fichero completo (filosofía de producto, carga, cobertura, "Sugerir con IA", agrupado por grupo, `OptionCard` con Confirmar/Descartar, `ImpactEditor` con latido de coste server-side) | Reutilizado tal cual, **sin retoques** — confirmado por `git diff main...HEAD -- ModifierImpactsTab.tsx` = **sin cambios**, 0 líneas de diferencia. Montado ahora en la MITAD "impacto" de la pestaña Modificadores junto a `ModifierEditorSection` (mitad "asignación") — coexisten con cargas independientes, tal como preveía el mapa de pestañas del plan. Montado desde `CatalogFichaPage.tsx:1014-1019`, con `key={modifiersTick}` para remount tras cambios en la mitad de asignación | sí |

### Pestaña "Etiquetado" (L539-543)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 202 | "No implementada" — cae en el `else` genérico, texto "Solapa «Etiquetado» — pendiente." | Movido con implementación real — ver filas 97-99 (contenido nuevo de `EtiquetadoTab.tsx`, Fase 5, sustituye la mentira de S5 de la ficha de producto, no el placeholder vacío del editor — ambos orígenes convergen en el mismo sitio nuevo) | sí |

### Pestaña "Histórico" (`RecipeHistoryTab.tsx`, L545-559)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 203 | Carga (`listRecipeVersions`+`listUnits`) | Sin cambios — confirmado por diff | sí |
| 204 | Bloque "Guardar versión" (etiqueta, qué cambió, checkbox hito, botón) | Sin cambios — confirmado por diff | sí |
| 205 | Lista de historial (versión, badge Hito/actual, fecha+autor, coste, nota) | Sin cambios — confirmado por diff | sí |
| 206 | "Comparar con la actual" → `diffSnapshots` (100% cliente) | Sin cambios — confirmado por diff | sí |
| 207 | "Restaurar" — confirmación inline "¿Restaurar vN?" en el original | Movido con mejora: `git diff` confirma el único cambio del fichero es sustituir la confirmación inline (Sí/No) por **ConfirmDialog** (Fase 6, B6) — todo lo demás byte-idéntico. Montado desde `CatalogFichaPage.tsx:1079-1083` (con `onRestored` disparando `reloadTick++`) | sí |
| 208 | Vacío "Aún no hay versiones…" | Sin cambios — confirmado por diff | sí |

### "Más ▾" (L561-568)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 209 | Confirmación de que no había contenido real en ningún fichero del repo | Ver fila 149 — retirado deliberadamente, decisión 7 del plan | sí |

### Modales / diálogos del editor de escandallo (L570-592)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 210 | Confirmar eliminar/archivar el plato (`checkItemDeletable` RPC, branching `deletable`/no-`deletable` con `Archive` icon, `deleteOrArchiveItem` RPC) | Movido a: `CatalogFichaPage.tsx:636-681` (mismo branching, mismos textos, mismo icono condicional) | sí |
| 211 | Lightbox de foto del plato (foto de cocina) | Movido a: `RecipeEscandalloTab.tsx:2318-2341` (distinto del lightbox de la foto pública, fila 117 — decisión 5b del plan: dos fotos, dos sitios) | sí |
| 212 | `AddToMenuModal.tsx` (Crear nuevo / Enlazar existente, 387 líneas) | Reutilizado tal cual — **confirmado por `git diff` = sin cambios**. Montado desde `RecipeEscandalloTab.tsx:2344-2361` (antes desde `RecipeEditorPage.tsx`), mismas props | sí |
| 213 | `RecipeImportReviewModal.tsx` (ver fila 186) | Ver fila 186 | sí |
| 214 | Modales de progreso/resultado/error de importación (ver filas 187-189) | Ver filas 187-189 | sí |

### Estado, efectos y servicios del editor (L594-635)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 215 | Inventario de `useState` (14 fuentes de datos con carga propia) | No son elementos de UI independientes. Verificado que cada fuente (`recipe`, `lines`, `photoUrl`, `usedByItems`, `usedByHealth`, `economics`, `brandNames`, `addableItems`/`units`/`unitsById`, `usageCounts`, `deleteCheck`, `aiWasteSuggestions`) reaparece en `RecipeEscandalloTab.tsx` o `CatalogFichaPage.tsx` con la misma llamada de servicio/RPC, ya cubierta en las filas de arriba | sí |
| 216 | Inventario de 6 `useEffect` con sus disparadores (`reloadTick`, `econReloadTick`) | Movido a: mismo patrón de ticks verificado en `RecipeEscandalloTab.tsx` (`tick`, `econReloadTick`) y `CatalogFichaPage.tsx` (`reloadTick`, `modifiersTick`, `anchorReloadTick`) — el patrón de invalidación cruzada se preserva y se AMPLÍA (nuevo `modifiersTick` no existía en el original, es puente nuevo entre las dos mitades de Modificadores, ver fila 96) | sí |
| 217 | Referencia de servicios y fuentes de datos exactas (RPCs, tablas, Edge Functions) | Verificado que ninguna llamada de servicio/RPC del inventario original desapareció — todas reaparecen en los ficheros nuevos citados en las filas de arriba, sin ningún servicio "huérfano" que sugiera una función perdida sin UI que la exponga | sí |

### Cálculos puramente cliente (L637-647)

| # | Elemento | Destino | Verificado |
|---|---|---|---|
| 218 | `totalCost`, `foodCost`/`packagingCost`, `grossFromNet`, `effectiveWastePct`, `dishNeedsReview` (ver fila 137, retirado del chip pero la fórmula en sí sigue viva en el punto rojo/ámbar por línea), `unconvertibleLineCount`, `previewLineCost`, producción, `classifyMenuItemLink`/`diffSnapshots`/`matchesTokens`/`channelIcon`/`statusColor`/`similarity` | Movidas a: mismas fórmulas verbatim en `RecipeEscandalloTab.tsx` (`totalCost` `440-443`, `grossFromNet`/`effectiveWastePct` `136-150`, `matchesTokens` `162-170`, `channelIcon` `174-179`, `statusColor` `182-191`), `menuLinkService.ts` (`classifyMenuItemLink`, sin cambios), `RecipeHistoryTab.tsx` (`diffSnapshots`, sin cambios), `AddToMenuModal.tsx` (`similarity`, sin cambios) | sí |

---

## HALLAZGOS TRANSVERSALES (auditoría L651-670)

| # | Hallazgo | Disposición en la ficha nueva | Verificado |
|---|---|---|---|
| 219 | Solapamiento "Coste calculado desde / Ver escandallo completo" (S1) vs. "Platos de venta que usan esta receta" (editor) — las dos mitades de la misma relación bidireccional | Resuelto por diseño: ambas mitades se funden en la pestaña Escandallo de la ficha única — el enlace producto→receta ya no necesita un texto/enlace aparte (fila 48/52, retirados porque el destino es la misma pantalla) y la lista de "platos que usan esta receta" sigue siendo la vista completa de la otra dirección (fila 199) | sí |
| 220 | Economía por canal duplicada con alcances distintos (S2 = por canal de esta marca; editor = cross-marca) | Resuelto explícitamente por decisión de Julio (04/08, documentada en el plan): se conservan AMBOS niveles pero en pestañas distintas y con propósito explícito — Economía (`EconomiaTab.tsx`) = detalle por canal del producto anclado; el bloque cross-marca (fila 196) se queda en Escandallo (es información DE LA RECETA, hermano natural de "platos que usan esta receta"). Ya no se corre el riesgo de fundirlos sin más — quedó explícito en el comentario de cabecera de `EconomiaTab.tsx:11-17` | sí |
| 221 | Sello de casado (`classifyMenuItemLink`) repetido en 3 sitios (tarjeta identidad, S1, filas de "platos que usan esta receta") | Resuelto: el sello "canónico" del producto anclado vive en un solo sitio, la cabecera (`CatalogFichaPage.tsx:727-731`), consumido también por las filas de "platos que usan esta receta" (fila 199, sellos por fila, caso distinto — ahí sigue habiendo N sellos porque son N productos distintos, no una repetición del mismo dato) | sí |
| 222 | Pestañas reales vs. simuladas (editor: 4/6 reales; ficha de producto: sin pestañas, 12 secciones, mayoría reales salvo stubs) | Resuelto: las 8 pestañas nuevas tienen TODAS contenido real (ver fila 148); ningún placeholder "— pendiente." sobrevive | sí |
| 223 | Inventario de "contenido no real" a decidir (lista completa de placeholders/botones muertos de ambas pantallas) | Cada elemento de esta lista se resolvió individualmente y está cubierto en las filas correspondientes de Parte 1/Parte 2 de arriba (S1 tiles, S2 Stock, S5 alérgenos, S6, S7, S11 External ID, tabla S3, Etiquetado, Más ▾, Mic/Pedir a Folvy, Exportar/···/AiButtons/Empezar con IA/Configurar en Ajustes) | sí |
| 224 | Confirmaciones inconsistentes (`ConfirmDialog` solo en "Quitar escandallo"; `window.confirm` nativo en varios sitios del editor; inline sin modal en otros) | Resuelto en su mayoría (decisión 6 del plan, Fase 6): 9 puntos migrados a `ConfirmDialog` — Duplicar escandallo (140), Dar por revisado (144), borrar foto pública (13)/foto de cocina (134)/línea (175)/paso (200)/grupo de modificador (83)/opción de modificador (89)/grupo de combo (39)/opción de combo (40), restaurar versión (207). **No migradas** (siguen inline, no es pérdida pero tampoco se unificaron del todo): "¿Marcar como agotado?" en En carta (fila 73/119) | sí |
| 225 | Cargas de datos duplicadas/desincronizables dentro de la MISMA pantalla (badge de modificadores S4) | Resuelto — ver fila 79, el badge duplicado se retiró en vez de mantenerse desincronizado | sí |
| 226 | Ambas pantallas cargaban su propia copia de `getMenuItemLinkHealth`/`classifyMenuItemLink` de forma independiente | Se mantienen DOS cargas en la ficha nueva, pero con alcances legítimamente distintos (no es el mismo problema): `CatalogFichaPage.tsx:341-352` carga la salud del ítem anclado (para el sello de cabecera); `RecipeEscandalloTab.tsx:349-356` carga la salud de TODOS los ítems que usan la receta (para los sellos de "platos que usan esta receta") — mismo patrón conceptual que antes, no una fuente que pueda contradecir a la otra para el MISMO hecho (son hechos distintos: "¿cómo está el producto anclado?" vs. "¿cómo está cada uno de los N productos de la lista?") | sí |

---

## Resumen

**Total de filas del checklist: 227** (226 elementos numerados de la auditoría + fila 50 partida en
50a/50b para no agrupar dos destinos distintos — "Coste/FC%" que se mueven vs. "Ingredientes/Pasos/
Tiempo" que se retiran — en una sola fila).

| Categoría | Cuenta |
|---|---|
| Movidas (a pestaña/cabecera/componente — incluye las movidas-con-mejora: cableadas de verdad, con `ConfirmDialog` nuevo, con fix documentado, etc. — y las referencias cruzadas a un fichero reutilizado ya contado en otra fila) | 205 |
| Retiradas deliberadamente (decisión 7 del plan, o el propio destino deja de existir por la fusión — con motivo documentado en cada fila) | 20 |
| Deshabilitadas con tooltip honesto (decisión 4 del plan: "Crear escandallo con IA" fila 46, "Pedir a Folvy" fila 152 — los 2 botones de IA que quedaron así tras la Fase 6) | 2 |
| **GAP — ❌ NO ENCONTRADO / parcial** | **0** |

### Los 6 GAP encontrados en la primera pasada — todos corregidos antes de cerrar la fase

La primera pasada de este checklist (agente, verificación de código) encontró 6 elementos del
inventario original sin destino verificable: badge de marca (fila 11), chips de tags (fila 17),
banner de error de guardado de la descripción (fila 29, parcial), franja de aviso visible del
sello de casado (fila 47), texto estático de merma (fila 51), línea tipo/código del escandallo
(fila 138). Julio revisó los 6 y pidió corregirlos todos (ninguno se aceptó como pérdida
deliberada) — quedaron arreglados en el propio código antes de cerrar esta fase, verificados de
nuevo (`tsc`/`build` limpios tras la corrección) y actualizados arriba con su destino real. El
detalle de cada corrección está en la fila correspondiente.
