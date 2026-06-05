# Folvy — Módulo de Economía de Canal y Promociones

**Diseño técnico · 05/06/2026**
**Autor:** Claude (coordinador) · **Decisor:** Julio Gª Colón
**Estado:** DISEÑO — no construido. Mapa antes de construir.

---

## 0. Por qué este documento

Este es el corazón económico de Folvy. Un error en el modelo se propaga a todos los
precios, así que se diseña entero antes de tocar código. Recoge tres frentes que se
han ido descubriendo en sesión y que están entrelazados:

1. **Margen real por canal** (¿gano o pierdo en cada plato, en cada plataforma?).
2. **Promociones rentables** (¿esta promo me deja margen o vendo a pérdida?).
3. **Cumplimiento de la Ley Ómnibus** (¿esta promo es legal?).

La tesis: con la Ley Ómnibus, el precio en plataforma deja de ser una palanca libre.
El foco se mueve al **margen real** y a la **planificación**. El mercado va justo hacia
donde Folvy ya apunta. Ninguna herramienta investigada (MarginEdge, R365, Apicbase,
Livelytics) cierra el bucle planificar + garantizar rentabilidad + garantizar
legalidad + ejecutar en plataforma. Ese es el hueco.

---

## 1. El problema real (validado con datos de Llorente29)

### 1.1 El 15% de comisión NO es el coste del canal

Calcular el PVP de Glovo con solo el 15% de comisión es ruina asegurada. El coste
efectivo real de un canal de delivery con reparto propio se compone de varias capas:

| Capa | Concepto | Fuente del dato | Naturaleza |
|------|----------|-----------------|------------|
| Comisión % plataforma | 15% Glovo/JustEat; Uber variable | Configuración manual | Proporcional al plato |
| Comisión fija plataforma | fee por pedido | Configuración / factura | Fija por pedido |
| Procesamiento de pago | ~2,9% + 0,25€/transacción | Configuración / factura | Mixto |
| Coste rider (reparto propio) | ~5,38€/pedido (real Catcher) | Catcher / JELP | Fija por pedido |
| Comisión broker reparto | 0,96€/pedido (Catcher) | Catcher / JELP | Fija por pedido |
| Ingreso envío cliente | lo que paga el cliente, lo abona la plataforma | Venta (sale) / Catcher | Ingreso (resta coste) |
| Ads / marketing | gasto mensual por canal | Estimación manual | Global periodo (NO al plato) |
| Promociones | descuento aplicado | Last (sale.discount_amount) | Por pedido real |

### 1.2 Datos reales de transporte (Catcher, Llorente29, marzo 2026 1ª quincena)

- **226 pedidos**, total transporte **1.328,38€** (IVA incl.).
- Dos componentes por pedido:
  - `rider to pitcher` = pago al rider: 208 líneas, 1.118,26€. Media ~5,38€, rango 4–9,69€.
  - `pitcher commissions` = comisión Catcher: 226 líneas, 210,10€. Fija 0,96€/pedido (0,79€ + IVA 21%).
- **Coste de transporte real ≈ 6,30€/pedido.** Sobre una burger de 12€, es enorme.
- Granularidad: el desglose llega a **pedido individual** (`order_code` + `order_date`),
  con local (3 ubicaciones FoodInt) y rider. Cruzable con `sale.external_ref`.

### 1.3 IVA heterogéneo — la trampa que descuadra precios

Confirmado con consultas vinculantes DGT (V2254-22) y tipos AEAT 2026:

- **Comida a domicilio: 10%** (entrega de bienes, art. 91.Uno.1.1º Ley 37/1992).
- **Bebidas alcohólicas / refrescos azucarados: 21%.**
- **Transporte / comisión rider: 21%** (en los datos de Catcher el rider factura +21%).
- **Combos:** se desglosan por líneas, cada una con su tipo.

**Regla de oro:** nunca mezclar base imponible con total (IVA incluido). El margen se
calcula sobre **bases homogéneas**. Cada componente lleva su tipo. Se reutiliza el motor
de IVA versionado por fecha ya existente (vat_category + vat_rate con valid_from/to).
Un error aquí cambia el precio y puede acarrear sanción.

### 1.4 Ley Ómnibus (RD-Ley 24/2021) — restricción legal sobre el precio

- El precio promocionado debe calcularse sobre **el precio más bajo de los últimos 30
  días naturales**. No puedes inflar y descontar.
- Aplica a delivery, carta digital, apps. **Glovo ya bloquea** promos que no cumplen.
- Las campañas deben planificarse con ~30 días de antelación (precio base estable).
- **Excepción legal útil:** no aplica si rebajas el precio SIN anunciarlo como rebaja, o
  si muestras comparativa sin mencionar el ahorro (fuente: análisis Ómnibus retail).
- **Estrategia de regalo:** promos de "producto adicional gratis con compra" controlan
  mejor el coste que un descuento directo y esquivan la mecánica de precio de referencia.

---

## 2. El modelo de cálculo — tres niveles

