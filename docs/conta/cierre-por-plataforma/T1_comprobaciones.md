# Cierre diario por plataforma y local — Tarea 1: comprobaciones previas

Encargo del 10/10. Rama `conta/cierre-por-plataforma`. **Estado: tarea 1 hecha. Paro y espero respuesta.**

Todo lo de producción se midió en **solo lectura**, en Foodint (cuenta `51ad1792…`, empresa `658728c0…`) y con `account_id` en cada consulta. Lo del código está en el repositorio, con fichero y línea.

**Antes de empezar.** Las dos referencias que pide leer el encargo (`claude/folvy_regla_cierre_diario_por_plataforma_y_local_20261009.md` y `claude/referencia_cierre_diario_diez_UBR-FLO-20260831.md`) **no están ni en el repositorio ni en Drive**. Viven en el proyecto de Claude.ai, y desde aquí no lo veo. Para esta tarea basta con lo que trae el encargo. Para la prueba «contra el de referencia» (§8) hace falta el cierre `UBR-FLO-20260831` íntegro: los 14 pedidos con su marca, su importe y su estado. Ver la pregunta 5.

---

## La conclusión, en cuatro líneas

1. **El detalle de la plataforma no se carga: se cargó una vez, a mano, el 12/07, y acaba el 30/06.** No hay ningún lector en Folvy que lo traiga, ni ninguna rutina que lo traiga solo. Además, lo cargado no tiene lo que pide la regla: por pedido no hay «cobrado sí/no», ni hora de entrega, ni quién paga la promoción. Uber no trae ni el importe de venta.
2. **Sin ese detalle, ningún cierre se puede confirmar** (§5 del encargo). Octubre se quedaría entero en «provisional» y no se podría validar. **Recomiendo que el detalle de la plataforma sea un encargo propio, antes de este.**
3. **Lo que Folvy sabe el mismo día (HubRise) no dice quién paga la promoción** y mete el envío dentro del total. La propuesta de hoy cuenta como venta 653,20 € de cargos de envío y de pedido pequeño del 01/10 al 08/10.
4. **No hay dónde guardar** el código del local, el de la plataforma, el número de la marca ni sus cuentas 700 y 708. Hay que crearlo. Sí se resuelve ya la 430 de cada plataforma.

---

## 1. El detalle de la plataforma

### Cómo se cargó lo que hay

En la base hay dos capas, y ninguna se carga sola.

**Capa por liquidación (`channel_settlement`).** Una fila por liquidación: quincena en Glovo y Just Eat, mes en Uber.
- Se carga con un CSV, de dos maneras:
  - el botón **«Subir liquidación»** de la ficha del tercero (`dialogosTercero.tsx:23-77` → `tercerosService.ts:385-404`, lector `lib/lectorLiquidaciones.ts`);
  - el script a mano `scripts/import-channel-settlements.mjs`.
- Lo que hay, todo cargado el 12/07:

| Plataforma | Fuente | Filas | Periodo |
|---|---|---:|---|
| Glovo | `import_csv_glovo` | 96 | quincenas, liquidadas del 15/04 al 30/06 |
| Just Eat | `import_csv_je` | 53 | quincenas, liquidadas del 15/04 al 30/06, **sin periodo** |
| Uber | `import_csv_uber` | 50 | meses de abril a junio, **sin número de liquidación** |

- De Uber y Just Eat el lector solo lee la venta, la base y el IVA. Comisión, neto e incidencias se quedan en el fichero (`import-channel-settlements.mjs:79-125`).

**Capa por pedido (`channel_settlement_order`).** Una fila por pedido. **No hay lector en la app**: son cargas sueltas.

