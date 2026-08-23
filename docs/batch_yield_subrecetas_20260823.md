# ENCARGO «Rendimiento de batch en sub-recetas» — resultado

Fecha: 23/08/2026 · Migración **aplicada y verificada en producción** + UI.
`App.tsx` y `AppContext.tsx` sin tocar.

## Lo primero: dos números del encargo que no son los de producción

### 1 · No descontaba 300.000 g. Descontaba 300 g

El encargo dice que el multiplicador entra «en unidad base = gramos» y que por
eso el bowl se lleva 300 kg de arroz. **La unidad base del Arroz Criollo es
`kg`**, no gramos (verificado en `recipe_item.base_unit_id` → `kg`,
`factor_to_base` 1000). Medido con la función real, antes de tocar nada:

```
explode_recipe_to_raws(Birria Beef Bowl, 1)  →  Arroz Largo  300 g
```

El error era de **2,22×**, no de 2.000×. Que es, exactamente, el rendimiento del
batch expresado en kg (2,222). El arreglo hacía falta igual; la cifra del
diagnóstico no.

### 2 · La fórmula del §2.2, tal cual, deja el resultado 1.000 veces mal

El encargo propone `p_multiplier / v_yield` con `v_yield = batch_yield`. Con los
datos reales:

```
multiplicador que llega a explode = 0,15    (kg — la unidad base del ítem)
batch_yield tecleado ............. = 2222   (g — lo que pide el §2.5)
0,15 / 2222 × 2000 = 0,135 g     ← mil veces menos de lo correcto
```

El rendimiento **hay que normalizarlo a la unidad base del ítem** antes de
dividir. Con `_qty_in_base` (2222 g → 2,222 kg):

```
0,15 / 2,222 × 2000 = 135 g      ← correcto
```

Lo mismo en el auto-yield: sumar los `_qty_in_base` de los hijos da «2222 en
gramos» contra un multiplicador en kg — el mismo error de 1.000×. Se suma en la
unidad base **del padre**. Ambas cosas están corregidas en lo entregado; los
resultados que esperaba el encargo (135 g y 8,1 g) salen exactos.

## Lo entregado

**Migración `20260823T2000_batch_yield.sql`** (+ su reverso
`REVERT_20260823T2000_batch_yield.sql`, transcrito de producción *antes* de
aplicar):

1. `recipe_item.batch_yield` + `batch_yield_unit_id`, con `CHECK (batch_yield IS
   NULL OR batch_yield > 0)` — un rendimiento de 0 es una división por cero
   esperando turno, y eso se prohíbe en la tabla, no solo en la pantalla.
2. **`_batch_yield_in_base(item)`**: el rendimiento en la unidad base del ítem.
   Declarado (normalizado con `_qty_in_base`) o automático (suma de las líneas
   medibles en esa base). Una sola fuente de verdad para stock, coste y UI.
3. `explode_recipe_to_raws`: divide el multiplicador por ese rendimiento.
4. `kitchen_recompute_item`: divide el coste igual, para que el plato no
   descuente 135 g de arroz cobrándose 2 kg. `packaging_cost` se divide con el
   total para que siga cumpliéndose `total = comida + packaging`.
5. **`kitchen_batch_yield(item)`**: RPC para la pantalla. No estaba en el
   encargo y hace falta: sin ella la UI tendría que reimplementar la fórmula en
   TypeScript y desincronizarse a la primera. Devuelve además si el rendimiento
   es declarado o automático, y cuántas líneas se quedan fuera del automático.

**`kitchen_recipe_breakdown` no se toca**, y es correcto que no se toque: cada
línea es `coste_del_hijo × cantidad`, y el coste del hijo ya viene dividido.
Dentro de la preparación sus líneas siguen mostrando el batch entero, que es lo
que quieres ver al editarla.

**UI** (`RecipeEscandalloTab`): en la cabecera de una preparación, «Este batch
produce [___] [unidad]», el coste por unidad de rendimiento, y si el número es
tuyo o calculado. El selector solo ofrece unidades de la misma dimensión que la
base (un rendimiento en litros para una receta en kg lo descartaría el motor).
Al guardar se recostea la preparación **y los platos que la usan** — si no, el
plato seguiría cobrando el batch entero.