Cada coste va donde es honesto. Nada inventado en ningún nivel.

### Nivel 1 — Margen unitario del plato (planificación, fija PVP)

Para un plato, en un canal, a un precio:

```
margen_unitario =
    base_imponible(PVP, iva_comida)          (ingreso neto del plato)
  − coste_escandallo                          (server-side, quantity_gross)
  − comision_pct * base_imponible             (% plataforma)
  − transporte_repartido_por_plato            (coste rider medio / platos por pedido medio)
  + ingreso_envio_repartido_por_plato         (own_customer_fee / platos por pedido medio)
```

- **NO incluye ads** (gasto global → sería inventar repartirlo al plato).
- **Transporte repartido:** coste medio real de Catcher/JELP ÷ nº medio de platos por
  pedido del canal (dato de sale/sale_line). Es media de datos reales, no estimación.
- Responde: "¿a qué precio vendo y cuánto gano en Glovo?".
- **Estados:** verde (margen sano), ámbar (margen bajo), rojo (pérdida).

### Nivel 2 — Margen real por pedido (a posteriori, exacto)

Cuando el pedido real existe (webhook ventas + dato Catcher):

```
Por cada pedido:
  costes_fijos_pedido = comision_fija + transporte_real + comision_broker − ingreso_envio
  Se diluyen entre las líneas del pedido por peso line_total / sale.total
  margen_real_linea = base(line_total) − coste_escandallo − comision_pct*base − cuota_fija_diluida
```

- Transporte real exacto de ese pedido (Catcher), promo real (sale.discount_amount).
- Cero estimación. Es el "margen real ponderado por mix vendido".

### Nivel 3 — Rentabilidad de canal (a posteriori, por periodo)

```
margen_canal_periodo =
    Σ margenes_reales_pedidos (Nivel 2)
  − ads_periodo (importe mensual por canal, manual)
  − reembolsos / incidencias
```

- Aquí SÍ entran ads y reembolsos, medidos contra ventas reales del periodo.
- Responde: "¿Glovo me rentó este mes, después de TODO?".

---

## 3. Promociones — simulador y gestor Ómnibus-aware

### 3.1 Simulador de escenarios (en la ficha del plato)

No existe "un" PVP cuando hay promos: existen escenarios de margen. La ficha muestra,
para el plato, el margen resultante de cada tipo de promo:

- Precio lleno (base).
- −X% (campo libre + presets habituales: −10, −20, −30).
- 2x1 / 2ª unidad a mitad.
- Envío gratis (lo asume el restaurante).
- Producto regalo con compra (estrategia recomendada: coste controlado).

Cada escenario muestra: precio efectivo, margen €, margen %, y semáforo (gana/pierde).
Decisión informada **antes** de lanzar.

### 3.2 Gestor de campañas

Una campaña = {artículo(s), canal(es), fechas, tipo de promo}. Folvy:

1. **Calcula rentabilidad** (Nivel 1) y avisa si entra en pérdida.
2. **Verifica Ómnibus:**
   - Conoce el histórico de precios de 30 días (requiere `menu_item_price_history`).
   - Calcula el descuento sobre el precio de referencia legal (mínimo 30 días).
   - Avisa/bloquea si no cumple.
3. **Programa** activación/desactivación en las fechas (con la antelación legal).

### 3.3 Técnica del artículo-espejo (Julio)

Para promos sobre artículos cuyo precio no se puede mover sin romper Ómnibus, se crea un
**artículo-espejo**: mismo escandallo (`recipe_item_id` compartido), distinta ficha
comercial (`menu_item`), con su propio histórico de precios limpio. Ej.: "Patatas
Clásicas" 5€ / "Patatas Clásicas Promo" 6€. Se activa el de promo durante la campaña.

- **No requiere arquitectura nueva:** dos menu_item con el mismo recipe_item ya es posible.
- Folvy lo orquesta: crea el espejo, le pone precio rentable, lo activa/desactiva por
  campaña, lo publica en la plataforma. El gestor evita que el usuario lo haga a mano y
  se líe.

### 3.4 Ejecución en plataformas (capa de publicación)

El cambio (precio, activación, promo) se publica en Glovo/Uber/JustEat. Depende de las
integraciones de push (Glovo G2, Uber, JE) — frente futuro. Conecta con TPV bidireccional
fase 2 y con `catalog_source` por marca.

---

## 4. Arquitectura de datos

### 4.1 Comisiones — defecto por canal + override por marca

Decidido con caso real (Glovo/JustEat 15% en todo; Uber variable por marca y reparto):

- **Defecto por canal** (siembra todas las marcas): tabla a nivel canal. NUEVA, porque
  `brand_channel_rate.brand_channel_id` es NOT NULL y no admite fila "sin marca".
  Candidata: `channel_rate` (account_id, sales_channel_id, service_type, commission_pct,
  commission_fixed, commission_base, own_customer_fee, own_courier_cost...).
- **Override por marca×canal:** `brand_channel_rate` (ya existe), solo donde difiere del
  defecto. Requiere poblar `brand_channel` (hoy 0 filas).