| Plataforma | Cómo se cargó | Pedidos | Fechas | Qué trae por pedido |
|---|---|---:|---|---|
| Glovo | `cargar_glovo_orders.py` (en la raíz del repo, con la cuenta escrita dentro) desde un export XLSX | 3.063 | 01/03 – 30/06 | código, día de entrega (sin hora), marca, `products`, comisión, `promo_product`, `promo_flash` (suma de tres columnas), incidencias, neto |
| Uber | un `INSERT` literal (`supabase/migrations/uber_carga_completa.sql`) para enero; **no está en el repo** cómo se cargó de febrero a junio | 3.575 | 01/01 – 30/06 | código, día, marca, comisión, `promo_product`, neto. **Sin importe de venta** (`products` vacío en las 3.575) |
| Just Eat | **nada** | 0 | — | — |

Todo se cargó el 12/07.

**Por qué se paró.** No hay nada que lo pare: nunca hubo carga periódica. Fue una carga única para montar el conciliador (C1). Según `docs/claude_folvy_frentes.md:29`, lo siguiente era «C2: cargar julio y agosto» y una ingesta `settlement-extract`. Ninguna de las dos se hizo, y la ingesta no existe en el repo. El único cron (`channel-settlement-match-daily`, 06:30) solo vuelve a casar lo que ya hay.

### Lo que la regla necesita y lo que hay, por pedido

| La regla pide | Glovo (lo cargado) | Uber (lo cargado) | Just Eat |
|---|---|---|---|
| Cobrado o no | no (solo forma de pago) | no | — |
| Venta (lo que paga el cliente por la comida) | `products`, antes de promoción | **no** | — |
| Promoción a cargo del restaurante / de la plataforma | dos columnas (`promo_product`, `promo_flash`) pero **no dice quién la paga**, y `promo_flash` ya mezcla tres columnas del export | una (`promo_product`) | — |
| Contracargo / incidencia | `incidents_cost`, `incidents_refund` | no | — |
| Fecha de entrega | el día, **sin hora** | el día, sin hora | — |
| Estado («Entrega fallida (cobrado)») | no | no | — |

**Para tenerlo al día hace falta:**
1. Un lector por plataforma del export de pedidos de su portal. El cierre de referencia dice «Fuente: Uber Eats Manager», o sea que Julio ya lo descarga. Glovo, del Partner Portal. Just Eat, del suyo.
2. Que el lector guarde lo que hoy se tira: el estado, si se cobra, la hora, la promoción partida por quién la paga y los contracargos. Hay que ampliar `channel_settlement_order` o, mejor, crear una tabla nueva para el detalle diario. Hoy esa tabla mezcla pedidos y ajustes: las líneas `add-…` de Glovo son ajustes.
3. Saber **cada cuánto se puede descargar**. Eso decide cuánto tiempo pasa un cierre en «provisional». Desde aquí no lo puedo medir: es la pregunta 1.

## 2. Lo que Folvy sabe el mismo día

### HubRise, en octubre (01/10–09/10, 343 pedidos de HubRise, de todas las marcas)

- Todos traen `discounts[]` y `charges[]`.
- **Descuentos.** Un único «Discount», con `price_off` y **nada que diga quién lo paga**. No hay `funded_by`, ni `sponsor`, ni nada parecido. Glovo: 135 pedidos y 1.738,77 €. Uber: 149 y 2.590,97 €. Just Eat: 2 y 11,28 €.
- **Cargos.**

  | Plataforma | Cargo | Pedidos | Importe |
  |---|---|---:|---:|
  | Glovo | «Delivery charge» | 116 | 522,00 € |
  | Glovo | «Small order fee» | 116 | 36,00 € |
  | Uber | «Delivery charge» | 62 | 257,15 € |
  | Just Eat | «Delivery charge» | 4 | 11,96 € |

- **`sale.total` = artículos − descuentos + cargos**, en 278 de 278 pedidos cerrados del 01/10 al 08/10.
  - Por eso el asiento que se propone hoy, que usa `sale.total`, **cuenta el envío como venta**: 465,00 € de Glovo, 176,24 € de Uber y 11,96 € de Just Eat, 653,20 € en ocho días.
  - Con la regla de §2 («lo que paga el cliente por la comida») el envío no es venta.
