# ENCARGO «Los pedidos a proveedor no se cierran nunca al recepcionar» — resultado

Fecha: 21/08/2026 · Commit `55862a5` · 4 migraciones aplicadas y verificadas

## La causa, confirmada — y quién la produce

747 líneas de recepción en Foodint, **3** con `purchase_order_line_id`. Cifra exacta.

Lo que el encargo no dice es **de dónde salen esas 3**: del formulario manual.
`GoodsReceiptForm` sí rellena el campo (línea 1543). El **asistente de cocina**
—`ReceiptWizard`, que es el camino que se usa hoy— llama a
`createGoodsReceiptLine` **sin** ese campo. Por eso son 744 sueltas y 3 casadas,
y por eso el único pedido que llegó a `recibido` en la historia (PED-00009) es
justamente el que se recepcionó por el formulario viejo.

## El arreglo

`_match_order_lines_for_order(p_order_id)`, llamada desde los **tres** sitios que
enlazan una recepción con un pedido, justo antes de `recompute`.

**Keyed por PEDIDO, no por recepción**: así cualquier camino que recalcule repara
el pedido entero, incluidas las líneas de otras recepciones que se quedaron
sueltas. Es auto-reparable en vez de depender de que cada recepción pase por el
sitio bueno.

### Dos desviaciones del encargo, las dos a propósito

**1 · Dónde va.** El encargo dice «dentro de `auto_link_goods_receipt_to_order`».
Esa función hace `return null` de entrada si la recepción **ya** tiene
`purchase_order_id` — y `confirm_goods_receipt` ni siquiera la llama en ese caso.
El camino normal es *enlazar al recibir y confirmar después*, así que ponerlo ahí
se lo saltaría justo en el caso habitual. El encargo lo contempla: «o en una
función hermana que se llame justo detrás».

**2 · La regla de casado.** El §5.1 dice «si hay exactamente una línea de pedido
**sin casar** con ese artículo, se casa». Al pie de la letra **rompería las
entregas parciales**: el Queso Mozarela de PED-00042 se pidió en 10 paquetes y
llegaron 3; cuando lleguen los 7 restantes en otro albarán no habría ninguna
línea «sin casar» y esa segunda entrega quedaría suelta.

Y `recompute` **ya** suma varias líneas de recepción contra la misma línea de
pedido (`SUM ... GROUP BY purchase_order_line_id`). Apuntar dos recepciones a la
misma línea no es un error: **es cómo se representa una entrega parcial**.

Regla aplicada: si el pedido tiene **una** línea con ese artículo, se casa —da
igual que otras recepciones ya apunten ahí—. Sólo si el artículo aparece **varias
veces** hay que desempatar, y se desempata por formato; si sigue empatado, no se
casa.

### Cómo se editaron las funciones

`confirm_goods_receipt` y `receive_goods_receipt` se tocaron **esta misma mañana**
(retención por `needs_review`). En vez de reescribirlas —que es exactamente como
se pierden mejoras, como pasó el 26/07 con `catcher-dispatch`— la edición se hizo
con `replace()` sobre `pg_get_functiondef` de lo vivo, comprobando que la
diferencia de longitud sea **exactamente** la del texto insertado: si tocara dos
sitios, aborta.

Verificado después: las tres llaman al casador, y `p_hold`, el posteo tardío y la
exigencia de nº de albarán siguen intactos.

## El barrido del atrasado

Corre bajo una **identidad real** (`set local role authenticated` + las claims de
Julio, admin de Foodint), no saltándose el guardián: `belongs_to_account()`
resuelve por `auth.uid()`, y como `postgres` devuelve **false**, las dos funciones
habrían reventado. Es la diferencia entre entrar con llave y quitar la cerradura.

Guardarraíl: aborta si las recepciones enlazadas no son exactamente 9.

| Pedido | Antes | Después | Casadas | Fila del pedido tocada |
|---|---|---|---|---:|
| PED-00009 | recibido | recibido | 3 → 3 | no |
| PED-00038 | cancelado | **cancelado** | 0 → 1 | no |
| PED-00040 | cancelado | **cancelado** | 0 → 7 | no |
| **PED-00042** | enviado | **recibido_parcial** | 0 → **28** | sí |
| PED-00043 | cancelado | **cancelado** | 0 → 1 | no |
| **PED-00045** | enviado | **recibido** | 0 → **2** | sí |

Los tres cancelados **sí** reciben el casado de sus líneas —que es un hecho: esa
línea de albarán corresponde a esa línea de pedido, y hace que su historial se
lea bien— pero su **fila de pedido no se toca**.