**Tipos**: `batch_yield` / `batch_yield_unit_id` y `kitchen_batch_yield` añadidos
a `database.ts`, `kitchen.ts` y `recipeItemService`. No he regenerado
`database.ts` entero (21.239 líneas): un regenerado arrastra al PR todo el drift
acumulado de otras tablas y lo vuelve irrevisable. La edición es exactamente lo
que el regenerado habría escrito en ese bloque.

## Verificación (hecha, no prevista)

**Caso 1 — Arroz Criollo.** Sin declarar nada, el auto-yield ya da **2,222 kg**:

| | antes | ahora | esperado §2.5 |
|---|---:|---:|---:|
| Arroz Largo | 300 g | **135,0135 g** | 135 g |
| Aceite de Birria | 18 g | **8,1008 g** | 8,1 g |
| Caldo Vegetal | 9 g | 4,0504 g | — |
| Sal | 6 g | 2,7003 g | — |

**Caso 2 — auto-yield.** Preparación de 100+50+50 g usada a 100 g por un plato,
creada y comprobada **dentro de una transacción con ROLLBACK** (producción sin
tocar, verificado después: 0 restos):

```
_batch_yield_in_base  = 200        (esperado 200)
mayor ingrediente     = 50 g       (100/200 × 100 = la mitad)  ✓
```

**Caso 3 — platos existentes intactos.** Huella md5 de la explosión de 30 platos
tomada antes (`c77461d6…`, 238 filas) y después (`61b1016f…`, 238 filas). Cambia,
y **es correcto que cambie**: el Birria Beef Bowl está entre esos 30. Que ningún
otro pueda haberse movido no lo deduzco, lo demuestro con el catálogo entero:

```
líneas cuyo hijo es 'recipe' en TODA la base .... 1   (la del bowl)
líneas cuyo hijo es 'raw' / 'packaging' ......... 1.275 / 353   (hojas)
ítems con rendimiento aplicable ................. 1   (Arroz Criollo)
```

No hay un solo `dish` dentro de otro `dish`, ni ningún `batch_yield` declarado.
El único árbol que puede cambiar es el del bowl.

**Front:** `tsc --noEmit` limpio · `npm run build` ✓ · ESLint sin regresiones
(los 6 avisos de `RecipeEscandalloTab` son exactamente los de antes; el
`exhaustive-deps` que introduje lo quité) · tests `6 failed | 239 passed`,
idéntico a `main` (fallos previos ajenos).

## Lo que queda pendiente, y es importante

**El coste todavía no está recalculado.** `kitchen_recompute_item` tiene guard de
tenancy (`belongs_to_account`) y desde el MCP `auth.uid()` es NULL, así que no
puedo dispararlo yo:

```
ERROR: kitchen_recompute_item: sin acceso al item 4868d63c-…
```

Estado real ahora mismo: **el stock ya reparte bien; el coste sigue inflado
2,22×** hasta que se recostee. Comprobado en solo lectura lo que saldrá:

| | ahora | tras recostear |
|---|---:|---:|
| Arroz Criollo | 2,3723 € (el batch) | **1,0677 €/kg** |
| lo que cobra el bowl | 0,3558 € | **0,1601 €** |

Se arregla solo en cuanto abras la preparación y toques el rendimiento (la UI
recostea la preparación y sus platos), o con «Recostear todo» de Artículos. Es
el único paso que queda de este encargo.

## Decisiones tomadas (dime si alguna no te vale)

1. **`CREATE OR REPLACE`, no `DROP` + `CREATE`.** El §5 lo dejaba abierto:
   comprobado en `pg_proc` que no hay overloads de ninguna de las dos funciones,
   y la firma no cambia. Un DROP innecesario solo añade riesgo.
2. **Auto-yield solo con las líneas medibles en la unidad base del ítem.** Sumar
   gramos con unidades sueltas no significa nada. Si no hay ninguna medible, no
   hay rendimiento y la receta se toma como 1 unidad base — que es justo lo que
   necesitan las «bases» en `ud` del encargo anterior. La UI avisa cuando el
   cálculo automático deja líneas fuera.
3. **Rendimiento declarado pero no convertible → sin rendimiento**, en vez de
   inventar un número. Si alguien teclea litros en una receta que se mide en
   unidades, el motor no divide y la pantalla lo dice.
4. **Las columnas no se borran en el reverso.** Revertir las funciones las deja
   inertes; borrarlas destruiría lo que hubieras tecleado. El DROP va aparte y a
   conciencia, comentado en el propio fichero de reverso.
