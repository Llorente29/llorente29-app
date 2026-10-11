# Compras — Tarea 1: comprobaciones previas

Encargo del 10/10. Rama `conta/compras`. **Estado: tarea 1 hecha. Paro y espero respuesta y maquetas.**

Todo lo de producción se midió **en solo lectura**, en Foodint (cuenta `51ad1792…`) y con `account_id` en cada consulta. Lo del código lleva fichero y línea.

**El repositorio es público.** En este documento los proveedores van con letra y no con su nombre, y no aparece ningún NIF:

| Letra | Qué es |
|---|---|
| A | Pan y bollería congelados |
| B | Distribución de alimentación |
| C | Bebidas |
| D | Carne, una factura al mes por local |
| E | Distribución, 5 de 5 papeles son albarán |
| F | Gourmet, 4 de 4 papeles son albarán |
| G | Mayorista de cash & carry |
| S | El socio de marca que liquida cada mes |

Los cinco PDF de la liquidación de septiembre de S están fuera del repositorio, y no ha ido ninguno a él.

---

## La conclusión, en cinco líneas

1. **Las facturas viven en Almacén (`/supply/facturas`), no en Contabilidad.** En toda la base hay **una**. Nunca se ha enlazado una factura con una recepción. No hay reglas de aprobación, y la que hubiera solo se mira en el navegador. El asiento de pago no lo propone nadie.
2. **El papel de la recepción ya trae lo necesario para la factura.**
   - Las líneas llevan su tipo de IVA y su importe.
   - En octubre, la base y la cuota por tipo, sacadas de las líneas, cuadran con la cabecera en 17 de 18 recepciones. La que no es un albarán sin importes.
   - Lo que falta en el papel es **el NIF del destinatario**: el lector solo guarda su nombre.
3. **La forma de facturar no existe.** `supplier.invoicing_frequency` dice cada cuánto, no cómo. Solo la lee la ficha y no la usa ninguna lógica. Hace falta un campo nuevo.
4. **La liquidación del socio de hoy tiene que rehacerse entera.** Su cálculo sale de los albaranes. La pantalla de terceros, el asiento y el panel de cedidas leen de ella.
5. **S no son dos fichas: son cinco proveedores y cinco terceros.** La fusión de terceros que existe no mueve nada de lo que cuelga del proveedor: recepciones, pedidos, artículos, avisos.

---

## 1. Cómo entra hoy una factura de proveedor

**Dónde vive.** Todo está en el módulo de Almacén:
- la página es `/supply/facturas` (`src/modules/supply/module.tsx:52`, permiso `show_facturas`);
- el servicio es `supply/services/supplierInvoiceService.ts`;
- el escaneo es `InvoiceScanPanel.tsx`.

**Desde Contabilidad se llega, pero de lado:**
- la ficha del proveedor tiene una pestaña «Facturas» (`conta/proveedor/Facturas.tsx`) que lista, marca pagadas, cambia el vencimiento y resuelve el IBAN o la repetida;
- «Subir factura» lleva a `/supply/facturas?escanear=…`;
- no hay una entrada «Compras» en Contabilidad;
- «Facturas que emites» está en el menú con `ruta: null` (`config/navegacion.ts:207`).

**Las tablas** (`20260604T2600_supply_c31_supplier_invoice.sql`):

| Tabla | Qué tiene |
|---|---|
| `supplier_invoice` | `status`: borrador, en_revision, aprobada, con_discrepancias, pagada, anulada. `match_status`: sin_match, ok, con_diferencias. `doc_kind`: invoice, credit_note |
| `supplier_invoice_line` | con `vat_pct` y `goods_receipt_line_id` |
| `supplier_invoice_receipt` | la relación N:M con las recepciones |

Después se le añadieron vencimiento y pago (C01), repetida e IBAN (C01b) y el enlace con el asiento y la retención (C04).

**Qué funciona y qué no se ha usado nunca:**

| Pieza | En la base | En el código |
|---|---|---|
| Facturas | **1 en toda la base** (Foodint, 06/08, «aprobada», «con_diferencias») | Alta a mano o con el lector, que solo prerrellena |
| Enlace factura ↔ recepción | **0** | `createSupplierInvoice` lo escribe si se eligen albaranes |
| Reglas de aprobación | **0** | `invoice_required_role` existe, pero lo aplica el **cliente** (`canApproveInvoice`): la base no impide aprobar |
| `en_revision` | — | **No lo escribe nadie**; solo tiene etiqueta |
| Abonos | — | El lector siempre dice «invoice» |
| Asiento de la factura | — | `facturaProveedor` lo propone desde `proponerPendientes` para las «aprobada» sin asiento (`propuestasLibroService.ts:251-270`). Nunca se ha ejercido con datos reales |
| Asiento del pago | — | `pagoFactura` **no lo llama ningún código**, solo una prueba. `payment_entry_id` no lo escribe nadie |
| Crear la factura desde la recepción | — | **No existe.** `confirm_goods_receipt` no crea factura |

