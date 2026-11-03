B01 · Cola 1d y 1e · **Pagar, como en la maqueta v2** (aprobada por Julio el 02/11, respuestas B01·7 y B01·8). Va en dos partes, en el mismo PR:
- **A**: la pantalla de Pagos, el panel, el saldo y la ficha.
- **B**: el justificante del pago.

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
- **2140, solo añade:** el justificante (la casilla del proveedor, la tabla y sus funciones).
- Las dos se pueden pasar dos veces; nada en el camino del pedido. El analizador dice **sigue** para las dos, sin `autorizo`. Contexto: medido el 02/11 a las 21:47Z.
- **Lo que cuenta** (`b01p-pagar.sql`): las funciones nuevas (0 → 1 y 0 → 6), la tabla y la casilla (0 → 2). Las facturas y los proveedores de Foodint, iguales.
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

## Parte B · el justificante del pago

La API de Revolut no da comprobante de una transferencia (solo de los gastos con tarjeta): lo hace Sumied cuando el banco confirma que el pago ha salido.

**La base (2140, solo añade):**
- `supplier.justificante_al_pagar` (admite nulos): «Mandar el justificante al pagar», en la ficha del proveedor.
- `conta_pago_justificante`: uno por pago confirmado, con su PDF (en `conta-documentos`) y la **clave** del enlace público (32 bytes al azar, 43 letras), que **caduca a los 30 días**. La lee la cuenta (RLS); solo escriben las funciones del servicio (sin los permisos por defecto de Supabase).
- Las funciones: las del servicio (los que faltan, sus datos con el IBAN ya tapado, guardarlo una vez, apuntar el correo, el enlace público) y `conta_factura_justificantes` para la ficha.

**El servidor (`_shared/justificantePago.ts`, puro y con unitarias):**
- **El PDF:** la franja y el nombre de la empresa que paga (su color), el importe, quién paga y desde dónde, a quién, **la cuenta tapada salvo los 4 últimos**, la factura, el concepto, la hora de Madrid y la referencia del banco.
- **Cuándo:** la lectura de cada hora, el aviso de Revolut y «Pagar» (`conta-pagar`) hacen el de cada pago confirmado de los últimos 60 días que no lo tenga. No lanza: lo que falle, lo vuelve a intentar la siguiente.
- **El correo:** solo si la ficha del proveedor tiene la casilla y un correo. Sale de `pagos@sumied.com` con el nombre de la empresa y las respuestas a su correo, con el PDF. **Cerrado** («justificante_pago») hasta que Julio lo abra; cerrado, no se manda nada y queda escrito por qué.

**El enlace público (`conta-justificante`, nueva, sin sesión):**
- Con la clave entera, el PDF y nada más. Con otra, «Este enlace no vale». Pasados los 30 días: «Este justificante ha caducado; pídelo a quien te pagó».
- «Mandar al proveedor» (POST, con la sesión de un administrador o encargado), por la misma función.

**La pantalla:**
- **La ficha de la factura**, «Justificante del pago»: lo pagado, cuánto le queda al enlace, «Ver el justificante», «Mandar al proveedor» (sin la casilla, lleva a marcarla) y **«Enviar por WhatsApp»** (`wa.me` con su teléfono y el mensaje con el enlace; sin teléfono, «falta su teléfono, ponlo» lleva a sus contactos). Caducado, lo dice.
- **La ficha del proveedor**, «Cómo le compras»: la casilla, con lo que hace.

**Pruebas:**
- Staging (`20261102_b01p_justificante_prueba.sql`, ROLLBACK, con los permisos por defecto de Supabase): sin confirmar no hay; pagado, sí, con el IBAN tapado y uno solo; el enlace solo con la clave entera, y caduca; la ficha a su cuenta y no a otra; lo del servicio no lo llama nadie más. En rojo sin el tapado del IBAN y sin el `revoke`.
- Unitarias (`revolut/justificante.test.ts`, 15): la clave, el PDF, el correo con su freno, hacer los que faltan, WhatsApp y la caducidad.
- e2e (`b01/justificante.spec.ts`, ordenador y móvil): la ficha (ver, WhatsApp con y sin teléfono, la casilla, el caducado y «Mandar») y el enlace público de verdad con claves que no son de nadie.

## Funciones a desplegar a mano

### Sumied

- conta-justificante
- conta-pagar
- conta-revolut-aviso
- conta-revolut-leer

### Folvy

ninguna

## Producto

- Sumied
- Común
