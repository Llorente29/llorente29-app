# Folvy — Economía de Plataformas de Delivery
### Documento de diseño para aprobación · v1 · 01/06/2026

> **Estado:** diseño previo a construcción. NADA construido aún. Igual método que el
> editor de escandallos: se aprueba el modelo sobre papel antes de tocar BBDD.
>
> **Origen:** análisis de una factura real de Glovo (Meraki Pita, 01–15 may 2026,
> PDF + Excel de 48 pedidos) cruzada al céntimo. Decisiones de Julio: (1) los **3
> tipos de reparto** existen en Llorente29; (2) el **IVA va aparte y se compensa**
> (soportado ↔ repercutido) → neutro para el margen, se registra para contabilidad.
>
> **Tesis de goleada:** nadie en el mercado une *margen teórico por plato* +
> *economía real del canal desde la factura* + *la varianza entre ambos*. Los
> agregadores (Deliverect, Otter) consolidan pedidos; la contabilidad concilia
> cobros; las herramientas de menú (Apicbase, R365, meez) usan margen teórico. La
> pieza que **conecta las tres** no existe. *(Afirmación a verificar con benchmark
> web antes de cerrar el doc — ver §2.)*

---

## 0. Por qué esto importa (y por qué se paró a diseñar)

El dashboard de Kitchen enseñaba **81,2 % de margen idéntico en los 4 canales**. Es
falso: Glovo/Uber/JustEat se llevan mucho más que un % plano. La causa raíz no es un
bug de cálculo — es que **`brand_channel` está vacía** (no hay forma de cargar
comisiones desde la app) y, sobre todo, que **la comisión de plataforma NO es un
número plano**. Modelarla como un `%` único sería sembrar un mal dato en el corazón
del producto (el margen real es EL diferenciador de Folvy).

Este documento define cómo modelarlo bien, de una vez, para que cuando entren los
datos definitivos de cada cliente el margen real salga solo y al céntimo.

---

## 1. La anatomía real de una factura (evidencia, no teoría)

Factura Glovo de Meraki Pita, 01–15 may 2026. Cruzando PDF ↔ Excel (cuadran al
céntimo: Tasa de acceso 99,44 €, Recargo Prime 18,00 €, Productos 1.190,40 €):

**Lo que Glovo se lleva NO es una sola cosa. Son DOS naturalezas distintas:**

### 1.A — Costes por PEDIDO (varían pedido a pedido)
| Concepto | En la factura | Naturaleza |
|---|---|---|
| Comisión sobre productos | 15 % (negociado) | % sobre PVP |
| Servicio de entrega (transporte) | −3,00 € / −4,50 € por pedido | fijo por pedido, **variable** |
| Recargo Glovo Prime | 0,75 € en pedidos Prime | fijo por pedido, condicional |
| Promoción producto asumida por partner | en 8 de 48 pedidos | variable, cofinanciada |
| Promoción oferta flash a cargo del partner | condicional | variable, cofinanciada |
| Coste de incidencias | −32,27 € total | imprevisible |
| Recargo por mínimo de pedido | condicional | condicional |

### 1.B — Costes mensuales del CANAL (no por pedido)
| Concepto | Importe | Naturaleza |
|---|---|---|
| Tasa de acceso a la plataforma | 99,44 € | mensual fijo |
| Tarifa recurrente por usar la plataforma | 10,00 € | mensual fijo |
| Tarifas de oferta flash | 162,07 € | mensual variable (marketing) |
| **IVA 21 % sobre lo anterior** | 60,79 € | **neutro (se compensa)** |

**Conclusión nº1:** el coste real de un canal = (componentes por pedido) +
(componentes mensuales del canal). Mezclarlos es el error que comete todo el mundo.

**Conclusión nº2 (la dura):** sólo una parte es **atribuible por plato** de forma
determinista (la comisión %). El transporte, las promos y las incidencias son **por
pedido** (dependen de la composición del pedido y del momento), y las tasas son **del
canal**. Por eso el margen "real por plato" perfecto **no existe a priori** — sólo
existe a posteriori, reconciliando contra la factura. Esto define las tres capas.

---

## 2. Benchmark (a verificar antes de cerrar)