## 2. Qué se saca del papel de la recepción

`goods_receipt_ai_session.parsed_result` = `{document, lines, confidence}` (`ocr-albaran/index.ts:44-81`).

- **`document` (cabecera):**
  - `doc_type`: albaran, factura o albaran_factura. **Ningún código lo usa hoy.**
  - `doc_number` y `doc_date`.
  - `supplier_name` y `supplier_tax_id`, que son los del **emisor**.
  - `bill_to_name`: solo el **nombre** del destinatario. **No hay NIF del destinatario.**
  - `tax_base_total`, `tax_total` y `grand_total`: **solo totales, sin desglose por tipo**.
- **`lines`:** cada una con `vat_pct`, `line_amount`, `unit_price_net`, cantidad, formato, lote y caducidad.

**Medido en las 18 recepciones de octubre**, sacando la base y la cuota por tipo de las líneas:

| Proveedor | Recepciones | Papel | Tipos de IVA | Bases y cuota de las líneas = cabecera |
|---|---:|---|---|---|
| S | 14 | albarán | 4, 10 y 21 | 14 de 14 |
| A | 2 | albarán-factura | 10 | 2 de 2 |
| B | 1 | factura | 4 y 10 | 1 de 1 |
| E | 1 | albarán | — | 0 de 1: el albarán no trae importes por línea |

**Se puede crear la factura sin volver a leer el papel**, con sus bases por tipo, en todas las que traen importes.

**Dos cosas a tener en cuenta:**
- **El NIF leído no es de fiar para aplicarlo solo.** En dos recepciones de A el lector leyó dos NIF distintos, que se diferencian en un dígito. En las de S leyó una variante del NIF del socio con un dígito cambiado.
  - Se puede **ofrecer** en la ficha, nunca escribir sin que alguien lo confirme.
  - B no trae NIF en el papel y no lo tiene en la ficha.
- **«A nombre de la empresa» hoy solo se puede decidir por el nombre.**
  - Los papeles dicen la razón social con variantes («… S.L.», «…, SOCIEDAD LIMITADA», «… food SL»).
  - Algunos llevan el **nombre de un local** en vez del de la empresa: D factura a nombre del local de Camichi.
  - Para decidirlo con seguridad, el lector tendría que leer también el NIF del destinatario. Es un cambio en la función `ocr-albaran` (pregunta 4).

## 3. Dónde se guarda la forma de facturar

`supplier.invoicing_frequency` (`20261006T0100_c01b_estructura.sql:24-25`):
- **Valores admitidos:** per_delivery, weekly, fortnightly, monthly, other o vacío.
- **Quién la lee:** solo la ficha («Cada cuánto te factura», `conta/proveedor/Pago.tsx:128-131`) y su servicio. **Ninguna función ni regla la usa.**

En Foodint:

| Valor | Proveedores | Con recepciones |
|---|---:|---:|
| vacío | 57 | 8 |
| per_delivery | 2 | 2 (E y G) |
| monthly | 1 | 0 (la ficha de S con NIF) |

**Cada cuánto no es cómo factura.** «Mensual» vale lo mismo para D, que agrupa albaranes, que para S, que liquida. Propongo:
- un campo nuevo `supplier.invoicing_mode`, con tres valores: con cada entrega, agrupa albaranes, liquidación mensual;
- conservar `invoicing_frequency` para la segunda forma, más un «por local» (sí/no);
- los tres valores de hoy se pasan así: per_delivery → con cada entrega; monthly de S → liquidación mensual.

El encargo ya avisa del caso de E: su ficha dice «con cada entrega» y sus 5 papeles son albaranes. Es justo la pregunta que tiene que hacer Folvy.

## 4. Los asientos que hacen falta y no existen

`journal_entry.source_type` (`20261010T0100_c04_libro.sql:75-78`) admite: sales_day, sales_adjustment, supplier_invoice, supplier_payment, channel_settlement, licensed_settlement, payroll, bank, vat_settlement, manual, template, reversal, opening, closing y migrated. Además hay un único asiento vivo por origen (`company_id, source_type, source_id`).

