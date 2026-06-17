# Folvy — AvT (Teórico vs Real) · Diseño

> Frente del módulo Almacén, sección "Teórico vs Real". El gran diferenciador de
> control de food cost. Documento de diseño; se construye por capas.
> RECON + benchmark hechos el 2026-06-17.

## 0. Qué es y por qué importa

El AvT (Actual vs Theoretical, "Teórico vs Real") compara, por artículo y periodo:

- **Teórico**: lo que el sistema *cree* que tienes = stock inicial + compras − consumo
  por escandallo. Folvy ya lo tiene vivo (ventas × escandallo → ledger `consumo`).
- **Real**: lo que un humano *cuenta* físicamente (conteo de inventario cerrado).
- **Desviación (merma)**: teórico − real. En €, es dinero que se evaporó sin venta:
  sobre-porción, caducidad, robo, error de recepción, o escandallo mal hecho.

Es la métrica reina del food cost. Los líderes apuntan a variance < 2-3%; lo importante
no es el número absoluto sino la **tendencia** (¿se estrecha o se ensancha?).

## 1. RECON (estado real, 2026-06-17)

- **Teórico**: VIVO. `compute_sale_line_consumption` + `recompute_sales_consumption`
  escriben movimientos `consumo` (ventas × escandallo). `listConsumptionByRaw` ya lista
  el consumo por ingrediente/local/periodo (es la base de la pestaña actual).
- **Real**: conteos de inventario. Hay AL MENOS uno `aprobado` con `closed_at` y líneas
  contadas (Foodint Alcalá, 15/06, 10 líneas). Son `cycle` (parciales/rotativos del
  autoinventario), no inventarios completos → el AvT cubre los artículos contados, no
  todos a la vez. Eso es CORRECTO en modelo rotativo; el diseño lo refleja con honestidad.
- **Ledger**: `stock_movement` con tipos consumo/recepcion/ajuste/apertura/merma/traspaso;
  `qty_base` con signo; `unit_cost`. Stock por local en `recipe_item_location_stock`
  (`qty_on_hand`, `avg_unit_cost` → permite valorar en €).
- **Merma**: `register_waste` + `stock_waste` (causa). Es una salida conocida y explicada
  → NO es "desviación inexplicada", se descuenta del misterio.
- **Saneamiento en curso**: stock negativo en varios artículos (escandallos en ajuste).
  El AvT debe sobrevivir a datos imperfectos sin mentir.

## 2. Benchmark (qué hacen los líderes y dónde fallan)

- **Apicbase**: variance por outlet × categoría contable, dashboard "Count Variance" con
  filtros (fecha, local, categoría/subcategoría), precios reales por local.
- **MarketMan**: el más rico en métricas — uso teórico, uso real, varianza, varianza
  INEXPLICADA, merma, % eficiencia, todo en cantidad Y en €, y como % de ventas. Exige
  ≥2 inventarios (modelo por periodo puro).
- **Crunchtime**: clave — ranking de ingredientes por mayor varianza en €, investigación
  desde el local más desviado; foco en recepción/factura/preparación.
- **MarketMan/ClearCOGS (multi-unidad)**: lo más valioso a escala NO es el agregado, es la
  COMPARACIÓN ENTRE LOCALES (qué unidad se desvía, en qué artículo).

**Huecos donde Folvy golea (deuda-0, no clonar):**
1. Todos EXIGEN el dato pero no lo CURAN ni avisan si falta → dan números aunque sean
   basura. Folvy añade SALUD DEL DATO: números honestos o ningún número.
2. No explican el PORQUÉ más allá de "merma/robo/porción". Folvy distingue causa:
   merma real (hay waste) vs dato incompleto (stock negativo, falta compra) vs escandallo
   no fiable.
3. El AvT vive separado (recetas, compras, POS en sistemas distintos). Folvy ya tiene
   todo en uno (escandallo al céntimo + ledger + recepción + autoinventario IA).

## 3. Diseño — 4 piezas

