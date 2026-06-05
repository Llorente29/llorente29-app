# Benchmark: Modificadores, Combos y Consumo de Inventario
## Cómo lo resuelven los SaaS más avanzados de hostelería

**Fecha:** 5 junio 2026  
**Contexto:** Decisión arquitectónica para la Capa 2 (Consumo) de Folvy Supply  
**Pregunta central:** ¿Normalizar en ingesta (webhook amplía sale_line) o explotar en runtime desde raw_products (JSON)?

---

## 1. Resumen ejecutivo

Todos los SaaS líderes (Toast/xtraCHEF, R365, Crunchtime, MarketMan, Apicbase, Lightspeed) resuelven el problema de la misma manera fundamental: **normalizan los modificadores y combos en la capa de ingesta, ANTES de que el motor de consumo/inventario los toque.** Ninguno parsea JSON crudo del TPV en el momento de calcular el consumo teórico. El patrón universal es:

1. **Ingesta:** El TPV envía productos + modificadores + combos.
2. **Normalización:** El sistema los convierte a su modelo interno (menu items / recipe items mapeados).
3. **Mapeo a receta:** Cada entidad normalizada se enlaza a una receta o ingrediente con porción definida.
4. **Explosión/Depleción:** El motor de inventario explota las recetas mapeadas para deducir ingredientes del stock. El motor NO sabe de qué TPV vienen los datos.

La diferencia entre plataformas está en CÓMO normalizan, no en SI normalizan.

---

## 2. Análisis por plataforma

### 2.1 Toast / xtraCHEF (el referente de AP + coste)

**Arquitectura de la cadena:**

- Toast POS sincroniza menu items Y modifiers (incluyendo nested modifiers) a xtraCHEF como entidades separadas.
- xtraCHEF tiene una pantalla explícita de **"Product Mix Mapping"** con dos secciones: **Menu Item Mapping** (producto → receta) y **Modifier Mapping** (modificador → producto/ingrediente/prep recipe + porción).
- Los modifiers mapeados se enlazan a un Product (ingrediente) o Prep Recipe con una cantidad y unidad de medida específicas.
- Para modificadores que RESTAN un ingrediente, existe un toggle **"Subtract"** — en vez de sumar consumo, lo resta de la receta base.
- **Nested modifiers** (sub-modificadores dentro de un modificador) están soportados y se despliegan de la misma manera para inventario y AvT.

**Motor de depleción:**

- La depleción es a nivel ingrediente, en tiempo real (o nightly batch según configuración).
- El AvT (Actual vs Theoretical) solo se activa cuando Product Mix Mapping está completo — sin mapeo, no hay reporte.
- Los reports "Depleting Inventory", "Product Mix Report" y "Actual vs. Theoretical Analysis" dependen todos del mapeo normalizado.

**Modelo conceptual:**

```
Toast POS
  ├── Menu Item "Smash Burger"         → xtraCHEF Recipe "Smash Burger"
  ├── Modifier "Extra Cheese" (+1.50)  → xtraCHEF Product "Cheddar" (30g, ADD)
  ├── Modifier "No Pickles"            → xtraCHEF Product "Pickles" (15g, SUBTRACT)
  └── Modifier "Bacon" (+2.00)         → xtraCHEF Prep Recipe "Bacon Strip" (2 strips)
```

**Hallazgo clave:** xtraCHEF separa completamente el dato de ventas (Toast) del dato de coste/inventario (xtraCHEF). El Product Mix Mapping es el puente. Es un **mapping manual por el operador** — no automático. Toast no adivina qué receta va con qué modificador.

---

### 2.2 Restaurant365 (R365) — el referente de gestión integral

**Arquitectura de la cadena:**

R365 tiene el sistema más sofisticado de normalización de modificadores del mercado: **POS Menu Item Modifier Management** (también llamado "Menu Item Concatenation").

- El principio base: **los modificadores del POS se importan a R365 como Menu Items regulares.** Un modificador = un menu item = se enlaza a una receta = depleta ingredientes por la porción definida.
- **Problema que resuelve la concatenación:** un modificador genérico ("No Tomato") significa cosas distintas según el plato padre (ensalada vs burger vs sandwich). Si solo puedes enlazar un modificador a UNA receta, calculas mal.
- **Solución — 3 modos por categoría de ventas del POS:**
  1. **"Concatenate":** R365 genera automáticamente nuevos menu items concatenados: "Smash Burger + No Tomato", "Caesar Salad + No Tomato". Cada combinación se enlaza a su propia receta diferenciada. Es la opción más precisa.
  2. **"Modifier Only":** el modificador entra como menu item independiente con una sola receta. Sirve para modificadores universales que no dependen del contexto (ej: "Extra Bacon" siempre son 2 tiras).
  3. **"Inactive":** el modificador se ignora para inventario.