| Asiento | Hoy | Qué haría falta |
|---|---|---|
| Fin de mes por lo recibido y no facturado (por proveedor y local) | No hay origen. `reversal` es otra cosa (el contraasiento de uno anulado) | Ampliar el CHECK con dos orígenes, uno para el asiento y otro para su contrario del día 1, y una tabla que diga de qué recepciones sale. Ampliar un CHECK es «cambiar en caliente» |
| La factura que la empresa emite y extiende el socio (AF-02927) | `licensed_settlement` existe. El libro de IVA ya toma `settlement_ref` como número de la emitida (`20261014T0100_c05_libros.sql:343-345`). `vat_book_entry.number` es texto libre y admite «AF-02927» | Generador nuevo: ingreso con su IVA a la 430 del socio, con `vat_book='issued'` |
| La factura del socio (FV-02927) | Como cualquier `supplier_invoice` | Que entre como factura de proveedor, con sus tres tipos de IVA, a su 400 |
| La compensación y el saldo | `liquidacionSocio` compensa contra la «liquidación pendiente» (410) | Un asiento que cruce la 430 y la 400 del socio y deje el saldo (5.545,84 € a favor) para el banco |

El libro de facturas expedidas se rellena solo al validar un asiento (`trg_journal_entry_libro_registro`), a partir de las líneas con `vat_book`. No hace falta tocarlo.

## 5. Quién lee la liquidación del socio de hoy

| Pieza | Qué hace |
|---|---|
| `brand_partner_settlement_compute / _prepare / _confirm` (`20261009T0140_c03_funciones.sql:216-352`) | Calcula compras = **albaranes** confirmados del local − aportaciones + comisión sobre `sale.taxable_base` de sus marcas |
| `licensed_settlement` | **3 filas** (junio, fórmula anterior, sin asiento). Ninguna de la fórmula C03 |
| `liquidacionSocio()` (`conta/lib/asientosPropuestos.ts:455-535`) | Asiento: 600/472 a su 400, comisión 430/705/477 al 21 % y compensación con la 410 |
| `propuestasLibroService.ts:293-388` | Propone ese asiento. Nadie escribe `licensed_settlement.journal_entry_id` |
| Ficha del tercero (C03) | `useFichaTercero`, `FichaTerceroPage` (cifras del mes, «Preparar liquidación»), `piezasTercero` (historial), `ApartadosTercero` (aportaciones), `TercerosPage` (acuerdos sin socio) |
| `conta/lib/liquidacionSocio.ts` | Cuenta pura (`liquidarLocal`, `liquidarMes`) |
| `licensed_economics_dashboard` → `CedidasPage` | Lee las **columnas antiguas** de `licensed_settlement`. Es el panel de cedidas, fuera de Contabilidad |
| `menu_item_economics` | Lee `brand_licensing_agreement.revenue_share_pct`. Este no se toca |
| Pruebas | `c03.test.ts`, `libroC04.test.ts`, e2e `c03/terceros.spec.ts` y las pruebas de staging del C03 y del C04 |

**Para rehacerlo sin dejar nada colgando:**
- las tres funciones, `liquidacionSocio()`, la ficha del tercero y sus pruebas se sustituyen por la liquidación desde sus documentos;
- `licensed_settlement` se puede conservar como cabecera, con una fórmula nueva («documentos»), para no romper `CedidasPage` ni las 3 filas de junio;
- `brand_licensing_agreement` se queda como está.

## 6. Unir las fichas del socio

**No son dos, son cinco** (todas de Foodint):

| Proveedor | NIF en ficha | Recepciones | Pedidos | Artículos | Avisos (cola) | Enlaces de cuenta | Su tercero |
|---|---|---:|---:|---:|---:|---:|---|
| S «, S.L.» (`92047dae…`) | no | **122** | **46** | **121** | **119** | 0 | `bdc25458…`, solo proveedor |
| S «BRANDS, S.L.» (`8d53a379…`) | sí | 0 | 0 | 0 | 0 | 3 | `915b4784…`, proveedor + socio + cliente |
| S «– sub-marca» (`0848e744…`) | no | 0 | 0 | 10 | 0 | 0 | su tercero, solo proveedor |
| S «-distribuidor» (`e880787a…`) | no | 0 | 0 | 13 | 0 | 0 | su tercero, solo proveedor |
| S «– envases» (`a12b3e74…`) | no | 0 | 0 | 0 | 0 | 0 | su tercero, solo proveedor |

Además, de `92047dae…` cuelgan 4 alias de emisor y 4 documentos de cumplimiento.

