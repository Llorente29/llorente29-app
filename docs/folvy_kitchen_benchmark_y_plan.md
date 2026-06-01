# Folvy Kitchen — Benchmark mundial + plan para ganar por goleada

**Fecha:** 01/06/2026
**Autor:** Claude (sesión con Julio Gascón, CEO Folvy)
**Ámbito:** EXCLUSIVAMENTE el módulo Kitchen (ingredientes · escandallo/receta · coste · rentabilidad · ingeniería de menús · compras-recepción ligadas al coste). No toca Personal, APPCC, Sales ni plataforma salvo cuando son palanca de goleada del propio Kitchen.
**Propósito:** que el equipo tenga 100% clara (a) cómo lo hacen los mejores en diseño, navegabilidad, solidez, visión comercial y comodidad de uso; (b) dónde está la goleada real de Folvy; (c) la estructura de trabajo para construirla.

## Nota metodológica
- **(D)** = dato verificado (webs/docs oficiales de los productos consultadas el 01/06/2026 + docs de competencia del proyecto del 16/05).
- **(I)** = interpretación de Claude. Opinión razonada, puede equivocarse.
- Principio rector que gobierna todo el documento: **el mercado decide la fórmula base; Folvy va por encima. Un empate NO es victoria, y se mide sobre DATOS REALES (Llorente29), no de laboratorio.**

---

## 0. Tesis central (TL;DR)

No se gana el módulo Kitchen **out-featureando** a gstock/Apicbase en profundidad clásica de back-office: llevan 10 años, tienen IA funcional, OCR, integraciones y reseñas excelentes; ahí Folvy llegaría tarde y peor. **Se gana cambiando el eje de la categoría.**

Toda la categoría calcula **coste TEÓRICO** y, los mejores, la **varianza teórico-vs-real (AvT)**. Folvy ya tiene un activo que ninguno tiene en el mercado español de dark kitchens: **11.894 tickets reales mapeados + escandallo validado al céntimo + comisiones por marca×canal (Capa 2)**. Eso permite pasar de *"coste teórico"* a **margen REAL por mezcla de ventas real, a nivel de modificador, por marca y canal**. Esa es la goleada: no un cálculo más, sino **la verdad del margen** con **fricción de arranque casi nula** (foto→IA + datos ya unidos), **honestidad** (no inventa costes) y **nativo multi-marca España**.

> **Resolución de la tensión con el doc del 16/05** (que decía "Cocina suficientemente buena + ecosistema, no competir con gstock en Cocina pura"): esa conclusión era correcta **en mayo**, cuando Folvy no tenía Kitchen. Hoy la premisa ha cambiado: el Kitchen ya está construido, validado al céntimo y alimentado con ventas reales. La goleada ya no exige ser "más profundo que gstock en back-office clásico" — exige **redefinir qué es el módulo: una máquina de verdad de margen, no una calculadora de coste teórico.** Eso sí es defendible.

---

## 1. Quién es quién en el módulo Kitchen (los referentes reales)

| Producto | Qué es en Kitchen | Posición | Eje fuerte |
|---|---|---|---|
| **Apicbase** (BE) | BoH para cadenas; receta = dato único que propaga a menú/producción/compras/inventario/nutrición/alérgenos/coste | Enterprise, multi-local, catering | Modelo de datos receta-céntrico + IA de generación de recetas |
| **meez** (US) | Recipe-first para chefs; la mejor UX de receta del mercado | Desktop/tablet-first; "complementario, no competitivo" con TPV/back-office | UX de cocinero + base de 2.500+ ingredientes con conversiones/mermas/alérgenos + Cook Mode |
| **Restaurant365** (US) | Coste de receta dentro de un ERP de restauración (contabilidad+inventario+POS) | Enterprise, 40.000+ restaurantes | Varianza Actual-vs-Teórico (AvT) + ingeniería de menús integrada con contabilidad |
| **Galley** (US) | "Culinary Resource Planning" (un ERP de cocina); receta-first | Foodservice/ghost kitchens/catering | Profundidad de modelo de datos (sub-recetas escalan en paralelo, trim yield) + importador IA |
| **gstock** (ES) | Back-office potente: escandallo dinámico recalculado al recibir albarán | Incumbente serio España, precios públicos | Escandallo dinámico + OCR albaranes + IA predicción/pedido + "por hosteleros" |
| **tspoon/tSpoonLab** (ES) | Back-office; el que usa hoy Llorente29 | Incumbente local | Modelo mental del operador español; pero datos monolíticos y UX densa |

