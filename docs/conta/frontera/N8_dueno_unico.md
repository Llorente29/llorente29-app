# N8 · Un solo dueño para tres tablas: `supplier_invoice`, `channel_settlement` y `licensed_settlement`

> Paso 7 de la auditoría C09. Solo documento: no cambia código ni base.
> **Puesto al día el 24/10 con las decisiones de Julio y su regla** (al final).
> Medido el 24/10 en producción, en solo lectura, y en `origin/main`.
> Las cifras de filas no se dan por cuenta: las tres tablas tienen filas en
> **una sola cuenta** (regla 9: ninguna de la plantilla).

## Para qué sirve decidirlo

Hoy las tres tablas las escriben y las leen los dos productos. Mientras sea
así:
- un cambio de Folvy puede romper un asiento de Sumied, y al revés;
- separar Sumied en su propio proyecto (N5) no se puede hacer limpio.

La regla que se propone: **una tabla tiene un solo dueño**. Solo el dueño
escribe en ella. El otro producto lee por una función con versión (la puerta
del N6) y nunca por la tabla.

## Lo que hay hoy, medido

### `supplier_invoice` (factura recibida)

| | Sumied | Folvy |
|---|---|---|
| Código del front que la nombra | 22 ficheros en `src/modules/conta` | `src/modules/supply`: `supplierInvoiceService`, `SupplierInvoicesPage`, `InvoiceScanPanel` |
| Escribe | Entrada por correo y lote (`conta_lote_*`), lectura, revisión, validación, asiento, IVA no deducible, PDF, envío a Diez, pago y casación con el banco (`bank_casar`, `compras_casar`), descarte | Alta manual y por OCR (`createSupplierInvoice`), anular, marcar discrepancias, aprobar (`approveInvoice`), reglas de aprobación (`invoice_approval_rule`) |
| Funciones de la base que la tocan | La mayoría de las 61: `conta_*`, `compras_*`, `bank_*`, `_compras_*` | `apply_invoice_costs` (el precio de la factura al coste de la receta), `run_invoice_match` (cruce con el albarán), `current_user_can_approve_invoice`, `invoice_required_role` |
| Disparadores | `trg_supplier_invoice_no_repetida`, `bank_factura_aprobada_con_pago`, `supplier_invoice_iban_guard` | `trg_supplier_invoice_aprobacion`, `trg_set_supplier_invoice_code` |

- **De dónde vienen las facturas** (últimos 30 días, la única cuenta con filas): casi todas por `lote · portal` (Sumied), y unas pocas por `ocr`, un camino que comparten `SubirFactura` (Sumied) e `InvoiceScanPanel` (Folvy).
- **La tabla está en el centro:** la referencian 18 tablas, entre ellas `goods_receipt_path` (Folvy), `tax_return_line` (impuestos), `channel_settlement.commission_invoice_id` y `licensed_settlement.received_invoice_id`.

### `channel_settlement` (liquidación de plataforma: Glovo, Uber, Just Eat)

| | Sumied | Folvy |
|---|---|---|
| Escribe | Las importaciones (CSV de cada plataforma, correo de Uber), cobrar y descobrar (`channel_settlement_collect` y `channel_settlement_uncollect`), confirmar el periodo, el asiento (`conta_liquidacion_*`), la tienda (`conta_tienda_plataforma_asignar`) y la factura de comisión | Nada |
| Lee | Todo lo anterior | `channel_economics_dashboard` y `licensed_economics_dashboard` (`src/modules/ventas`): la rentabilidad por canal |
| Apunta a | `supplier_invoice` y `journal_entry` | `sales_channel`, `platform_store`, `brand` y `locations`; y `channel_settlement_order` la cruza con los pedidos |

- **Las importaciones activas** de los últimos 30 días son solo `correo_uber`.

### `licensed_settlement` (liquidación de licencia o socio de marca)

| | Sumied | Folvy |
|---|---|---|
| Escribe | `compras_liquidacion_*` y `brand_partner_settlement_*`: preparar, contrastar, guardar y confirmar, y el asiento | Nada |
| Lee | Todo lo anterior | `licensed_economics_dashboard` |
| Apunta a | `supplier_invoice`, `journal_entry` y `company` | `locations`, `party` y `supplier` |

### Y el #317 (N6), ya resuelto

La puerta v1 traía tres funciones que leían las dos liquidaciones como si fueran
de Folvy. Con la decisión 2 se quitaron antes de aplicar su tanda: en producción
están las cinco de la puerta y las dos de apoyo, y ninguna de liquidaciones.

## Las opciones, tabla a tabla

### `supplier_invoice`

**A · Dueño Sumied (recomendada).** Folvy deja de escribir. Lo que necesita
lo lee por funciones con versión, en sentido contrario al de la puerta:
- `factura_lineas_para_coste_v1`: los precios por artículo, para el coste de la receta;
- `factura_cruce_albaran_v1`: el resultado del cruce con el albarán.