**Lo que existe para fusionar** (`20261012T0120_c04r_fusionar_terceros.sql`, `party_merge_do`):
- mueve papeles, enlaces de cliente, liquidaciones y asientos propuestos **del tercero**, archiva el que se va **y también su ficha de proveedor**;
- **no** mueve nada que cuelgue del proveedor: recepciones, pedidos, compras, facturas, `article_supplier`, alias, contactos, aprendizaje, documentos, la cola de avisos ni los enlaces 400/410;
- usarla tal cual con S dejaría las 122 recepciones colgando de un proveedor archivado.

**El plan.** Queda el tercero con NIF (`915b4784…`) con su proveedor `8d53a379…`. De `92047dae…` a `8d53a379…`, en una migración con copia y vuelta atrás:
1. Mover `supplier_id` en `goods_receipt`, `purchase_order`, `purchase`, `supplier_invoice`, `supplier_alias`, `supplier_contact`, `supplier_proposal`, `supplier_learning*`, `compliance_document`, `ctb_notification_queue` e `invoice_approval_rule`.
2. `article_supplier`: mover lo que no choque con las claves únicas (`supplier_id, supplier_code, recipe_item_id`; `recipe_item_id, supplier_id`). Lo que choque se resuelve fila a fila y se dice.
3. `company_account_link` con `entity='supplier'`: mover lo que no choque.
4. Fusionar los terceros con `party_merge_do`, que archiva el que sobra, y archivar el proveedor vacío.
5. Contar antes y después, con la misma consulta: recepciones, pedidos, avisos, artículos y enlaces.

Esto lo hace una función nueva, `supplier_merge_do / _undo`, con su rastro, porque sirve para cualquier proveedor repetido, no solo para S. Las otras tres fichas, la duda es la pregunta 1.

## 7. El contraste

**Compras, septiembre, local de Florencio Llorente (Alcalá):**
- Folvy: 26 albaranes de S, con **11.394,56 €** de base según los documentos.
- La liquidación dice **11.393,44 €**.
- Diferencia: **1,12 €**. Coincide con lo que mide el encargo.

**Comprobaciones sobre el inventario de la liquidación** («Relación Compras y Ventas»):
- **El PDF repite la última fila de cada página al empezar la siguiente.** Leído en bruto salen 124 filas. Quitando las dos repetidas quedan **122 productos** y las cifras salen exactas:
  - positivos **3.587,15 €**, la base de la factura FV;
  - negativos **−1.738,68 €**, frente a las mercaderías aportadas de 1.738,74 €;
  - compras valoradas **11.393,44 €**.
- El lector de la tarea 5 tiene que saber lo de la fila repetida.
- El total que imprime el documento (1.848,41 €) difiere en 0,06 € de la suma de sus filas (1.848,47 €): el documento redondea por fila.

**Casar por producto:**

| Contra qué | Casan |
|---|---:|
| Nombre de un artículo de Folvy, o sus nombres alternativos | 27 de 122 |
| Nombre del proveedor en `article_supplier` (93 artículos de S lo tienen) | 0 |
| Nombre del artículo de los artículos de S | 21 |
| Productos con compras en el mes que casan con algo | 19 de 70 |

**Por nombre no basta.** El casado se hace una vez, a mano, y se recuerda. El sitio natural es `article_supplier`, que es por proveedor. Mientras tanto, el contraste por totales funciona desde el primer día.

**Ventas de las marcas del socio, septiembre, mismo local.** Folvy sí las tiene: entraron por Last, 1.441 pedidos cerrados. **El detalle del socio va sin IVA**, así que se compara con la base de Folvy (`taxable_base`):

| Plataforma | Folvy, base | Socio, «Ventas» | Diferencia | Socio, «Total» (tras dev./cancel.) |
|---|---:|---:|---:|---:|
| Glovo | 19.281,93 € | 19.497,01 € | −215,08 € | 18.694,62 € |
| Uber | 8.274,37 € | 8.282,10 € | −7,73 € | 8.052,50 € |
| Just Eat | 679,54 € | 679,54 € | 0,00 € | 679,54 € |
| **Total** | **28.235,84 €** | **28.458,65 €** | **−222,81 €** | **27.426,66 €** |

- Just Eat cuadra al céntimo y Uber por 7,73 €.
- **Lo que hay que comparar es «Ventas»**, porque Folvy no sabe de devoluciones ni cancelaciones de la plataforma. El servicio del 25 % y del 35 % se calcula sobre el «Total».
- Los 215,08 € de Glovo, pedido a pedido, solo se explican con el detalle de la plataforma.