(Menciones de vigilancia: **MarketMan/WISK/Supy** — recetas+inventario; **MarginEdge/xtraCHEF** — OCR factura→coste. No son el referente de craft de Kitchen, pero convergen hacia foto→IA.)

---

## 2. Benchmark por los 5 ejes que pediste

### 2.1 — Diseño (visual + modelo de datos)

**(D) Lo que hacen los mejores:**
- **Receta como única fuente de verdad** que propaga a todo. Es unánime: Apicbase ("una vez creada/actualizada una receta, todo lo demás —menús, producción, pedidos, inventario, nutrición, alérgenos, costes— se sincroniza"), Galley ("recipe-first culinary OS"), gstock (estandarización multi-centro de fichas técnicas).
- **Sub-recetas anidadas** (receta dentro de receta) con **escalado en paralelo**: al escalar porciones, todos los datos asociados escalan (Galley, Apicbase, meez, gstock).
- **Constructor visual drag-and-drop** de ingredientes vinculados a proveedores (Apicbase).
- **Base de ingredientes "del sistema"** con conversiones peso↔volumen, mermas por acción de prep y rendimientos ya programados (meez, 2.500+).

**(I) Dónde está el listón:** el diseño ganador no es "bonito", es **un grafo de datos limpio donde un cambio en un ingrediente recalcula todo aguas arriba sin que el usuario toque nada**. Folvy ya lo tiene (cascada coste compra→plato, `recipe_line` con prevención de ciclos, `SUM(line_cost)==computed_cost`). **Folvy está en paridad de modelo, y por delante en honestidad** (ver 2.3).

### 2.2 — Navegabilidad

**(D/I):**
- Patrón dominante: **lista + detalle** (catálogo → ficha de receta), con la ficha en **pestañas** (escandallo/coste, método/pasos, alérgenos-nutrición, histórico). meez separa **modo VER/escalar** de **modo EDITAR** — clave: el cocinero en servicio no edita, consulta.
- meez en móvil = **ver/Cook Mode** (no editar tablas densas). El trabajo denso vive en escritorio/tablet.
- gstock: una reseña real dice que la web app es *"necesariamente compleja"* — potente pero con curva. Apicbase: *"steep learning curve"*.

**(I) Goleada de navegabilidad para Folvy:** Folvy ya usa lista+detalle por estado y el patrón responsive (R1, `useIsMobile`, tarjetas en móvil). El golpe es **editar bien también en tablet** (el tablet es el "caso general de cocina"), donde meez solo deja ver. Si Folvy permite la ficha completa usable en tablet **sin la curva de gstock**, gana en navegabilidad.

### 2.3 — Solidez

**(D):**
- gstock: **escandallo dinámico recalculado en tiempo real con cada recepción de mercancía**. Apicbase/R365/Galley: cambio de precio de proveedor → recalcula coste y margen al instante. **Esto es TABLE STAKES** (el doc de inventario del proyecto ya lo marcó: si Folvy hace Cocina, esto NO es opcional).
- **AvT (Actual vs Theoretical)**: R365 lo pone en el centro; la varianza teórico-vs-real es donde se caza la fuga de margen. gstock lo trae en PREMIUM.
- meez marca el ingrediente **no definido en rosa/rojo** (no lo esconde).

