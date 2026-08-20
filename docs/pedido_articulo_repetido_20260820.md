# ENCARGO «El pedido enseña el mismo artículo varias veces» — resultado

Fecha: 2026-08-20 · Commit: `f0f5b63` · Rama: `main` (y `claude/redesign-pricing-modal-amxuzy`)

## Resumen

La Parte B estaba bien diagnosticada y está arreglada. **La Parte A no aplica a Foodint**:
los 67 formatos duplicados que cita el encargo están todos en *Folvy Interno*, no en la
cuenta de producción. Por eso no se archiva nada.

## Parte A — los 67 duplicados no están en Foodint

Duplicados exactos de formato activo (mismo artículo + mismo nombre + misma medida),
agrupados por cuenta:

| Cuenta | Grupos duplicados | Filas sobrantes |
|---|---:|---:|
| Folvy Interno | 55 | 67 |
| Foodint | 1 | 0 |
| Kitchen Grill LstQ | 1 | 0 |

De los 55 grupos de Folvy Interno, 54 tienen alguna fila con `source = 'import'`.
Ésa es la cifra del encargo, medida sin filtrar por cuenta.

**Conclusión:** en Foodint hay **0 formatos duplicados activos**. El caso de
`Aceite Alto Oleico` que motivó el encargo ya tenía el Bidón sobrante archivado.
Los criterios 4 y 5 del encargo (archivar 59, verificar que los 6 con movimiento no
se tocan) no tienen sujeto en Foodint: no se ha ejecutado ninguna migración.

Si se quiere limpiar *Folvy Interno* es un encargo aparte y hay que decidirlo:
es la cuenta de demo, y archivar ahí cambia lo que se ve en las demos.

## Parte B — la causa real: una fila por ficha de proveedor

`getSupplierCatalog` devolvía **una fila por registro `article_supplier`**, no por artículo.
Cuando un artículo tiene dos fichas del mismo proveedor (una con código y formato, otra
sin nada), la pantalla lo pintaba dos veces — y la segunda caía a la unidad base,
imprimiendo "ml" en vez del envase.

Estado actual en Foodint:

| Proveedor | Filas antes | Filas después | Repeticiones |
|---|---:|---:|---:|
| CLOUDTOWN, S.L. | 101 | 91 | 10 |
| MAKRO DISTRIBUCION MAYORISTA SA | 81 | 76 | 5 |
| BODEGA DE VALLECAS S.L | 10 | 6 | 4 |
| COHELDI, S.L. | 10 | 9 | 1 |

19 grupos, 20 fichas sobrantes, 4 proveedores. **7 de esas fichas no tienen código de
proveedor**; las otras 13 tienen dos códigos distintos para el mismo artículo, así que
no se pueden fusionar en la BBDD sin decidir cuál vale. Por eso el arreglo se hace en
pantalla y no borrando datos.

### Qué se ha cambiado

`src/modules/supply/services/supplierCatalogService.ts`
- `fichaScore(e)`: preferido (8) > tiene código (4) > tiene formato (2) > tiene precio (1).
- `mergeEntriesByItem(list)`: agrupa por `recipeItemId`, elige representante por
  `fichaScore`, rellena huecos desde las hermanas, **toma el bloque de formato entero de
  una sola ficha** (no mezcla el formato de una con la medida de otra), marca
  `isPreferred` si alguna lo está y recoge los códigos alternativos en
  `otherSupplierCodes`. Ordena por `itemName`.

`src/modules/supply/pages/SupplyOrderBuilder.tsx`
- `DraftLine.formatId` y `setFormato(id, formatId)`.
- La fila pinta de tres maneras: sin formato → aviso ámbar «sin formato de este
  proveedor»; más de uno (o ninguno preferido) → `<select>` con la medida en la etiqueta
  («Garrafa (5 L)»); uno solo → texto plano.
- El guardado escala el precio al `qtyInBase` del formato elegido, no al preferido.
- Los códigos alternativos se enseñan como «· también {códigos}».

### Pruebas

`tests/unit/modules/supply/supplierCatalogMerge.test.ts` — 12 pruebas del merge.
Junto con `receiptQty`: 23 pruebas, 2 ficheros, todas pasan.
`tsc --noEmit` limpio. `npm run build` limpio.
`eslint` sobre los dos ficheros: 4 errores, **los mismos 4 que ya había antes**
(`rules-of-hooks` en `useSuggested`, `set-state-in-effect` ×2 en efectos preexistentes).

## Criterios del encargo

| # | Criterio | Estado |
|---|---|---|
| 1 | Aceite Alto Oleico sale una sola vez | ✅ un formato activo → una fila |
| 2 | Aceite de Oliva Suave enseña envase, no "ml" | ✅ «Botella (250 ml)» / «Garrafa (5 L)» |
| 3 | El proveedor no repite artículos | ✅ 101→91, 81→76, 10→6, 10→9 |
| 4 | 59 formatos archivados y verificados | ⛔️ no aplica: 0 duplicados en Foodint |
| 5 | Ninguno de los 6 con movimiento tocado | ⛔️ no aplica: no se ha tocado ninguno |
| 6 | Verificado con la pantalla delante y captura | pendiente — de Julio |