| Actor | Qué hace con la economía de canal |
|---|---|
| Deliverect / Otter | Agregan pedidos de varias plataformas en un POS; **no** modelan el coste real por plato ni reconcilian la factura contra el margen teórico. |
| R365 / Restaurant365 | Contabilidad fuerte; concilia **cobros** (bank rec), pero no ata coste de plataforma a margen por plato. |
| Apicbase / meez | Margen **teórico** por plato (food cost). No tocan la economía de plataforma. |
| gstock / tspoon | Escandallo + food cost teórico. Sin economía de canal. |
| Cuadernos/Excel del hostelero | Aquí vive hoy el problema: nadie le da una herramienta. |

> **La goleada** = ser el primero que une **margen teórico por plato (Capa A)** +
> **P&L real del canal desde la factura (Capa B)** + **la varianza teórico↔real
> (Capa C)**, en una herramienta que un cocinero entienda. **Acción pendiente:**
> verificar esta afirmación con benchmark web (Deliverect, Otter, Flipdish, Nory,
> Margin Edge) antes de venderla como goleada. Regla del proyecto: no se afirma
> "nadie lo tiene" sin auditar.

---

## 3. Los 3 tipos de reparto (decisión de Julio)

La comisión cambia según **quién reparte**. Tres modos, comisión distinta:

1. **Reparto de plataforma** (`platform_delivery`) — Glovo/Uber lleva con su flota.
   Comisión **más alta** (usa su logística). Es el caso de la factura (15 %).
2. **Reparto propio / marketplace** (`own_delivery`) — la plataforma es escaparate,
   **tú repartes**. Comisión **menor** (no usas su flota).
3. **Recogida / pickup** (`pickup`) — el cliente recoge en tienda. Comisión **mínima
   o 0** (Shop/takeaway encaja aquí).

**Implicación de modelo:** la comisión no es por (marca × canal), es por
**(marca × canal × tipo de reparto)**. Una misma marca en Glovo puede tener 3 tarifas.

> *Nota:* `sales_channel.channel_type` ('delivery'/'takeaway') es un atributo del
> CANAL. El **tipo de reparto** es por TARIFA/pedido y es un concepto distinto — no
> reutilizar `channel_type` para esto.

---

## 4. El IVA (decisión de Julio: aparte y se compensa)

- La comisión y las tasas llevan **IVA 21 %**, pero Llorente29 es sujeto pasivo: el
  **IVA soportado** de esas facturas **se compensa** con el **IVA repercutido** de
  sus ventas. → **El IVA es NEUTRO para el margen.**
- **Decisión:** el cálculo de margen usa **importes SIN IVA** (base imponible).
  El IVA **no resta** del margen.
- Pero se **registra** el IVA en la Capa B (la factura lo tiene, y afecta a
  tesorería: lo adelantas y lo recuperas). Separar "coste económico" (sin IVA, para
  margen) de "flujo de caja" (con IVA, para tesorería) es parte de hacerlo bien.
- **PVP:** `menu_item.price` ya se guarda SIN IVA (base imponible) + `vat_rate`. La
  comisión % se aplica sobre el PVP **¿con o sin IVA?** → **pregunta abierta P1**
  (las plataformas suelen calcular sobre el precio de cara al cliente, con IVA).

---

## 5. El modelo en TRES CAPAS

### Capa A — Configuración de comisiones → **margen teórico por plato**
**Qué es:** la tarifa negociada por (marca × canal × tipo de reparto). Lo único
atribuible por plato de forma determinista. **Es lo que enciende el margen real del
dashboard hoy.**

**Qué incluye por tarifa:**
- `commission_pct` (% sobre PVP).
- `commission_fixed` (€ fijos por pedido, si los hay).
- `service_type` (platform_delivery / own_delivery / pickup).
- (IVA NO — neutro.)

**Cómo entra en el margen (RPC `menu_item_economics`, que YA prevé estos campos):**
La RPC ya devuelve `commission_pct`, `commission_amount`, `commission_fixed`,
`delivery_fee`, `net_margin`… → fue diseñada anticipando esto. Sólo le falta **el
dato** (la tarifa) y, posiblemente, **la dimensión de tipo de reparto**.

> Margen de contribución teórico por plato×canal×reparto =
> `PVP_base − food_cost − (commission_pct × base_comisionable) − commission_fixed`
> (el `delivery_fee` teórico se puede incluir como estimación media, marcándolo como
> tal — ver Capa C para el real).