**(I) Dónde Folvy ya golea en solidez:** **honestidad de coste.** Folvy NO inventa conversiones: si no hay vía de conversión → `needs_review` y la línea aporta 0, en vez de fabricar un coste falso (error de Apicbase de asumir 1:1, evitado). El invariante `SUM(line_cost)==computed_cost` verificado al céntimo. **Esto es un diferenciador real, no cosmético:** el operador confía porque el sistema admite lo que no sabe. Ninguno de los grandes vende esto como valor; Folvy puede.
- **Pendiente para igualar el table stake:** cerrar el escandallo dinámico al recibir (eslabón 1 ya demostrado end-to-end) + el aviso de salto de precio + el verificador de platos obsoletos (deuda viva declarada).

### 2.4 — Visión comercial

**(D):**
- **Precios públicos = arma rara y potente.** Casi nadie publica (Apicbase, Mapal, tspoon, Toast: "pide presupuesto"). Los que SÍ: **gstock** (43,90 / 65,90 / 98,90 €/mes, sin permanencia) y MarketMan (USA, ~$199-249/mes/local).
- **Time-to-value corto vende:** meez "go-live en ~3 días", gstock "1-2 semanas un local" frente a 6-12 meses de ERPs.
- Mensaje **"por hosteleros, para hosteleros"** (gstock, Apicbase, Mapal) refrendado en reseñas. **Julio es dueño de Llorente29 → este mensaje es de Folvy por derecho propio.**
- Posicionamiento de Apicbase frente al TPV: *"el TPV optimiza ingresos; nosotros, control de coste. Somos complementarios"*. meez igual: "complementary, not competitive".

**(I) Goleada comercial de Folvy:**
1. **Publicar precios desde el día uno** (gstock lo hace y le funciona; tspoon no).
2. **Plan de entrada barato que sube por funcionalidad** (modelo bottom-up tipo gstock Zero).
3. **El gancho de demo:** no "tengo escandallo" (todos), sino **"te enseño tu margen REAL por marca y canal con tus tickets reales, y doy de alta una receta/albarán con una foto"**. Eso es lo que ningún incumbente puede demostrar en 5 minutos con los datos del propio cliente.

### 2.5 — Comodidad de uso (fricción de arranque + IA + didáctica)

**(D) La IA ya es baseline, no innovación — y todos van a por la fricción de alta:**
- **Galley:** importador de recetas con IA, **humano-en-el-bucle, parsea una receta en <1 min, −90% de entrada manual**.
- **Apicbase:** IA genera una propuesta de receta completa a partir de restricciones (coste objetivo, alérgenos, porciones) desde la propia base de ingredientes del cliente; workflow de estandarización IA.
- **gstock:** OCR de albaranes (add-on) + IA de predicción de ventas a 15 días + pedido óptimo.
- **MarketMan/MarginEdge/xtraCHEF:** factura/foto → coste.
- **meez:** entrada de texto inteligente + import desde Excel/Word/PDF; base de ingredientes con conversiones que ahorra la "báscula".

**(I) El dolor nº1 del sector sigue siendo dar de alta a mano. Quien lo mate, gana la comodidad.** El listón NO es "tener foto→IA" (lo tendrán todos) — es **"acierta con fotos reales malas"** (albarán arrugado, escandallo manuscrito) y **encadena a la cascada de coste con `needs_review`**. Folvy tiene una ventaja única para esto: **los datos ya están unidos** (ventas + catálogo de Last.app), así que la foto→IA no parte de cero, parte de un catálogo real.
- **Didáctica:** ningún competidor *reeduca* bien al operador. Folvy puede enseñar el modelo de tres unidades (compra/stock/uso) mientras lo rellena, en vez de exigir que el cocinero lo entienda antes. Eso es comodidad + reducción de errores de coste.

---

## 3. Table stakes vs. diferenciadores (el mapa de la batalla)

