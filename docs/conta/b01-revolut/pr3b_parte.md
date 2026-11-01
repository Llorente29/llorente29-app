B01 Revolut · PR 3b · **Pagar varias facturas a la vez con Revolut**, desde Compras › Pagos. Es la remesa de siempre con otra salida, como en la maqueta v2 aprobada (pantalla 4): las facturas marcadas, un solo «Aprobar y pagar» y una sola segunda aprobación para todas. Sin base nueva: usa la 1234, la 1614 y la 2030, ya en producción. Sin tanda.

## Qué hace

**La barra de Pagos.** Cuando la cuenta de «Desde» es una con la que se paga desde Sumied (ligada a Revolut) y quien mira puede pagar:
- el botón principal es **«Pagar las N con Revolut»**: lleva el nombre del banco de «Desde»;
- **«Preparar el fichero SEPA»** queda como segunda salida, la remesa de siempre;
- la nota de la barra dice que salen al momento, con una sola aprobación, y que el cargo se casa solo (2030);
- Intro hace lo mismo que el botón principal.

Con cualquier otra cuenta, o si no puedes pagar, la barra es la de siempre.

**La ventana «Pagar con Revolut».** Para cada factura marcada, una a una:
- lo que dice la base (`conta_pago_preparar`): el importe, el IBAN («✓ comprobado», «nuevo» o «cambiado») y por qué pediría la segunda aprobación;
- el titular, que pregunta el banco (`conta-pagar · titular`).

**Qué sale y qué no** (`quienesSalen`, con unitarias):
- **no sale** lo que la base no deja pagar, con su porqué (sin IBAN, domiciliada…);
- **no sale** un titular que no coincide, salvo que se marque «Lo he comprobado con el proveedor: pagar igual» y se diga por qué. Ese porqué va a la base con la factura y pide la segunda aprobación;
- **las demás salen juntas**, y el resumen lo dice: «Salen 2 pagos, 1.338,50 €, con una sola aprobación. 1 se queda por pagar».

**Después de aprobar** (`conta_pago_aprobar` con todas, un solo lote):
- sin segunda aprobación, se mandan a Revolut en el mismo gesto;
- con ella, si eres la única persona que paga, la pantalla de la llave o el PIN (la del 2c-2), una sola para todos;
- si la da otra persona, se dice, y la otra la ve en «Esperan tu segunda aprobación».

Pagos dice lo que ha pasado: «Enviado a Revolut: 2 pagos. Te avisamos cuando lo confirme» (regla 8).

## Pruebas

**Unitarias** (`tests/unit/modules/conta/pagos/pagarVarias.test.ts`):
- mientras se comprueba alguna, no sale ninguna;
- lo que la base no deja, se queda con su porqué;
- un titular que no coincide no sale; tampoco con «pagar igual» sin porqué; sí con su porqué;
- el botón lleva el nombre del banco;
- la barra solo cambia con una cuenta que paga desde Sumied y con quien puede pagar.

**e2e** (`tests/e2e/conta/b01/revolutPagarVarias.spec.ts`, cuenta A, ordenador y móvil):
- como la de Pagos del PC01: la lista se simula con la forma de la base, y los bancos son los de staging. Uno de ellos hace de cuenta de Revolut;
- lo del pago va interceptado: no se manda nada a ningún banco;
- **lo que recorre:**
  1. marcar dos facturas y elegir la cuenta: «Pagar las 2 con Revolut» y «Preparar el fichero SEPA»;
  2. la ventana: la primera, «✓ Revolut dice que coincide»; la segunda no sale hasta «pagar igual» con su porqué;
  3. una sola segunda aprobación, con el PIN; salen a Revolut y Pagos lo dice;
  4. una sola aprobación con las dos facturas, desde la cuenta de Revolut, y el porqué solo en la que no coincidía.

**Comprobaciones:** `scripts/conta/antes-de-subir.sh`, los 10 pasos en verde (lint, unitarias, `npm run build` en limpio).

## Lo que sigue

- La prueba de punta a punta en producción con un pago de 1 € a una cuenta de Julio, guiada por la sesión principal.
- PR 4: las nóminas.

## Funciones a desplegar a mano

### Sumied

ninguna

### Folvy

ninguna

## Producto

- Sumied
