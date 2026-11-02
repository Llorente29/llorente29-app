B01 Revolut · PR 2c-2 · **Pagar una factura con Revolut.** El «Pagar» de la ficha de la factura recibida, con la segunda aprobación con la llave o con el PIN de pago, y la remesa «banco» en Pagos. Sigue las maquetas aprobadas por Julio: la v2, pantalla 3 (pagar una factura), y la v4 (la segunda aprobación con la llave). Sin base nueva: usa la 1234 y la 1614, ya en producción. Sin tanda.

## Qué hace

**La ficha de la factura recibida** (Compras › Facturas recibidas › la factura) tiene un bloque nuevo, «Pagar con Revolut», debajo de «Pago». Solo sale con la factura aprobada y por pagar, si no es un abono ni está descartada.
- **Sin ninguna cuenta ligada a Revolut**, o sin nadie con el permiso de pagar: el bloque no sale. El pago sigue siendo el de siempre: la remesa o «Ya la he pagado».
- **Quien no puede pagar** lee «Pídeselo a …, que puede pagar», sin botón (maqueta v2).
- **Quien puede pagar** pulsa «Pagar con Revolut» y se abre el panel:
  - desde qué cuenta (solo las que pagan desde Sumied);
  - el importe y a quién;
  - el IBAN, con «✓ comprobado», «nuevo» o «cambiado»;
  - el concepto;
  - el titular: lo que dice Revolut, preguntado al abrir el panel (`conta-pagar · titular`);
  - por qué hace falta la segunda aprobación y quién la da.
  - Lo que no se puede pagar, lo dice la base con su porqué: sin IBAN válido, domiciliada, ya en una remesa…
- **Si el titular no coincide**, el panel lo dice como en la pantalla 5: «No se ha pagado: el titular de esa cuenta no es …», sin el nombre real.
  - No deja aprobar hasta marcar «Lo he comprobado con el proveedor: pagar igual» y decir por qué.
  - Eso pide la segunda aprobación y queda escrito con tu nombre.
- **«Aprobar y pagar»** (`conta_pago_aprobar`):
  - sin segunda aprobación, se manda a Revolut en el mismo gesto (`conta-pagar · mandar`);
  - con ella, se abre la pantalla de la segunda (si la das tú) o se dice que la tiene que dar otra persona.
- **Un pago en marcha se dice en la ficha** (regla 8), según su estado:
  - esperando la segunda («Ver la segunda aprobación»);
  - listo para mandar («Mandar a Revolut»);
  - enviado o esperando aprobación en Revolut («Preguntar a Revolut»);
  - pagado, rechazado con el motivo de Revolut entre comillas, devuelto o cancelado.

**La segunda aprobación** (maqueta v4), en una pantalla aparte:
- la lista exacta (cada pago, su IBAN y por qué), desde dónde y el total;
- **«Confirmar con mi llave»:** `llave_opciones`, después `navigator.credentials.get` y después `llave_confirmar`;
- **«Usar mi PIN de pago»:** `pin_confirmar`, con la huella de la lista que se ve. Un PIN equivocado dice cuántos intentos quedan, y con 5 se bloquea;
- al confirmar, se manda a Revolut y se dice: «Confirmado con tu PIN de pago… Enviado a Revolut: 1 pago. Te avisamos cuando lo confirme»;
- si se cancela la ventana de la llave: «No has confirmado. No ha salido ningún pago: siguen aprobados y esperando»;
- **«No pagar»** cancela el lote (`conta_pago_cancelar`);
- **con dos o más personas que pagan**, la da otra con su llave o su PIN. Quien no puede darla lee el porqué de la base.

**Compras › Pagos:** con dos o más personas que pagan, arriba sale lo que espera tu segunda aprobación (`conta_pago_para_mi`), con «Verlo y aprobarlo». Si no hay nada, no ocupa sitio.

