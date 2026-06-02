# Folvy — Economía de Plataformas de Delivery
### Documento de diseño para construir · v2 · 02/06/2026

> **Estado:** diseño CERRADO, listo para construir EP1. Sustituye a la v1 (01/06).
> Las preguntas abiertas P1–P6 de la v1 quedaron resueltas o disueltas en la sesión
> del 02/06 con factura + tickets reales. Ver §13.
>
> **Origen y evidencia:** factura real de Glovo (Meraki Pita, 01–15 may 2026, PDF
> Nº I170326000182175 + Excel de 48 pedidos `invoice-200342777943.XLSX`) cruzada al
> céntimo, más un ticket de pedido flash real (Last ↔ Glovo, pedido `101663910592`).
>
> **Método (igual que el editor de escandallos):** se aprueba el modelo sobre papel
> antes de tocar BBDD. Al construir, los tipos exactos de columna y el cableado de la
> RPC se verifican contra `information_schema` — **la BBDD manda sobre este doc**.

---

## 0. Por qué esto importa (y qué se demostró)

El dashboard de Kitchen enseñaba **81,2 % de margen idéntico en los 4 canales**. Causa
raíz, ahora **probada en el código de la RPC**, no en teoría: `brand_channel` está vacía
(0 filas) y los 4 canales tienen `default_commission_pct` a null, así que el
`COALESCE(bc.commission_pct, sc.default_commission_pct, 0)` de `menu_item_economics`
cae al **0** en todos → comisión 0 → mismo coste de receta → margen idéntico. No es un
bug de cálculo: es el dato vacío.

Y, sobre todo, la comisión de plataforma **no es un % plano**. Modelarla como un número
único sería sembrar un mal dato en el corazón del producto. Este documento define cómo
modelarlo bien para que, con los datos definitivos de cada cliente, el margen real salga
solo.

**El número que justifica el producto (probado con la factura de mayo):**
Productos 1.190,40 € → ingreso real a cuenta 686,06 €. Glovo se quedó con **~43,5 %**,
no con el 15 % del titular negociado. *Ese gap es lo que ningún competidor enseña.*

---

## 1. Anatomía real de una factura (evidencia, no teoría)

Factura Glovo de Meraki Pita, 01–15 may 2026. PDF y Excel cuadran al céntimo:

```
Productos                                       1.190,40
Servicio de entrega                               210,00
Promoción producto asumida por partner            -48,06
Coste de incidencias sobre productos              -32,27
Promoción de oferta flash a cargo del Partner    -283,71
  Subtotal liquidación                          1.036,36
Tasas (con IVA): acceso 99,44 + flash 162,07
  + Prime 18,00 + recurrente 10,00 + IVA 60,79    -350,30
INGRESO A CUENTA COLABORADOR                       686,06   ✓
```

**Dos naturalezas distintas (no mezclar nunca):**

- **Por PEDIDO** (varían pedido a pedido): comisión %, transporte (−3/−4,5 € variable),
  Prime (condicional), promo de producto cofinanciada (8 de 48 pedidos), promo flash a
  cargo del partner (condicional), incidencias.
- **Mensual del CANAL**: tasa de acceso (99,44), tarifa recurrente (10,00), tarifas de
  oferta flash (162,07), **+ IVA 21 % aparte** (60,79).

**Conclusión:** coste real de un canal = (componentes por pedido) + (componentes
mensuales). Solo una parte es atribuible por plato de forma determinista (la comisión %).
El resto es por pedido o del canal → el margen "real por plato" perfecto **no existe a
priori**; solo a posteriori, reconciliando contra la factura (Capa C).

### 1.A — Lo que se demostró del flash (mecánica validada, NO al céntimo)

- **Comisión por pedido normal = 50 % de Productos**; en pedido **flash = 70 %**
  (35/35 normales exactos; el salto +20 % = la aportación extra del restaurante en
  campaña flash). El 15 % nominal de la columna `Porcentaje de comisión` y la columna
  mal-etiquetada `Tasa de acceso` (que suma 99,44 = la tasa mensual prorrateada) son
  **ruido**: la cifra real de comisión-equivalente es esa relación 50/70.
- **El 30 % al cliente, confirmado al céntimo** con el ticket real `101663910592`:
  PVP 19,40 € → descuento flash −5,82 € = exactamente 19,40 × 0,30. Precio tras
  descuento 13,58 € + envío 4,50 € = 18,08 € (lo que paga el cliente y liquida Glovo).