- **El estado.** `raw_tab` guarda el pedido tal como entró (`status: new`). El estado final está en `sale.order_status` / `delivery_state`.

### Junio, para comparar las dos fuentes: no sirve para HubRise

**En junio no había HubRise.** Los 297 pedidos propios de junio entraron por Last (`source = lastapp`). HubRise empieza en agosto. Así que con junio no se puede medir cuánto se parece HubRise a lo que cobra la plataforma. Lo que sí se puede medir es Last contra la plataforma:

**Glovo, junio** (502 pedidos en la plataforma: 304 casados con Folvy, 20 sin casar, 178 de antes de que Folvy empezara el 12/06):
- En **291 de 304** (96 %) se cumple: total de Folvy − envío + descuento = `products` de Glovo. Es decir, Folvy y Glovo coinciden en la venta antes de promoción.
- Después de la promoción ya no. Folvy sin envío da 6.136,50 €; Glovo, `products − promo_flash`, da 6.059,89 €. **Hay 76,61 € de diferencia en 304 pedidos**, y no se puede repartir porque ninguna de las dos fuentes dice quién paga cada promoción.
- 30 pedidos tienen incidencia (633,75 €). Folvy no sabía de ninguna.

**Uber, junio** (343 pedidos: 233 casados, 1 sin casar, 109 de antes de Folvy): **no se puede comparar**. El detalle cargado no trae importe de venta.

**Just Eat**: no hay detalle.

**Lo que hace falta para medirlo de verdad con HubRise** es el detalle de la plataforma de cualquier mes desde septiembre, que tiene HubRise entero. Con el export de Uber Manager de septiembre lo mido en una tarde.

## 3. Contracargos e incidencias

- **Folvy solo los sabe por la liquidación.** HubRise no los trae. `sale.refund_amount` está declarada columna muerta (`20260904113200_b59_refund_amount_columna_muerta.sql`) y no tiene ni un valor desde junio.
- `conta_devoluciones_del_dia(company, local, día)` (`20261010T0120_c04_funciones.sql:460-474`):
  - lee `channel_settlement_order.incidents_refund`, que en la práctica solo existe para Glovo;
  - las fecha por `coalesce(settlement_date, order_date)`, es decir, **por el día de la liquidación, no por el del pedido**. En un cierre por día y plataforma, un contracargo saldría en el cierre del día en que se liquidó, no en el del pedido. Hay que decidir cuál vale (pregunta 4);
  - ignora `incidents_cost`;
  - para octubre devuelve 0, porque no hay detalle.
- **Cuándo los sabe:** cuando alguien carga el detalle. Hoy, nunca.

## 4. El control mensual

- El resumen de pagos que tiene Folvy es la capa por liquidación (`channel_settlement`), **hasta el 30/06**.
  - En Glovo y Just Eat es por quincena. Uber, por mes.
  - Trae venta, base e IVA. En Glovo, también comisión, promociones, incidencias y neto.
  - El botón «Subir liquidación» ya existe y funciona. Basta con que alguien suba los CSV de julio en adelante.
- **Problemas para usarlo de control:**
  - 149 de las de Glovo y Just Eat no tienen periodo;
  - 92 no tienen local;
  - las de Uber son de mes entero, sin número.
- **Con qué se compara.** La suma de los cierres de una plataforma en el periodo de la liquidación contra su `gross_sales`, `base_amount` y `vat_amount`. Si la liquidación no dice el local, se compara la suma de los locales. El agente puede hacerlo en cuanto haya liquidaciones de octubre.

## 5. Dónde se guarda cada dato

