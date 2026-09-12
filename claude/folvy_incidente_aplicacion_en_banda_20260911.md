# INCIDENTE · apliqué A4a en producción dentro de la banda

**11/09/2026, 14:25–14:28 (Madrid, reloj de la base).** Mío, entero.

## Qué pasó

Mandé el fichero `A4A_escritor_unico_con_corte.sql` a la base **sin el
`RAISE EXCEPTION` final**. Todos los ensayos anteriores lo llevaban; éste lo
partí en dos mensajes —fichero primero, ensayo después— y **la primera mitad se
confirmó sola**.

Durante unos tres minutos estuvieron vivos en producción, en plena banda de
servicio y sin haber pasado los 13 casos:

- `generate_sale_consumption` reescrito (el escritor único con corte),
- `cortes_aprobados`, `_corte_motor_viejo`, `sale_consumption_skip`,
- el índice `idx_icl_item_count` creado,
- el índice gemelo `stock_movement_sale_dedup` borrado.

Es exactamente lo que Julio prohibió el 11/09 a las 12:45, y la regla existe
porque **aplicar una migración es publicar**.

## Qué costó — y la corrección de lo que dije al principio

**Dije que había costado un pedido sin descontar. Medido después, no es
verdad, y la corrección importa más que el susto.**

Lo que vi a las 14:29: el pedido de las **14:26:24** (Deep Pizza,
`aeff5e5e-…`), entrado con mi escritor vivo, con tres líneas enlazadas, 7
renglones de escandallo y 558 unidades, tenía **cero movimientos**. Lo até a mi
ventana y lo conté como daño. Lo comprobé mal de dos maneras:

**1 · Reproducido, mi escritor hace lo mismo que el actual.** Con la venta
puesta otra vez en `open/accepted` y sin movimientos, en transacción deshecha:
`escritor NUEVO -> devuelve 7, deja 7` y `escritor ACTUAL -> devuelve 7, deja
7`. No se come nada.

**2 · Cero movimientos a los tres minutos es lo NORMAL.** Sobre las ventas con
líneas enlazadas de los últimos 3 días:

| | ventas | sin consumo | descontaron <5 s | más tarde | mediana |
|---|---:|---:|---:|---:|---:|
| sin combo | 153 | **0** | 4 | 149 | **53 min** |
| con combo | 48 | **0** | 0 | 48 | **2 h 3 min** |

El consumo se escribe casi siempre **al cerrar la venta**, no al entrar. Mi
«una sola de 18 ventas de hoy sin consumo» comparaba una venta de tres minutos
con diecisiete de varias horas: la misma clase de error que medir con la vara
equivocada. Y los 7 movimientos que hay ahora llevan fecha **14:50:35**, que es
cuando la venta cerró — ni los míos de las 14:30 ni los de las 14:26.

**Entonces, ¿qué costó?** Que un pedido estuviera unos minutos sin consumo
cuando igualmente lo habría estado, y una regeneración a mano que no hacía
falta. **Daño permanente: ninguno.** Lo grave sigue siendo lo otro, y no
necesita un muerto para serlo: **apliqué en producción dentro de la banda.**

## Qué se restauró

| | |
|---|---|
| `generate_sale_consumption` | restaurado, `97a3533602349f6cebb7f55f3ab15fc3` |
| `revert_sale_consumption`, `reprocess_sale`, vigía | intactos (no llegaron a tocarse) |
| `sale_consumption_skip` | borrada, 0 filas escritas |
| `cortes_aprobados`, `_corte_motor_viejo` | borradas |
| `stock_movement.sale_line_id` | 0 de 68.582, como antes |
| fallos de consumo sin resolver | 0 |

**Dos cosas quedan cambiadas a propósito**, y dichas a Julio para que decida:
`stock_movement_sale_dedup` sigue borrado —el gemelo idéntico sigue ahí, así
que la garantía no se perdió, y recrearlo ahora es un índice único sobre 68.582
filas con bloqueo de escritura en pleno servicio— y `idx_icl_item_count` sigue
creado, que es aditivo.

## La regla que se paga con esto

**Un guion que toca producción se escribe EMPEZANDO por el `RAISE EXCEPTION`
final, no terminando por él.** Y un ensayo no se parte en dos mensajes: partir
el guion es partir la red.

*Detector automático:* si un guion que va a la base no tiene, **en el momento de
escribirlo**, una última línea que lo deshaga, no es un ensayo — es un despliegue,
y entonces se le aplican todas las reglas de un despliegue: la banda, la vuelta
atrás preparada, y el permiso.

## Lo que queda por saber

**Por qué mi escritor devolvió cero en ese pedido sin dar excepción.** Hay una
sospecha —el orden en que los disparadores por línea lo llaman mientras las
líneas del combo se van insertando— pero **no cuenta como causa hasta
reproducirla** en transacción deshecha. Es lo primero, antes que los 13 casos.
