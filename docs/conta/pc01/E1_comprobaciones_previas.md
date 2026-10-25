# PC01 · Entrega 1 · Lo medido antes de escribir, y lo que necesito que decidas

> Medido el 25/10 en producción, **solo leyendo**, cuenta Foodint
> (`51ad1792-…`). Ninguna otra cuenta tiene facturas emitidas ni pagadas
> (regla 9: las consultas van por `account_id`; la plantilla no tiene filas).
> No he escrito código ni SQL todavía: el encargo pide estas tres respuestas antes.

## 1 · Cómo se enlaza una liquidación con sus cierres

**Lo que hay:**

| | Medido |
|---|---|
| Facturas emitidas | 1.281, todas «Cierre del día»: 1.196 traídas de Diez (262.321,99 €) y 85 de octubre (18.271,90 €) |
| Con algún cobro (`customer_invoice_payment`) | **0** |
| Vencen | **el mismo día que se emiten**, las 1.281 (por eso salen todas «Vencidas») |
| Las 85 por canal | Uber 43 (9.764,44 €), Glovo 31 (8.100,71 €), Just Eat 11 (406,75 €). Sin marca: un cierre es día · local · canal, con todas las marcas dentro |
| Liquidaciones de sep–oct | **8, todas de Uber** (por correo), semanales y **una por marca y tienda**. Glovo y Just Eat: **ninguna** |
| Cobradas | **2**: Bendito Burrito Florencio 05–11/10 (110,00 €) y Milanesa House Camichi 12–18/10 (66,94 €). Ninguna con asiento |
| Pedidos de la liquidación (`channel_settlement_order`) | **0** en las de Uber por correo. Solo las de Glovo por CSV traen pedidos con su venta (302), y son antiguas, sin periodo |
| Tienda → marca (`platform_store.brand_id`) | **vacía en las 8**: la marca solo está en el texto («Bendito Burrito (Calle de Florencio…)») |

**Cruce probado:** si se buscan las ventas de la marca, el local y el canal dentro
del periodo (en hora de Madrid), salen los mismos pedidos que dice la liquidación:
Bendito Burrito 5 de 5, Milanesa House 7 de 7 y Meraki Pita **44 de 46**. Los 56
están en un cierre con factura.

**La regla que propongo:**

1. Una liquidación cobra **pedidos**, no facturas. Cada pedido está en un solo
   cierre (`sales_day_summary.sale_ids`), y por tanto en una sola factura.
2. Al cobrar la liquidación, cada factura queda cobrada por **lo que su cierre
   cuenta de esos pedidos**, no por el neto que paga la plataforma. La comisión y
   los cargos ya los compensa el asiento de la liquidación contra la misma 430
   (`liquidacionPlataforma`: 410 contra 430, y el cobro, 572 contra 430). Así, la
   430 de la factura y lo cobrado cuadran.
3. **Los pedidos, por este orden:** los de `channel_settlement_order` con su
   venta, cuando la liquidación los trae. Si no los trae (Uber por correo), plataforma, local, marca y fechas del
   periodo.
4. **Si el número de pedidos no coincide** (el 44 de 46 de Meraki), no se cobra
   nada solo: la liquidación queda «a revisar» con la diferencia dicha.
5. El cobro va con método «plataforma» y con el asiento de la liquidación
   enlazado cuando lo tenga. Descobrar la liquidación borra esos cobros.
6. Una factura queda **Cobrada** cuando todos sus pedidos están en liquidaciones
   cobradas, y **Cobrada en parte** mientras falten.

**Lo que necesito de ti:**

- **a.** ¿Vale la regla?
- **b.** La marca de cada tienda: propongo rellenar `platform_store.brand_id` una
  vez, en la tanda, con la lista delante (son 8 tiendas), en vez de buscarla por
  el nombre cada vez. ¿Vale?

## 2 · «Marcar como pagada» sin asiento

**Hoy hay 0.** Hay 4 facturas recibidas pagadas (732,65 €). Las 4 se pagaron casando
en Bancos, y las 4 tienen su asiento de banco (3 validados y 1 propuesto). El
registro dice «paid · Julio» porque `bank_casar` llama a `mark_supplier_invoice_paid`
por dentro.