**TABLE STAKES (si no lo tenemos, PERDEMOS — no son goleada, son no-perder):**
- Receta = fuente única que propaga; sub-recetas anidadas; escalado por porciones.
- Coste teórico automático; **recálculo al cambiar precio / al recibir albarán**.
- **Alérgenos + valor nutricional automáticos desde los ingredientes** (meez/Apicbase/gstock lo tienen; Folvy AÚN NO → riesgo).
- Ingeniería de menús (matriz popularidad×rentabilidad).
- Varianza AvT (actual vs teórico).
- Importación asistida por IA (foto/OCR) de recetas y albaranes.

**DIFERENCIADORES (donde Folvy puede GOLEAR):**
1. **Margen REAL por mezcla de ventas real, a nivel de modificador, por marca×canal.** (Activo único: 11.894 tickets + Capa 2 comisiones + escandallo validado.) Todos los demás se quedan en teórico/AvT. *Este es el golpe principal.*
2. **Fricción de arranque casi-cero:** foto→IA **sobre datos ya unidos**, con honestidad (`needs_review`) y cascada automática.
3. **Honestidad de coste como valor de producto** (no inventa; admite lo que no sabe; invariante verificado).
4. **Didáctica que reeduca** al cocinero sin bloquearle.
5. **Nativo multi-marca / dark kitchen España** + ecosistema conectado (el Kitchen no vive solo: comparte dato con Sales, Personal, APPCC). gstock/Apicbase/meez no tienen Personal ni APPCC nativos; el multi-marca virtual de gstock es débil.

---

## 4. Cómo proceder — estructura de trabajo

**Regla de oro de cada fase (cadencia obligatoria, sin que Julio la pida):** antes de diseñar la pieza → mini-benchmark de cómo la hace el mejor. Al cerrarla → medición contra él **con datos reales de Llorente29**. Si solo empata → deuda declarada, no victoria.

Orden propuesto (ataca primero lo que convierte el activo único en goleada visible, y cubre los table stakes que faltan antes de que duelan):

**K1 — Cerrar el escandallo al 100% de confianza.**
Resolver los 34 platos `needs_review`. *Benchmark:* gstock recalcula al recibir; meez marca lo indefinido. *Goleada:* honestidad + cuadre al céntimo. *Medida:* 94/94 al céntimo o cada excepción declarada con su causa.

**K2 — E8 Pasos inteligentes + G9 Cook Mode.**
E8.4 (resaltado en vivo + vínculo paso↔ingrediente, CERO IA) → E8.5 (aviso faltantes) → E8.6 (orden por elaboración) → E8.7 (foto por paso) → E8.8 (borrador IA de pasos) → **G9 Cook Mode** (servicio a pantalla completa, un paso, ingredientes por paso, timer). *Benchmark:* meez/Apicbase tienen los pasos como **texto muerto**; meez Cook Mode muestra ingredientes por paso. *Goleada:* per-step ingredients vivos (matching local, gratis) + Cook Mode que nace con ingredientes por paso (no cojo).

**K3 — Modificadores con coste/margen real por mezcla de ventas.**
*Benchmark:* tspoon/R365 modelan modificadores. *Goleada:* coste/margen **ponderado por ventas reales** (Last.app manda los modificadores en `sale.raw_products`). Único en el mercado.

**K4 — Formato de compra (modelo 3 unidades) + cierre del recálculo dinámico.**
Eslabón 1 ya demostrado. Falta: aviso didáctico de salto de precio + verificador de platos obsoletos + activar `average_*` con la recepción. *Benchmark:* escandallo dinámico de gstock (TABLE STAKE). *Goleada:* honestidad (no inventa 1:1) + didáctica del modelo de tres unidades.

**K5 — foto→IA de escandallo y albarán.**
*Benchmark:* Galley (−90%, <1 min, humano-en-bucle), Apicbase (genera receta), gstock/MarketMan (OCR). *Goleada / listón:* **"acierta con fotos reales malas"** + `needs_review` + cascada, **sobre el catálogo ya unido**. Medir con fotos reales de Pamela, no de laboratorio. Si solo iguala el OCR de gstock → deuda.

