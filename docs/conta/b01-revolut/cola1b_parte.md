B01 · Cola 1b · **El agregador de BBVA vuelve a leer los últimos 7 días, sin duplicar, y apunta los pendientes que deja fuera.** Decisión de Julio (02/11): las dos cosas valen sea cual sea la causa del 30/10. Si después de releer el hueco sigue, es el proveedor, y Bancos lo dice.

Lo medido antes, en solo lectura: `docs/conta/b01-revolut/cola1b_agregador_bbva.md`.

## Qué cambia

**La lectura de cada noche** (`_shared/bancoAgregador.ts`, `conta-banco-agregador`):
- **Vuelve a leer los últimos 7 días** (`RELEER_DIAS_OBI`), además de lo nuevo desde el día siguiente al último leído:
  - pide al banco desde hoy − 7;
  - de los días ya leídos, se queda solo con lo que **no está en Folvy** (`quitarLoQueYaEsta`): primero por la referencia del proveedor (`reference_2`, lo que entró por la conexión); lo demás, por día e importe, uno a uno (lo que entró por un Norma 43 no lleva esa referencia; dos cafés iguales el mismo día son dos);
  - lo que llegó tarde entra por `bank_importar`, como siempre, en **su propio extracto**: formato `agregador:open-banking-io:tarde`, sin saldos y con su porqué. Así no toca la continuidad de los demás (`bank_importar` la mide contra el último con saldo, y este no lo tiene);
  - lo nuevo sigue como antes, con su saldo inicial calculado solo con lo nuevo.
- Solo con una lectura anterior suya. La primera vez, y Revolut (que relee su último día a su manera), como antes.
- **Cuenta los pendientes**: lo que el banco da en el periodo y no entra porque no está contabilizado. Cuántos y su importe:
  - en el texto de la cuenta: «Hay 1 movimiento pendiente en el banco (−5,00 €) que aún no entra: entrará cuando el banco lo contabilice»;
  - y en el registro de la lectura.
- Si llega tarde algo, el texto lo dice: «Al releer desde el 26/10, han llegado tarde 1 (3.308,46 €)».

**El registro de cada lectura** (la 1205, solo añade):
- `bank_aggregator_lectura`: una fila por cuenta y por lectura, con:
  - el periodo y desde cuándo se releyó;
  - lo leído, lo nuevo y lo repetido;
  - los pendientes y lo que llegó tarde, con su importe;
  - la continuidad y el saldo del banco.
- La lee el administrador o el encargado de la cuenta.
- La escribe solo la clave de servicio (`bank_agregador_lectura_apuntar`).
- Si la tabla aún no está (antes del real), la función de cada noche sigue sin apuntarla.

**Bancos, en «Cuentas y extractos»**, la columna «Con el anterior» de un extracto con hueco (`lib/huecoBanco.ts`):
- si lo que llegó tarde con fechas de ese extracto suma el hueco: «Rellenado: el banco dio tarde 3.308,46 € de estos días y ya está en Sumied»;
- si no, mientras se relee: «Falta un trozo: 3.308,46 €. Cada noche se vuelven a leer estos días, hasta el 06/11»;
- pasados esos 7 días: «… La conexión con el banco no lo ha dado al releer estos días: falta en lo que da el proveedor (open-banking.io), no en Sumied. Sube el extracto de esos días»;
- el extracto de lo que llegó tarde: «Llegó tarde · rellena días ya leídos»;
- un hueco entre dos ficheros, como siempre.

**Para el 30/10:** la ventana de 7 días lo alcanza hasta la lectura del 06/11. Si el traspaso estaba pendiente o se contabilizó tarde, entra en la primera lectura después del despliegue y el hueco sale «Rellenado». Si no entra, a partir del 07/11 Bancos dice que es el proveedor.

## Tanda

`supabase/produccion/tandas/sumied/claude-revolut-business-sumied-9fhlsh/`. Las del PR 1 al 3a están aplicadas y en el historial con su huella.

- **1205, solo añade:**
  - la tabla y la función;
  - se puede pasar dos veces;
  - nada en el camino del pedido;
  - el analizador dice **sigue**, sin `autorizo`.
- **Contexto:** medido en producción en solo lectura el 02/11 a las 11:15Z. No existe ninguna de las dos, nada en el camino del pedido y nada en el historial.
- **Lo que cuenta** (`scripts/conta/produccion/cuentas/b01q-lecturas.sql`):
  - la tabla y la función: 0 → 1;
  - movimientos y extractos de Foodint hasta el corte, iguales (la tanda no importa nada).
- **El real lo lanza Julio.**

## Pruebas

- **Staging** (`supabase/staging/sql/20261102_b01q_bancos_prueba.sql`, ROLLBACK, cuenta D, IBAN del banco 9999), en verde en la base local del W09:
  - la vuelta atrás y la 1205 dos veces;
  - un administrador no apunta lecturas ni escribe en el registro;
  - la clave de servicio, sí, de la cuenta y la empresa del banco;
  - el administrador lo lee.
  
  Cazó que faltaba el `grant select`: ya está.
- **Unitarias** (`bancoAgregadorRelectura.test.ts`), el 30/10 con importes inventados:
  - el traspaso que llega tarde entra solo, en su extracto, sin duplicar el cargo ni la tarjeta (por referencia) ni el pago de un Norma 43 (por día e importe);
  - lo nuevo sigue con su saldo;
  - el pendiente se cuenta y se apunta;
  - la noche siguiente no lo vuelve a meter;
  - sin la opción, o la primera vez, como antes;
  - lo que dice Bancos de un hueco: rellenado, releyendo y proveedor.
  
  Y las de antes del agregador (`bancoAgregadorB01c`, `agregadorB01`): 34 en verde.
- **`deno check`** (Deno 2.5.4), con la misma vara en los dos lados:
  - `conta-banco-agregador`: 0 errores en la rama, 0 en `main`;
  - `conta-revolut-leer`: 1 en la rama y el mismo 1 en `main` (TS2769, al firmar con la clave privada: es de la versión de Deno, no de este cambio).
- `scripts/conta/antes-de-subir.sh`: los 10 pasos en verde.
- **e2e:** la de la zona en cada push.

## Lo que sigue

- **Olimpo** (cola 2): la tanda que deshace los dos casados y casa cada pago con su factura, y el arreglo de fondo, en el PR siguiente.
  - Medido ya: la regla «el número del banco manda» existe desde la S01c (30/10 09:32). Las dos propuestas se calcularon antes, el 29/10, y se aceptaron después sin recalcular.
  - El arreglo de fondo: `bank_casar` para con una factura anulada o descartada, y anular una factura deshace sus casados.
- **Las maquetas de Pagar** (cola 3).

## Funciones a desplegar a mano

### Sumied

- conta-banco-agregador
- conta-pagar (importa `_shared/revolut/servidor.ts`, que importa `bancoAgregador.ts`: no cambia lo que hace)
- conta-revolut-aviso (ídem)
- conta-revolut-conectar (ídem)
- conta-revolut-leer (ídem)

### Folvy

ninguna

## Producto

- Sumied
- Común (`supabase/functions/_shared`)