| Dato | Hoy | Qué haría falta |
|---|---|---|
| 430 de la plataforma | **Existe.** `sales_channel` → `party_role` (platform) → `party` → `company_account_link (customer, principal)`. Glovo 43000001, Uber 43000002, Just Eat 43000003, igual que la tabla de Julio | nada |
| 410 / 623 de la plataforma | Existen en el plan y la 410 está enlazada al tercero | nada para el cierre (van con la factura) |
| Cuenta de ventas y de devoluciones de la marca | **No existe.** La 700 sale de la hoja del plan para todas las marcas (`propuestasLibroService.ts:171`). `company_account_link.entity` solo admite `supplier, customer, bank_account, expense_category, tax_rate, withholding_rate` (`20261007T0120_c02_plan_empresa.sql:80-95`) | ampliar `entity` con `brand` y roles `venta` / `devolucion`. Es un CHECK que solo amplía |
| Número de analítica de la marca | **No existe** | lo da su subcuenta (`700000NN` → NN). Si se quiere guardar aparte, va en la misma tabla de códigos de abajo |
| Código del local (`FLO`) y de la plataforma (`UBR`) | **No existe.** `locations`, `brand` y `sales_channel` no tienen código. La tabla `cost_center` tiene `code` y «1 por local», pero no la usa nadie y es por cuenta, no por empresa | una tabla nueva por empresa: `company_code (company_id, entity, entity_id, code)`, única por empresa, entidad y código |
| Plataforma en la línea del asiento | **No existe.** `journal_line` tiene `location_id` y `brand_id`, no canal (`20261010T0100_c04_libro.sql:142-180`) | columna `channel_id` en `journal_line`, que admite nulos |
| Número del cierre (`UBR-FLO-20261001`) | `journal_entry.document_ref` existe y ya se escribe | va ahí. El número legal (serie y número) sigue poniéndose al validar |
| PDF adjunto | `journal_entry.document_url` existe y **nadie lo escribe**. No hay bucket de contabilidad | bucket privado nuevo, con RLS por cuenta. El PDF, con jsPDF, como `supply/services/purchaseOrderPdf.ts` |
| Fichas | En contabilidad no hay ficha de marca, local ni canal. Las marcas y los locales están en `/configuracion/marcas` y `/configuracion/locales`. La plataforma está en la ficha del tercero (`ApartadosTercero.tsx:180`) | §7.5 del encargo: la cuenta en la ficha de la marca, el código en la del local y el de la plataforma en la del tercero |

**Marcas de octubre.** Las nueve con venta propia del 01/10 al 09/10 están en la tabla de Julio: Milanesa House, Meraki Pita, Scandal Burgers, Smash Brothers Burgers, Mila's Sandwiches, Bendito Burrito, The Urban Kebab, Dirty Burger y Lovers Burgers. Se casan por la marca de Folvy, no por el texto.

**Locales de octubre.** Venden Alcalá (`FLO`) y Carabanchel (`CAM`). Plaza Castilla no tiene venta propia cerrada en octubre.

**Cierres al día.** Del 01/10 al 08/10 salen 3, 4 o 5 por día, no 6:

| Día | Cierres | Pedidos | Importe |
|---|---:|---:|---:|
| 01/10 | 4 | 21 | 401,40 € |
| 02/10 | 4 | 37 | 864,87 € |
| 03/10 | 5 | 48 | 1.210,29 € |
| 04/10 | 4 | 55 | 1.427,07 € |
| 05/10 | 5 | 26 | 653,13 € |
| 06/10 | 4 | 31 | 691,20 € |
| 07/10 | 5 | 40 | 849,95 € |
| 08/10 | 3 | 20 | 485,06 € |

**Los 11 asientos de octubre ya propuestos.** Todos `propuesto`, sin número, del 01/10 al 08/10, por **4.908,13 €** de los 6.582,97 € cerrados en esos días. Los días que faltan no se propusieron por los motivos que ya da la pantalla. Se retiran en la tarea 3.

## 6. El cierre de las 6:00 y los no confirmados

Lo que cerró el cron, en octubre (01/10–08/10):

| Plataforma | Cerrados como no confirmados | Importe | Cómo acabaron |
|---|---:|---:|---|
| Glovo | 8 | 161,43 € | 5 esperando recogida, 2 entrega fallida, 1 cancelado |
| Uber | 1 | 27,40 € | entrega fallida |

