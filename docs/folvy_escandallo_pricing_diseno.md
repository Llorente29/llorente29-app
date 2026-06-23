# Folvy — Escandallo, coste y pricing (diseño)

> Estado: hueco 1 cerrado (deuda 0). Huecos 2 y 3 con el "cómo" diseñado, pendientes de cerrar el detalle antes de construir.
> Método seguido: RECON contra fuente primaria (BBDD + repo) → benchmark del mejor → diseño → (medir tras construir).
> Folvy es para toda la hostelería. La sala/barra/terraza (canales dine_in) pesan igual que el delivery; el packaging en sala es 0 € y en delivery suma.

---

## 1. Punto de partida — qué motor existe ya (RECON)

El motor escandallo→coste→compras→stock está construido y cableado a la UI. No se reescribe; se completa.

**Coste de comida, exacto al céntimo.** Cadena ingrediente → sub-receta → plato con recosteo en cascada (`cascadeFromItem` / `recomputeItemAndAncestors` en `costCascadeService.ts`), anti-bucles (`recipe_line_prevent_cycle`), recálculo automático ante cualquier cambio de línea. Coste siempre server-side (SQL), nunca cliente. `recipe_line` es autorreferencial: `parent_item_id` (plato) → `child_item_id` (ingrediente o sub-receta).

**Margen real por canal.** `menu_item_channel_economics(p_menu_item_id, p_overrides)` calcula, por canal, el margen restando comisión (`brand_channel_rate` override > `channel_rate` defecto) y costes de pedido (reparto propio). Devuelve `contribution_margin`, `net_margin`, `food_cost_pct`, `target_food_cost_pct` (de `kitchen_settings`), `food_cost_status`. Gemelo para listas: `menu_item_economics(p_brand_id, p_service_type)`. Servicio front: `menuOverrideService.ts`.

**Factura/proveedor → coste.** `apply_invoice_costs` / `price_drift_for` / `trg_article_supplier_recompute_cost`: al entrar una factura, el coste del ingrediente se actualiza y recostea solo todos los platos que lo usan.

**Venta → consumo → stock.** `recompute_sales_consumption`, `compute_sale_line_cost`, `explode_recipe_to_raws`.

### Los tres huecos reales

1. **Packaging fuera del margen.** `menu_item` tiene `packaging_cost` (numeric) y `packaging_description` (text), pero el motor de margen NO lo resta → el margen sale inflado. Además se teclea a mano por plato (no escala, no se actualiza desde compras).
2. **No hay PVP recomendado.** El motor audita hacia adelante (precio → margen). No calcula hacia atrás (coste + objetivo + comisión → a cuánto vender). Sin esto, Folvy es una auditoría de precios, no una herramienta de pricing.
3. **No hay mano de obra (prime cost).** El coste es solo producto. Falta la capa de labor para la foto completa.

---

## 2. Benchmark — cómo lo hacen los mejores

Verificado contra R365, Toast/TouchBistro, ChowNow, KitchenCost, Visual Veggies, calculadoras de comisión de delivery (2026).

**Packaging — unánime: entra en el coste, siempre.** Dejarlo fuera infla el beneficio falsamente. La contabilidad seria de restauración desglosa el prime cost en **comida + papel + mano de obra**; "paper" (o "paper & packaging") es la categoría reconocida para envases y desechables. Referencia: prime cost (comida + papel + labor) ≤ 60% de ventas netas. La fórmula de contribución de delivery del sector: `contribución = subtotal − deducciones de plataforma − food cost − packaging − labor de canal − promos − devoluciones`.

**PVP inverso — estándar, con fórmula.** Método markup/factor: `precio = food cost ÷ food_cost_objetivo`. Método margen bruto: `precio = coste ÷ (1 − margen_deseado)`. Dos refinamientos no negociables:
- **Por categoría, no plano.** Un markup 3x trata igual un aperitivo de 2 € que un principal de 8 €. Las bebidas aguantan más margen que los principales. El objetivo debe poder variar por categoría.
- **Redondeo psicológico.** Se redondea al alza al precio "bonito" (16,67 → 16,90 / 17,00).

**PVP de delivery — el diferenciador.** El sector lo hace a ojo ("delivery +10-15% sobre sala"). Eso es un parche. El cálculo correcto despeja el precio para que el margen objetivo aguante **después** de la comisión, y por eso es **distinto por canal**:
`PVP_canal = (coste + packaging) ÷ (1 − food_cost_objetivo − comisión%)`.
Folvy gana aquí porque ya tiene el motor de comisiones por canal: calcula bien lo que el sector estima a ojo.