### Capa B — Economía del canal → **P&L real desde la factura**
**Qué es:** importar la factura/liquidación (PDF+Excel como la de Glovo) y registrar
**todo** el coste real del canal en un periodo: comisiones reales, transporte real,
Prime, promos cofinanciadas, incidencias, tasas mensuales, IVA. **No se reparte por
plato** — es el P&L del canal.

**Por qué es oro:** responde "¿cuánto me costó Glovo en mayo y en qué?" — tasas,
marketing (ofertas flash), transporte, incidencias. Hoy nadie se lo dice al hostelero.

**Cómo entra el dato:** importador de factura (foto/PDF/Excel → IA/parser →
`channel_invoice` + `channel_invoice_line`). Encaja con K5 (foto→IA) del plan Kitchen.

### Capa C — Reconciliación AvT (Actual vs Theoretical) → **la corona**
**Qué es:** cruzar el margen TEÓRICO (Capa A × ventas reales de Last.app) contra el
PAGO REAL (Capa B, la factura). La diferencia = **dónde se fuga el margen**:
- "Tu margen teórico decía 1.190 € de productos; cobraste 686 €. El gap son 162 € de
  ofertas flash + 199 € de transporte + 48 € de promos + 32 € de incidencias + tasas."
- Es la varianza que convierte datos en **decisiones**: ¿las ofertas flash compensan?
  ¿el transporte propio sale mejor que el de plataforma? ¿qué canal drena margen?

> Capa C es **el diferenciador definitivo**. Capa A arregla el dashboard hoy; Capa B
> da el P&L; Capa C es lo que **nadie tiene**.

---

## 6. Esquema de BBDD propuesto

### 6.1 — Capa A: tarifas por tipo de reparto
`brand_channel` (existe, vacía) hoy es (brand × channel) → un solo `commission_pct`.
**Opción recomendada:** tabla de tarifas hija, una por tipo de reparto.

```
brand_channel_rate                         (NUEVO)
  id                 uuid pk
  account_id         uuid  (tenancy + RLS)
  brand_channel_id   uuid  → FK brand_channel(id) ON DELETE CASCADE
  service_type       text  CHECK in ('platform_delivery','own_delivery','pickup')
  commission_pct     numeric        -- % sobre base comisionable
  commission_fixed   numeric NULL   -- € por pedido, si aplica
  commission_base    text   CHECK in ('pvp_con_iva','pvp_sin_iva')  -- ver P1
  est_delivery_fee   numeric NULL   -- transporte medio estimado/pedido (teórico)
  is_active          boolean
  archived_at        timestamptz NULL
  created_at / updated_at / created_by / created_by_name
  UNIQUE (brand_channel_id, service_type)
```

`brand_channel` se mantiene como cabecera (la relación marca↔canal existe y está
activa); las tarifas cuelgan de ella por tipo de reparto. `sales_channel.default_
commission_pct` (hoy null) sirve para **proponer** la tarifa al crear (menos fricción).

### 6.2 — Capa B: facturas del canal
```
channel_invoice                            (NUEVO)
  id                 uuid pk
  account_id         uuid
  brand_id           uuid NULL  → FK brand   (puede ser por marca o por cuenta)
  channel_id         uuid       → FK sales_channel
  invoice_number     text
  period_from        date
  period_to          date
  issue_date         date
  total_base         numeric    -- base imponible
  total_vat          numeric    -- IVA (registrado, neutro para margen)
  total_amount       numeric    -- con IVA
  net_payout         numeric    -- ingreso a cuenta del colaborador
  source             text  CHECK in ('manual','ocr_pdf','import_xlsx')
  raw_ref            text NULL  -- ruta al fichero original
  created_at / updated_at / created_by

channel_invoice_line                       (NUEVO)
  id                 uuid pk
  account_id         uuid
  invoice_id         uuid → FK channel_invoice(id) ON DELETE CASCADE
  concept            text  -- 'comision' | 'transporte' | 'prime' | 'oferta_flash'
                           --  | 'promo_producto' | 'incidencia' | 'tasa_acceso'
                           --  | 'tarifa_recurrente' | 'min_pedido' | 'otro'
  concept_kind       text  CHECK in ('per_order','monthly_fixed','marketing','incident')
  amount_base        numeric
  amount_vat         numeric NULL
  external_order_id  text NULL  -- 'Código de Glovo' (enlaza con la venta real)
  order_date         date NULL
  meta               jsonb NULL -- columnas crudas del Excel sin perder nada
```

