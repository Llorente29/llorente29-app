# V04 · PR 2 · El tique de la bolsa con Verifactu: el QR de Hacienda

*27/10 · rama `conta/v04-qr`. Encargo V04, puntos 4 y 5, con las notas de la Respuesta 2.*

## Lo que hace

### Cada tique de una propia, un registro F2

- **Con Verifactu encendido en su empresa**, el tique registra su alta F2 en el motor de Sumied, en la misma impresión.
  - Uno por tique, nunca un resumen del día.
  - Encadenado y a la cola. El envío a Hacienda sale después, con la cola de siempre (`conta-verifactu`): la impresora no espera a Hacienda.
- **El IVA, como el papel:** todo al 10 %, con base = total / 1,10. Un tique de 20,18 € va con 18,35 + 1,83.
- **El tique apunta su importe y su entorno la primera vez que se numera.** Reimprimir no hace otro registro.
- **Si el motor falla, el tique sale igual.** El registro queda «pendiente», se avisa (`tique_verifactu_pendiente`, alto) y `ticket_verifactu_pendientes` lo reintenta cada 5 minutos.

### El QR, solo en real

- **Se calcula con los datos del propio tique** (NIF, número, fecha e importe), no con el registro. Sale aunque el registro haya quedado pendiente.
- **En el papel:** de 30 a 40 mm, corrección M, con «QR tributario:» encima, «VERI*FACTU» debajo y 2 mm en blanco. Va encima del QR de la tienda (tablero 1).
  - Se pinta módulo a módulo, a un número entero de puntos, para que cada módulo salga nítido (`puntosPorModulo`).
- **En «pruebas»** el tique se registra y se envía, pero el papel del cliente va sin QR.
- **Lo mismo en los tres pintados:** la imagen que imprime la tablet, el texto (ESC/POS) y la vista previa de Pedidos.

### Después de imprimir

- **Cancelar no borra nada:** se anula con el registro de anulación de la E3.
  - Va encadenado, y con «sin registro previo» si Hacienda había rechazado el alta.
  - Si el alta aún no estaba registrada, primero el alta: el tique existió y el cliente lo tiene.
- **Una devolución o un cambio de importe después de entregar** va en una rectificativa R5 por diferencias, de la serie R del local (`CA26-R-000001`).
- **Lo hace un disparador de `sale` que nunca tira la venta.** Un fallo queda pendiente y avisado.

### Las cedidas no entran

No numeran, no tienen registro, no van a Hacienda ni al libro. Las sigue llevando la liquidación del socio.

## Las dos notas de la Respuesta 2

### La serie al pasar a real no repite números (propuesta, la aprueba Julio)

- **Si el paso a real cae el 1 de enero**, la serie del año ya es nueva: `CA27-000001`.
- **Si cae a mitad de año** y el local ya dio números ese año (en pruebas o apagado), lo de real va en un **tramo con una letra: `CA27B-000001`**. Así ningún número de real repite uno del papel de antes.
  - Las rectificativas, igual: `CA27B-R-000001`.
  - Un local que no había dado números ese año no necesita letra.
  - El año siguiente vuelve a ir sin letra.
- **Cómo:** una columna `tramo` en la serie, con su clave única (local, año, tipo, tramo), en lugar de la de antes.
- **Ajustes lo dice:** «Desde el paso a real va en el tramo B: así no repite ningún número de antes».

### El fabricante de Sumied

- **Queda el hueco:** una tabla de una fila, `verifactu_sistema`, con el nombre y el NIF de la declaración responsable. Nace vacía.
- **El candado:** `verifactu_modo` no deja pasar a «real» sin él. A «pruebas», sí.
- **El aviso:** sale en Ajustes de Folvy («Facturas de los pedidos») y en Sumied › Ajustes › Verifactu.
- **Lo pone el servicio**, para Julio: `select public.verifactu_sistema_poner('<nombre>', '<NIF>', 'Julio');` (comprueba el NIF).
- **La función de envío lo lee de la base**, el mismo dato que mira el candado. Si la base no lo tiene, usa sus secretos de antes.

## Lo probado

- **Staging, en ROLLBACK** (`supabase/staging/sql/20261027_v04_tique_verifactu_prueba.sql`), por los caminos de la regla 10: imprimir, reimprimir, cerrar y cancelar, con Verifactu apagado, en pruebas y en real.
  - El F2 con su importe y su IVA, una vez.
  - El motor caído: el tique sale, el registro queda pendiente y avisado, y el reintento lo registra.
  - La anulación al cancelar y la R5 al devolver.
  - El candado del fabricante.
  - El tramo B y el QR exacto en real.
  - Las cedidas fuera, y los permisos.
  - La vuelta atrás en limpio (las cinco funciones con su huella de antes), y que **para** con números en un tramo o registros dentro.
- **Unitaria del tramo contra un Postgres de verdad** (`tramoTique.test.ts`): carga tal cual el bloque «serie» de la 2309 y el «tramo» de la 0741.
  - Pruebas, real a mitad de año (B), dos a la vez en el tramo B, el año siguiente y real el 1 de enero.
- **Unitarias del QR** (`qrHacienda.test.ts`): solo en real, tamaño de 30 a 40 mm en cada versión posible, y encima del de la tienda en la tablet y en la vista previa.
  - Y las de Ajustes (`facturasPedidos.test.ts`).
- **e2e de la zona** (`tests/e2e/conta/v04/tique.spec.ts`):
  - el tique en real con su QR, al lado del tablero 1 (`docs/folvy/capturas/v04/tique-propia-real-al-lado-del-tablero-1.png`), y en pruebas sin QR;
  - el aviso del fabricante en Ajustes.

## La tanda

`folvy/conta-v04-qr`: la 0741, con su cuenta (`cuentas/v04-qr.sql`) y su vuelta atrás.

- **El analizador dice AUTORIZO:** camino del pedido (`fiscal_for_print` y el disparador de `sale`) y una restricción que se quita.
  - En el campo `autorizo`: `20261027T0741_v04_tique_verifactu.sql`.
- **Cada función que cambia en caliente se guarda antes** en `funcion_respaldo` y se restaura byte a byte.
- **La cuenta, antes:** 3978 / 10950 · 0 · 0 de 10 · 0 · 0 y 0 · 0. Las huellas de las cinco: `_ticket_invoice_number` 6e140882, `fiscal_for_preview` 98888cc6, `fiscal_for_print` f32a7c74, `ticket_invoice_ajustes` d8f59630, `verifactu_modo` d3460342. Y las del camino.
- **Con Verifactu apagado en todas las empresas** (hoy, en producción), el tique sale igual que con la 2309: ni registro ni QR.

## Lo que queda abierto

- **Julio:** aprobar el tramo B, o decir otra forma, antes de fusionar. Y poner el fabricante.
- **El IVA del tique es todo al 10 %**, como ya decía el papel. Una bebida al 21 % iría mal declarada. No es de este PR, pero el registro dice lo mismo que el papel.
- **Un local de una propia sin empresa** (`location_company`) no va a Verifactu. Hoy los tres locales de Foodint la tienen.