- La configuración se hace **por ubicación** (configurable por location), lo que permite que diferentes conceptos tengan reglas distintas.
- Es un **add-on de pago** y requiere una worksheet de configuración inicial con soporte de R365.

**Motor de depleción:**

- "Theoretical Depletion": cada venta del POS explota las recetas mapeadas de sus menu items + sus modifiers concatenados. El resultado es el uso teórico por ingrediente.
- Soporta sub-recetas (Recipe Items) ilimitadas en profundidad.
- La formula AvT = Uso real (inventario inicio − inventario fin + compras) vs Uso teórico (suma de explosiones).

**Hallazgo clave:** R365 resuelve el problema del **modificador contextual** (el mismo nombre de modifier tiene efecto distinto según el plato) mediante la concatenación automática. Esto es lo más avanzado del mercado. Pero tiene un coste: explosión combinatoria de menu items.

---

### 2.3 Crunchtime (el referente enterprise de cadenas)

**Arquitectura de la cadena:**

- Crunchtime usa el concepto de **"POS Decrement"** con dos tipos:
  1. **Component Decrement:** la venta explota la receta del menu item y depleta cada ingrediente individualmente. Es el modo para productos compuestos (burger, cocktail, plato).
  2. **Item Decrement:** el menu item entero se trata como un producto de inventario y se depleta como unidad. Es para productos comprados ya terminados (ej: postre de proveedor).
- Los recipes se crean específicamente **"for the purpose of inventory depletion"** — la receta en Crunchtime es un artefacto de inventario, no un documento culinario.
- El **Menu Mix Service** es la pieza de integración que conecta ventas POS con recetas.
- Crunchtime diferencia entre producción **"To Order"** (se fabrica al vender, como una burger) y **"Production"** (se fabrica en batch, como una salsa).

**Motor de depleción:**

- Depleción en tiempo real, cada vez que un cliente hace un pedido.
- El sistema rastrea el uso de componentes a través de integración POS y genera prep sheets automáticos.
- Suggested prep basado en forecast de ventas.

**Hallazgo clave:** Crunchtime distingue entre recetas "culinarias" (la del chef, con instrucciones) y recetas "de inventario" (la BOM que explota ingredientes). Son dos vistas del mismo dato. Para hostelería enterprise, esta separación es fundamental porque el chef y el controller necesitan perspectivas distintas.

---

### 2.4 MarketMan (el referente mid-market)

**Arquitectura de la cadena:**

- MarketMan se conecta a 60+ POS vía API.
- El POS envía la venta con sus items y modifiers normalizados.
- MarketMan hace **"ingredient-level tracking"**: cada venta depleta ingredientes individualmente según la receta (que MarketMan llama "Cookbook").
- **Modifiers y substitutions se rastrean completamente:** "burger con extra queso, sin cebolla y con bacon" depleta correctamente — más cheddar, menos cebolla, más bacon vs la receta base.
- El mapeo de POS items a recetas de MarketMan es manual/configurado.

**Motor de depleción:**

- Automático en cada venta registrada por el POS.
- Genera alertas de stock bajo y órdenes automáticas cuando el stock baja de par level.
- Reportes de profitabilidad que muestran qué modificadores son populares y su impacto en coste.

**Hallazgo clave:** MarketMan enfatiza que el tracking de modificadores no es solo para inventario sino para **insights de negocio** — saber qué extras son populares, cuáles aumentan o reducen el margen, y cómo afectan al forecasting. El modifier es dato de negocio, no solo dato de stock.

---

### 2.5 Apicbase (el referente europeo de F&B management)

**Arquitectura de la cadena:**