- **Resolución por especificidad:** override marca×canal > defecto canal > sin configurar
  (avisar, no inventar). Mismo patrón que `menu_item_override` para precios.

### 4.2 Tablas implicadas

| Tabla | Estado | Rol |
|-------|--------|-----|
| `sales_channel` | existe (4 filas) | canales |
| `brand_channel` | existe, VACÍA | marca opera en canal |
| `brand_channel_rate` | existe, VACÍA | comisión override por marca×canal |
| `channel_rate` (defecto canal) | NUEVA | comisión por defecto del canal |
| `menu_item` / `menu_item_override` | existe | precio base + por canal×ubicación |
| `menu_item_price_history` | NUEVA | histórico de precios (Ómnibus 30 días) |
| `promo_campaign` + `promo_campaign_item` | NUEVAS | campañas planificadas |
| `transport_cost` (por pedido, multi-broker) | NUEVA | coste real de Catcher/JELP |
| `sale` / `sale_line` | existe, normalizado | ventas (Nivel 2/3) |

### 4.3 Conector de transporte multi-broker

Catcher y JELP son del mismo tipo (broker de reparto propio, coste por pedido, API).
El conector debe ser **capa genérica multi-broker** (como el de TPV con Last.app de
primer adaptador). No cablear "Catcher" en duro: "fuente de coste de transporte" con
Catcher y JELP como adaptadores.

- **Catcher:** OAuth2 (AppId/AppSecret → JWT). Base `api.catcher.es`. Endpoints útiles
  para coste: `Get Orders History`, `Get Order Details`. Hay credenciales de pruebas.
- **JELP:** API propia por pedido, mismo modelo. Adaptador futuro.

---

## 5. Fases de construcción (sin media tubería)

Cada fase aporta valor sola y se enchufa a la siguiente sin reescribir.

| Fase | Qué | Depende de |
|------|-----|-----------|
| **E1 — Comisiones** | `channel_rate` (defecto) + UI Ajustes Kitchen + poblar brand_channel + override por marca | RECON hecho |
| **E2 — Margen unitario** | Nivel 1 en la sección Precios de la ficha (escandallo + comisión + IVA). Transporte = constante manual al principio | E1 |
| **E3 — Conector transporte** | Adaptador Catcher (leer histórico de costes), tabla `transport_cost`, alimenta own_courier_cost real | E2 + credenciales |
| **E4 — Margen real** | Nivel 2: diluir costes de pedido entre líneas reales | E3 + ventas |
| **E5 — Histórico precios + Ómnibus** | `menu_item_price_history` + validador de descuento legal | E2 |
| **E6 — Simulador de promos** | Escenarios de margen en la ficha | E2 |
| **E7 — Gestor de campañas** | `promo_campaign`, artículo-espejo, activación programada, Ómnibus-aware | E5 + E6 |
| **E8 — Rentabilidad de canal** | Nivel 3: ads + reembolsos por periodo | E4 |
| **E9 — Ejecución en plataformas** | Push de promos/precios a Glovo/Uber/JE | integraciones push (futuro) |
| **E10 — JELP** | Segundo adaptador de transporte | E3 |

**Arranque recomendado:** E1 (comisiones) → E2 (margen unitario). Es lo que responde
"¿a qué precio vendo para ganar?" y desbloquea todo lo demás.

---

## 6. Dónde Folvy golea (resumen competitivo)

- **MarginEdge / R365 / Apicbase / Livelytics:** calculan coste y hacen menu engineering
  a posteriori. NO planifican promos rentables, NO integran Ómnibus, NO ven el coste real
  del rider.
- **Catcher / JELP:** dan el coste de transporte pero no ven el escandallo ni la comisión.
- **Glovo/Uber/JE:** bloquean promos ilegales pero no te dicen si pierdes dinero.
- **Folvy:** une las tres fuentes (escandallo de cocina + comisión configurada + coste
  real de transporte de brokers), respeta el IVA heterogéneo, simula promos con margen,
  garantiza Ómnibus y (a futuro) ejecuta en plataforma. **Margen garantizado ANTES de
  vender, no descubierto al cierre de mes.** Nadie cierra este bucle.

---

## 7. Riesgos y cuidados

- **IVA:** el mayor riesgo de error de precio. Tratar cada componente con su tipo, bases
  homogéneas, motor versionado por fecha. Probar con casos reales (combo comida+bebida).
- **Ómnibus:** es asesoramiento operativo, no legal. Folvy ayuda a cumplir pero el
  responsable legal es el cliente. Redactar los avisos con ese matiz.
- **Transporte por pedido vs por plato:** el reparto al plato (Nivel 1) es una media;
  el exacto solo existe a posteriori (Nivel 2). No vender la media como exacta.
- **Ads:** nunca al coste unitario. Solo en rentabilidad de periodo (Nivel 3).
- **Multi-broker:** no cablear Catcher en duro. Capa genérica desde el principio.
- **Credenciales Catcher:** rotar/proteger; no pegar en claro en chat.