### 3.1 Un motor, cinco niveles de zoom
La misma desviación se agrega/desglosa por: **Cuenta → Local → Almacén/zona → Familia →
Artículo**. Métricas por fila (estilo MarketMan, superándolo en claridad):
teórico (€ y qty), real (€ y qty), desviación (€ y %), y para el detalle: merma conocida,
desviación inexplicada (= desviación − merma). El % se expresa sobre el teórico y, donde
haya ventas del periodo, también como % de ventas.

### 3.2 Dos modos en cada nivel
- **Puntual** (capa 1): stock teórico HOY (saldo del ledger) − último conteo real cerrado
  de ese artículo/local. Foto al momento. Vale con UN conteo. Da valor ya.
- **Por periodo** (capa posterior): entre dos conteos cerrados. conteo inicial + compras
  − consumo = teórico final; teórico final − conteo final = merma del periodo. El AvT
  contable serio. Necesita 2 conteos cerrados.

### 3.3 El porqué de cada desviación (clasificación de causa)
Por artículo, ordenado por € perdido (Crunchtime), cada línea lleva una ETIQUETA de causa:
- **Merma real**: existe `stock_waste` que explica (parte de) la desviación.
- **Stock negativo / dato incompleto**: saldo teórico < 0 → falta registrar compras o el
  escandallo descuenta de más. No es merma, es dato que arreglar.
- **Escandallo no fiable**: el plato que consume este artículo tiene escandallo dudoso
  (sin líneas, needs_review, coste 0) → el teórico de este artículo no es de fiar.
- **Sin clasificar**: desviación inexplicada genuina → candidata a investigar (porción/robo).

### 3.4 Salud del dato (★ diferenciador mayor)
Antes de mostrar números, Folvy declara la fiabilidad del AvT del ámbito elegido:
cobertura (cuántos artículos tienen conteo real reciente vs total), nº en stock negativo,
nº de platos sin escandallo fiable, antigüedad del último conteo. Resumen: Buena / Parcial
/ Sin conteo. Coherente con "IA propone, humano decide" y "la verdad del margen".

## 4. Plan por capas

- **Capa 1 (AHORA)**: AvT PUNTUAL a nivel ARTÍCULO × LOCAL. Tabla: artículo · teórico hoy
  (qty+€) · real (último conteo, qty+€+fecha) · desviación (€+%) · etiqueta de causa.
  Ordenado por € de desviación. Cabecera con salud del dato del local. Reemplaza/expande
  la `ConsumptionSection` actual (que se queda como sub-vista "solo consumo" o se integra).
- **Capa 2**: clasificación de causa fina (cruce con stock_waste, stock negativo, escandallo).
- **Capa 3**: consolidado por LOCAL (comparación entre locales) + niveles familia/almacén.
- **Capa 4**: modo POR PERIODO (entre dos conteos) + tendencia (¿variance se estrecha?).
- **Capa 5**: informes exportables / consolidado de cuenta.

## 5. Notas técnicas (para construcción)
- Real = último `inventory_count` con `status='aprobado'` y `closed_at` no nulo del local;
  sus líneas `inventory_count_line.counted_qty`. Cobertura = artículos con línea contada.
- Teórico hoy = `recipe_item_location_stock.qty_on_hand` (saldo vivo del ledger) por
  artículo/local; valorar con `avg_unit_cost`.
  OJO: el "teórico puntual" compara el saldo de AHORA con un conteo PASADO; la lectura
  correcta es "desde aquel conteo, el teórico dice X y la última realidad fue Y". El modo
  por periodo (capa 4) es el riguroso; la capa 1 es la foto útil pero menos estricta.
- Valoración SIEMPRE server-side (coherente con la regla de coste de Folvy).
- Multi-local y precios por local: aplicar el coste real de CADA local (no blended), como
  recomienda Apicbase, para no confundir diferencia de precio con problema operativo.
- Acceso por local (RLS) es FRENTE APARTE (hoy el control es solo por cuenta); el AvT
  consolidado multi-local deberá respetarlo cuando exista.