- Apicbase se conecta al POS (Lightspeed, Untill, Deliverect, HubRise, etc.).
- Los PLUs del POS se enlazan a recetas de Apicbase en una pantalla de **"POS Linking"**.
- La depleción baja **"down to the raw materials"** — si un plato usa una sub-receta (salsa, masa), Apicbase explota recursivamente hasta llegar a ingredientes comprados.
- Las sub-recetas ("semi-finished products") tienen su propio tracking: al producirlas, los ingredientes salen del stock y la sub-receta entra como producto intermedio.
- La sincronización con POS es **nightly** (no real-time) — decisión deliberada para estabilidad operativa.

**Motor de depleción:**

- **Theoretical stock** = inventario calculado a partir de: stock inicial + compras − depleción por ventas (POS) − waste registrado.
- **Actual stock** = conteo físico.
- Varianza = Actual − Theoretical → señala waste, theft, over-portioning.
- Tiene un indicador de "POS Linking Health" que muestra qué % de los PLUs están enlazados a recetas — el objetivo es 100%.

**Hallazgo clave:** Apicbase hace la depleción nightly, no real-time. Esto simplifica la arquitectura (batch process vs event-driven) y es suficiente para el 99% de los casos de uso de hostelería (no eres Amazon con warehouse robotizado; el inventario se reconcilia diariamente o semanalmente).

---

### 2.6 Lightspeed Restaurant (K-Series / O-Series)

**Arquitectura de la cadena:**

- Lightspeed tiene inventario nativo (no necesita terceros, aunque se integra con MarketMan, R365, WISK, BevSpot).
- Las recetas son de dos tipos: **"Made to order"** (se depleta al vender) y **"Made in batches"** (se depleta al producir).
- El enlace es directo: producto que vendes → receta → ingredientes que depleta.
- Soporta yield, batch sizes, y cascada de costes (Recipe Cost → Average Cost Price → Fixed Cost Price).

**Motor de depleción:**

- Real-time para "made to order".
- Para batches: el production planning depleta los ingredientes y añade el producto intermedio al stock.
- Reportes de varianza y gross profit por item.

**Hallazgo clave:** Lightspeed demuestra que el modelo básico "item vendido → receta → ingredientes" es funcional incluso sin un sistema de concatenación de modificadores como R365. La diferencia está en la precisión del AvT: si no modelas los modifiers, tu teórico es menos preciso.

---

### 2.7 Deliverect / UrbanPiper (los agregadores de delivery)

Estos no son sistemas de inventario, pero son relevantes porque **son la capa de normalización** entre plataformas de delivery y el POS/back-office.

- **Deliverect:** recibe pedidos de Uber Eats/Glovo/DoorDash/etc., los **normaliza** al formato del POS del restaurante, e inyecta el pedido en el POS con productos y modificadores mapeados. El operador configura el mapeo de items y modifiers de cada plataforma al catálogo del POS.
- **UrbanPiper:** mismo modelo — middleware que normaliza entre plataformas y POS, con mapeo de menu items y modificadores. Soporte para real-time stock sync (si un item se agota en el POS, se marca unavailable en todas las plataformas).

**Hallazgo clave:** La industria resuelve la heterogeneidad de plataformas (Glovo, Uber, JustEat, TPV sala, TPV barra) con una **capa de normalización intermedia** que traduce cada fuente a un modelo canónico interno. Este es exactamente el problema que Folvy enfrenta con Last.app hoy y con N fuentes mañana.

---

## 3. Patrones universales identificados

### Patrón 1: Normalización en ingesta, NUNCA parsing en runtime

Ninguna plataforma seria parsea el JSON crudo del TPV al calcular consumo teórico o deplecionar inventario. El flujo es siempre:

```
FUENTE (TPV/delivery) → NORMALIZACIÓN (capa de ingesta) → MODELO INTERNO → EXPLOSIÓN (motor de consumo)
```

**Por qué:** el motor de consumo debe ser agnóstico de la fuente. Si mañana cambias de TPV (Last.app → Revo → TPV propio), no reescribes el motor. Solo reescribes el adaptador de ingesta.

### Patrón 2: Modificador = entidad de primer nivel, no metadata

En todos los sistemas avanzados, un modifier es un **item mapeado a una receta** (o ingrediente + porción), no un texto informativo pegado a una venta. Los modificadores que no están mapeados no generan consumo (y eso es un agujero de precisión declarado).

### Patrón 3: Tres operaciones sobre la receta base

Todos los sistemas soportan al menos 3 operaciones de modificación:

