# C04 · Libro diario — comprobaciones previas (tarea 1)

> 06/10/2026. Rama `conta/c04-libro-diario`, desde `main` en `0b949ca6` (lleva
> C00–C03 y los PR #157–#159). Producción en **solo lectura** (SELECT) y siempre
> con `account_id` (regla 9). No se ha aplicado nada ni se ha escrito código:
> esto es el informe y **paro** aquí. Las decisiones para Julio van al final (D1–D10).
>
> El repositorio es público: los locales van como «local 1» (el de más volumen)
> y «local 2», y los socios de marca como «socio 1» y «socio 2». Las plataformas
> se nombran porque ya están en el código.

## 0. Lo que cambia respecto al encargo (lo dicen los datos, no yo)

1. **Las ventas sin base imponible son las de HubRise, no las de Last.**
   - En Foodint, **las marcas propias entran por HubRise** y **las cedidas por Last**. En 30 días no hay ni un cruce.
   - **Last trae base y cuota en 10.630 de 10.631 ventas cerradas.**
   - **HubRise no trae ninguna**: 0 de 1.338. El `hubrise-webhook` escribe `tax: null, taxable_base: null` a propósito («futuro»).
   - Así que la regla 13 muerde justo en las ventas que **sí** van a 70x.
2. **Foodint no tiene sala, caja ni tarjeta.**
   - Todas las ventas cerradas de septiembre son reparto por plataforma: Glovo, Uber o Just Eat.
   - `payment_method` está vacío en todas.
   - El cobro del asiento de ventas del día es la **430 de cada plataforma**, no 570/572. Las líneas de caja y tarjeta de la maqueta valen para otro negocio (el TPV de Folvy sí guarda efectivo y tarjeta).
3. **`fiscal_year` y `fiscal_period_lock` ya existen** desde el C00 (`20261003T0110_c00_empresa.sql:165-233`).
   - Hoy hay un ejercicio, el 2026, abierto, y 0 bloqueos.
   - No se crean de nuevo: se amplían (D8).
4. **Nadie sabe hoy de qué socio es cada marca cedida.**
   - `brand_licensing_agreement` tiene **0 acuerdos con socio** (`party_id`).
   - Hay 8 marcas cedidas y 2 socios.
   - Sin ese enlace no se puede llevar una venta cedida a la cuenta de su socio (D4).

## 1. Ventas y tickets

### Dónde están

| Qué | Dónde |
|---|---|
| Ticket | `sale` (un registro por pedido) y `sale_line`; no hay tabla de cobros ni de IVA por línea |
| Local / marca / canal | `sale.location_id` → `locations`, `brand_id` → `brand` (`ownership_type` `own`/`licensed`), `channel_id` → `sales_channel` |
| IVA | solo por ticket: `sale.taxable_base`, `sale.tax` (€); **sin tipo** en `sale` ni en `sale_line` |
| Medio de cobro | `sale.payment_method` texto libre (TPV: `cash`/`card`); `payment_status`, `cash_session_id` |
| Importadores | `lastapp-webhook` (base y cuota del bill, totales, sin desglose por tipo), `lastapp-backfill-sales` (**no** escribe base ni cuota), `hubrise-webhook` (null), Shop/Otter (null), TPV `upsert_pos_sale` (calcula por línea con `menu_item.vat_rate`) |

### Producción, Foodint, ventas cerradas de septiembre (hora de Madrid, regla 4)

| Local | Origen | Marca | Canal | Tickets | Tickets/día | Total € | Base € | Cuota € |
|---|---|---|---|---:|---:|---:|---:|---:|
| local 1 | hubrise | propia | Glovo | 362 | 12,9 | 8.132,77 | — | — |
| local 1 | hubrise | propia | Uber | 253 | 9,7 | 5.691,65 | — | — |
| local 1 | hubrise | propia | JustEat | 19 | 1,5 | 407,25 | — | — |
| local 1 | lastapp | cedida | Glovo | 1.016 | 36,3 | 21.209,86 | 19.281,93 | 1.927,93 |
| local 1 | lastapp | cedida | Uber | 397 | 14,7 | 9.101,78 | 8.274,37 | 827,41 |
| local 1 | lastapp | cedida | JustEat | 28 | 1,9 | 747,50 | 679,54 | 67,96 |
| local 2 | hubrise | propia | Glovo | 97 | 3,6 | 2.812,92 | — | — |
| local 2 | hubrise | propia | Uber | 45 | 2,1 | 1.081,50 | — | — |
| local 2 | lastapp | cedida | Glovo | 670 | 23,1 | 14.850,69 | 13.500,83 | 1.349,86 |
| local 2 | lastapp | cedida | Uber | 347 | 12,0 | 7.029,50 | 6.390,46 | 639,04 |
| local 2 | lastapp | cedida | JustEat | 27 | 1,6 | 726,43 | 660,41 | 66,02 |

- **Lo que esto supone para el resumen diario de propias** (por día, local y canal): **115 asientos en septiembre**, unos 4 al día.
  - Si fuera por día y local: 56.
  - Cada uno lleva de media 2,7 marcas propias, con un máximo de 7.
  - Es poco volumen: el resumen diario no tiene problema de tamaño.
- **Datos de Last (marcas cedidas):**
  - Desde que existen (12/06): base y cuota en todas menos 1, de un `backfill`.
  - En las que traen las dos, base + cuota = total al céntimo en **todas**.
  - **Last no da desglose por tipo** (el bill trae totales).
- **Datos de HubRise (marcas propias, desde el 06/08):** se ha medido qué trae el pedido original (`raw_tab`).

  | Canal | Pedidos | Con `tax_rate` por línea | Con impuestos en cabecera |
  |---|---:|---:|---:|
  | Uber | 637 | **630** (todas al 10,0) | 0 |
  | Glovo | 668 | **0** | 0 |
  | Just Eat | 33 | **0** | 0 |

  De dónde puede salir la base sin inventarla:
  - En Uber, del tipo que trae cada línea.
  - En Glovo y Just Eat, del tipo de ventas de la empresa (`company_tax_profile.sales_tax_rate_code`, 10 % para reparto, C00), marcado como «calculado». Esto no toca `hubrise-webhook`: se calcula al proponer el asiento.
  - Las **liquidaciones de Glovo y Just Eat** traen `base_10`/`iva_10` (lector del C03) y sirven de testigo al cerrar la quincena (D1).

## 2. Facturas de proveedor (`supplier_invoice`)

- **Foodint en producción tiene 1 factura**, de agosto, aprobada, con base y cuota y sin pagar.
  - En cambio, los albaranes son **39, 44, 47 y 50** al mes (junio a septiembre) y 13 en octubre.
  - **El lado de compras del libro estará casi vacío mientras no se registren facturas** (D6).
- **«Confirmar» es `status='aprobada'`** con `approved_*`. No hay otra marca.
  - La factura tiene `location_id`.
  - Las líneas tienen `vat_pct`, pero no clave de libro registro ni marca de deducible.
- **La retención no está en la factura**: está en el proveedor (`supplier.irpf_withholding_pct`).
  - Para asentarla hay que llevarla a la factura (cambio aditivo, tarea 2).
- **El pago ya existe:** `paid_at`, `paid_method` y `supplier_invoice_payment_log`. Falta saber **de qué banco** sale (D7).
- **«Albarán a nombre del socio»:** no hay marca explícita.
  - Hoy se deduce porque el proveedor del albarán es la ficha de un tercero con papel de socio de marca (`brand_partner_settlement_compute`).
  - Hay que decidir si eso basta o si hace falta marcar el albarán (D4).

## 3. Liquidaciones

| Tabla | Foodint en producción |
|---|---|
| `channel_settlement` propias (CSV Glovo / Just Eat / Uber) | 96 / 53 / 50; liquidadas del 15/04 al 30/06. **Glovo y Just Eat sin periodo** (149) y 92 sin local |
| `channel_settlement` cedidas | 48 (`ctb_sales_detail`, junio) |
| `channel_settlement_order` (pedido a pedido) | Glovo 304 casados, 20 sin casar, 2.739 sin origen; Uber 233 / 1 / 3.341 |
| `licensed_settlement` | 3, fórmula `anterior`, junio, ninguna confirmada con la fórmula nueva |

- **No hay columna de IVA de la comisión.** La comisión llega con su signo y el IVA de la comisión hay que leerlo del documento o calcularlo (21 %). La liquidación a asiento lo dirá («calculado»).
- **Casar pedidos ya funciona** (`channel_settlement_match_recompute`, por código de pedido y ±2 días).
  - Es lo que permite la regla 7: la liquidación no vuelve a asentar ventas que ya se asentaron desde tickets.
  - Los «sin origen» son de antes de que hubiera tickets en Folvy (las propias entran por HubRise desde el 06/08).
- **En la liquidación del socio** (C03) el neto es `amount` (compras − aportaciones + comisión). No hay columna de «compensación»: el asiento la construye.

## 4. Nóminas

- `payroll_cost` va por trabajador y mes. **Foodint tiene 13 nóminas: 7 de junio y 6 de julio**, leídas del correo. **No hay de agosto ni de septiembre.**
- **Qué trae cada una:**
  - Bruto, SS de la empresa (con el desglose CC, desempleo, FOGASA, formación, MEI y AT/EP) y líquido.
  - **El IRPF y la SS del trabajador llegan juntos** (`deductions_total`, dentro de `raw`).
  - **Sin IRPF aparte no se puede hacer el apunte a 4751**, que es el que alimenta el 111.
- **No llevan local:** se saca de `employees.location_id`.
- **Lo que hay que pedir a la gestoría:** un resumen mensual con IRPF y SS del trabajador separados. Basta el propio resumen de nóminas, o el 111 y el RLC (D5).

## 5. Bancos

- `treasury_account` tiene **1 cuenta** en Foodint y **no tiene `location_id`**. «Cada local tiene su cuenta bancaria» no tiene hoy dónde apuntarse (D7).

## 6. Diez

- En el repositorio solo está documentado lo que se trajo en el C02c: los PDF de plan, proveedores y clientes.
- **De asientos no hay nada.**
- No afirmo qué exporta Diez del diario sin verlo. Pido una exportación de prueba del libro diario de un mes cerrado (D10). No la traigo aquí: es para el C04b, y no se sube al repositorio.

## 7. Norma (literal comprobado en los textos del BOE de `docs/conta/fuentes/textos`)

- **Código de Comercio:**
  - **Art. 25.1:** diario obligatorio.
  - **Art. 28.2** (redacción de la Ley 14/2013 art. 48, vigente desde el 29/09/2013): «Será válida, sin embargo, la anotación conjunta de los totales de las operaciones por períodos no superiores al **trimestre**, a condición de que su detalle aparezca en otros libros o registros concordantes». Es la base del resumen diario, con los tickets como detalle.
  - **Art. 29.1:** «sin espacios en blanco, interpolaciones, tachaduras ni raspaduras. Deberán salvarse a continuación, inmediatamente que se adviertan, los errores u omisiones». Es la base de la numeración sin huecos y de la anulación por contraasiento.
  - **Art. 30.1:** seis años desde el último asiento.
  - **Art. 27.2:** legalización «antes de que transcurran los cuatro meses siguientes a la fecha de cierre del ejercicio».
- **RIVA (RD 1624/1992):**
  - **Art. 63.4:** el asiento resumen de facturas expedidas pide, **a la vez**:
    - que no sea preceptivo identificar al destinatario;
    - que el devengo caiga en el mismo mes natural.
    - Además, que sean facturas **«numeradas correlativamente y expedidas en la misma fecha»**, con «los números inicial y final».
    - ⚠ Con los pedidos de plataforma hay que saber **quién expide** el ticket o la factura simplificada al consumidor y con qué numeración (D3). Si la expide la plataforma en nombre de Foodint, el rango es el de la plataforma.
  - **Art. 64.5:** resumen de recibidas solo si es de un único proveedor, con un total sin IVA ≤ 6.000 € y cada factura ≤ 500 €.
- **LIVA (Ley 37/1992):**
  - **Art. 91.Uno.2.2º:** 10 % para «el suministro de comidas y bebidas para consumir en el acto, incluso si se confeccionan previo encargo del destinatario».
  - **Novedad:** el RDL 26/2026 (BOE-A-2026-20266) toca este número con efectos del **01/12/2026**. Añade los arrendamientos de apartamentos amueblados; el texto de restauración no cambia. Queda para «Normativa al día».
- **Marcas cedidas, los dos caminos:**
  - **Camino A, en nombre propio.**
    - **LIVA 8.Dos.6º:** son entregas «las transmisiones de bienes entre comitente y comisionista que actúe en nombre propio».
    - **LIVA 11.Dos.15º**, segunda frase: si media en un servicio en nombre propio, «se entenderá que ha recibido y prestado por sí mismo los correspondientes servicios».
    - Consecuencia: Foodint repercute el IVA de toda la venta al consumidor (477) y el socio le factura a él.
  - **Camino B, en nombre ajeno.**
    - **LIVA 11.Dos.15º**, primera frase: es servicio «la mediación… cuando el agente o comisionista actúe en nombre ajeno».
    - Lo de Foodint es solo su comisión (servicio, 705 + IVA). La venta y su IVA son del socio. Lo cobrado por cuenta de él no es ingreso (**PGC, NRV 14.ª.1** y la **16.ª.1 de pymes**: «así como las cantidades recibidas por cuenta de terceros, no formarán parte de los ingresos»). En la memoria se dice «si la empresa está actuando como un agente o comisionista» (RD 1/2021).
    - **LIVA 78.Tres.3º** (suplidos, «sumas pagadas en nombre y por cuenta del cliente en virtud de mandato expreso») es para pagos adelantados por el cliente. No es este caso, salvo la mercancía que el socio pague y Foodint reciba.
  - **Lo que decide entre A y B es un dato, no una opinión:** quién figura como vendedor ante el consumidor en el ticket de la plataforma de esas marcas, y si Foodint incluye hoy esas cuotas en su 303.
  - **Last trae base y cuota de esas ventas.** La pregunta es de quién es el NIF del ticket.
  - **Valor inicial de Foodint: camino B**, que es «no es venta propia», como en Diez. El agente marcará ámbar hasta que esté dicho por socio (D2).
- **No están todavía en `fuentes.json`, y los añado en la tarea 5:**
  - LGT art. 29.2.j (Ley 58/2003, redacción de la Ley 11/2021);
  - RD 1007/2023 (Verifactu);
  - Ley 14/2013 art. 18;
  - la Resolución del ICAC de 10/02/2021 (agente o principal).
  - No cito su literal hasta tenerlo descargado.

## 8. Lo que reutilizo y lo que es nuevo (para la tarea 2)

- **Reutilizo:**
  - `fiscal_year` y `fiscal_period_lock`;
  - `company_account` (solo hojas), `company_account_link` (430 de plataforma, 40/41 del proveedor, 472/477 por tipo);
  - `tax_rate` / `withholding_rate` (con `model_190_key` y `filed_in`);
  - `party` / `party_role`;
  - `treasury_account`;
  - `entry_text` (textos de asiento del C00).
- **Nuevo:**
  - `journal_entry`, `journal_line`, `allocation_rule`, `entry_template`;
  - el enlace al asiento en `supplier_invoice`, `channel_settlement` y `licensed_settlement` (aditivo);
  - las consultas de Mayor, sumas y saldos y resultado por local y marca.
- **El Mayor del C02 lee hoy un array vacío** (`MayorPage.tsx:35`, `SusCuentas.tsx:37`, `ApartadosTercero.tsx:281`). Pasa a leer de `journal_line`; el `Apunte` de `cuentasProveedor.ts:277` ya tiene la forma.

## Decisiones para Julio

1. **D1 · Base de las ventas propias.** Propongo:
   - Uber: con el tipo por línea que trae HubRise.
   - Glovo y Just Eat: con el tipo de ventas de la empresa (10 %), marcado como «calculado».
   - Sin tocar `hubrise-webhook`.
   - Al llegar la liquidación de la quincena, su `base_10`/`iva_10` se compara con la suma de los asientos del periodo, y la diferencia se dice.

   ¿Vale, o prefieres que no se proponga nada sin base de origen?
2. **D2 · Marcas cedidas: ¿camino B (nombre ajeno) para los dos socios?** Es como lo llevas en Diez. Y para contrastarlo con la gestoría: ¿con qué NIF sale el ticket al consumidor de esas marcas?
3. **D3 · ¿Quién expide el ticket o la factura simplificada** de los pedidos de plataforma de tus marcas propias, y con qué numeración? Decide qué rango de tickets lleva el asiento resumen (RIVA 63.4).
4. **D4 · De qué socio es cada marca cedida.**
   - Hay 8 marcas cedidas sin socio en `brand_licensing_agreement`.
   - Propongo una tarjeta de revisión en la ficha del socio, como la de las 430, para que lo confirmes marca a marca.
   - Y: ¿basta «el proveedor del albarán es el socio» para saber que una compra es suya, o hay albaranes de otros proveedores a nombre del socio?
5. **D5 · Nóminas:**
   - ¿Pides a la gestoría el resumen mensual con IRPF y SS del trabajador separados?
   - Faltan agosto y septiembre en Folvy.
6. **D6 · Compras:** hay 1 factura frente a unos 50 albaranes al mes. ¿Empezamos octubre registrando las facturas en Folvy (C01b), o el lado de compras del libro arranca vacío hasta Bancos?
7. **D7 · Bancos por local:** hay 1 cuenta en Folvy y ninguna con local. Añado `location_id` a `treasury_account` y me dices qué cuenta es de qué local.
8. **D8 · Ejercicios:** amplío `fiscal_year.status` con `traido` y creo 2023–2025 vacíos para el C04b, sin traer nada. ¿Correcto?
9. **D9 · Asiento de ventas del día de cedidas:** ¿en el mismo asiento que las propias (una línea a la cuenta de cada socio) o en uno aparte por socio? Propongo el mismo asiento: un día, un local, un canal, un cobro de la plataforma.
10. **D10 · Diez:** una exportación de prueba del libro diario de un mes cerrado, en el formato que saque Diez, para dimensionar el C04b. No se sube al repositorio.

## Respuesta de Julio (06/10/2026)

1. **D1 · Todas las ventas son al 10 %.**
   - La base de cada venta propia es `total / 1,10`, redondeada por ticket. El asiento lo marca «calculado».
   - Donde la línea trae su tipo (Uber), sirve de testigo: si no es 10, el asiento queda en «Duda».
2. **D2 · Pendiente.** Julio pide la explicación de los dos caminos antes de responder.
3. **D3 · El ticket lo expide Folvy.**
   - Hoy Folvy no numera ningún ticket de plataforma: esa pieza es de Facturación (F01, con Verifactu).
   - Mientras tanto, el asiento resumen del día guarda la lista y la huella de los pedidos.
   - El rango «inicial–final» del RIVA 63.4 se rellena cuando F01 numere. Va al PR como pendiente.
4. **D4 · Hoy hay un solo socio activo, el socio 1.** Las marcas cedidas son suyas; el socio 2 es histórico.
5. **D5 · Sí, se pide a la gestoría.**
   - Las nóminas y los contratos los hará el módulo de personal.
   - El asiento de nóminas se queda como entrada que ese módulo rellenará.
6. **D6 · Las compras se registran desde octubre.**
   - Excepción: **las compras al socio 1 van por su resumen mensual**, que hace de factura (la emite una vez al mes).
   - Sus albaranes sirven para contrastar, no se asientan (regla 8).
7. **D7 · Una cuenta de banco por local**, con el número que pone Julio en la pantalla.
8. **D8 · Se crean los ejercicios 2023–2025.**
   - Julio sube lo de Diez en dos tandas: hasta el 30/06/2025, y el resto.
9. **D9 · Las ventas cedidas no se contabilizan día a día.**
   - Se agrupan, y el socio manda una vez al mes el total, que Folvy compara con sus tickets.
   - **No hay línea de cedidas en el asiento de ventas del día.** El asiento de cedidas nace de la liquidación mensual del socio (C03); los tickets de Last son el testigo.
10. **D10 · Diez trabaja por series.** El libro diario solo no basta: hacen falta también los libros de facturas emitidas y recibidas y la tesorería (se ve en la respuesta).

## D2 y D10 · Segunda respuesta de Julio y lo que enseñan las cinco series de Diez (06/10)

**D2 · Decidido: camino B para las marcas cedidas.**
- Las marcas propias las factura Folvy con el NIF de la empresa.
- Las ventas de marcas cedidas son del socio, y su IVA también. La empresa declara solo el IVA de lo suyo.
- **Lo confirma el dato:** cada pedido de Last trae en `raw_tab.bills[]`:
  - la sociedad emisora (`company.name`, la del socio);
  - el número de su factura (`number`);
  - `taxPercentage` (10), `taxableBase` y `tax`.
- Hoy ese número **no se guarda** en `sale`, solo en el bruto. Se guarda en la tarea 2, para casar con el resumen mensual del socio.

**D10 · Las cinco series de Diez, un mes cerrado (junio de 2025).**
- Leídas fuera del repositorio. Aquí van solo formas y recuentos, sin nombres.
- Columnas de la exportación: `Serie.Número · Fecha · Asiento · Doble · Subcuenta · Nombre de la subcuenta · Concepto (documento-tercero) · Debe · Haber`.
- Todos los asientos cuadran al céntimo en las cinco.

| Serie | Asientos (junio) | Forma |
|---|---:|---|
| 1 · Facturas expedidas | 30 | 430 de la plataforma al Debe, 700 + 477 (10 %) al Haber, **una por documento de la plataforma**: Glovo por liquidación (22), Just Eat por documento (6) y Uber **una al mes**. Más una factura mensual al socio: 705 + 477 en tres tipos |
| 2 · Facturas recibidas | 154 | 600/62x al Debe con **una línea de 472 por tipo** (hasta tres, todas en la misma 47200000), 400/410 al Haber; alquiler con 4751 |
| 3 · Tesorería | 88 | **Solo compensaciones**: 410 de la plataforma contra su 430 (84), y 400 del socio contra su 430 (4). **Ni una 572**: el banco no se asienta |
| 4 · General | 1 | Reparto del resultado (129 → 112/120/121) |
| 9 · Automáticos | 2 | Nómina del mes en un asiento (640, 642, 4750 IRPF, 476 SS ×2, 465), y liquidación trimestral del IVA (477 y 472 → 4700) |

**Lo que cambia para el C04 (tarea 2):**
1. **La numeración de Diez va por serie y no sigue el orden de las fechas** (58 de 154 en recibidas). Se numera al grabar.
   - Folvy numera al validar (regla 2).
   - Lo traído conserva serie y número de Diez tal cual (`source_type='migrated'`, `diez_series`, `diez_number`).
2. **Las series de Folvy** se alinean con las de Diez por dentro: 1, 2, 3, 4 y 9. En pantalla siempre la palabra —Ventas · Compras · Banco · General · Nóminas— y el número solo en «Detalle contable» (respuesta 1). Las mismas cinco para una empresa que no venga de Diez. La liquidación del IVA, la regularización y el cierre van a General.
   - Así el C04b mete cada asiento en su serie sin traducir.
3. **Las ventas propias, en Diez, salen del documento de la plataforma** (liquidación o autofactura), no del ticket del día.
   - Con «el ticket lo expide Folvy» (D3), las de Uber y Just Eat pasan a resumen diario.
   - **Glovo, que es comisionista** (C03: `platform_model='comisionista'`), documenta la venta con su propia factura por liquidación. Asentar además el resumen diario la duplicaría.
   - El generador elige por modelo de plataforma: comisionista → venta desde la liquidación; en nombre ajeno → resumen diario de tickets. Es la regla 7, decidida por el modelo y no solo por lo ya asentado.
4. **El IVA soportado en Diez va a una sola 472.** Folvy lleva la 472 por tipo (C00/C02); al traer, se reparte por el tipo de cada línea.
5. **El banco no está en Diez.** La tesorería solo compensa terceros. El asiento de cobro o pago contra 572 nace aquí y se completa en Bancos.
6. **Nómina:** un asiento resumen al mes con el IRPF separado (4750 en Diez, 4751 en el BOE). Es la forma que el módulo de personal rellenará.

## Tercera respuesta de Julio (06/10): las tres plataformas igual, y el corte en el 30/09/2026

**Corrección mía.**
- En el apartado anterior separé Glovo de Uber y Just Eat por ser «comisionista». Era un error de lectura.
- En el C03, `comisionista` significa justo lo contrario de lo que escribí: la plataforma «vende en NOMBRE del restaurante (el contrato de compra es entre el restaurante y el consumidor)» (`20261009T0180_c03_modelo_plataforma.sql:6`, RD 1065/2007 art. 34.3).
- Es el modelo de las tres. En producción solo Glovo lo tiene puesto; Uber y Just Eat están sin decir (`null`). Se ponen igual desde la ficha (C03); no lo toco yo.

**Decidido: las tres plataformas, un mismo tratamiento.**
- La venta es de la empresa al consumidor. La plataforma intermedia y factura su comisión.
- **Ventas:** factura simplificada de Folvy por pedido, con el NIF de la empresa y numeración correlativa.
  - Lo permite RD 1619/2012 art. 4.2.e: restauración hasta 3.000 € IVA incluido.
  - Cada una es su registro de facturación (Verifactu, F01).
  - En el diario: **asiento resumen por día y local** con base y cuota por tipo (todas al 10 %) y el rango de facturas. Base legal: CCom 28.2 y RIVA 63.4, con los dos requisitos que pide: sin identificar al destinatario y dentro del mismo mes.
  - Contrapartida: la 430 de la plataforma por lo que cobra ella.
- **Liquidación de la plataforma:** su factura de comisión (623 + 472 al 21 %) a su 410 y otros cargos; la compensación 410 contra 430; el neto al banco.
  - Es lo que hace Diez en tesorería, pero con el banco.
- **Marcas cedidas:** fuera del diario día a día (camino B, decidido). Entran por la liquidación mensual del socio.

**El corte con Diez, 30/09/2026, es una suposición de trabajo** (corregido el 07/10 con la respuesta 1). No está escrito en el código: es un dato de la empresa (`fiscal_year.imported_until`, `origin`, `origin_program`) que pone `conta_fijar_corte(empresa, hasta, programa)` y que se puede cambiar mientras no haya ningún asiento traído; con el primero, el disparador `fiscal_year_corte_cambiable` lo congela. Probado en staging (run 76, pruebas 4 y 4b).
- **C04b:** se trae **tal como está** todo lo de Diez hasta el 30/09/2026: los ejercicios 2023, 2024 y 2025 cerrados, y 2026 del 01/01 al 30/09. Con sus series, sus números y su 47200000 única. Nada se reinterpreta.
- **Desde el 01/10/2026, Folvy:**
  - ventas por resumen diario de facturas simplificadas;
  - 472 y 477 por tipo;
  - cada liquidación con su comisión y su cobro;
  - banco asentado;
  - local y marca en cada apunte.
- **El primer IVA trimestral enteramente de Folvy es el 4T de 2026.**
- **Consecuencia para el C04:** no hay que reconvertir nada de antes del corte.
  - El ejercicio 2026 tendrá asientos `migrated` hasta el 30/09 y propios desde el 01/10.
  - Los saldos del 30/09 son el punto de partida de los asientos de Folvy, así que no hace falta asiento de apertura a mitad de ejercicio.
  - Se bloquean los meses de enero a septiembre de 2026 como «traídos».
- **Pendiente para F01:** hoy Folvy no numera facturas simplificadas de plataforma. Hasta F01, el resumen del día guarda los pedidos y su huella, y el rango se rellena cuando F01 numere.
  - Desde el 01/10 esto deja abierto el art. 63.4 en la parte de la numeración.
  - **F01 sube de prioridad.** Va al PR.

## Tarea 2 · Lo que dijo Julio al empezarla (07/10): lo que deciden las plataformas

Las plataformas deciden cancelaciones, devoluciones parciales y, en Glovo,
cargos por espera del repartidor. El modelo de la tarea 2 les da sitio
(`source_type` `sales_adjustment` y `channel_settlement`), y los generadores de
la tarea 3 las tratan así. Literal comprobado:

- **Cancelación antes de entregar.** No hay venta. El pedido no entra en el
  resumen del día; si ya había entrado, el asiento del día aún no validado se
  recalcula.
- **Devolución total o parcial después de la venta.** Queda sin efecto la
  operación o cambia el precio después de hecha: **LIVA art. 80.Dos** («la base
  imponible se modificará en la cuantía correspondiente»).
  - **RD 1619/2012 art. 15.2:** es obligatoria la factura rectificativa cuando
    se dan las circunstancias del art. 80. La expide Folvy (F01).
  - En el diario, un asiento `sales_adjustment`: menos venta (708 «Devoluciones
    de ventas», o 700 al Debe) y menos IVA repercutido (477 al Debe, con la
    misma base y tipo y libro de expedidas), contra la 430 de la plataforma.
  - Fecha: la de la liquidación que la comunica.
- **Cargo por espera del repartidor (Glovo) y demás cargos.** Son servicios
  que la plataforma presta a la empresa y factura en su liquidación: gasto
  (623/629) con su IVA soportado al 21 %, a su 410.
  - Al no ser una devolución al cliente, no toca la venta ni el 477.
