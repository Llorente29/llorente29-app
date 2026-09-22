# RECON — El vigía que caza el 100 % de lo vendido que no descuenta

> 22/09/2026, 21:4x. Encargo de Julio a raíz del aviso #637.
> Cuenta Foodint `51ad1792-6629-4ef7-833a-b57b09a86710`.
> **Nada aplicado. Nada escrito en la base.** Esto es el reconocimiento.

## Lo que está probado: el cierre cierra

El encargo dice que lo demás son detalles y que el encargo de verdad es que
«las casillas cierren contra el total vendido». **Cierra, al céntimo.**

| casilla | líneas | euros |
|---|---:|---:|
| 1 · sin casar con la carta | 29 | 206,13 € |
| 2 · sin ficha y sin descontar | 7 | 75,10 € |
| 3 · con ficha y cero movimientos | 6 | 81,60 € |
| 4 · descuenta, le falta un ingrediente | **93** | **1.897,42 €** |
| 5 · la comida sí, el envase nunca | 1.710 | 24.486,51 € |
| 6 · completo | 497 | 7.498,70 € |
| **TOTAL** | **2.342** | **34.245,46 €** |

Las seis suman exactamente el total. La consulta está en
`claude/folvy_cierre_por_euros_20260922.sql`.

**Y los dos falsos positivos del encargo se caen solos, sin excluirlos a mano.**
Porque lo esperado sale de `_sale_line_raw_consumption`, la propia función del
motor: un combo sin ficha carga a la línea padre y la función lo sabe; los
`modifier` no conducen y la función tampoco los cuenta. No aparecen porque no
pueden aparecer, no porque los hayamos tapado.

## Tres cosas que cambian el diseño, y no estaban en el encargo

### 1. El envase es INVISIBLE para el motor, no «filtrado»

El encargo sospecha que «el consumo filtra por `type = 'raw'`». Leído el código,
es más limpio y más difícil de arreglar: `explode_recipe_to_raws` para en
`raw`/`tool`/receta stockable; un `packaging` no tiene líneas hijas, así que cae
en la rama compuesta y **devuelve cero filas**. No hay filtro que quitar.

Consecuencia para el vigía: **la casilla 5 no puede salir de la función del
motor.** Preguntarle al motor por el envase siempre dirá que todo va bien. Se
mide contra el escandallo (`recipe_line` → `recipe_item.type='packaging'`), y por
eso en la consulta va por su propio camino.

Esto también explica el dato que al encargo le chirriaba: la «Caja Milanesa
Haus» tiene `is_stockable = true` y no se mueve, y las «Patatas Bastón» lo tienen
a `false` y sí. **`is_stockable` no pinta nada aquí**; lo que decide es el `type`.

### 2. La casilla 4 es 93 líneas, no 1 — y parte es ruido del método

El encargo daba 1 línea / 13,10 €. Salen **93 / 1.897,42 €**.

Pero el patrón delata que no todo es agujero: hay **22 líneas con el mismo
importe exacto y siete ingredientes faltando a la vez**. Eso no es el motor
saltándose siete cosas. Es que **`_sale_line_raw_consumption` calcula lo esperado
con la receta de HOY, y los movimientos se escribieron con la receta del DÍA DE
LA VENTA.** Si alguien añade un ingrediente hoy, todas las ventas anteriores de
ese plato aparecen como incompletas y no falta nada.

**No doy el número del reparto.** Lo intenté cuantificar dos veces y las dos
consultas salieron mal —la primera no ataba plato con ingrediente, la segunda
contaba líneas por duplicado—. Antes que un número cómodo y falso, nada.

**Es el siguiente paso y decide si el vigía avisa o grita en falso.** Un vigía
que marca como agujero cada edición de escandallo se apaga solo en una semana.

### 3. No reproduzco el total del encargo, y eso es parte del encargo

El encargo dice 2.343 líneas / 34.309,96 €. Me salen **2.342 / 34.245,46 €**.
Una línea y 64,50 €.

Descartado: **no es la zona horaria** (UTC, Madrid y día-de-negocio a las 04:00
dan los tres exactamente lo mismo), y **no hay ninguna línea anulada de ese
importe** en la ventana.

No lo he explicado. Y es literalmente el punto 1 del encargo: **mientras el
universo no viva en un solo sitio, dos personas honestas sacan dos números.** Por
eso la definición del universo va dentro de la consulta, con su comentario, y no
en la cabeza de quien la escriba la próxima vez.

## Lo que queda por hacer, en orden de lo que desbloquea