El alta por OCR y la aprobación pasan a Sumied.
- **A favor:**
  - es un documento fiscal: va al libro de IVA, al 303, a las retenciones y a Diez;
  - casi todo lo que la toca ya es de Sumied;
  - casi todas las facturas entran ya por Sumied.
- **En contra:**
  - Folvy pierde la pantalla de facturas de Supply tal como está, y hay que rehacerla como lectura;
  - `apply_invoice_costs` y `run_invoice_match` cambian de casa, y los dos tocan el **coste**: regla 10, se ensayan por sus cuatro caminos;
  - la aprobación por roles (`invoice_approval_rule`) es hoy de Folvy.

**B · Dueño Folvy.** Sumied escribe por funciones de Folvy.
- **A favor:** no se toca la pantalla de Supply.
- **En contra:**
  - deja lo fiscal fuera de Sumied, que es justo lo que el N5 quiere separar;
  - Sumied tendría que pedir permiso a Folvy para cada campo nuevo.

**C · Partirla.** El documento fiscal en Sumied y el cruce operativo
(albarán, precio, aprobación) en una tabla de Folvy, con una referencia de
una a otra.
- **A favor:** cada uno con lo suyo.
- **En contra:**
  - es la más cara: hay dos tablas que tienen que coincidir;
  - y las 18 tablas que la referencian hay que repartirlas.

### `channel_settlement` y `licensed_settlement`

**A · Dueño Sumied (recomendada).** Folvy ya no escribe en ellas. Solo hay
que dar una lectura con versión a sus dos paneles de rentabilidad
(`liquidaciones_para_rentabilidad_v1`). Las tres funciones del #317 que las
leen se quitan.
- **A favor:**
  - hoy ya es así de hecho: es el cambio más barato;
  - el cobro, el periodo y el asiento son contabilidad.