> `external_order_id` es la llave de oro: enlaza cada línea de factura con la venta
> real de Last.app (`sale`) → permite la reconciliación de Capa C pedido a pedido.

### 6.3 — Capa C: vista de reconciliación
No es tabla nueva: es una **función/vista** que cruza:
- ventas reales del periodo (`sale_line` × `menu_item_economics` = margen teórico),
- contra `channel_invoice_line` (coste real),
agrupado por canal × marca × periodo, devolviendo: margen teórico, coste real
desglosado, varianza y % de fuga por concepto.

---

## 7. Encaje con lo que YA existe (no reinventar)

- **`menu_item_economics` (RPC):** ya devuelve `commission_pct/amount/fixed`,
  `delivery_fee`, `revenue_share_pct`, `net_margin`. Fue diseñada para esto. Cambio
  necesario: que lea de `brand_channel_rate` por **tipo de reparto** (hoy asume uno).
  → posible extensión de la RPC (SECURITY DEFINER: probar desde la app, no SQL Editor).
- **`brand_channel`:** se conserva como cabecera; las tarifas van a la tabla hija.
- **`sales_channel.default_commission_pct`:** se usa para proponer tarifa (hoy null →
  habría que sembrar defaults orientativos por canal).
- **`brand_licensing_agreement`:** ya cubre las cedidas (revenue share + reembolso de
  consumos). Ver §8.
- **Last.app (`sale`/`sale_line`):** la venta real; `external_order_id` la enlaza con
  la línea de factura para la Capa C.

---

## 8. Caso de marcas cedidas (licensed) — "más simple pero con sus problemas"

En las cedidas (p.ej. Cloudtown), tú **cocinas la marca de un tercero** y cobras
`revenue_share_pct` sobre PVP (ya en `brand_licensing_agreement`). Preguntas a cerrar:
- **P2:** ¿La comisión de la plataforma (Glovo) en una marca cedida la asume **el
  dueño de la marca** o **tú**? Cambia quién paga la Capa A.
- **P3:** El `revenue_share` ¿es sobre PVP **con o sin IVA**? ¿Antes o después de la
  comisión de plataforma?
- **P4:** `reimburses_consumption` — ¿el reembolso de consumos entra como ingreso que
  compensa el food cost? ¿A qué precio (`menu_item.consumption_price`)?

El margen de una cedida = `revenue_share` − food_cost (− comisión si la asumes tú) +
reembolso de consumos. La RPC ya ramifica por `flow_type='licensed'`; sólo faltan
estas respuestas para cuadrarlo.

---

## 9. UX (pantallas) — fiel al sistema de diseño de Kitchen

1. **Comisiones por marca** (Capa A) — en la ficha de cada marca, una pestaña
   "Canales": lista de canales activos, y por canal las 3 tarifas (reparto
   plataforma / propio / recogida) con su % y fijo. Propone el default del canal.
   Es lo que **rellena `brand_channel`/`brand_channel_rate` desde la app**.
2. **Importar factura de canal** (Capa B) — subir PDF/Excel → parser/IA → previsualizar
   líneas mapeadas a conceptos → confirmar (humano en el bucle, `needs_review`).
   Encaja con K5 (foto→IA).
3. **P&L del canal** (Capa B) — por canal×periodo: comisiones, transporte, marketing
   (ofertas), incidencias, tasas. "Glovo te costó X este mes, repartido así."
4. **Reconciliación / fuga de margen** (Capa C) — el panel navy "en vivo" del
   diferenciador: teórico vs real, varianza por concepto, semáforo.
5. **Gestión de ofertas hacia plataformas** (visión, §10).

Todo con el lenguaje fijado: hero cálido, panel navy "en vivo", clicabilidad, lenguaje
de color único, honestidad ("estimado" vs "real").

---

## 10. Visión: gestión de ofertas hacia plataformas (futuro, no en este cierre)

