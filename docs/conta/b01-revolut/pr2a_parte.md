B01 Revolut · PR 2a · **La base del «Pagar» común.** Solo base: tablas y funciones nuevas, sin cambiar nada de lo que existe. No manda ningún pago. Mandarlo es del 2b (la función que paga y la salida de Revolut) y las pantallas, del 2c.

## Qué hace

- **Quién puede pagar** (`conta_pago_permiso`). El permiso es explícito (decisión de Julio, 01/11): lo da un administrador, también a sí mismo al «Activar pagos». Sin él no sale el botón, y la pantalla dice «Pídeselo a X, que puede pagar».
- **Los topes** (`conta_pago_ajustes`): 3.000 € por pago y 10.000 € al día de partida (P6), cambiables por empresa y solo por un administrador. El del día suma lo aprobado ese día en hora de Madrid.
- **Los pagos que salen juntos** (`conta_pago_lote`) **y cada pago** (`conta_pago_salida`), con su registro (`conta_pago_evento`):
  - el importe, el beneficiario y el IBAN tal como se aprobaron;
  - el `request_id`, para que el banco no lo haga dos veces y su cargo se case solo;
  - un solo pago vivo por factura.
- **La segunda aprobación** (maqueta v4, aprobada el 01/11):
  - **Cuándo hace falta:** IBAN nuevo, cambiado o leído de la factura (P1), por encima de un tope, o «pagar igual» con un titular que no coincide.
  - **Una para todos:** una sola confirmación vale para todos los pagos del lote.
  - **De la lista exacta:** se confirma su huella. Si cambia algo después, ya no vale.
  - **Quién la da:** lo decide Sumied. Con una sola persona que paga, ella misma; con dos o más, otra, nunca quien aprobó.
  - **Cómo:** siempre con su **llave** o su **PIN de pago**. Un «Aprobar» solo no vale.
- **La llave de acceso** (`conta_llave`, WebAuthn):
  - solo se guarda la parte pública, atada a su dirección: una de app.sumied.com no vale en app.folvy.app;
  - activarla pide antes el código del correo;
  - un contador que no sube la quita, porque puede estar copiada.
- **El PIN de pago** (`conta_pago_pin`):
  - cifrado con HMAC-SHA256 y una clave que solo tiene la función que lo comprueba (2b);
  - un PIN de 6 cifras guardado solo con su resumen se sacaría probando el millón de combinaciones; con la clave del servidor no se puede ni leer ni probar fuera de Sumied;
  - 5 fallos lo bloquean y los pagos siguen esperando;
  - crearlo o recuperarlo pide el código del correo.
- **Los retos** (`conta_pago_reto`): de un solo uso y con 10 minutos. Se guarda su huella, nunca el reto ni el código. El correo sirve solo para crear o recuperar el PIN y para activar la llave: ningún pago se confirma con él.
- **Lo que no se paga por aquí:** lo domiciliado, con tarjeta, prepago, en efectivo o compensado; lo que no está aprobado; sin IBAN válido; con un IBAN de la factura distinto del de la ficha y sin decidir; o sin su cuenta 400. Son las mismas reglas que la remesa de PC01.

## Una decisión sobre lo aprobado en la respuesta 1

Cuando el 2b mande un pago, lo apuntará como una remesa de PC01 de tipo «banco», con su línea. Así la factura solo queda pagada cuando su cargo se casa en Bancos y tiene asiento (PC01 · E1), como cualquier remesa. En la respuesta 1 dije que el resultado se escribiría aparte en `supplier_invoice_payment`, y así no hace falta.

## Quién ve qué

- Los pagos, los permisos y los topes: la gente de la cuenta.
- Las llaves: cada persona solo las suyas, y sin la clave pública.
- Los retos y los PIN: nadie, salvo la clave de servicio.
- Las funciones que comprueban la llave y el PIN: solo la clave de servicio.

## Tanda

`supabase/produccion/tandas/sumied/claude-revolut-business-sumied-9fhlsh/` (la del PR 1 está aplicada, en el historial con su huella, y su manifiesto en la historia de git: #415).

- **1234, añade.** El analizador dice **sigue**, sin `autorizo` y sin avisos.
- **Contexto:** medido en producción en solo lectura el 01/11 a las 14:00Z. No existe ninguna de las 8 tablas ni de las 37 funciones, nada está en el camino del pedido y nada en el historial.
- **Lo que cuenta** (`scripts/conta/produccion/cuentas/b01p-pagos.sql`), antes: 0 de 8 tablas y 0 funciones; en Foodint, 21 facturas aprobadas sin pagar (3.364,05 €) y 0 remesas. Después, las tablas y las funciones pasan a 8 de 8 y 37, y lo de Foodint queda igual.
- **El real lo lanza Julio.**

## Pruebas

**Prueba de staging** (`supabase/staging/sql/20261101_b01p_pagos_base_prueba.sql`, en ROLLBACK, cuenta D, IBAN inventados del banco 9999). Recorre los 11 caminos:

1. Sin permiso no se paga, y solo un administrador da el permiso.
2. Desde una cuenta sin Revolut, o con Revolut solo para leer, no se paga; con PAY, sí.
3. Lo domiciliado, sin IBAN o sin su 400 no se paga, y no deja nada.
4. Un pago comprobado y bajo el tope sale listo; dos a la vez piden una sola segunda; la misma factura no se paga dos veces.
5. La llave: un reto equivocado no vale, y un pago no se confirma con el correo.
6. El PIN:
   - sin PIN, se dice;
   - crearlo pide el correo;
   - 4 fallos dicen cuántos quedan y el 5.º lo bloquea, con los pagos esperando;
   - recuperarlo lo desbloquea;
   - con otra lista no vale.
7. Con dos personas, quien aprobó no puede dar la segunda (ni con la llave ni con el PIN); la otra, sí.
8. Los topes: solo los cambia un administrador; por encima del del día, segunda aprobación.
9. «No pagar» cancela, y la factura vuelve a tener lo pendiente.
10. Otra cuenta no ve nada, y nadie lee los retos, los PIN ni las claves públicas.
11. Registrar una llave pide el correo; la llave es de su dirección; un contador que no sube la quita.

Empieza con la vuelta atrás, que deja la base sin el 2a.

**Dónde se ha pasado:**
- **En la base local del W09:** en verde. Ahí `service_role` no tiene `BYPASSRLS` como en Supabase: se le dio solo en local, y las comprobaciones que leen como la clave de servicio dan error si no ven la fila.
- **La migración, dos veces seguidas:** en verde (W05).
- **En staging:** pendiente, el run [41309002393](https://github.com/Llorente29/llorente29-app/actions/runs/41309002393).

**Lo que la prueba encontró en la migración:** concatenar un texto a un array sin tipo, una expresión regular con más de 255 repeticiones y una frase en plural con un solo pago. Corregidos.

**Unitarias y e2e:** el 2a no toca `src/` ni las funciones, así que no lleva unitarias ni e2e. Llegan con el 2b (la llave, el PIN, el correo) y el 2c (las pantallas).

## Funciones a desplegar a mano

### Sumied

- ninguna

### Folvy

- ninguna

## Producto

- Sumied
