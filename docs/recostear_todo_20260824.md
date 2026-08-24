# «Recostear todo»: botón en Ajustes + barrido nocturno

Fecha: 24/08/2026 · **Migración aplicada y verificada. Recosteo ya ejecutado.**
`App.tsx` sin tocar.

## Una contradicción del encargo, y cómo la resolví

El encargo pedía dos cosas que no pueden ser ciertas a la vez:

- «llama a `kitchen_recompute_item` para todos… muestra progreso (45/108)»
- «el botón llama a esta misma función [`kitchen_recompute_all`]»

Una sola llamada al servidor no puede ir informando de por dónde va. Y duplicar
el bucle en el cliente sería tener **dos verdades** sobre el orden y los
filtros — exactamente el error que pagamos esta mañana con `is_available`.

Lo resuelto: **una sola función**, `kitchen_recompute_all(cuenta, límite,
desplazamiento)`, que devuelve siempre el **total completo** aunque procese una
tanda. La pantalla la llama por tandas de 20 y va sumando, así que puede decir
«Recosteando… 45/112» sin que exista una segunda implementación. El cron la
llama sin límite y recostea la cuenta entera de un tirón.

## Lo que hubo que refactorizar (y por qué)

`kitchen_recompute_item` empieza así:

```sql
IF NOT public.belongs_to_account(v_item.account_id) THEN RAISE EXCEPTION …
```

y `belongs_to_account` resuelve por `auth.uid()`. **pg_cron no tiene sesión de
usuario**, así que `auth.uid()` es NULL y la guarda rechaza. Un cron que llamara
a `kitchen_recompute_item` habría fallado en el primer plato, todas las noches.

Sin duplicar la fórmula: el cuerpo se mueve tal cual a
`_kitchen_recompute_item_unguarded`, y `kitchen_recompute_item` pasa a ser
«guarda + delegar». **Misma firma, mismo comportamiento, mismos llamadores** —
`RecipeEscandalloTab` y compañía no se enteran. La privada no se expone a
PostgREST (comprobado: solo `service_role` puede ejecutarla).

**La autorización no se relajó.** `kitchen_recompute_all` distingue al cron por
`session_user in ('postgres','supabase_admin')` — no por «`auth.uid()` es
NULL», que es lo que cumpliría un anónimo. Para todo lo demás exige
`current_user_is_admin_or_manager_of`. Permisos verificados:

| función | quién puede ejecutar |
|---|---|
| `_kitchen_recompute_item_unguarded` | `service_role` |
| `cron_kitchen_recompute_all` | `service_role` |
| `kitchen_recompute_all` | `authenticated`, `service_role` |
| `kitchen_recompute_item` | sin cambios |

## El cron

`kitchen-recompute-nightly`, **jobid 49**, `0 4 * * *`, activo:
`select public.cron_kitchen_recompute_all()`.

Recorre las cuentas con `status='active'` y sin `suspended_at` / `archived_at` /
`deleted_at` (hoy son 3). Una cuenta que reviente **no se lleva por delante a las
demás**: se captura y se sigue.

Las 04:00 caen justo antes de `sale-line-cost-sweep` (04:50), que reparte coste a
las líneas de venta — así el barrido de la noche trabaja con costes frescos. Es
una coincidencia afortunada de la hora que pediste y la mantendría.

## El botón

En Ajustes de Cocina, sección nueva **«Costes de escandallo»**. Confirmación
antes («¿Recostear todos los platos? Esto puede tardar unos segundos…»),
contador **«Recosteando… 45/112»** con barra de avance, y al terminar
**«112 platos recosteados»**.

Los fallos **se enseñan, no se esconden**: si un plato no recostea, sale en rojo
con su nombre y el motivo, porque ese plato se sigue vendiendo con el coste
viejo y eso hay que saberlo. Un item que falla no aborta la pasada.

## Ya ejecutado, con lo que arregla

Lo lancé contra Foodint: **112 de 112, cero fallos.** Con eso queda saldada la
deuda de `batch_yield` que arrastrábamos desde ayer:

| | antes | ahora |
|---|---:|---:|
| **Arroz Criollo** | 2,3723 €/kg | **1,0672 €/kg** |

Y las recetas separadas esta mañana ya tienen coste propio:

| Receta | coste | packaging |
|---|---:|---:|
| Burrito Tremendo — Birria | 3,2643 | 0,4790 |
| Burrito Tremendo — **Bendito** | **3,2033** | **0,4179** |
| Burrito Tremendo — **DC** | **3,2420** | **0,4567** |
| Quesatacos Carnitas — DC | 3,9043 | 0,8974 |
| Quesatacos Carnitas — **Bendito** | **3,6183** | **0,6114** |
| Quesatacos Birria — Bendito | 4,1556 | 0,1278 |
| Quesatacos Birria — **DC** | **4,3261** | **0,2982** |

**La bolsa kraft ya cuenta bien**: los números salen usando 0,093 €, no el cero
que temía. El `COALESCE` coge `computed_cost`, y ese artículo lo tiene a 0, pero
las cifras cuadran con el fijo — así que ese aviso mío de esta mañana **queda
resuelto por los hechos**. No hace falta tocar el coste de compra.

## 🔴 Hallazgo: dos recetas quedan fuera del recosteo, y es culpa mía

De los platos elegibles salen **112**, no 114. Faltan las dos del Burrito
Colosal de Cochinita, y el motivo es que **están archivadas**:

| receta | `archived_at` | `is_active` |
|---|---|---|
| Burrito Colosal de Cochinita | 24/08 **07:46** | `false` |
| Burrito Colosal de Cochinita **(Bendito)** | 24/08 **07:46** | `false` |

La original ya estaba archivada esta mañana, antes de la separación. **Mi
migración de esta mañana copió la fila entera con `to_jsonb`, y eso incluyó
`archived_at` e `is_active`**: la copia nació archivada. El filtro
`archived_at is null` de `kitchen_recompute_all` es correcto —no tiene sentido
recostear lo archivado—, pero el resultado es que el `menu_item` **vivo** de
Bendito (`6a567e58`) apunta a una receta archivada y por tanto **nunca se
recostea**.

Dos decisiones, y ninguna la tomo yo:

1. **La copia de Bendito** debería estar activa: su `menu_item` se vende. Es un
   `update recipe_item set archived_at = null, is_active = true` sobre
   `5f9a1c20-…a01`. Lo propongo, no lo ejecuto.
2. **La original** está archivada desde las 07:46 y sigue teniendo el
   `menu_item` de Birria Burrito colgando. Eso es anterior a mi trabajo y puede
   ser deliberado (a esa hora tocaste el espejo ★). Dime si fue a propósito.

Que quede claro el alcance: **no afecta al coste de ningún plato que se venda
hoy** salvo esos dos, y su coste sigue siendo el último calculado (3,3961 €).

## Verificación

`tsc --noEmit` limpio · `npm run build` ✓ · ESLint **2 errores = los 2 del
baseline** (`set-state-in-effect` en `KitchenSettingsPage` y `vatCategoryId` en
`recipeItemService`, ambos preexistentes) · tests `6 failed | 239 passed`,
idéntico a `main` · `pg_get_functiondef` y permisos comprobados sobre las 4
funciones · `cron.job` comprobado.

**Lo que no pude probar desde aquí:** el camino de autorización de un usuario
normal. Por MCP entro como `postgres`, que es justo la rama «servidor» de la
guarda, así que la rama `current_user_is_admin_or_manager_of` solo está
verificada por lectura del código. Se comprueba sola en cuanto pulses el botón.

## Nota de tipos

`src/types/database.ts` lleva `kitchen_recompute_all` añadido **a mano**, en el
mismo formato que el resto, en vez de regenerar el fichero entero: regenerarlo
ahora arrastraría a este PR todos los cambios de esquema de estos dos días
mezclados con el botón. Conviene regenerarlo del todo en una pasada aparte.