Con la regla de §2, parte de estos **son venta si la plataforma los cobra**. Las «entregas fallidas» son las candidatas claras.

**¿Basta con que la confirmación los recupere?** Casi, con tres cosas más:

1. **La recuperación de la T4 del PR #171 no funciona para Uber.**
   - `conta_no_confirmados_pagados` busca el pedido casado con `products > 0` (`20261016T0150_cierre_del_dia_liquidacion.sql:44`).
   - El detalle de Uber no trae `products`, así que un no confirmado de Uber nunca saldría como pagado.
   - Con el detalle nuevo (§1) se cambia esa condición por «la plataforma lo cobra».
2. **Hay pedidos que no son «no confirmados» y también pueden ser venta.**
   - En Uber hay **13 pedidos que la propia plataforma marcó como cancelados** (`order_status = cancelled`, 318,85 €). **2 de ellos tienen la entrega hecha** (`delivery_state = delivered`, 50,40 €): es el caso «Cancelado (cobrado)» del cierre de referencia.
   - El cierre de las 6:00 no los toca, porque ya estaban cerrados.
   - La confirmación tiene que poder meter en el cierre **cualquier** pedido que la plataforma cobre, sea cual sea su estado en Folvy, y no solo los no confirmados.
3. **El día cambia.** El cierre de las 6:00 y la propuesta de hoy usan el día de entrada (`sold_at`). La regla nueva usa el de entrega.
   - En octubre cambian de día **6 pedidos (153,94 €)**: 1 de Glovo y 5 de Uber.
   - **63 pedidos no tienen `delivered_at`** (59 de Glovo y 4 de Uber, todos cerrados como completados) y van por el de entrada, como dice la regla.
   - Lo ya aplicado no se toca. La hora de cierre de las 6:00 sigue mandando sobre qué días están cerrados: un pedido que entra a las 23:50 y se entrega a las 00:20 cae en el día siguiente, que también cierra a las 6:00.

**Lo que no hace falta tocar:** `sale.unconfirmed_at`, el consumo y el cron. El no confirmado sigue sin ser venta en la propuesta provisional, y la confirmación de la plataforma lo puede meter con su porqué («Entra 1 pedido cobrado que no se entregó (+27,40 €)»).

---

## Lo que pregunto

1. **El detalle de la plataforma.** ¿Va en un encargo propio antes de este (lo que recomiendo) o dentro de este? Para cualquiera de las dos cosas necesito:
   - qué exporta cada portal: Uber Manager, Glovo Partner y Just Eat, en qué formato y con qué columnas. Un fichero real de cada uno, de septiembre, me sirve para medir §2 de verdad;
   - cada cuánto se puede descargar: cada día, cada semana o con la liquidación. Eso decide cuánto tiempo pasa un cierre en «provisional».
2. **Mientras no haya detalle**, ¿se proponen los cierres de octubre como provisionales y se quedan sin poder validarse? Esa es la regla §5.3 del encargo, y significa que octubre no se podrá cerrar hasta tener el detalle.
3. **El importe provisional.** Con lo que sabe Folvy el mismo día, propongo artículos − descuentos, sin cargos de envío ni de pedido pequeño. Es lo más cercano a «lo que paga el cliente por la comida», tomando todo el descuento como a cargo del restaurante hasta que la plataforma diga otra cosa. ¿Vale?
   - El de hoy usa el total con envío. La diferencia del 01/10 al 08/10 son 653,20 €.
4. **Los contracargos**, ¿van en el cierre del día del pedido o en el del día en que la plataforma los liquida? Hoy Folvy los pone el día de la liquidación.
5. **El cierre de referencia** `UBR-FLO-20260831`. ¿Me lo pegas aquí o lo subes al repo (`docs/conta/cierre-por-plataforma/`)? El repo es público: los nombres de marca y los códigos de pedido no son un problema, pero sí cualquier dato de cliente.