**K6 — Alérgenos + nutrición automáticos desde ingredientes.**
TABLE STAKE que hoy falta. Los 14 alérgenos UE ya están en los catálogos semilla diseñados. *Riesgo:* sin esto perdemos comparativas. Construir antes de abrir a 2º cliente.

**K7 — Ingeniería de menús REAL.**
Matriz estrellas/perros pero con **coste real validado × mezcla de ventas real (11.894 tickets) × comisiones reales por canal (Capa 2)** = margen de contribución **verdadero** por marca×canal. *Benchmark:* todos hacen la matriz desde POS+teórico. *Goleada:* la nuestra es real, no teórica.

**K8 — Varianza AvT (consumo teórico vs real).**
Requiere cerrar el bucle de recepción/inventario. TABLE STAKE. Construir cuando el bucle cierre; activa `average_weighted`/`average_window`.

**Transversales (aplican a todas las fases):**
- **Sistema de diseño coherente** (patrón R1 `useIsMobile`+tarjetas; lista+detalle por estado; ver/editar separados como meez).
- **IA donde aporta** (no decorativa): foto→IA, borrador de pasos, sugerencia de mermas — siempre con humano-en-el-bucle y `needs_review`.
- **Didáctica en cada pantalla**: enseña mientras captura.

---

## 5. Cómo medimos la goleada (y deuda declarada)

**Medición sobre datos reales, no de laboratorio.** Una demo que solo empata con tspoon/gstock puede ser NEGATIVA. Métricas concretas:
- **K1/K3/K7:** ¿el margen real por marca×canal sale con los 11.894 tickets y cuadra al céntimo? ¿Folvy enseña algo que gstock/tspoon NO pueden con los mismos datos? Sí/No.
- **K5:** ¿acierta foto→IA con albaranes/escandallos reales malos de Llorente29? % de campos correctos sin tocar. Listón: por encima del OCR de gstock con las mismas fotos.
- **K2/G9:** ¿Pamela ejecuta un servicio con Cook Mode sin volver a la receta? Feedback real.

**Deuda viva del módulo (declarada, regla nº1):**
- Alérgenos/nutrición automáticos: AÚN NO existe → table stake pendiente (K6).
- Aviso de salto de precio + verificador de platos obsoletos: sin construir.
- `average_weighted`/`average_window`: dormidas hasta la recepción.
- foto→IA: sin construir; el listón es "fotos reales malas", no "tener la feature".
- Medidor de coste IA por cuenta: prerequisito antes del 2º cliente (HIGH).

---

## 6. Riesgos / lo que hay que aceptar

- **(I)** En back-office clásico puro, gstock es muy difícil de superar de frente (10 años, IA funcional, reseñas que dicen "no hay alternativa"). **No se le ataca de frente; se cambia el eje** (margen real + fricción cero + ecosistema + multi-marca).
- **(I) Convergencia:** todos van hacia foto→IA. La ventana de ventaja es la EJECUCIÓN ("acierta con fotos malas") + el activo de datos ya unidos, no la idea.
- **(D)** Apicbase/gstock tienen curva de aprendizaje. El riesgo simétrico de Folvy es construir profundidad y heredar la misma curva. **La comodidad/didáctica es parte del producto, no un extra.**
- **(I)** Folvy NO necesita que el módulo Kitchen sea *más profundo* que gstock en todo para golear; necesita ser **suficientemente profundo en table stakes + imbatible en los 5 diferenciadores + medido sobre datos reales.**

---

*Documento de trabajo. Fuentes (D): webs/docs oficiales de Apicbase, meez, Restaurant365, Galley (consultadas 01/06/2026) + `competidores_2026-05-16.md`, `competidores_profundizacion_2026-05-16.md`, `folvy_competidores_inventario_compras.md` del proyecto. (I) marcadas como interpretación.*