**La remesa «banco»** (la que crea un pago mandado por Revolut, 1614):
- **El problema:** las funciones de las remesas solo dicen si una remesa es «a mano», así que la «banco» salía como de fichero, con «Descargar el fichero».
- **El arreglo:** ahora se lee su tipo de la tabla (`conta_pago_remesa.kind`, con su RLS de lectura) y se enseña como «Pago por el banco»:
  - sin «Descargar el fichero»;
  - con «Cómo sale: por la API del banco (Pagar con Revolut), sin fichero»;
  - con su frase: «Cuando llegue el cargo, cásalo en Bancos con este pago».
- Igual en la lista de remesas y en la propuesta de casar de Bancos.

## Lo que no está

- **El cargo no se casa solo todavía.** Decisión de Julio (01/11): va en un PR propio, el primero del PR 3. Allí se saca un núcleo, sin guardas y solo para dentro de la base, de cuatro funciones:
  - `bank_casar`;
  - `mark_supplier_invoice_paid`;
  - `journal_entry_validar`;
  - `conta_remesa_casar`.

  Cada una lleva su prueba de antes = después, y con eso el cargo de Revolut se casa solo, y también el de las remesas. Hasta entonces, Bancos ofrece casar el cargo con el pago «banco» con un clic, como cualquier remesa, y la factura queda pagada al casarlo.
- **Pagar varias facturas a la vez desde Pagos** (la remesa por Revolut) es el PR 3. La pantalla de la segunda aprobación ya sirve para varios pagos.
- **La llave de acceso de verdad en una e2e**, con el autenticador virtual de Chromium, va en la e2e con el sandbox. Una llave no se puede atar a la IP en la que corre la e2e (127.0.0.1).

## Pruebas

**Unitarias** (`tests/unit/modules/conta/pagos/pagarPantalla.test.ts`):
- el panel y la lista de la segunda, leídos tal como los devuelven `conta_pago_preparar` y `conta_pago_lote_ver`;
- el titular en sus cinco respuestas. «No coincide» no dice de quién es la cuenta;
- lo que dice la ficha en cada estado de un pago, contrastado con el CHECK de `conta_pago_salida`: ni un estado sin su frase;
- la remesa «banco» no ofrece el fichero.

**e2e** (`tests/e2e/conta/b01/revolutPagar.spec.ts`, cuenta B, ordenador y móvil):
- **La factura y su proveedor son de verdad.** Se crean por la API con la sesión de B, con nombres inventados y únicos, y se borran al acabar.
- **Lo del pago va interceptado.** No se manda nada a ningún banco ni se escribe ningún pago.
- **Lo que recorre:**
  1. quien no puede pagar lee «Pídeselo a …», sin botón;
  2. quien puede: el panel (importe, IBAN nuevo, concepto, «✓ Revolut dice que coincide», «Hace falta una segunda aprobación (IBAN nuevo)»);
  3. «Aprobar y pagar»: la segunda con la lista exacta, «Usar mi PIN de pago», un PIN equivocado («Te quedan 4 intentos») y el bueno; sale a Revolut y la ficha dice «Enviado a Revolut»;
  4. que se mandó la factura de la empresa desde la cuenta de Revolut, el PIN con la huella de la lista y el envío del lote.

**Comprobaciones hechas:**
- `scripts/conta/antes-de-subir.sh`: los 10 pasos en verde (lint, unitarias, `npm run build` en limpio, SQL y capturas).
- `npx tsc -b`: sin errores.
- **Regla 40:** los nombres entre comillas, contra producción. Las tablas `bank_aggregator_link`, `treasury_account`, `conta_pago_salida` y `conta_pago_remesa` existen. Las funciones `conta_pago_preparar`, `conta_pago_aprobar`, `conta_pago_cancelar`, `conta_pago_lote_ver`, `conta_pago_para_mi` y `conta_pago_quien`, también. El CHECK de `kind` admite «banco», y las columnas de `conta_pago_salida` que se leen existen.

## Antes de usarlo

- `PAGO_PIN_CLAVE` y los dos correos de los pagos, ya en producción (Julio, 01/11).
- **Para probar en el sandbox,** el código del correo (crear el PIN o activar la llave) necesita `codigo_pago_conta` abierto en el freno de staging. Además, el SMTP de staging da 535 (apuntado el 31/10).

## Funciones a desplegar a mano

### Sumied

ninguna

### Folvy

ninguna

## Producto

- Sumied
