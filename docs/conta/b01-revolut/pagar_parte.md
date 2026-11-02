B01 · Cola 1d y 1e · **Pagar, como en la maqueta v2** (aprobada por Julio el 02/11, respuestas B01·7 y B01·8). Va en dos partes, en el mismo PR:
- **A**, en este commit: la pantalla de Pagos, el panel, el saldo y la ficha.
- **B**, la siguiente: el justificante.

Maqueta: https://claude.ai/artifact/R5AYjQR88fwKU46AuMaFTU (versión 2).

## Parte A · lo que hay

**Pagos (`compras/PagosPage.tsx`, `lib/pagos.ts`):**
- **Lo que toca pagar**, arriba. Las cuatro cifras de Julio: vencido, vence esta semana, por revisar y pagado en el mes.
  - Debajo, el botón grande **«Pagar lo de esta semana · N facturas · X €»**: marca lo vencido y lo de esta semana que se puede pagar y abre el panel.
  - Lo que se queda fuera se dice con su porqué: domiciliada, por revisar…
- **El saldo de cada banco que paga** en la cabecera, con **«Llega» / «No llega»**: para lo marcado o, sin nada marcado, para lo de esta semana. Es el de la última lectura de Revolut.
- **Ordenar con un clic** por vence, proveedor, pendiente y estado, en los dos sentidos.
  - Por defecto, por vencimiento, lo más cercano primero.
  - Las «sin fecha», al final en los dos sentidos.
  - El orden se recuerda en este navegador.
- **Las facturas por revisar** salen en «Por pagar» con su vencimiento. **No se pueden marcar**: la casilla está apagada y dice «está por revisar: apruébala para pagarla».
  - Vienen de `conta_pagos_por_revisar` (la 2115, solo añade). `conta_pagos_lista` no se toca.
- **«Fecha de pago»** se llama «Fecha del fichero SEPA» cuando se paga desde Revolut: con Revolut, sale ahora.

**El panel lateral (`pagos/PagarVarias.tsx`, `diseno/Dialogo.tsx` con `lateral`):** el de pagar varias del 3b, ahora fijo a la derecha. En el móvil sube desde abajo.
- **Lo que enseña:**
  - las facturas, con una transferencia por factura;
  - **desde**, con el **saldo antes → después** y la hora del saldo;
  - **«Sale ahora»**;
  - **lo que comprueba Sumied**: el titular y si pide la segunda aprobación (IBAN nuevo, topes);
  - el botón **«Aprobar y pagar · X €»**.
- **Sin saldo:** «En Revolut hay 3,00 €; hacen falta 708,70 €», y el botón no se puede pulsar.
- **La confirmación, con contenido:** «Pagadas 3 facturas · 708,70 € desde Revolut · el cargo se casará solo.», seguida de lo que dice Revolut.

**La ficha de la factura (`documentos/RevisarFacturaPage.tsx`):**
- **«Pagar · X €» arriba**, en una aprobada y por pagar, si hay una cuenta que paga y tú puedes pagar. Abre el mismo panel.
- **«Vence»**: con una fecha guardada, ya no sale la etiqueta «Por revisar» (la de Coheldi P26 5.989: su ficha, a 0 días, daba el 26/10 y la factura dice el 10/11). La diferencia se dice debajo. «Por revisar» queda solo para una factura sin vencimiento.

## Tanda

- **2115, solo añade:** `conta_pagos_por_revisar`.
  - Se puede pasar dos veces; nada en el camino del pedido.
  - El analizador dice **sigue**, sin `autorizo`.
  - Contexto: medido el 02/11 a las 20:47Z.
- **Lo que cuenta** (`b01p-pagar.sql`): la función, 0 → 1. Las facturas de Foodint por estado, iguales.
- **El real lo lanza Julio.**

## Pruebas

- **Staging** (`20261102_b01p_pagar_prueba.sql`, ROLLBACK, cuenta D, IBAN del banco 9999), en verde en local:
  - la vuelta atrás y la 2115 dos veces;
  - trae las en revisión de la empresa con su vencimiento, y no las aprobadas, ni las descartadas, ni las que se compensan;
  - otra cuenta no ve nada; anon no la llama.
- **Unitarias** (`pagarMaqueta.test.ts`, 8):
  - el orden por columna y lo guardado;
  - «lo de esta semana» con lo que se queda fuera;
  - las cuatro cifras;
  - la de por revisar: en qué pestaña sale y que no se marca;
  - si el saldo llega;
  - la confirmación.
  
  Las 2.733 de antes, en verde.
- **e2e:**
  - `pc01/pagos.spec.ts` (ordenador y móvil): lo que toca pagar, el botón grande, lo que se queda fuera y la de por revisar sin casilla;
  - `b01/revolutPagarVarias.spec.ts`: el panel «Pagar 2 facturas» con «Sale ahora».

## Lo que falta (parte B)

- **El justificante:**
  - un PDF con la marca de la empresa;
  - se genera cuando Revolut confirma que la transferencia ha salido, y queda en la ficha de cada factura;
  - «Mandar al proveedor» por correo, si su ficha lo tiene marcado (casilla nueva);
  - «Enviar por WhatsApp» con un enlace público que caduca a los 30 días.
  
  La API de Revolut no da comprobante de transferencias.
- **Las e2e de la parte B,** y los pagos de punta a punta en el sandbox de staging.
