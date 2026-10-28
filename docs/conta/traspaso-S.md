# Traspaso de S · Pagos y cobros, y los asientos sin botón (28/10)

Lo que deja la sesión S, que cierra aquí, para quien coordina. Escrito el 28/10
hacia las 10:30 UTC. Las cifras son de producción, medidas en solo lectura ese
día, de la cuenta Foodint salvo que se diga otra cosa.

## Los PR

| | Qué | Estado |
|---|---|---|
| #363 · PR 1 | Redsys en el enlace de pago; el abono de Stripe o del TPV casado en Bancos (tanda con autorizo 2030) | fusionado |
| #366 · Respuesta 5 | Pagar con Redsys en staging (funciones y empresa de prueba) | fusionado |
| #368 · PR 2 | El menú limpio (Tickets y Series fuera) y Stripe sin parpadeo en «Cómo te pagan» | fusionado |
| PR 3 (`claude/s01-pr3-propuestas-solas`) | El cobro por el enlace nace validado (0735) y la entrega 5 del PC01: los asientos se proponen solos | abierto; runs y tanda, en su parte |

## El PR 3, en una línea por pieza

- **0735 · el cobro por el enlace nace validado.** Stripe y Redsys, como el
  efectivo. Una devolución se deshace con su contraasiento. Si no se puede
  validar, se queda propuesto y la factura lo dice. Las reglas de validar
  viven en `_journal_entry_validar`, en una sola copia. Medido el 28/10: 0
  enlaces de pago y 0 asientos de cobro por el enlace.
- **Los cinco orígenes, en SQL.** Cada uno se comparó con la regla del
  navegador sobre datos reales (regla 31) y luego se borró la copia del
  navegador (Respuesta 7: «no pueden quedar dos copias de la misma regla»).

  | Origen | Migración | Cuándo se propone | La comparación |
  |---|---|---|---|
  | Nóminas | 0800 | Al llegar el resumen de la gestoría (disparador) | Producción tiene 0 nóminas; sobre la semilla de staging |
  | Lo recibido sin factura | 0830 | Al acabar el mes | 6 de 6 iguales, campo a campo (Foodint, octubre) |
  | El no confirmado que una liquidación paga | 0849 | Al leer la liquidación (disparadores de `channel_settlement_order`) | 19 pedidos reales: iguales en cobro, IVA, venta neta, cabecera y razones. A propósito, la SQL usa la subcuenta de la marca y separa promociones y envíos, como el asiento del día |
  | El socio de marca | 0905 | Al confirmarse o saldarse su liquidación | Sobre la semilla de staging, con y sin lo aprendido |
  | La liquidación de plataforma | 0929 | Al leerse (disparador de `channel_settlement`) | De las 268 de Foodint, 247 iguales (96 propuestas y 151 «no se propone»); las otras 21 salen antes por el mismo motivo. Más los 16 casos de las pruebas del navegador |

- **1103 · la retención del trabajo de serie.** En producción había 5 tipos
  de retención, todos de serie y ninguno de trabajo. Se añade el del 111,
  clave A del 190, al 0 % (el tipo es el de cada nómina). La regla de nóminas
  lo busca por su clave y su vigencia, nunca «el primero». No se ofrece al
  elegir la retención de un proveedor, un contacto o una factura de venta.
- **1025 · la pasada de las 03:40 de Madrid.** Recoge lo que se haya quedado
  atrás de los cinco orígenes. Valida solo las ventas del día «seguro» sin
  «Mira esto», y solo si la empresa lo tiene encendido (en Foodint está
  apagado). El cron salta a las 01:40 y a las 02:40 UTC y trabaja solo a las
  3 de Madrid. Si falla una empresa, sigue con las demás y termina en error.
- **Pantallas.**
  - Asientos ya no tiene «Proponer lo pendiente».
  - «Lo que no he podido proponer, y por qué» sale en su apartado: Asientos
    (las nóminas, hasta Laboral), Facturas recibidas, Ventas › Liquidaciones y
    Ventas › Cierres del día.
  - El pago a proveedor y lo recibido sin factura (con su contrario) se deciden
    en Facturas recibidas, en un bloque nuevo que los enseña todos y los valida
    uno a uno (`SE_DECIDE_EN`).
  - El pago del lote prepagado de Catcher conserva su botón.
  - Capturas en `docs/conta/pc01/tableros/s01-pr3/`. Facturas recibidas no
    tiene tablero propio.

## La primera noche de la pasada, en Foodint (medido el 28/10)

- **Rango:** del 01/10 (septiembre está cerrado) a hoy.
- **Nóminas, socio de marca y pagado después:** 0 cada uno. No hay nada que
  proponer.
- **Liquidaciones de plataforma:** 13 en el rango, y 0 se proponen. Las 13 van
  a «Lo que no he podido proponer» de Ventas › Liquidaciones:
  - 8: «Tienda sin asignar: dale su marca y su local.»
  - 5: «Falta su factura de comisión».
- **Lo recibido sin factura:** nada hasta que acabe octubre. La noche del 31/10
  al 01/11 propone el de octubre, que fueron 6 asientos en la comparación, y
  sus contrarios del día 1.
- **Validar solo:** 0. Está apagado y no hay ventas «seguro» propuestas.
- **Cambio de sitio:** de los tres orígenes que pasan a Compras hay 1 asiento
  de pago a proveedor, ya validado (15/10), y ninguno propuesto.

## Lo que queda abierto, y de quién

- **El PR 3:** e2e, después el ensayo (una vez, sobre el commit final), luego
  el real de su tanda desde la rama y, por último, la fusión.
- **El #728:** psql se quedó esperando a la red. El límite de conexión del
  workflow va con la copia de la estructura de staging, en otro encargo.
- **La pasada no recoge facturas recibidas.** El botón también recogía las
  aprobadas sin proponer; ahora se proponen al validarlas en Compras.
- **El enlace sigue diciendo «pagado» después de una devolución.** La factura
  sí queda con su contraasiento.
- **En los textos del socio** aparece «Sumied» donde el navegador ponía el
  nombre de la marca.

## «Pagos y cobros» en la biblia: lo que creo que queda en verde, y por qué

La fila la reescribe Julio después de comprobarlo en producción y en pantalla.
Esto es solo lo que yo diría:

- **En verde:** cobrar una factura por enlace con Stripe o con Redsys, con su
  asiento validado al nacer, y la devolución con su contraasiento. Está
  probado en staging, con Redsys de prueba. En producción todavía no hay
  ningún enlace de pago (0 el 28/10), así que falta el primer cobro de verdad.
- **En verde:** el abono de Stripe o del TPV casado en Bancos (#363,
  fusionado).
- **En verde con una condición:** las propuestas sin botón y la pasada de
  noche, una vez aplicada la tanda del PR 3. La primera noche no propondrá
  nada en Foodint: dirá por qué no en 13 liquidaciones.
- **No en verde todavía:**
  - las nóminas, porque producción no tiene ninguna (0 resúmenes de gestoría);
  - el socio de marca, porque sus 3 liquidaciones son de la fórmula anterior y
    esa no se propone.