- **En contra:**
  - `channel_settlement_order` cruza la liquidación con los pedidos de Folvy y se quedaría a caballo: hay que decidir de quién es (la propuesta es Sumied, leyendo los pedidos por `fuente_pedidos_v1`, que ya está en el #317);
  - los paneles de Folvy cambian de consulta.

**B · Dueño Folvy.** Se queda como dice el #317: Sumied lee por la puerta.
- **A favor:** el #317 ya está escrito así.
- **En contra:** Folvy sería dueño de una tabla que no escribe. Todo lo que la escribe es de Sumied, y para escribirla tendría que hacerlo por funciones de Folvy.

## La regla de Julio (24/10) para todo lo que se mueve

**Folvy nunca se queda cojo por lo que se haga en Sumied.** Una cuenta que solo
tiene Folvy no pierde nada de lo que tiene hoy, y no tiene que contratar Sumied
para seguir usándolo.

Cómo se sabe qué tiene cada cuenta, hoy: Sumied está encendido si la cuenta
tiene el interruptor `conta` en `feature_flags`. Medido el 24/10:
- Foodint tiene los dos productos.
- Kitchen Grill LstQ y Casa Lola tienen solo Folvy, y hoy no tienen ni
  facturas de proveedor ni liquidaciones.
- La plantilla (Folvy Interno) no cuenta.

## Lo que decidió Julio (24/10)

1. **Facturas de proveedor: el dato es de Sumied.**
   - Con los dos productos, se dan de alta en un solo sitio, Sumied, y Folvy las lee (coste del plato, precios).
   - Solo con Folvy, Supply sigue dando altas y editando como hoy, **sobre la misma tabla**.
2. **Liquidaciones, y qué pedidos lleva cada una: de Sumied, con su liquidación.** Una cuenta solo con Folvy tiene que seguir teniendo liquidaciones (hoy no las tiene), sobre lo mismo y sin copia.
3. **Aprobación de facturas por roles: se muda con las facturas** y sigue disponible solo con Folvy.
   - Medido el 24/10: **nadie la usa**. Hay 0 reglas en `invoice_approval_rule` en las cuatro cuentas.
4. **El orden:**
   - primero las liquidaciones;
   - después las facturas, empezando por el precio que alimenta el coste del plato, probado en sus cuatro caminos (regla 10).

## Cosa a cosa: qué ve cada cuenta

### 1. Liquidaciones de plataforma (`channel_settlement`) y sus pedidos (`channel_settlement_order`)

| | Solo Folvy, hoy | Solo Folvy, después | Con los dos productos |
|---|---|---|---|
| **Meter liquidaciones** (CSV de Glovo, Uber y Just Eat, o el correo de Uber) | **No puede.** La importación vive en Sumied (Compras › Liquidaciones y la entrada por correo). | **Puede**, con la misma importación y en la misma tabla, desde una entrada de Folvy (Ventas). **Sin asiento.** | Como hoy: en Sumied, con su asiento. |
| **Ver la rentabilidad por canal** (Ventas › Economía / Márgenes) | La pantalla está, pero sale vacía: no tiene liquidaciones. | Con datos. | Como hoy. |
| **Cruzar la liquidación con los pedidos** | No puede. | Puede: el mismo cruce, sobre la misma tabla. | Como hoy, en Sumied. |
| **Cobro, periodo y asiento** | — | No aplica: no lleva contabilidad. | En Sumied. |

**Dónde pierde hoy y cómo se evita:** hoy una cuenta solo con Folvy ya está coja, porque no puede meter liquidaciones. Se arregla así:
- La importación y el cruce, que hoy viven en Sumied, se ofrecen también desde Folvy cuando la cuenta no tiene `conta`. Escriben en la misma tabla, sin asiento y sin copia.
- La regla para no romper nada es que **la importación no puede exigir lo contable**: ni empresa, ni asiento, ni cuenta de cobro.

*Ojo:* esta importación es la base del V01 de D (Ventas en Sumied, sobre las
`d01_liquidaciones_*`). Este documento no la toca. Abrirla a Folvy se hace
**después del V01 y con D**, porque es lo suyo.

### 2. Liquidaciones de licencia (`licensed_settlement`, Cloudtown)

| | Solo Folvy, hoy | Solo Folvy, después | Con los dos productos |
|---|---|---|---|
| **Meter la liquidación del mes** | **No puede.** Preparar, contrastar y confirmar (`compras_liquidacion_*`) son de Sumied. | Puede preparar y confirmar, sin asiento, en la misma tabla. | Como hoy, en Sumied, con su asiento. |
| **Verla** (Ventas › Cedidas CTB) | La pantalla está, pero sale vacía. | Con datos. | Como hoy. |

**Dónde pierde y cómo se evita:** lo mismo que en el punto 1. Lo que hoy solo hace Sumied se ofrece sin asiento a la cuenta que no tiene `conta`.

### 3. Facturas de proveedor (`supplier_invoice`)

| | Solo Folvy, hoy | Solo Folvy, después | Con los dos productos |
|---|---|---|---|
| **Dar de alta** (a mano o leyendo el PDF) | En Supply › Facturas. | **Igual**, en Supply y en la misma tabla. | **Solo en Sumied.** En Supply el botón de alta lleva a Sumied. |
| **Cruzar con el albarán** (`run_invoice_match`) | En Supply. | Igual. | Igual, sobre la factura que entró por Sumied. |
| **Que el precio de la factura pase al coste del plato** (`apply_invoice_costs`) | Al pulsar «Aprobar» en Supply. | Igual. | **Hoy no pasa: validar en Sumied no llama a `apply_invoice_costs`.** Ver abajo. |
| **Ver las facturas** | En Supply. | Igual. | En Sumied; en Supply, la lista se queda solo para mirar. |
| **Anular o marcar diferencias** | En Supply. | Igual. | En Sumied. |
| **IVA, asiento, Diez y pago** | — | No aplica. | En Sumied, como hoy. |

**Dónde pierde y cómo se evita:**
- **Solo Folvy no pierde nada**, porque Supply se queda como está y sobre la misma tabla.
- **Lo que hay que cuidar** son los disparadores de Sumied sobre `supplier_invoice` (N4: no repetida, IBAN, pago):
  - no pueden impedir una alta de Supply en una cuenta sin `conta`;
  - se comprueban dando de alta una factura desde Supply en una cuenta de staging sin `conta`.
- **Con los dos productos falta algo que hoy tampoco está:** el precio de una factura validada en Sumied no llega al coste del plato.
  - Es la primera pieza del orden: que validar en Sumied pase el precio, igual que «Aprobar» en Supply.
  - Va con sus cuatro caminos (regla 10): cerrar una venta, recibir un albarán, apuntar una merma y aprobar un recuento.

### 4. Aprobación de facturas por roles (`invoice_approval_rule`)

| | Solo Folvy, hoy | Solo Folvy, después | Con los dos productos |
|---|---|---|---|
| **Poner reglas** («las de más de 500 € las aprueba un encargado») | En Supply. | **Igual**, en Supply. | En Sumied, sobre la misma tabla. |
| **Aprobar según la regla** | En Supply. | Igual. | Antes de validar, en Sumied. |

**Dónde pierde y cómo se evita:** no pierde. Además, hoy no la usa nadie (0 reglas), así que moverla no le cambia nada a ninguna cuenta.

## El orden, con la regla

1. **Liquidaciones:**
   1. que Sumied sea el único que escribe, por funciones;
   2. los dos paneles de Folvy leen por una función con versión;
   3. **después**, con D y tras el V01, la importación sin asiento para las cuentas solo con Folvy.
2. **Facturas:**
   1. primero, que validar en Sumied pase el precio al coste del plato, probado en sus cuatro caminos;
   2. después, el alta en un solo sitio cuando hay dos productos;
   3. y la prueba de que Supply sigue dando altas en una cuenta sin `conta`.
3. **Aprobación por roles:** se muda con las facturas. Como no la usa nadie, no hay nada que traspasar.

Nada de esto se ha movido todavía: este documento solo lo ordena.