- **Flash = solo clientes nuevos** (condición de la mecánica; relevante para el
  simulador de ofertas, EP4).

**DEUDA DECLARADA (no cerrada, y por qué no toca cerrarla ahora):** el flash NO se cuadró
al último céntimo. El Excel por pedido de esta factura tiene `Tarifas de oferta flash` y
`Promoción flash partner` **a 0 en las 48 filas**; los 162,07 / 283,71 solo viven en el
agregado del PDF (los pedidos flash que los generaron están en otro periodo/Excel). La
mecánica está validada, lo cual basta para modelar Capa B/C. Cuadrarlo al céntimo exige
el Excel del periodo correcto, **pero** —por decisión de producto— los descuentos
llegarán por **extracción de plataforma**, no por parser de Excel; invertir en un parser
fino de flash sería deuda inútil. Prioridad: baja, solo si se necesita para EP2/EP3.

---

## 2. Benchmark (auditado el 02/06, sin vender empate como victoria)

| Actor | Qué hace con la economía de canal |
|---|---|
| Deliverect / Otter | Agregan pedidos multi-plataforma; Otter SÍ deja configurar comisiones y tarifas de marketplace por canal + marcas virtuales. **Configurar comisión por canal NO es diferenciador.** |
| MarginEdge / Restaurant365 | Tienen AvT (Actual vs Theoretical), pero es de **uso de ingrediente** (merma, robo, porción) cruzando factura de proveedor + inventario. NO es economía de plataforma. |
| Apicbase / meez / gstock / tspoon | Margen **teórico** por plato (food cost). No tocan la economía de canal. |

**Verdicto honesto:**
- **Capa A (configurar comisión) NO es goleada por sí sola** — Otter ya lo hace. Solo
  gana cuando alimenta a la C.
- **La combinación escandallo a nivel plato × comisión por canal Y tipo de reparto ×
  reconciliación contra la factura de la PLATAFORMA** no aparece en el set auditado.
  Su "AvT" es de cocina; el nuestro sería de **canal**.
- **Regla de rigor:** se dice *"no está en el set que auditamos"*, NO *"nadie lo tiene"*
  (ausencia de evidencia ≠ prueba de ausencia). Con eso, **Capa C es diferenciador
  defendible.**

---

## 3. Los 3 tipos de reparto

La comisión y el flujo del dinero cambian según **quién reparte**:

1. **Reparto de plataforma** (`platform_delivery`) — Glovo/Uber reparte con su flota.
   Comisión más alta. El `delivery_fee` es **neutro** (la plataforma se lo queda).
2. **Reparto propio / marketplace** (`own_delivery`) — la plataforma es escaparate, **tú
   repartes**. Comisión menor. **El fee de envío NO es neutro** (ver §3.A).
3. **Recogida / pickup** (`pickup`) — el cliente recoge. Comisión mínima o 0.

**Implicación de modelo:** la comisión es por **(marca × canal × tipo de reparto)**. Una
misma marca en Glovo puede tener 3 tarifas distintas.

> El **tipo de reparto se decide en el PEDIDO**, no en el plato ni en la tarifa. El dato
> real viene de **Last.app** (`sale`, campo "Entrega gestionada por el Partner" =
> `own_delivery`, confirmado en el ticket `101663910592`). Esto es lo que habilita la
> vista ponderada por mix real (§5) sin pedirle nada al cocinero.

### 3.A — Reparto propio: el fee NO es neutro (corrige la v1)

La v1 decía "el `delivery_fee` es neutro, no lo metas para no doble-contar". **Falso para
reparto propio.** Ahí hay DOS flujos:

- **INGRESO:** el cliente paga los gastos de envío (p.ej. 4,50 €) y **lo recibe
  Llorente29** (visto en el ticket: "Gastos de envío 4,50 €", reparto propio).
- **GASTO:** Llorente29 paga al repartidor (hoy **Catcher**) el precio pactado por pedido.

→ **Margen del reparto en propio = fee cobrado − coste del repartidor.** Puede ser
positivo, neutro o **negativo**. Es neutro SOLO en reparto de plataforma. Hay que
modelarlo, no ignorarlo.

