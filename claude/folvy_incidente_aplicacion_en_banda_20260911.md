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

## Qué costó

**Un pedido sin descontar.** El de las **14:26:24** (Deep Pizza,
`aeff5e5e-1eee-46b2-ab0a-f34d876aa6b5`) entró con mi escritor vivo: tres líneas
enlazadas, el escandallo del pack da 7 renglones y 558 unidades, y se quedó con
**cero movimientos y cero fallos registrados**. Silencio, que es lo peor.

No es interpretación: de las **18 ventas de hoy con líneas enlazadas, una
sola** se quedó sin consumo, y fue esa. Regenerada con el motor restaurado: 7
movimientos. A las 14:31, ventas de hoy sin consumo = 0.

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