1. **Separar la casilla 4** entre agujero real y deriva de receta. Sin esto el
   vigía no se puede encender. Lo más limpio probablemente no sea fechar
   recetas, sino que el motor **deje escrito lo que descartó** (punto 4 del
   encargo): entonces la pregunta se contesta leyendo, no deduciendo.
2. **La tabla de descartes** (punto 4). Convierte la mitad de este encargo en una
   consulta de dos líneas, ahora y siempre. Solo **añade** registro, no toca el
   cálculo.
3. **El vigía**, con el cierre dentro, por día / local / marca, con las 72 h de
   gracia y la severidad por dinero.
4. **El silencio de un canal** (punto 6) y **los anulados** (punto 7).
5. **El envase**: decisión de Julio antes de tocar nada.

## Lo que NO he tocado

Ni el motor, ni los adaptadores, ni ninguna venta. Cero escrituras.

## Una pregunta para Julio, la que bloquea

**El envase: ¿descuenta o sale del escandallo?**

Son **24.486,51 € de venta en diez días** en esa casilla, y 1.337,67 € de coste
de envase en 30 días. Es la casilla más gorda con diferencia, y hasta que no se
decida, el vigía tiene que enseñarla como causa propia y no mezclarla con las
demás — que es como está montada la consulta.

---

# ADENDA — 22/09, 22:0x. «El envase descuenta, arréglalo»

## El titular no era el del encargo

El encargo decía: «si el envase debe descontar, se arregla; si no, no puede
estar en el escandallo dando un coste de plato que no es real».

**Ya estaba dando el coste, y el coste era real.**
`_kitchen_recompute_item_unguarded` suma **todas** las líneas del escandallo a
`computed_cost` —envase incluido— y guarda en `packaging_cost` solo la rebanada,
para informar. Medido:

| plato | `computed_cost` | explosión | envase |
|---|---:|---:|---:|
| DSH-00010 Kebab de Pollo | 2,3636 | 2,0882 | 0,2754 |
| DSH-00015 Rollitos Feta | 1,6941 | 1,4700 | 0,2241 |
| DSH-00389 Patatas Harisa | 2,7122 | 2,4654 | 0,2469 |

Cuadra al céntimo en las tres. O sea: **la cuenta de resultados está bien y lo
único roto es el stock.** No es un arreglo de coste, es un arreglo de
inventario — y por eso **no hay riesgo de duplicar coste**: `computed_cost` no
sale de la función que se toca.

## El arreglo: una condición, una palabra

```sql
IF v_item.type IN ('raw', 'tool', 'packaging')   -- entra 'packaging'
   OR (v_item.type = 'recipe' AND COALESCE(v_item.is_stockable, false)) THEN
```

No había filtro que quitar. Un `packaging` no es raw ni tool ni receta
stockable, así que caía a la rama compuesta, buscaba líneas hijas, no tenía, y
devolvía cero filas. **Invisible por construcción.**

## El terreno, medido antes de tocar (escenario p8 del 10/09)

| | |
|---|---|
| envases activos | 60 |
| **sin unidad base** | **0** |
| en escandallo y sin coste | 1 → la guarda 2 lo caza |
| líneas de escandallo de envase sin unidad | **0** |
| ya con fila de stock | 62 |
| `recipe_item_location_stock` NOT NULL | id, account_id, recipe_item_id, location_id, qty_on_hand, updated_at |

**`stock_value` no es `NOT NULL` aquí**, así que el fallo exacto de la p8 —que
abortaba la transacción entera y se llevó 79 pedidos— **no aplica**. El terreno
es más firme de lo que temía.

## 🔴 No la paso, y llevo tres guardas para que no se pase sola

`supabase/migrations/20260922T2330_el_envase_descuenta.sql`.

**Esto es EL motor de consumo**, leído en cada cierre de venta. La guarda 1
aborta si hay un solo pedido en los últimos 30 minutos. Son las 22:0x y la cena
sigue.

Y **no se hace commit sin los cuatro caminos en verde** (regla 10): cerrar una
venta de un plato con envase, recibir un albarán, apuntar una merma, aprobar un
recuento. Los RPC están localizados; **los ids no van escritos** porque cambian
cada día y un ensayo contra una fila inventada no mide nada. Se rellenan con la
base delante esa noche. Si alguno no se puede ensayar, eso es el hallazgo: se
dice y no se hace commit.

## Lo que hay que decirle a quien cuente

No se reprocesa nada (regla del 18/09). **El stock de envase arranca
descuadrado** —lleva meses sin descontarse— y no se arregla solo: se arregla en
el primer recuento después de aplicar esto. Antes de ese recuento, las cifras de
cajas y bolsas siguen sin valer.