**Honestidad de dato:** el fee al cliente probablemente viene por pedido en Last
(`delivery_cost`) → ese lado puede ser **real**. El coste de Catcher hoy no está en
ningún sistema → será **valor configurado/estimado** ("Catcher ~X €/pedido en esta
zona") y casi seguro **no es fijo** (varía por distancia/franja). En EP1 se modela como
un valor configurable por marca×canal; el coste real por pedido es Capa C / EP4 cuando se
integre Catcher como 4ª fuente. El margen de reparto propio se etiqueta **"coste de
reparto estimado"** hasta entonces.

---

## 4. El IVA y la base de la comisión (P1 — RESUELTO)

- La comisión y las tasas llevan **IVA 21 %**, pero Llorente29 lo compensa (soportado ↔
  repercutido) → **IVA neutro para el margen**. El cálculo de margen usa **bases SIN
  IVA**. El IVA se **registra** en Capa B (afecta a tesorería).
- **P1 — base de la comisión: PVP CON IVA.** Probado con dato real (doble evidencia):
  - Ticket flash: descuento 30 % = 5,82 € sobre **19,40 € (PVP con IVA)**.
  - Factura: la comisión-equivalente se aplica sobre `Productos`, que es el importe de
    cara al cliente (con IVA).
  - **Consecuencia para la RPC:** hoy aplica el % sobre `menu_item.price` (SIN IVA) →
    **subestima la comisión**. Debe aplicarse sobre `price_with_vat`.

---

## 5. Un motor, tres vistas (decisión de producto, 02/06)

Si se calcula bien el margen de **UN pedido** (PVP con IVA, su descuento, quién lo
repartió, − food cost, − comisión, ± fee/coste de reparto), las tres vistas salen casi
gratis del mismo motor:

- **Vista A — Ponderada por mix real** *(por defecto, el diferenciador)*: media de los
  pedidos del periodo según cómo se vendieron de verdad (mix de reparto sacado de
  `sale`). "De tus pedidos de Glovo, el 60 % los repartió Glovo y el 40 % tú; tu margen
  real medio es X." **Nadie del set auditado lo hace.**
- **Vista B — Por tipo de reparto**: tres números ("si reparte Glovo X, si repartes tú Y,
  si recogen Z"). Es lo que ya hace la competencia → empate; se mantiene como **opción de
  visualización**, no como obra nueva.
- **Vista por pedido**: "vendí este pedido, gané esto." El mismo cálculo aplicado a un
  pedido.

**Visión de Julio (recogida):** que **cada cliente elija su vista por defecto**. No son
tres features: es un interruptor sobre un único motor.

**Alcance EP1:** entrega el **motor del pedido** + **vista A** (enciende el dashboard).
La vista por pedido, la B y el selector de vista por defecto son **continuación rápida**
(baratas porque el motor ya está), **diseñadas desde ya** para encajar sin reescribir.

---

## 6. Modelo en TRES CAPAS

### Capa A — Configuración → margen teórico por plato (EP1)
La tarifa negociada por (marca × canal × tipo de reparto). Lo único atribuible por plato
de forma determinista. **Enciende el margen del dashboard.** Todo % es **configurable,
cero hardcode** (ni el 15 % de propias ni el % de cedidas).

### Capa B — Economía del canal → P&L real desde la factura (EP2)
Importar la factura/liquidación y registrar todo el coste real del canal en un periodo.
No se reparte por plato — es el P&L del canal. Fuente futura preferente: **extracción de
plataforma**, no parser de Excel.

### Capa C — Reconciliación AvT → la corona (EP3)
Cruzar margen TEÓRICO (Capa A × ventas reales) contra PAGO REAL (Capa B). La diferencia =
dónde se fuga el margen. "Tu teórico decía 1.190 € de productos; cobraste 686 €. El gap
son flash + transporte + promos + incidencias + tasas." Es el diferenciador definitivo.

---

## 7. Esquema de BBDD propuesto (verificar tipos contra `information_schema` al construir)

### 7.1 — Capa A: tarifas por tipo de reparto (NUEVO)

`brand_channel` se mantiene como **cabecera** (relación marca↔canal). Las tarifas cuelgan
de ella, una por tipo de reparto:

```
brand_channel_rate                         (NUEVO)
  id                 uuid pk
  account_id         uuid  (tenancy + RLS)
  brand_channel_id   uuid  → FK brand_channel(id) ON DELETE CASCADE
  service_type       text  CHECK in ('platform_delivery','own_delivery','pickup')
  commission_pct     numeric          -- % sobre base comisionable (CONFIGURABLE)
  commission_fixed   numeric NULL     -- € por pedido, si aplica (informativo)
  commission_base    text  CHECK in ('pvp_con_iva','pvp_sin_iva')  -- default 'pvp_con_iva' (P1)
  -- Reparto propio (§3.A) — solo relevante en service_type='own_delivery':
  own_customer_fee   numeric NULL     -- fee cobrado al cliente (idealmente real desde Last)
  own_courier_cost   numeric NULL     -- coste pactado del repartidor (Catcher), estimado
  is_active          boolean
  archived_at        timestamptz NULL
  created_at / updated_at / created_by / created_by_name
  UNIQUE (brand_channel_id, service_type)
```

`sales_channel.default_commission_pct` (hoy null en los 4 canales) sirve para **proponer**
la tarifa al crear (menos fricción) — nunca para imponerla.

### 7.2 — Cedidas: el acuerdo de licencia (existe, hacer editable)

Las comisiones de plataforma en cedidas **las asume el dueño de la marca** (P2), NO
Llorente29 → `brand_channel_rate` **no aplica a cedidas**. El ingreso de Llorente29 en una
cedida se rige por `brand_licensing_agreement`:

```
brand_licensing_agreement (existe)
  revenue_share_pct        numeric   -- % que cobra Llorente29 sobre VENTAS NETAS (sin IVA)
                                      --   CONFIGURABLE por marca (Cloudtown hoy 25%, NO fijo)
  reimburses_consumption   boolean   -- ¿reembolsa materiales?
  consumption_price        ...       -- a qué precio se reembolsan (tarifado por el dueño)
```

> Verificar al construir que la RPC lee `revenue_share_pct` como editable y que el
> reembolso de materiales encaja en `consumption_price`.

### 7.3 — Capa B / C (EP2/EP3, no en EP1)

`channel_invoice` + `channel_invoice_line` (con `external_order_id` como llave de oro para
enlazar cada línea de factura con la venta real de `sale`). Capa C = vista/función que
cruza venta real × teórico × factura. Detalle del esquema se cierra al abrir EP2.

---

## 8. Cambios en la RPC `menu_item_economics` (para EP1)

La RPC YA devuelve `commission_pct/amount/fixed`, `delivery_fee`, `revenue_share_pct/
amount`, `consumption_reimb`, `net_margin`… (fue diseñada anticipando esto). Cambios:

1. **Base con IVA (P1):** `commission_amount` sobre `price_with_vat`, no sobre `price`.
2. **Dimensión tipo de reparto:** leer tarifa de `brand_channel_rate` por `service_type`
   (hoy asume una sola comisión por marca×canal).
3. **Reparto propio (§3.A):** en `own_delivery`, sumar `own_customer_fee` y restar
   `own_courier_cost` al margen (etiquetado "estimado" mientras Catcher no esté integrado).
4. **Ponderación por mix real (vista A):** cruzar con `sale` para obtener el % real de
   cada tipo de reparto en el periodo y devolver el margen ponderado.
5. **Cedidas:** `revenue_share_pct` editable + reembolso de materiales; sin comisión de
   plataforma (la asume el dueño).

> SECURITY DEFINER: `auth.uid()` es null en el SQL Editor. **Probar SIEMPRE desde la app
> con sesión**, nunca en el SQL Editor. Regenerar `src/types/database.ts` en el mismo
> commit que toque esquema. Dejar el DDL como migración en `supabase/migrations/`.

---

## 9. UX (pantallas) — fiel al sistema de diseño de Kitchen

1. **Comisiones por marca (Capa A)** — en la ficha de marca, pestaña "Canales": por canal,
   las tarifas por tipo de reparto (% + base + fee/coste de reparto propio). **Default del
   canal que se hereda**; el cocinero solo sobrescribe la excepción ("Glovo: 15 %
   heredado"). Ganar a Otter aquí = facilidad, no la feature.
2. **Importar factura de canal (Capa B)** — subir/extraer → previsualizar líneas mapeadas
   a conceptos → confirmar (humano en el bucle, `needs_review`).
3. **P&L del canal (Capa B)** — por canal×periodo: comisiones, transporte, marketing,
   incidencias, tasas.
4. **Reconciliación / fuga de margen (Capa C)** — panel navy "en vivo" del diferenciador.
5. **Selector de vista** (§5) — A ponderada / B por reparto / por pedido; defecto por
   cliente.

Lenguaje fijado: hero cálido, panel navy "en vivo", color único, honestidad explícita
("estimado con tu tarifa" / "coste de reparto estimado" vs "real").

---

## 10. Visión (EP4, fuera de este cierre)

- **Simulador de ofertas:** antes de lanzar un flash (recordar: solo clientes nuevos),
  predecir su impacto en margen real. "Esta oferta te deja en pérdidas en estos 4 platos."
- **Coste de transporte real por zona/pedido** (integración Catcher como 4ª fuente).
- **Publicación de ofertas al POS/plataforma** (Fase 2 del conector TPV bidireccional).
- **Extracción de descuentos desde plataforma** (Glovo/Uber/JE) — vía preferente para los
  descuentos que Last no desglosa; depende de qué API real exista (explorándose con
  HubRise). No dar por viable hasta confirmar API.

---

## 11. Plan de construcción

- **EP1 — Capa A + motor + vista A.** `brand_channel_rate` + RLS + service + pantalla
  "Canales" + RPC (base con IVA, tipo de reparto, reparto propio, ponderación por mix).
  **Medible:** el margen por canal deja de ser idéntico; sale el real ponderado.
- **EP2 — Capa B.** `channel_invoice(_line)` + importador (extracción > parser) + P&L.
  **Medible:** la factura de mayo cuadra al céntimo (686,06 ya validado).
- **EP3 — Capa C.** Reconciliación AvT → fuga por concepto. **Medible:** explicar el gap
  1.190 → 686 €.
- **EP4 — Visión.** Simulador, Catcher, publicación, extracción.

Cada fase: diseño aprobado → BBDD (transaccional, revisable) → service → UI → build verde
→ verificación en la app. Cero deuda colgando entre fases.

---

## 12. Riesgos y honestidad declarada

- **Atribución por plato imposible al 100 %:** transporte/promos/incidencias son por
  pedido. El margen teórico por plato es **aproximación honesta**; el real solo existe
  reconciliando (Capa C). Etiquetar "estimado" vs "real" en toda la UI.
- **Comisión EP1 = la negociada**, no la realmente cobrada (esa relación 50/70 opaca solo
  se cierra reconciliando contra factura, Capa C). El margen por pedido va como **"estimado
  con tu tarifa"** hasta entonces.
- **Coste de reparto propio = estimado** hasta integrar Catcher.
- **Flash no cuadrado al céntimo** — deuda declarada §1.A; prioridad baja por la vía de
  extracción.
- **Cada plataforma factura distinto** (Glovo ≠ Uber ≠ JE) → cada importador/extractor es
  trabajo por plataforma.
- **Datos actuales desechables:** no cargar tarifas/facturas reales a mano "para ver";
  construir la herramienta y cargar con datos definitivos.

---

## 13. Preguntas P1–P6 — estado tras la sesión 02/06

- **P1 — Base de la comisión:** ✅ **PVP CON IVA** (probado al céntimo).
- **P2 — Cedidas:** ✅ las comisiones de plataforma las asume **el dueño de la marca**
  (Cloudtown), no Llorente29. → `brand_channel_rate` no aplica a cedidas.
- **P3 — Revenue share:** ✅ sobre **ventas netas SIN IVA** ("antes de impuestos", Julio).
  El "antes/después de comisión" es irrelevante para Llorente29 porque no soporta la
  comisión en cedidas. El % es **editable por marca** (Cloudtown hoy 25 %, NO fijo).
- **P4 — Reembolso de consumos:** ✅ entra como ingreso que compensa el food cost, **al
  precio tarifado por el dueño** (`consumption_price`). Verificar mapeo al construir.
- **P5 — Mix de reparto por plataforma:** ✅ **disuelta** — no hace falta sembrar defaults;
  el mix real se calcula desde `sale` (vista A).
- **P6 — Alcance del cierre:** ✅ **EP1 = Capa A + motor + vista A.** EP2/EP3/EP4 después.

---

*Documento vivo. Versionar en `docs/` y referenciar en `CONTEXTO_CLAUDE.md` (§1).
Construcción: EP1 primero. Antes de tocar esquema, verificar estado real vía
`information_schema`.*