**Prime cost (labor) — capa avanzada y aparte.** Los serios suben de food cost a prime cost = comida + mano de obra directa, y despejan el precio sobre ese total (p. ej. 40% food + 8% labor = 48%). La mano de obra es **estimación** (minutos × coste/hora), no dato exacto → se trata como capa separada y marcada, nunca mezclada con el coste exacto del escandallo. No confundir packaging con prime cost: packaging es "paper", prime cost incluye labor.

**Veredicto que gobierna el diseño:** el delivery se juzga por contribución por canal, no por ventas brutas — que es justo lo que el motor de Folvy ya hace. Solo le falta meter el packaging dentro y calcular el precio hacia atrás.

---

## 3. Nomenclatura (cerrada)

Términos del sector, ninguno inventado, coherentes con el resto de Folvy (food cost, KDS, 86):

| Concepto | Nombre en Folvy | Qué es |
|---|---|---|
| Coste de comida | **Food cost** | Solo comida (raw + sub-recetas). Indicador de cocina, con semáforo. |
| Coste de envases | **Packaging** | Desechables ("paper" en el sector). Línea propia. |
| Coste total del plato | **Plate cost** | Food cost + packaging. Término estándar del sector. |
| + mano de obra | **Prime cost** | Plate cost + labor. Hueco 3. Capa estimada y marcada. |

En pantalla se usa "Packaging" (más claro en español que "paper").

---

## 4. Hueco 1 — Packaging en el coste y el margen (CERRADO, deuda 0)

### 4.1 Escandallo en tres secciones

La pestaña Escandallo del editor pasa de una lista plana a **tres bloques**, agrupando el mismo `recipe_line` por la naturaleza del hijo (`child_item.type`), cada uno con su botón "+ Añadir":

- **Ingredientes** — `child.type = 'raw'`
- **Sub-recetas** — `child.type = 'recipe'`
- **Packaging** — `child.type = 'packaging'`

Resuelve cuatro cosas a la vez: orden mental del cocinero, packaging como artículo, food cost limpio, y clasificación correcta en la importación (la IA deja de aplanar todo a `raw`).

**Cambio de esquema:** `recipe_item.type` admite hoy `'raw','recipe','tool','dish'`. Se añade `'packaging'` al CHECK constraint. Cambio trivial y honesto.

### 4.2 Packaging = artículo (no campo de ficha)

Cada envase es un `recipe_item` `type='packaging'` con su proveedor y coste. Se da de alta **una vez**, se recostea solo desde factura (como cualquier ingrediente), y se añade como **línea de receta** a los platos que lo usan. Así:
- Ya entra en `recipe_item.computed_cost` → el coste del plato lo incluye sin tocar el motor de margen.
- Si sube el precio de las cajas, se cambia en el artículo y recostea todos los platos solos. Cero teclear por plato.

El campo `menu_item.packaging_cost` / `packaging_description` queda obsoleto para el cálculo (migración/limpieza a definir al construir; no se borra dato sin verificar uso).

### 4.3 Plantilla de embalaje (herencia viva)

Un set de envases con nombre, reutilizable, para no montar el packaging plato a plato (429 platos en el cliente laboratorio).

- **Modelo:** `packaging_template` (nombre, ámbito) + líneas (`packaging_item_id`, cantidad).
- **Ámbito:** por **marca + categoría** (p. ej. "Bowls de Ay Mamita", "Burgers de Meraki"). Defecto de cuenta donde no haya plantilla específica.
- **Aplicación:** al crear o importar un plato, si su marca/categoría tiene plantilla, se siembran sus líneas de packaging en la sección Packaging, marcadas "heredado de plantilla".
- **Herencia viva con override:** cambiar la plantilla (añadir envase, cambiar caja) se refleja en todos los platos que la usan, salvo los que tengan override por plato. Un plato especial quita/cambia su línea y queda marcado "modificado", sin afectar a la plantilla ni a los demás.
- **Gestión:** zona "Plantillas de packaging" en Ajustes de Kitchen, + selector en marca/categoría.

### 4.4 Panel de coste en vivo

Cada línea con € y % sobre PVP. Food cost limpio (solo comida) con su semáforo; plate cost (con packaging) con el suyo.

```
COSTE EN VIVO

Comida              2,97 €    (21%)
Packaging           0,30 €     (2%)
─────────────────────────────────
Plate cost          3,27 €    (23%)

Food cost           21%   vs objetivo 30%   ← semáforo (solo comida)
Plate cost          23%   vs objetivo 33%   ← semáforo (con packaging)

MARGEN POR CANAL (sobre plate cost)
Sala                9,63 €
Glovo −30%          5,38 €
Uber  −28%          5,95 €
```