Estado de los pedidos de Foodint ahora: **41 cancelado · 2 recibido · 1
recibido_parcial · 1 borrador**. No queda ninguno en `enviado`.
Líneas casadas: **3 → 42**.

### Por qué PED-00042 es `recibido_parcial` y no `recibido`

Es la respuesta honesta, y es más útil que cerrarlo:

- **3 artículos nunca llegaron**: Bolsa Marrón Grande 25x15x43,5 (2 cajas),
  Bolsas Personalizadas Big Mikes (1 caja), Salsero Pp 120 Cc con Tapa (1 paquete).
- **1 servido a medias**: Queso Mozarela, 10 paquetes pedidos, **3** recibidos.
- Los otros 27 completos.

## El vigía (§7)

`purchase_orders_stuck(p_days)`. **Desviación**: el encargo dice «pedidos en
`enviado`», pero tras el barrido no queda ninguno en `enviado` y el vigía daría 0
— mientras PED-00042 sigue con 3 artículos sin llegar. `recibido_parcial` con la
fecha pasada **es** un pedido que no se cierra. Vigila los dos estados.

Hoy devuelve exactamente una fila:

| Pedido | Estado | Proveedor | Esperado | Retraso | Líneas | Completas | Sin recibir |
|---|---|---|---|---:|---:|---:|---:|
| PED-00042 | recibido_parcial | CLOUDTOWN, S.L. | 18/08 | 4 días | 31 | 27 | 3 |

⚠️ **No lo consume nadie todavía.** Es la cuarta pata otra vez si se queda así:
hace falta colgarlo de una pantalla o de un aviso. Dilo y lo engancho.

## Criterios

| # | Criterio | Estado |
|---|---|---|
| 1 | Recepcionar contra PED-00042 → `recibido_parcial`, y `recibido` con todas | ✅ está en `recibido_parcial`; PED-00045 llegó a `recibido` |
| 2 | Una línea que no estaba en el pedido se queda a null y no impide cerrar | ✅ 4 de las 32 sin casar y el pedido avanzó igual |
| 3 | Artículo repetido con formatos distintos casa por formato; si empata, no casa | ✅ probado sintéticamente |
| 4 | Barrido con el `SELECT` antes/después dentro de la transacción | ✅ tabla de arriba |
| 5 | Los 41 `cancelado` intactos | ✅ 41, ninguno con `updated_at` de hoy |
| 6 | Comprobado con PED-00042 **en pantalla** | ⏳ **de Julio** |

### Criterio 3 — no hay ningún caso así en producción

Ni un solo pedido tiene un artículo repetido, así que no se podía comprobar
contra datos reales. Se probó **sintéticamente y con `rollback`**: un pedido con
Milanesa de Pollo dos veces (formato `caja` y formato `Paquete`) y dos líneas de
albarán —una con formato Paquete, otra sin formato—. La primera casó con la línea
de Paquete; la ambigua se quedó sin casar. Verificado después: 0 restos de prueba,
45 pedidos, los mismos que antes.

### Un fallo mío, cazado antes de escribir nada

La primera versión del casador usaba `min(pol.id)` — y **`min(uuid)` no existe en
Postgres**. Mi bloque de verificación sólo comprobaba que la función *existiera*,
así que pasó tan campante y sólo reventó al ejecutarla, en el ensayo en seco con
`rollback`. Corregido a `(array_agg(pol.id))[1]`, y **la verificación ahora
ejecuta la función**, no se limita a mirar si está. Una función que no se ha
ejecutado nunca no está verificada.

## Deuda que dejo anotada, no arreglada

`recompute` compara `qty_recv >= qty_ordered` **sin mirar el formato**. En
PED-00042 hay dos líneas donde el formato del pedido y el del albarán no coinciden
—Queso Rulo de Cabra («Paquete» vs «Pieza 850 g») y Tomate Pera («Caja» vs
«paquete»)— y ahí las cantidades cuadran por casualidad (1=1 y 4=4). El día que no
cuadren, un pedido se dará por completo sin estarlo, o al revés. Es
comportamiento **anterior** y el encargo no lo pide; queda escrito.

## Y lo que responde a tu pregunta original

Los **41 «cancelados» no son anulaciones**: son pedidos que llegaron y que alguien
cerró a mano por la única puerta que había. A partir de ahora se cierran solos, y
la pantalla de pedir deja de enseñar «en camino» mercancía que está en la
estantería.
