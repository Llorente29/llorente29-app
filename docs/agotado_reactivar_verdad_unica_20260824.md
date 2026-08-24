# «Agotado · reactivar» sigue sin funcionar — la causa real

Fecha: 24/08/2026 · **Migración propuesta, NO ejecutada.** Front sin tocar.

## Tenías razón, y mi diagnóstico del PR #87 estaba incompleto

El PR #87 arregló un caso real (el espejo en espera ofrecía el botón
equivocado durante la carga), pero **no era la causa de lo que tú veías**. Lo
di por bueno sin comprobar la cadena hasta el final. La causa es otra y es más
grave.

## El `onClick` sí llama a `setProductAvailability`. Y la llamada funciona.

Verificado línea a línea: `EnCartaTab.tsx:239` → `handleToggleAvailability(true)`
→ `setProductAvailability(item.id, true, 'manual')` → RPC
`set_product_availability`. Todo conectado, sin overlay, sin estado sin
inicializar.

Y la prueba de que llega al servidor está en la tabla `availability_event`
—**ocho** eventos `open` correctos hoy, origen `oficina`/`web`, sobre «Birria
Beef Bowl (AMB)»:

```
09:12:46  09:12:48  09:12:49 ×3   ← antes del deploy
10:20:05  10:20:10  10:20:32      ← después del deploy del PR #87
```

Ocho clics tuyos, ocho ejecuciones correctas, cero cambios en pantalla.

## Por qué: el 86 tiene DOS verdades y solo se mantiene una

```
_set_product_availability_core   escribe →  product_availability   (tabla de overrides)
la ficha y la lista de carta      leen  ←   menu_item.is_available (columna)
```

**La función del motor nunca ha escrito `menu_item.is_available`.** Reactivar
borra el override —el producto vuelve a venderse de verdad— pero la columna que
pinta la pantalla se queda como estaba. La ficha recarga, lee `false` otra vez,
y vuelve a dibujar «Agotado · reactivar». Silencio perfecto.

Los números que lo cierran, de «Birria Beef Bowl (AMB)»:

| dato | valor |
|---|---|
| `is_available` | `false` |
| `updated_at` | **14/08 09:23** — diez días sin tocarse |
| overrides vivos en `product_availability` | **0** |

Cero overrides significa que **el producto ya está reactivado** desde el primer
clic. Lo que falla no es la reactivación: es que la pantalla no se entera.

No hay ningún trigger que propague una cosa a la otra (comprobado: `menu_item`
solo tiene los de precio, `updated_at` y `stock_group`; `product_availability`
no tiene ninguno).

## El alcance es mayor de lo que parece

De las **510 fichas vivas** de la cuenta, **217 mienten**:

- **108** se pintan «agotado» y en realidad se están vendiendo.
- **109** se pintan «disponible» y el motor las tiene apagadas.

Y esto **alcanza también a la Tarea A del PR #86**, la de agotar desde la lista:
el badge, la opacidad y el icono de esa pantalla leen la misma columna
(`KitchenMenuPage:1095, 1157`), así que ese botón tiene exactamente el mismo
defecto — la RPC se ejecuta, el badge no cambia. Lo di por verificado y no lo
estaba: comprobé que la llamada llegaba a HubRise, no que la lista reflejara el
cambio.

**Por qué los espejos sí funcionan:** `swap_mirror` es la única función del
motor que sí escribe `menu_item.is_available`. Por eso ese camino nunca falló y
el del 86 sí.

## Lo propuesto (para que lo ejecutes tú)

`supabase/migrations/20260824T1100_availability_verdad_unica.sql`, con su
`REVERT_` al lado. Transaccional, dos partes:

1. **`_set_product_availability_core` pasa a mantener `menu_item.is_available`.**
   No asigna `p_is_available` a pelo: lo **recalcula** como «disponible = no
   queda ningún override que lo apague», para que un 86 puesto en otro local no
   se pierda al reactivar desde la oficina. Solo sobre los afectados y solo si
   cambia.
2. **Reparación de una vez** de las filas que hoy mienten. Sin esto, los
   productos ya reactivados seguirían pintándose «agotado» para siempre, porque
   nadie vuelve a llamar a la RPC sobre ellos.

**Los pares espejo quedan fuera del recálculo, a propósito.** `swap_mirror`
oculta el original mientras la promo está activa, y eso no es un agotado:
recalcularlo destaparía la promo al agotar cualquier producto de esa receta.
Hoy hay 1 espejo y 1 original con espejo.

### Lo que la migración haría, medido en producción (simulación de solo lectura)

| | filas |
|---|---:|
| a corregir | **224** |
| pasan a «disponible» | 115 |
| pasan a «agotado» | 109 |
| de ellas, fuera de Foodint | **7** |
| evaluadas | 1.094 |

**Las 109 que pasan a «agotado» no dejan de venderse por esto.** Ya están
apagadas en el motor y en las plataformas; lo único que cambia es que la
pantalla deja de decir lo contrario. Comprobado que `hubrise-catalog-publish`
decide qué publica por `is_active`, **nunca** por `is_available` (el apagado a
plataformas viaja por `availability-dispatch`, otro camino). La migración no
altera ni un producto en Glovo/Uber/JustEat.

Las **7 filas fuera de Foodint** son de otras cuentas y también están mal por el
mismo motivo. Si prefieres acotar la reparación a Foodint, es añadir un
`and mi.account_id = '51ad…'` al último `update`; dímelo y te lo cambio.

### Para ejecutarla

No la he aplicado: tu regla es que el SQL se revisa antes y lo ejecutas tú. Va
en un solo `begin/commit`, así que o entra entera o no entra. Si prefieres que
la aplique yo con `apply_migration`, dilo y lo hago.

## Front: nada que tocar

Con el motor manteniendo la columna, la ficha y la lista quedan correctas sin
cambiar una línea. El arreglo del espejo del PR #87 sigue siendo válido y
necesario — solo que resolvía otra cosa.

## Deuda que esto deja anotada

`menu_item.is_available` queda como **columna derivada** sin nada que lo
imponga. Un trigger sobre `product_availability` sería la garantía real; no lo
propongo hoy porque añade un punto de escritura nuevo en el camino caliente del
86 y prefiero que esto entre acotado. Cuando quieras, lo hablamos.
