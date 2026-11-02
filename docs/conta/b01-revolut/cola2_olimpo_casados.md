B01 · Cola 2 · **Olimpo: dos pagos casados con lo que no era.** Lo medido en producción el 02/11/2026, en solo lectura y solo en Foodint. Todavía sin tanda: primero la lista de lo que cambia, para Julio.

## Qué pasó, con las horas (Madrid)

| Cuándo | Qué |
|---|---|
| 20/10 15:28 | Entra «26/13028» de Olimpo, 363,67 €. Se aprueba el 21/10. |
| 26/10 | Salen de ···6536 dos transferencias: −363,67 («FACT: 26A/10966») y −170,10 («FACT: 26A/10965»). |
| 29/10 10:26 | Las trae el agregador. El motor propone lo que puede con lo que hay: la 26/13028, que es la única pendiente de 363,67 («la referencia no coincide»), y el saldo de Olimpo en el libro para la de 170,10. |
| 30/10 08:52 | El real de la tanda S01c **anula la 26/13028**: no era una factura, era el albarán. Su parte ya dice que la factura es la 26A/10966. |
| 30/10 20:49 | Una persona acepta las dos propuestas, que se habían calculado antes de la anulación. Bancos casa **un pago con una factura anulada**, sin mirar su estado. Los dos asientos de pago quedan validados (4/3312 y 4/3310). |
| 30/10 21:16 | Se sube la 26A/10966 (363,67) y se aprueba. Su pago ya está casado con otra. |
| 01/11 11:12 | Se sube la 26A/10965 (170,10). Sigue «Por revisar». |

**Por qué el motor no lo evitó:**
- La propuesta se guarda en el movimiento cuando se calcula, y **no se vuelve a calcular** cuando su factura cambia de estado.
- Al aceptarla, `bank_casar` **no mira el estado de la factura**: solo que sea de la cuenta y que no se pague dos veces.
- Y el número que trae el banco («FACT: 26A/10966») no cuenta para nada cuando no hay ninguna factura con ese número: el motor casa por importe y proveedor, y deja escrito «la referencia no coincide».

**Por qué hay riesgo de pagar dos veces:** la 26A/10966 sigue «aprobada», sin pagar, vence el 05/11 y saldrá en Pagos, y con el 3b se puede pagar con Revolut. La 26A/10965 vence el mismo día.

## La lista de lo que cambia (para que Julio la vea antes)

**1 · El −363,67 del 26/10** (movimiento `0e62eb54…`, casado `a79e4d17…`):

| | Antes | Después |
|---|---|---|
| El casado | vivo, con la 26/13028 (anulada) | deshecho, con el motivo «la factura del banco es la 26A/10966; la 26/13028 era el albarán, anulado por la S01c» |
| El asiento 4/3312 (572 → 400, con Olimpo) | validado | sigue validado y se anula con su contraasiento, con fecha de hoy (`journal_entry_anular`): el libro no pierde nada |
| La 26/13028 | anulada, con el asiento de pago de arriba | anulada, sin asiento de pago |
| El movimiento | casado | casado con la 26A/10966, con su asiento de pago nuevo (572 → 400 con Olimpo, 26/10) |
| La 26A/10966 | aprobada, sin pagar, vence 05/11 | **pagada** el 26/10 por transferencia, por «Sumied»; deja de salir en Pagos |

**2 · El −170,10 del 26/10** (movimiento `910ca451…`, casado `e7e87d64…`):

| | Antes | Después |
|---|---|---|
| El casado | vivo, «a cuenta» de Olimpo (el saldo del libro) | deshecho, con el motivo «la factura del banco es la 26A/10965» |
| El asiento 4/3310 (572 → 400, **sin tercero**) | validado | anulado con su contraasiento, con fecha de hoy |
| El movimiento | casado | casado con la 26A/10965, con su asiento de pago (572 → 400 con Olimpo, 26/10) |
| La 26A/10965 | **Por revisar**, sin pagar, vence 05/11 | **pagada** el 26/10 por transferencia |

**Hace falta una decisión:** una factura solo se marca pagada si está aprobada (`_mark_supplier_invoice_paid_nucleo`), y la 26A/10965 sigue «Por revisar». Dos caminos:
- **(a, el que propongo)** Julio la revisa y la aprueba en Sumied antes del real. La tanda lo comprueba y, si no está aprobada, para sin tocar nada.
- (b) La tanda solo arregla la de 363,67, y la de 170,10 se recasa a mano en Bancos después de aprobarla.

**Cómo se hace:**
- Por las funciones de siempre, `bank_deshacer` y `bank_casar`, como lo hizo la S01c: como una persona, con `request.jwt.claims` de Julio y solo dentro de la transacción.
- Así el rastro (registro de Bancos, contraasientos, quién) es el de un arreglo hecho en la pantalla.
- Cada paso se ancla y se comprueba antes de tocarlo: el importe, el concepto, el casado y su asiento, y el estado de cada factura. Si algo no está como se midió el 02/11, para.

## El resto de Foodint (lo que pidió Julio contar)

Casados vivos en Foodint, medidos el 02/11:

| | Casados | Importe |
|---|---:|---:|
| Con una factura anulada | **1** | 363,67 (el de Olimpo) |
| Con «la referencia no coincide» | 7 | 1.384,79 |
| — de ellos, con un número de factura en el concepto que es **otra** factura | **1** | 363,67 (el de Olimpo) |
| — los otros 6 | 6 | 1.021,12, sin número de factura en el concepto («FACTURA PENDIENTE» o nada): no hay nada que lo contradiga |
| A cuenta (saldo del libro) con «FACT» en el concepto | 2 | 764,03 |
| — de ellos, con el número de una factura que existe | **1** | 170,10 (el de Olimpo) |
| — el otro | 1 | 593,93, «FACTURA PENDIENTE»: no es un número |

Solo están mal los dos de Olimpo.

## El arreglo de fondo (propuesta, sin construir)

1. **El número del banco manda.**
   - Si el concepto trae un número de factura («FACT: 26A/10966») y existe una factura de ese proveedor con ese número, se propone esa, aunque haya otra con el mismo importe.
   - Si no existe todavía, el movimiento se queda en «Por aclarar» con «El banco dice que paga la 26A/10966, que aún no está en Sumied», sin casarlo por importe.
   - Cuando llega la factura con ese número, se propone sola.
   - El número se compara sin barras, guiones ni espacios (como `number_key`).
2. **Al anular una factura, lo que tenía casado vuelve a «Por aclarar».**
   - La anulación deshace sus casados vivos (`bank_deshacer`, con el contraasiento si el asiento estaba validado), y el movimiento queda en «Por aclarar» con «Su factura 26/13028 se anuló el 30/10».
   - **Y al aceptar una propuesta**, `bank_casar` vuelve a mirar las facturas: una anulada o descartada **para**, con «Esa factura está anulada: vuelve a calcular la propuesta».
3. **Una propuesta guardada no sobrevive a un cambio de su factura:** al anular, descartar o pagar una factura, se vuelven a calcular las propuestas de los movimientos que la tenían.

**Cómo iría:**
- Un PR con la tanda de datos (lo de arriba, cuando Julio dé el visto bueno a la lista) y el arreglo de fondo.
- `bank_casar` y la anulación cambian en caliente: declarados en su cabecera, con su prueba de staging de antes y después.
- La prueba recorre: aceptar una propuesta de una factura anulada (para), anular una factura casada (vuelve a «Por aclarar» con su contraasiento) y un concepto con el número de otra factura (manda el número).
