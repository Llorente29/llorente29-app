# N8 · Un solo dueño para tres tablas: `supplier_invoice`, `channel_settlement` y `licensed_settlement`

> Paso 7 de la auditoría C09. Solo documento: no cambia código ni base.
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

### Y lo que ya da por hecho el #317 (N6)

La puerta v1 trae `fuente_liquidaciones_plataforma_v1`,
`fuente_liquidacion_pedidos_v1` y `fuente_licencias_mes_v1`. Las tres **leen
`channel_settlement` y `licensed_settlement` como si fueran de Folvy**. Si las
dos pasan a ser de Sumied, esas tres sobran: Sumied leería su propia tabla.
**Conviene decidirlo antes de aplicar la tanda del #317.** Las otras seis de
la puerta no dependen de esto.

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

## Lo que hay que decidir

1. **`supplier_invoice`:** ¿A (Sumied), B (Folvy) o C (partirla)? Recomendada: **A**.
2. **Las dos liquidaciones:** ¿A (Sumied) o B (Folvy)? Recomendada: **A**. Si es A, quito del #317 las tres funciones que las leen **antes** de aplicar su tanda.
3. **`channel_settlement_order`:** ¿va con su liquidación, a Sumied? Recomendado: sí.
4. **La aprobación de facturas por roles** (`invoice_approval_rule`, de Folvy): si `supplier_invoice` es de Sumied, ¿la aprobación se muda con ella o la quitamos? Hoy no lo puedo medir desde aquí: depende de si alguien la usa.
5. **El orden.** El de siempre para quitar algo: primero el front deja de escribir y se publica, y en otra tanda se cierran los permisos. Propuesta:
   1. las liquidaciones, que es lo más barato;
   2. después `supplier_invoice`, empezando por las lecturas de coste, ensayadas por sus cuatro caminos.