Lo que Julio apunta: que desde Folvy se puedan **gestionar las ofertas** hacia las
plataformas y **conocer los costes de transporte**. Esto es el nivel más ambicioso:
- **Simulador de oferta:** antes de lanzar un 2x1 en Glovo, Folvy predice su impacto
  en margen real (Capa A + coste de promo cofinanciada). "Esta oferta te deja en
  pérdidas en estos 4 platos."
- **Coste de transporte por zona/pedido:** del histórico de facturas (Capa B), media
  real de transporte por pedido y su tendencia.
- **Publicación de ofertas al POS/plataforma:** escribir, no sólo leer (Fase 2 del
  conector TPV bidireccional). Requiere API de cada plataforma — lejano.

No entra en este cierre. Se diseña aquí para no perder la visión.

---

## 11. Plan de construcción por fases (cerrar bien, una capa cada vez)

- **EP1 — Capa A (cierra el margen del dashboard).** `brand_channel_rate` + RLS +
  `brandChannelRateService` + pantalla "Canales" en la ficha de marca + extender la
  RPC para leer tarifa por tipo de reparto. **Resultado medible:** el margen por canal
  deja de ser idéntico; sale el real por marca×canal×reparto. Cierra el bug de hoy.
- **EP2 — Capa B (P&L del canal).** `channel_invoice` + `channel_invoice_line` +
  importador (manual primero; IA/parser después) + pantalla P&L. **Medible:** importar
  la factura de mayo y que cuadre al céntimo con el PDF (99,44 / 18,00 / 1.190,40 ya
  validados).
- **EP3 — Capa C (reconciliación AvT).** Vista/función que cruza venta real × teórico
  × factura → fuga de margen por concepto. **Medible:** explicar el gap 1.190 → 686 €.
- **EP4 — Visión (simulador de ofertas, transporte, publicación).** Posterior.

Cada fase: diseño aprobado → BBDD (transaccional, revisable) → service → UI → build →
verificación en la app. Cero deuda colgando entre fases.

---

## 12. Riesgos y honestidad declarada

- **Atribución por plato imposible al 100 %:** transporte/promos/incidencias son por
  pedido, no por plato (lo prueban los datos: transporte −3/−4,5 € variable, promos en
  8 de 48 pedidos). El margen teórico por plato es una **aproximación honesta**; el
  real sólo existe reconciliando (Capa C). Hay que **etiquetar "estimado" vs "real"**
  en toda la UI.
- **Cada plataforma factura distinto:** Glovo ≠ Uber ≠ JustEat en formato y conceptos.
  El modelo de `channel_invoice_line` con `concept` + `meta jsonb` lo absorbe, pero
  cada importador (parser) es trabajo por plataforma.
- **La RPC es SECURITY DEFINER:** no se prueba desde el SQL Editor (auth.uid() null,
  ya lo vimos). Verificar siempre desde la app.
- **Datos actuales desechables:** no cargar tarifas/facturas reales a mano ahora "para
  ver"; construir la herramienta y cargar con los datos definitivos del cliente.
- **Base del % (P1) sin cerrar:** con/sin IVA cambia el número. Hay que confirmarlo
  con una plataforma antes de fijar `commission_base`.

---

## 13. Preguntas abiertas para Julio (cerrarlas antes de EP1)

- **P1 — Base de la comisión:** ¿Glovo/Uber/JustEat aplican el % sobre el PVP **con
  IVA** o **sin IVA**?
- **P2 — Cedidas:** ¿la comisión de plataforma en una marca cedida la asume el dueño
  de la marca o Llorente29?
- **P3 — Revenue share:** ¿sobre PVP con o sin IVA? ¿antes o después de la comisión?
- **P4 — Reembolso de consumos:** ¿cómo entra en el margen y a qué precio?
- **P5 — Tipos de reparto reales por plataforma:** ¿qué % aproximado tiene cada uno
  (plataforma / propio / recogida) en Glovo, Uber, JustEat? (Para sembrar defaults.)
- **P6 — Alcance del cierre:** ¿confirmamos EP1 (Capa A) como el cierre de ESTA tanda,
  y EP2/EP3 como cierres posteriores?

---

*Documento vivo. Al aprobar, se versiona en `docs/` y se referencia en
`CONTEXTO_CLAUDE.md`. Construcción: EP1 primero (cierra el margen del dashboard).*