| Operación | Ejemplo | Efecto en consumo |
|---|---|---|
| **ADD** | Extra cheese | + ingrediente / + porción |
| **SUBTRACT / REMOVE** | No pickles | − ingrediente de la receta base |
| **SWAP / SUBSTITUTE** | Pollo → Ternera (Milanesa House) | − ingrediente A + ingrediente B |

R365 añade una cuarta: **CONTEXT-DEPENDENT** (el mismo modifier tiene efecto distinto según el plato padre) → resuelto con concatenación.

### Patrón 4: Combo = explosión de sub-items, cada uno con su receta

Un combo ("Combo Burger Single") no tiene receta propia. El combo tiene sub-productos, cada uno con su receta + sus propios modifiers. El consumo = suma de las explosiones de cada sub-producto.

### Patrón 5: Mapeo manual es la norma, no un defecto

En TODAS las plataformas, el operador (o su equipo) configura manualmente el mapeo de items del POS a recetas del back-office. No es automático. La razón: el POS y el back-office tienen ontologías distintas (el POS tiene "Smash Burger Menu" como un item; el back-office tiene 3 recetas y 5 modificadores detrás).

### Patrón 6: Timing — real-time vs batch

| Plataforma | Timing de depleción |
|---|---|
| Crunchtime | Real-time (cada venta) |
| MarketMan | Real-time (cada venta) |
| Toast/xtraCHEF | Configurable (real-time o nightly) |
| R365 | Batch (periódico) |
| Apicbase | **Nightly** (decisión deliberada de estabilidad) |
| Lightspeed | Real-time para made-to-order |

Para Folvy: el inventario perpetuo de hostelería NO necesita real-time al milisegundo. Un batch cada hora o diario (como Apicbase) es suficiente y mucho más robusto. El real-time es para KDS/pedido instantáneo (otro módulo), no para stock.

---

## 4. Aplicación a Folvy: recomendación arquitectónica

### El veredicto es claro: NORMALIZAR EN INGESTA (opción B)

La industria es unánime. Las razones son técnicas y estratégicas:

**Razones técnicas:**
- El motor de consumo NO debe saber de JSON de Last.app (ni de Glovo, ni de Uber, ni del TPV propio futuro).
- La normalización una vez vs parsing N veces por cada cálculo.
- Los modificadores son entidades de negocio (tienen receta, porción, coste) — no texto descriptivo.

**Razones estratégicas:**
- Folvy es multi-TPV por diseño. Hoy Last.app, mañana Revo, Lightspeed, TPV propio.
- Los modificadores como entidades de primer nivel habilitan: analytics de mix (qué extras se piden), coste real por combinación, y forecasting de demanda de ingredientes.
- La concatenación estilo R365 (o una versión simplificada) es un diferenciador que ningún competidor español tiene.

### Modelo propuesto para Folvy (a nivel conceptual)

```
INGESTA (webhook / pull)
  │
  ├── Adaptador Last.app    ───┐
  ├── Adaptador Glovo        ──┤
  ├── Adaptador TPV propio   ──┤
  │                             │
  └── Todos escriben ──────────►  MODELO NORMALIZADO
                                   ├── sale (cabecera)
                                   ├── sale_line (producto, type='product')
                                   ├── sale_line (modifier, type='modifier',
                                   │              parent_sale_line_id, operation=add/remove/swap)
                                   ├── sale_line (combo sub-item, type='combo_item',
                                   │              parent_sale_line_id)
                                   └── Cada sale_line tiene → menu_item_id → recipe_item_id
                                   
MOTOR DE CONSUMO (batch o near-real-time)
  │
  ├── Lee sale_lines normalizadas
  ├── Explota: producto base → receta → recipe_lines → ingredientes (recursivo si sub-recetas)
  ├── Aplica modifiers: ADD (+qty), REMOVE (−qty), SWAP (−A +B)
  ├── Divide por yield_portions si > 1
  ├── Convierte unidades a base (misma lógica que kitchen_recompute_item)
  └── Escribe stock_movement type='consumo', source_type='sale_line'
```

### Decisiones pendientes para el diseño

1. **¿Ampliar sale_line o tabla nueva?** Ampliar sale_line (añadir parent_sale_line_id, line_type, modifier_operation) es más limpio y reutiliza RLS/índices. Tabla nueva separa responsabilidades pero añade JOINs.

