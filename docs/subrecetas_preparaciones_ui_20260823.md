# ENCARGO «Desbloquear sub-recetas (preparaciones) en la UI» — resultado

Fecha: 23/08/2026 · Solo front (UI + un service). **Cero migraciones, cero cambios
de motor SQL, cero Edge Functions.** `App.tsx` y `AppContext.tsx` sin tocar.

## Lo primero: tres cosas del encargo que hay que corregir

### 1 · El §1.3 ya estaba hecho (no hace falta ALTER)

El encargo plantea añadir `child_type` al retorno de `kitchen_recipe_breakdown`
(opción A) frente a un JOIN en cliente (opción B). **Ya existe desde el 22/06**:

- Migración `20260622T1200_packaging_breakdown_child_type.sql` en el repo.
- Verificado en la BD viva:
  ```
  kitchen_recipe_breakdown → TABLE(line_id, child_item_id, child_name,
    child_type, quantity, quantity_net, unit_abbr, line_cost,
    needs_review, child_needs_review)
  ```
- Y `recipeLineService.ts` ya lo mapeaba a `childType`, y el editor ya lo usaba
  para partir el escandallo en **Ingredientes / Sub-recetas / Envases**.

**No hay ninguna migración que escribir.** El dato estaba; lo que faltaba era el
indicador ↗ encima de él.

### 2 · Buena parte del §1.5 tampoco faltaba

El buscador del escandallo **ya incluía preparaciones**: carga `raw + recipe +
packaging` y la sección «Sub-recetas» abre el alta filtrada a `type='recipe'`.

### 3 · El bloqueo real era una condición de dos palabras, puesta a mano

En `RecipeEscandalloTab.tsx`, los dos botones de «crear al vuelo» excluían
explícitamente las sub-recetas:

```tsx
{addSearch.trim() !== '' && addKind !== 'recipe' && (   // ← aquí
  <button …>Crear «{addSearch}» como {addKindLabel} nuevo</button>
)}
```

Es decir: en la sección Sub-recetas podías **buscar** una preparación, pero si no
existía, la UI **no ofrecía crearla**. Y aunque hubiera ofrecido, el alta creaba
siempre `type: addKind === 'packaging' ? 'packaging' : 'raw'` — una preparación
habría nacido como ingrediente crudo.

Eso, más la ausencia de la pestaña en la lista de artículos, es todo lo que
mantenía las sub-recetas fuera de la app.

---

## Lo que se entrega

| § | Qué | Dónde |
|---|---|---|
| 1.1 | Crear preparación desde el buscador del escandallo | `RecipeEscandalloTab.tsx` |
| 1.2 | Pestaña **Preparaciones** en Artículos, con badge y «usado en N platos» | `KitchenItemsPage.tsx`, `SimpleArticleCreateModal.tsx` |
| 1.3 | Indicador **↗** en las líneas que son sub-receta | `RecipeEscandalloTab.tsx` |
| 1.4 | «Usado en N platos» en la cabecera de la preparación, desplegable | `RecipeEscandalloTab.tsx`, `recipeLineService.ts` |
| 1.5 | Badge ↗ en los resultados del buscador | `RecipeEscandalloTab.tsx` |

### 1.1 · Alta de preparación (E2b)

El mini-formulario ya conocía el tipo que se está añadiendo (`addKind`), así que
**no hace falta un selector nuevo**: la sección desde la que pulsas ➕ ya dice si
quieres un ingrediente, un envase o una sub-receta. Lo que cambia:

- El alta crea `type='recipe'` cuando se pide desde la sección Sub-recetas.
- `is_stockable` queda a `false` — es el **default de la columna**, no hace falta
  tocarlo: una preparación no se inventaría, se atraviesa hasta los crudos.
- `needs_review=true` (nace vacía: su coste es 0 hasta que tenga líneas).
- **No pide unidad ni coste**, como pedía el encargo: el coste sale de sus
  líneas vía `kitchen_recompute_item`. Ver la salvedad de la unidad más abajo.

### 1.2 · Pestaña Preparaciones

La página ya listaba por pestañas excluyentes (Ingredientes · Packaging ·
Herramientas), así que la preparación entra como **una pestaña más** en vez de
mezclarse en la de ingredientes. La fila cambia lo que no aplica:

- **No** hay columna «Coste fijo» (coste de compra: una preparación no se compra).
- «Familia» → **«Usado en N platos»** (`kitchen_raw_usage_counts`, que ya contaba
  padres `type='dish'` de cualquier hijo — no hizo falta tocarla).
- «Coste computado» → **«Coste de la receta»**.
- Al pulsarla **no** se abre la ficha de ingrediente (proveedores, formatos, IVA:
  nada de eso aplica) sino **su escandallo** — `/kitchen/recetas?recipe=<id>`.

### 1.4 · «Usado en N platos»

`listParentsUsingItem()` nuevo en `recipeLineService.ts` (dos SELECT simples,
sin RPC ni migración). Se muestra en la cabecera del escandallo solo si el item
es `type='recipe'`, y despliega la lista de platos; cada uno abre su escandallo.

---

## Hallazgo que NO estaba en el encargo, y que conviene decidir antes de crear las 4 bases

**El motor no normaliza el coste de una sub-receta por lo que rinde.**
`kitchen_recompute_item` escribe en `computed_cost` la **suma de sus líneas**, y
`explode_recipe_to_raws` la trata como **coste por unidad base**. Las dos cosas
solo cuadran si la receta de la preparación está escrita **para 1 unidad base**.

