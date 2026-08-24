# URGENTE «No se puede quitar un plato de una carta» — resultado

Fecha: 23/08/2026 · Solo front. **Cero migraciones, cero cambios de motor SQL.**
`App.tsx` sin tocar.

## Qué lo impedía

Una línea, con su comentario explicando el porqué:

```ts
// src/modules/kitchen/components/ProductPlacementSection.tsx
async function handleRemove(p: RecipeBrandPresence) {
  if (busy || p.brandId === currentBrandId) return   // no quitar la marca que estás viendo
```

`archiveMenuItem()` existía y funcionaba, pero **su único llamador en toda la app
era ese**, y se negaba justo para la marca que tienes delante. Como la ficha
siempre se abre dentro de una marca, «quitar este plato de esta carta» no se
podía hacer desde ningún sitio. En el chip de la marca actual ni siquiera se
pintaba el botón: en su lugar iba el texto «actual».

Y en la **lista de la carta** (`KitchenMenuPage`) no había ninguna acción de
quitar productos — la única papelera de esa pantalla borra *categorías*.

## Los duplicados que motivaron el encargo

Los dos que hay vivos en Ay Mamita Bowls los creó la ingesta de Last el 26/07:

| Producto | menu_item | receta | precio | creado |
|---|---|---|---:|---|
| Birria Chicken Bowl (AMB) | `e09e1cb4` | `912d49c4` | 12,90 € | 20/06 |
| Birria Chicken Bowl (AMB) | `3e76ed32` | **NULL** | 12,90 € | 26/07 |
| Cochinita Bowl (AMB) | `7a72dab4` | `8e650b48` | 12,90 € | 20/06 |
| Cochinita Bowl (AMB) | `7e872fb4` | `8e650b48` | **0 €** | 26/07 |

Esto obliga a **dos** puntos de entrada, no uno:

- El duplicado de Cochinita comparte receta → se ve desde la ficha del plato.
- El de Birria Chicken Bowl tiene **`recipe_item_id = NULL`**, así que
  `listBrandsForRecipe` y `listMenuItemsUsingRecipe` (ambos buscan *por receta*)
  **nunca lo devuelven**: desde la ficha es invisible. Solo aparece en la lista
  de la carta. Un botón únicamente en la ficha habría dejado ese caso —
  precisamente el que no se puede limpiar hoy — igual de bloqueado.

## Lo entregado

**1 · Ficha del plato** (`ProductPlacementSection`, pestaña «En carta»)

- Se puede quitar el producto de la carta que estás viendo. El chip lleva ahora
  su botón, además de la etiqueta «actual».
- El chip se identifica por **menu_item, no por marca**: con dos copias en la
  misma marca (el caso real) se distingue cuál se quita.
- Confirmación antes de archivar, diciendo qué pasa y qué no.
- `onRemovedCurrent` avisa al padre: quitar el que estás viendo dejaba la ficha
  sin sujeto, que es el problema que aquel `return` esquivaba en vez de
  resolver. Ahora `CatalogFichaPage` **reubica**: si la receta se vende en más
  productos salta al siguiente (el caso duplicado: quitas uno y sigues ahí); si
  entraste por el escandallo se queda y lo dice; si no, vuelve a la lista.

**2 · Lista de la carta** (`KitchenMenuPage`)

- Botón «Quitar de la carta» en cada fila, con la misma confirmación. Es la vía
  para los duplicados huérfanos que la ficha no ve.

Ambos archivan el `menu_item` (`is_active=false` + `archived_at`). Nada se
borra: el escandallo, el histórico de ventas y la trazabilidad siguen intactos,
y volver a añadirlo lo reactiva (`addRecipeToBrand` ya contempla el archivado,
porque el índice único cuenta también los archivados).

## Verificado

Que archivar **cumple lo que promete**, no solo que compila:

- `listMenuItems` filtra `archived_at IS NULL` → desaparece de la carta.
- `hubrise-catalog-publish` publica solo `is_active !== false` → deja de
  publicarse en plataformas al republicar.
- `menuLinkService` ya filtra archivados en sus dos consultas.
- `tsc --noEmit` limpio · `npm run build` ✓ · ESLint **16 avisos, exactamente
  los 16 del baseline** (comprobado en un worktree limpio de `main`) · tests
  `6 failed | 239 passed`, idéntico a `main` (fallos previos ajenos).

El flujo en vivo (pulsar y ver el plato salir de la carta) queda para ti tras el
deploy: no he tocado ningún dato de producción.

## Deuda que deja a la vista, sin tocar

La RLS de `menu_item` no es la de sus hermanas:

| tabla | escritura |
|---|---|
| `recipe_item`, `recipe_line` | `current_user_is_admin_or_manager_of` |
| `menu_item`, `menu_category`, `menu_item_override` | **`current_user_is_admin_of`** |

Un *manager* puede editar el escandallo pero no la carta. **Hoy no bloquea a
nadie**: la cuenta tiene 1 admin y 8 workers, cero managers, y el módulo exige
rol manager para entrar. Pero el día que exista un encargado con rol manager,
estos botones le fallarán con un error de permisos, no con un mensaje útil. No
he tocado RLS: cambiar seguridad sin una necesidad demostrada no toca, y menos
en un encargo urgente. Si quieres que un manager pueda gestionar cartas, es una
migración de tres líneas y te la preparo.