2. **¿Mapeo modifier → receta se guarda dónde?** Opciones: (a) el modifier como menu_item con su recipe_item_id (como R365: modifier = menu item regular); (b) tabla nueva de "modifier definitions" con receta + porción + operación; (c) dentro de recipe_item como tipo 'modifier'.

3. **¿Timing del batch de consumo?** Apicbase dice nightly y funciona para 45.000+ locales. Folvy puede arrancar nightly e ir a hourly si se necesita.

4. **¿Qué pasa con modificadores sin mapear?** Igual que todos los competidores: se ignoran para inventario y se marcan como "coverage gap". El KPI de "% de facturación con cobertura de depleción" es clave.

5. **¿El webhook de Last.app se toca ahora o se hace post-procesado?** Si normalizar en ingesta, lo limpio es que el webhook ya escriba sale_lines desglosadas. Esto requiere tocar `lastapp-webhook`.

---

## 5. Tabla resumen comparativa

| Aspecto | Toast/xtraCHEF | R365 | Crunchtime | MarketMan | Apicbase | Lightspeed |
|---|---|---|---|---|---|---|
| Normaliza en ingesta | ✅ Sync POS→xtraCHEF | ✅ POS→R365 menu items | ✅ POS→Menu Mix | ✅ POS API→MarketMan | ✅ POS→Apicbase PLU link | ✅ Nativo |
| Modifier = entidad | ✅ Product/Prep Recipe | ✅ Menu Item regular | ✅ Recipe component | ✅ Ingredient-level | ✅ Recipe linkable | Parcial |
| Subtract/Remove | ✅ Toggle Subtract | ✅ Vía receta diferenciada | ✅ Component decrement | ✅ "sin cebolla" depleta | ❓ No documentado | ❓ No documentado |
| Modifier contextual | Parcial (nested) | ✅ Concatenación | ✅ | Parcial | ❓ | ✗ |
| Combos | ✅ Sub-items mapeados | ✅ Menu Item Links | ✅ | ✅ | ✅ Sub-recetas | ✅ |
| Sub-recetas recursivas | ✅ Prep Recipes | ✅ Recipe Items ilimitadas | ✅ | ✅ Cookbook | ✅ Semi-finished | ✅ Batch production |
| Yield/porciones | ✅ En prep recipe | ✅ En recipe | ✅ | ✅ | ✅ | ✅ |
| Timing depleción | Configurable | Batch | Real-time | Real-time | **Nightly** | Real-time (MTO) |
| AvT | ✅ Product Mix Report | ✅ Actual vs Theoretical | ✅ Dashboard AvT | ✅ Variance reports | ✅ Variance Analysis | ✅ |
| Mapeo manual | ✅ | ✅ (+ worksheet soporte) | ✅ | ✅ | ✅ (POS Linking) | ✅ |

---

## 6. Donde Folvy puede GANAR

Con la Capa 2 bien diseñada, Folvy tiene oportunidades que ningún competidor español ofrece hoy:

1. **AvT conectado al margen del plato.** xtraCHEF/R365 calculan AvT como COGS. Folvy YA tiene el eslabón al margen vía C3 (factura → last_price → cascada al escandallo → menu_item_economics). El AvT de Folvy mostrará no solo "cuánto te sobra/falta" sino "cuánto € de margen pierdes por la varianza", por plato.

2. **Modificadores con coste y analytics.** Ningún competidor español (Gstock, Gerentino, Cuiner) modela modificadores con receta y depleción. Folvy puede decirle al operador "el 'Extra Queso' te cuesta 0.35€, lo piden el 40% de las veces, y cobras 1.50€ — tu margen en ese modifier es 76%".

3. **Multi-fuente sin reescribir.** Al normalizar en ingesta con adaptadores, el mismo motor sirve para Last.app, Glovo directo, TPV propio, o cualquier fuente futura. Esto iguala a Deliverect/UrbanPiper como capa de normalización pero con la ventaja de que Folvy TAMBIÉN tiene el back-office de coste/inventario.

4. **Autoinventario IA + AvT = bucle cerrado.** La IA de capa 3 selecciona qué contar basándose en la varianza del AvT de capa 2. Nadie en hostelería cierra este bucle automáticamente.

---

*Documento generado como insumo para la decisión de diseño de la Capa 2 (Consumo) de Folvy Supply.*
*Fuentes: documentación pública de Toast/xtraCHEF, R365, Crunchtime, MarketMan, Apicbase, Lightspeed, Deliverect, UrbanPiper.*