**Lo que propongo:**

- `mark_supplier_invoice_paid` deja de poder llamarse desde la pantalla: solo la
  llaman Bancos y el pago con asiento.
- El botón «Marcar como pagada» de la ficha se quita, y en la entrega 2 lo
  sustituye «Ya la he pagado», que deja el pago esperando el cargo.
- Para registrar los pagos en partes, una tabla `supplier_invoice_payment`, gemela
  de la de cobros, con su asiento y su casado. Los 4 de hoy entran en ella, sacados
  de `bank_match_item`.
- No hay nada que arreglar en los datos.

## 3 · Las que se quedan por cobrar después de la tanda

**Con la regla de arriba:**

| | Facturas | Importe |
|---|---|---|
| Traídas de Diez, cobradas (sin asiento, «traído de Diez») | 1.196 | 262.321,99 € |
| Octubre, cobradas enteras por sus liquidaciones | **1** (UBR-CAM-20261018, 17,70 €) | |
| Octubre, cobradas en parte | **5** | 279,90 € cobrados de 1.257,67 € |
| Octubre, **sin nada cobrado** | **79** | |

*(Cifras de octubre medidas con el total de cada venta. El cobro real usará lo
que cuenta el cierre, que puede variar unos céntimos con las promociones. Se mide
otra vez en la cuenta de la tanda.)*

**Aquí hay un choque con la comprobación del punto 6.** Esas 84 vencen el mismo
día en que se emiten, así que al día siguiente salen «Vencidas». No lo están: es
dinero que la plataforma aún no ha liquidado (Uber paga por semanas, y de Glovo y
Just Eat no ha entrado ninguna liquidación de octubre).

- **c.** ¿Qué plazo tiene cada plataforma para el vencimiento de su factura? Por
  ejemplo: Uber, el lunes siguiente a la semana más X días; Glovo y Just Eat, cada
  cuántos días. Es un dato del negocio y no lo deduzco. Si no hay plazo, propongo
  que la factura de un cierre de plataforma no salga «Vencida» mientras su
  liquidación no haya llegado, sino «Esperando liquidación».
- **d.** Una de las traídas es una devolución (GLV655836-20260913, −3,90 €).
  Propongo darle un cobro de −3,90 €, devuelto con su signo, para que quede
  saldada como las demás. ¿Vale?

## 4 · El vencimiento de las recibidas

- El plazo del proveedor está en `supplier.payment_terms_days`. `payment_term` es
  un catálogo de 4 plazos que no está enlazado con ningún proveedor.
- Hoy hay 89 aprobadas sin vencimiento, y **solo 1** tiene proveedor con plazo.
- Lo que propongo para la entrega 1: al validar una factura, se le pone
  `invoice_date + payment_terms_days`. Sin plazo, se queda «Sin vencimiento».
- Las 89 de antes no las toco: es el «Ponerles vencimiento» de la entrega 2.

---

## Lo que decidió Julio (25/10) y cómo queda construido

| | Decisión | Dónde está |
|---|---|---|
| 1 | La regla de las liquidaciones: **sí**. Si los pedidos no cuadran, «a revisar» y nada cobrado. El cruce por marca, local, canal y semana vale para Uber por correo | `conta_liquidacion_pedidos` y `_conta_liquidacion_cobros` (0916), disparador de `channel_settlement` (0917) |
| 2 | La marca de cada tienda, en la tanda, con la lista en el PR | 0918, paso 2 (son **9** tiendas, no 8: las 15 liquidaciones de Uber por correo desde julio cuelgan de 9) |
| 3 | Cuándo paga cada plataforma, dato de su ficha: periodo, día aproximado de pago y margen (5 por defecto) | `party_role.payout_days_after` y `payout_margin_days` (0916); «Cuándo te paga» en la ficha (Contactos › Cobro); `conta_plataforma_plazo_guardar` |
| 3 | Hasta el día de pago más el margen, «Esperando liquidación»; después, «Vencida». También en las cifras | `conta_factura_cobro` (0916) y Ventas › Facturas |
| 3 | Arreglar el vencimiento de las 1.281 | 0918, paso 3 (las traídas, por la plataforma de su 430) |
| 4 | La devolución de −3,90 €, saldada con un cobro negativo | CHECK de `customer_invoice_payment` (0917) y 0918, paso 4 |
| 5 | La tabla de pagos gemela: sí; los 4 de hoy desde lo casado en Bancos | `supplier_invoice_payment` (0916); 0918, paso 5a |
| 6 | El vencimiento de las recibidas, de `supplier.payment_terms_days`; `payment_term` no se toca | disparador `pc01_recibida_vence` (0917) |