El margen por canal se calcula sobre **plate cost** (ya con packaging) → arregla el margen inflado. En sala el packaging es 0 → plate cost = food cost.

### 4.5 Dos objetivos, por marca/categoría con defecto de cuenta

- `target_food_cost_pct` (ya existe en `kitchen_settings`) — vigila la cocina.
- `target_plate_cost_pct` (nuevo) — vigila el coste del plato entregado.

**Por marca/categoría con defecto de cuenta** (mismo patrón defecto+override que las comisiones por canal). Deuda 0: se diseña entero, no se deja "por categoría" como fase 2 — el benchmark exige objetivo por categoría, no plano. Modelo: defecto en `kitchen_settings`; override por marca/categoría donde difiera.

**Quién los fija:** el cliente (manager/admin) en Ajustes de Kitchen. Es una decisión de negocio suya (cuánto quiere ganar). Folvy pone defaults en onboarding: **food cost 30% / plate cost 33%** (deja ~3 puntos de packaging; en sala el plate cost tiende al food cost). El cliente los ajusta.

### 4.6 Implicación en el motor (resumen técnico)

- Esquema: `recipe_item.type` += `'packaging'`; tabla `packaging_template` + líneas; `kitchen_settings.target_plate_cost_pct` + tabla/columnas de override por marca/categoría.
- Coste: el plate cost ya sale de sumar líneas (incluye packaging). Hay que **desglosar** cuánto del coste es comida vs packaging para mostrar las líneas separadas y mantener el food cost % limpio.
- Margen: `menu_item_channel_economics` y `menu_item_economics` calculan margen sobre **plate cost**, y devuelven `food_cost_pct` (solo comida) y `plate_cost_pct` (con packaging), cada uno con su `*_status` vs su objetivo.
- UI: editor con tres secciones; panel con renglón Packaging + Plate cost + segundo semáforo; Ajustes con plantillas y objetivos.
- Tras tocar esquema: regenerar `src/types/database.ts`.

---

## 5. Hueco 2 — PVP recomendado por canal (cómo diseñado, detalle pendiente)

Convierte Folvy de auditoría a herramienta de pricing. El precio es **salida**, no entrada.

**Fórmula base:** `PVP_canal = plate_cost ÷ (1 − food_cost_objetivo − comisión%_canal)`, donde `plate_cost = comida + packaging`.

- **Por canal:** la comisión difiere (sala 0%, Glovo ~30%, Uber ~28%) → precio distinto por canal para igual margen objetivo. Folvy lo calcula bien porque ya tiene el motor de comisiones por canal.
- **Por categoría:** el objetivo (food/plate cost) varía por categoría (bebida ≠ principal). Reutiliza los objetivos por marca/categoría del hueco 1.
- **Redondeo psicológico:** redondeo al alza configurable (al 0,10 / 0,50 / entero).

**Pendiente de cerrar antes de construir:** sobre qué objetivo se despeja (food cost o plate cost — probablemente plate cost para delivery), UI (¿sugerencia editable junto al precio actual? ¿aviso si el precio vigente queda por debajo del objetivo?), y cómo conviven precio recomendado y precio real por canal (`menu_item_override`).

---

## 6. Hueco 3 — Prime cost / mano de obra (cómo diseñado, último)

Cuarta línea en el panel, **marcada como estimación**, debajo del plate cost:

```
Plate cost          3,27 €    (23%)    ← exacto, medido
Mano de obra       ~1,10 €     (8%)    ← estimación (min × coste/h)
─────────────────────────────────
Prime cost         ~4,37 €    (31%)    ← con mano de obra
```

- **Piezas en BBDD:** `location_labor_cost`, `indirect_cost_pct`, tiempos de prep en `recipe_item`.
- **Dato a poblar:** minutos de mano de obra por plato (× 429 platos en el laboratorio) + coste/hora real del local.
- **Anti-invención:** la mano de obra es estimación, se separa visualmente (`~`, etiqueta "estimación") del coste exacto. No se enciende hasta tener los datos fiables (deuda 0: no mostrar un prime cost inventado).
- **Efecto en el hueco 2:** el PVP recomendado podrá ofrecer dos modos — "cubrir plate cost" y "cubrir prime cost".

**Pendiente:** modelo de captura de minutos por plato, y la capa de objetivo de prime cost.

---

## 7. Orden de construcción

1. **Hueco 1** — packaging (tres secciones + artículo + plantilla + panel + dos objetivos). Base de todo; arregla la mentira del margen.
2. **Hueco 2** — PVP recomendado por canal sobre plate cost.
3. **Hueco 3** — prime cost / labor, capa estimada marcada.

De este documento salen los tramos de construcción del hueco 1.