La única sub-receta que existe hoy no cumple esa condición:

**Arroz Criollo** (`4868d63c-…`, unidad base **kg**) está escrita como un batch:

| Ingrediente | Cantidad |
|---|---|
| Arroz criollo | 2 kg |
| Agua Mineral | 4 L |
| Aceite de Birria | 120 g |
| Caldo Vegetal en Polvo | 60 g |
| Sal | 40 g |
| Colorante amarillo | 2 g |

Eso son **~6,2 kg de producto**, no 1 kg. Consecuencia medida en producción —
`explode_recipe_to_raws` del plato **Birria Beef Bowl (AMB)** (que lo usa a
0,15 kg):

```
Arroz criollo ............ 300 g     ← debería ser ~48 g
Caldo Vegetal en Polvo ..... 9 g
Aceite de Birria .......... 18 g
Sal ........................ 6 g
Colorante .................. 0,3 g
```

**Cada bowl descuenta ~6,2× de más** de todo lo que hay dentro del arroz criollo,
y su coste va inflado en la misma proporción. No es un fallo de este encargo (el
dato es de julio y lo cargó SQL directo), pero **es la trampa exacta en la que
caen las 4 bases del encargo si se escriben "en grande"**.

Dos salidas, y la elección es tuya:

1. **Convención (lo entregado).** La preparación se crea en **`ud`** y la UI dice,
   en el propio formulario, que *el escandallo describe 1 ud* — que es justo como
   funcionan las 4 bases del encargo (Base Napolitana = 1 ración, el plato la usa
   1 ud). Cero cambios de motor. Es lo que hay hoy en la rama.
2. **Rendimiento real en el motor**, usando `recipe_item.yield_portions` (la
   columna ya existe, hoy siempre `NULL`) para dividir. Toca
   `kitchen_recompute_item` **y** `explode_recipe_to_raws` → fuera del alcance de
   este encargo, y con efecto retroactivo sobre costes ya calculados.

Para Arroz Criollo, si eliges (1), lo que cuadra es reescribir sus cantidades a
1 kg. **No lo he tocado** — es dato de producción y toca ejecutarlo a ti:

```sql
-- PROPUESTA (no ejecutada). Arroz Criollo: batch ~6,2 kg → receta por 1 kg.
-- Revisar los factores antes de correr; y después recostear el plato que lo usa.
begin;
  update recipe_line set quantity_net = 0.321, quantity_gross = 0.321
   where parent_item_id = '4868d63c-6933-440e-a9e2-0aeb3aec5d66'
     and child_item_id  = (select id from recipe_item
                            where name = 'Arroz criollo' and type = 'raw'
                              and account_id = '51ad1792-6629-4ef7-833a-b57b09a86710');
  -- … ídem para agua (0,643 L), aceite (19,3 g), caldo (9,6 g), sal (6,4 g),
  --    colorante (0,32 g)
  select public.kitchen_recompute_item('4868d63c-6933-440e-a9e2-0aeb3aec5d66');
  select public.kitchen_recompute_item('d9c6fc3b-d37c-4d48-845e-6646c9521669'); -- Birria Beef Bowl
commit;
```

---

## Verificación

Hecho aquí:

- **`tsc --noEmit`** limpio.
- **`npm run build`** ✓ (9,7 s).
- **ESLint** sobre los 4 ficheros tocados: **9 avisos, los mismos 9 que ya había
  antes** (`react-hooks/set-state-in-effect` y un `toFixed`, todos preexistentes).
  El único que introduje lo quité reescribiendo el efecto.
- **Tests:** `6 failed | 239 passed`. **Idéntico en `HEAD` sin mis cambios**
  (comprobado en un worktree limpio): son fallos previos de
  `salesChannelsService.mappers` y compañía, no de esta rama.
- **Motor, contra la BD viva:** confirmado que `explode_recipe_to_raws` atraviesa
  la sub-receta hasta los crudos (tabla de arriba). El §3.4 del encargo ya se
  cumple sin tocar nada.

Pendiente de ti, en vivo (§3.1–3.5), con «Base Napolitana TEST»: crear desde el
escandallo, añadirle los 7 ingredientes, usarla en un plato, ver ↗ y el contador,
y vender una unidad para ver los `stock_movement`.

## Decisiones tomadas (dime si alguna no te vale)

1. **Unidad base `ud` fija, sin selector** en el alta de preparación. El encargo
   pedía «solo nombre», pero `recipe_item.base_unit_id` es **NOT NULL**: hay que
   poner una. Se elige `ud` y se explica la convención en el formulario. Si luego
   hace falta otra (una salsa en kg), se cambia en la ficha del artículo, que ya
   permite editar la unidad base.
2. **Pestaña propia** en vez de mezclar preparaciones en la lista de
   ingredientes. El encargo pedía las dos cosas; la página es de pestañas
   excluyentes y no tiene «Todos», así que mezclarlas habría requerido rehacer
   los filtros de familia y las acciones masivas de IA, que no aplican a una
   preparación.
3. **Sin selector de tipo en el mini-form** (§1.1). La sección desde la que se
   pulsa ➕ ya determina el tipo; añadir un desplegable sería preguntar dos veces
   lo mismo.