**Qué pedidos entran: los cerrados.** Julio midió el total entre 1,10 de **todos** los pedidos de Last: Glovo 19.402,62 €, Uber 8.462,48 € y Just Eat 725,82 €. Esa medida incluye 120,93 €, 188,14 € y 46,27 € de pedidos cancelados o abiertos. Just Eat decide cuál vale: el socio no tiene devoluciones ahí, y su cifra (679,54 €) es la de los **cerrados** de Folvy (679,55 € entre 1,10). Los cancelados no están en su cuenta. El contraste se hace con los pedidos cerrados.

*Corregido el 10/10.* En la primera versión comparé los totales de Folvy, con IVA, con las cifras del socio, que van sin IVA, y concluí que Folvy daba entre un 9 y un 10 % más. Era al revés: las dos fuentes casi cuadran. Las cifras de ejemplo de la maqueta de la liquidación (19.402,62 €, +132,27 €) no salen de los datos y se sustituyen por estas.

## 8. Octubre, recepción a recepción

Las 18 recepciones activas desde el 01/10, todas confirmadas:

| Recepción | Día | Local | Proveedor | Papel | A nombre de | Camino | Le falta a la ficha |
|---|---|---|---|---|---|---|---|
| ALB-00185, 186, 190, 191, 192, 193, 196, 197, 201, 202 | 01–09/10 | Alcalá | S | albarán | el socio (o un distribuidor que le sirve a él) | liquidación mensual: no se asientan una a una | unir fichas; marcar «liquidación mensual» |
| ALB-00188, 189, 199, 200 | 01–07/10 | Carabanchel | S | albarán | el socio | liquidación mensual de Carabanchel (pregunta 2) | ídem |
| ALB-00195, 00203 | 06 y 09/10 | Alcalá | A | albarán-factura | la empresa | **factura con cada entrega** | tipo de gasto |
| ALB-00198 | 07/10 | Alcalá | B | factura | la empresa | **factura con cada entrega** | NIF (el papel tampoco lo trae) y tipo de gasto |
| ALB-00194 | 05/10 | Alcalá | E | albarán | la empresa | **pendiente de factura**. La ficha dice «con cada entrega»: se pregunta | nada |

ALB-00190 la emite un distribuidor distinto (NIF propio) a nombre del socio: es la «mercadería aportada» de §2.5 y entra en su liquidación.

**Septiembre y octubre juntos** (67 recepciones confirmadas, como mide el encargo), por proveedor:

| Proveedor | Confirmadas sep–oct | Papel desde agosto | Le falta |
|---|---:|---|---|
| S | 45 | albarán en 74 de 79 | NIF en la ficha con recepciones (se arregla al unir) |
| A | 5 | albarán-factura 9 de 9 | tipo de gasto |
| D | 4 | albarán 7 de 8 | NIF y tipo de gasto |
| B | 4 | factura 3, albarán-factura 1 | NIF y tipo de gasto |
| C | 3 | factura 2, sin leer 3. Una va a nombre de otra empresa | tipo de gasto |
| E | 3 | albarán 5 de 5 | nada |
| F | 2 | albarán 4 de 4 | NIF y tipo de gasto |
| G | 1 | sin leer | tipo de gasto |

---

## Lo que ya contestan las maquetas (10/10)

Las maquetas están en `docs/conta/maquetas/compras/`: `Main`, `FichaProveedor`, `Recepcion` y `Liquidacion`. Contestan tres de las cinco preguntas:

- **Carabanchel (pregunta 2):** la liquidación es **por proveedor y local**. La maqueta enseña la de «Local Sur · septiembre» como «todavía no ha llegado», con sus 5 albaranes por 2.977,74 €.
- **El contraste de ventas (pregunta 3):** **entra en este encargo**, con su veredicto «se parecen, pero no son iguales» y la tabla por plataforma. La tabla va con las cifras medidas en §7, no con las de ejemplo.
- **La forma de facturar (pregunta 5):** tres opciones. En la segunda, «una vez al mes» y «una por cada local». Va en un campo nuevo, como proponía.

También lo confirman: el NIF leído se **ofrece**, nunca se aplica solo («Compruébalo antes de aceptarlo»), y la pregunta de §2.2 va a «Qué tienes que mirar», no al local.

## Lo que sigue abierto

1. **Las otras tres fichas del socio** (sub-marca, distribuidor y envases): no tienen recepciones, pero sí 10 y 13 artículos. ¿Se unen las cinco en una, o solo las dos del encargo?
2. **El NIF del destinatario.** ¿Hago que el lector de recepciones lo lea? Es un cambio en la función `ocr-albaran`, que se despliega y se commitea a la vez (regla 1). Si no, Folvy decide «a nombre de la empresa» por el nombre y por el de sus locales, y pregunta cuando dude.