**Los plazos que pone la 0918, en días después de cerrar el periodo:**
- Uber: semanal, 1 día (el lunes);
- Just Eat: quincenal, 4 días (la del 1 al 15, hacia el 19; la del 16 a fin de mes, hacia el 4);
- Glovo: quincenal, 20 días (la del 1 al 15, hacia el 4 del mes siguiente; la del 16 a fin de mes, hacia el 20).

Julio dio el 18 y el 5 para Just Eat, y el 5 y el 18 para Glovo. Un solo número por plataforma los aproxima a un día, y el margen de 5 lo cubre. Se cambian en su ficha.

**Lo que salió al construir, medido (25/10, solo lectura):**
- **83 recibidas de Foodint (1.919,87 €) pagadas del saldo prepago de Catcher**, con el asiento del pago del lote validado, seguían «aprobada». Con el motor saldrían por pagar. Ahora el pago del lote es su pago con asiento: la 0918 las deja pagadas y, desde la 0917, el pago de cada lote nuevo lo hace solo.
- **Con los plazos de Julio, hoy (25/10) pasan de su fecha unas 40 de las 85 de octubre**: 34 de Uber y 6 de Just Eat, unos 8.266 €. Sus semanas y quincenas ya se habrán pagado, pero Sumied no tiene sus liquidaciones, así que salen «Vencida» y no «Esperando liquidación». Es la regla tal como está escrita. Lo arregla la captura de las liquidaciones (otro encargo).

## Lo que decidió Julio después (25/10, respuesta 2) y cómo queda

1. **Las marcas de las 9 tiendas: la lista vale.** En Uber hay más marcas (todas las de Florencio Llorente 29 están también en Camichi 4), pero no están en Sumied porque no ha llegado ninguna liquidación suya. No se crean en esta tanda: llegarán con su liquidación, en el encargo de la captura de las liquidaciones.
2. **Una de plataforma sin liquidación sale «Falta su liquidación», en ámbar, no «Vencida».**
   - `conta_factura_tiene_liquidacion` (0916) y el estado `falta_liquidacion` de `conta_factura_cobro`.
   - «Vencida» en rojo queda para cuando la liquidación existe y no la cubre (o la cubre en parte), y para las que no son de plataforma.
   - Ventas › Facturas: su chip, su pestaña (solo si las hay), su propia cifra (no suma en Vencido) y un aviso con el enlace a Ventas › Liquidaciones; en la ficha, el mismo enlace.

   **Por marca, porque si no, no dice la verdad.** La factura de un cierre junta los pedidos de todas las marcas del local, y en Uber cada liquidación es de una tienda, o sea de una marca. Con «hay alguna liquidación de su periodo», **23 de Uber (6.968,96 €)** habrían salido «Vencida» por tener la liquidación de una de sus marcas, aunque les faltaban las de las demás. Así que una factura tiene su liquidación cuando **cada marca con pedidos en su cierre** tiene una de su canal, su periodo y su local. Medido hoy en producción (solo lectura, con las marcas que pone la 0918):

   | Plataforma | Pasadas de su plazo | Falta su liquidación | Vencida |
   |---|---|---|---|
   | Uber | 34 | 33 · 8.037,94 € | 1 · 17,70 € |
   | Just Eat | 6 | 6 · 211,01 € | 0 |
   | Glovo | 0 (vencen del 9 al 25/11) | 0 | 0 |

   La de Uber que sale «Vencida» tiene la liquidación de todas sus marcas. Lo que queda cobrado de verdad lo mide la cuenta, en el real.
