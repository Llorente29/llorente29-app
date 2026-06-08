# Folvy — Reconciliación: modificadores, combos, identidad y modelo canónico

**Fecha:** 2026-06-08
**Por qué este documento:** el frente trabajado el 08/06 (motor de coste + adaptador + modelo
canónico) YA estaba diseñado y benchmarkeado el 05/06. Por no consultar las sesiones previas
(`conversation_search`) al arrancar, se redescubrió a base de rodeos. Este documento reconcilia
ambas en UNA verdad y fija qué está hecho y qué falta.

**LECCIÓN DE MÉTODO (fijar):** al abrir cualquier frente, lo PRIMERO es `conversation_search`
del tema — ANTES del RECON de BBDD y ANTES de diseñar. Las sesiones previas son fuente primaria
igual que la BBDD. La memoria resume y a veces engaña (listaba "tspoon Fase 0 pendiente" cuando
el análisis estaba hecho); las conversaciones tienen la verdad.

---

## 1. Lo que YA estaba decidido (benchmark 05/06)

Documento previo: `folvy_benchmark_modificadores_consumo_2026-06-05.md`. Benchmark de
Toast/xtraCHEF, R365, Crunchtime, MarketMan, Apicbase, Lightspeed. Conclusiones:

**Veredicto unánime del sector:** todos NORMALIZAN EN INGESTA. Ninguno parsea el JSON del TPV al
calcular consumo/coste. Capa de adaptador (por TPV) → modelo interno normalizado → motor (coste/
inventario) agnóstico del TPV. → **Decisión B confirmada** (= el "corte directo a canónico" de hoy).

**Los modificadores son entidades de primer nivel** con receta/ingrediente + porción + operación
(add/remove/swap), no texto decorativo.

**7 patrones reales de modificador en producción (Llorente29):**
1. Choice point proteína (Pollo vs Ternera) — cambia la receta base (swap)
2. Add ingrediente (Extra carne, Extra queso)
3. Remove ingrediente (Sin pepinillos, Sin salsa)
4. Cantidad (1 disco / 2 discos / triple)
5. Upsell side ("Sí con patatas" +3.95€) — es un producto entero
6. Cross-sell como modificador (postres/bebidas dentro de modifiers[])
7. Combos (comboProducts[] con sub-productos, cada uno con organizationProductId + sus modifiers)

**3 modelos de cómo se CONSTRUYE el escandallo de un modificador:**
- Modelo 1 — delta sobre la base (xtraCHEF/Craftable): base + mini-escandallo de qué cambia
  (ADD/SUBTRACT/SWAP). = nuestro `modifier_recipe_impact` (add_item/remove_item/replace_item).
- Modelo 2 — concatenación (R365): un menu_item por combinación. Preciso pero explota.
- Modelo 3 — Base Multiplier (Craftable): "Doble" = base ×2. = nuestro `multiply`.

**Hallazgo capital:** la creación del escandallo del modificador es MANUAL en TODAS las
plataformas. Ninguna lo adivina. → `modifier_recipe_impact` se puebla con criterio humano
(asistido por IA), nunca automático. xtraCHEF tiene "Modifier Mapping" con toggle "Subtract".

**Dónde gana Folvy (ya identificado):** modificadores con coste y analytics ("el Extra Queso
cuesta 0.35€, lo piden 40% de las veces, cobras 1.50€ → margen 76%"); AvT conectado al margen del
plato; multi-fuente sin reescribir (= el canónico); bucle autoinventario IA → varianza.

## 2. Lo CONSTRUIDO hoy (08/06) y qué decisión previa cumple

| Construido hoy (commiteado)                          | Cumple la decisión del 05/06            |
|------------------------------------------------------|------------------------------------------|
| `sale_line.computed_cost` + `compute_sale_line_cost` | motor de coste sobre modelo normalizado  |
| impact_type add_item/remove_item/replace_item/multiply | Modelo 1 (delta) + Modelo 3 (multiplier)|
| `adapt_lastapp_order` (descompone raw_products)      | Decisión B (normalizar en ingesta)       |
| `sale_line` jerárquico (parent_sale_line_id+line_type)| estructura normalizada agnóstica del TPV |
| modelo canónico poblado (750 líneas)                 | capa de normalización del benchmark      |
| doc `folvy_modelo_canonico_ventas.md`                | reafirma el benchmark, con detalle de BBDD|

Lo de hoy NO contradice lo del 05/06: lo implementa y lo lleva a código. Vamos en la dirección
correcta; el rodeo fue de método (no leer lo previo), no de dirección.

## 3. Lo que el RECON de hoy AÑADIÓ (real, no rodeo)

- **Drift de esquema:** `lastapp_product_map` en BBDD tiene `recipe_item_id` (el migration
  `20260528T1100` dice `menu_item_id`). La BBDD manda; el migration está desactualizado → DEUDA.
- **Identidad multi-marca confirmada:** Last.app genera un `organizationModifierId`/`organization
  ComboId` DISTINTO por marca/contexto. El id NO es identidad estable. La identidad de un
  modificador es su nombre EN EL CONTEXTO de su artículo padre (modifier_group_assignment).
- **5 productos vendidos sin mapear** en `lastapp_product_map` (AUSENTES, no needs_review):
  Combo Duo Smash, Combo Individual Smash, Doble Scandal Bacon Cheezy Burger,
  Plato Ternera Gyros: Carne y Patatas, Smash Bacon Cheeseburger. Causa: la carga de mapeo del
  07/06 (108 filas, 2 tandas) fue PUNTUAL (hecha desde Claude), no es un proceso continuo. Por eso
  los productos nuevos quedan fuera.
- **18 modificadores "sin casar en contexto"** → causa única: su producto PADRE no resuelve (está
  entre los 5 ausentes). El modificador es víctima, no causa. Mapear el padre los arrastra.
- **El módulo de mapping asistido YA EXISTE y está probado** (`mapping_proposal`+candidate+decision,
  Edge `map-products` con IA, RPC `confirm_mapping`, 157 mapeos reales de familias). Es genérico
  (source_kind/target_kind). NO hay que construirlo: hay que extenderlo a la identidad de ventas.

## 4. EL FRENTE REAL (lo que las notas de Julio del 08/06 revelaron)

No es "modificadores y combos". Es la **RESOLUCIÓN DE IDENTIDAD DE ARTÍCULOS A LO LARGO DE SU
CICLO DE VIDA, agnóstica al origen.** Un artículo puede nacer en 3 sitios:
1. **Migración** (carga masiva desde otro sistema) — como se hizo hasta hoy, desde Claude.
2. **A mano en Folvy** (el usuario da de alta artículo/menú/modificador).
3. **En el TPV del cliente** (Last.app, Otter…) — y al llegar la venta, Folvy debe IDENTIFICARLO
   y saber QUÉ HACER (¿vincular a un artículo existente? ¿crear? ¿revisar?).

Hoy solo existe (1) puntual. Falta el ciclo de vida: cuando llega un `organizationProductId`
desconocido, el adaptador debe crear una PROPUESTA de identidad (`mapping_proposal`) — IA propone
"¿es tu artículo Y?" o "¿es nuevo, créalo?", humano confirma (o auto si confianza alta), queda
resuelto, visible mientras no lo esté. Mismo mecanismo para las 3 vías. Igual que el canónico es
agnóstico al TPV, el catálogo debe ser agnóstico al origen del artículo.

## 5. Estado real del motor (con datos limpios faltaría)

- Motor de coste: VALIDADO. Productos con escandallo dan coste; combos dan NULL (componentes
  cascarón sin coste — honesto). Modificadores suman 0 porque `modifier_recipe_impact` está VACÍA.
- Para que el motor "encienda": (a) resolver identidad de los 5 productos padre (desbloquea
  modificadores en cascada); (b) poblar `modifier_recipe_impact` (manual asistido, Modelo 1+3);
  (c) poblar coste de los platos cascarón (desbloquea combos).

## 6. PLAN ordenado (sin más rodeos)

1. **Resolver identidad de los 5 productos** por la vía correcta (no parche manual): entender/usar
   el proceso que puebla `lastapp_product_map`, o extender `mapping_proposal` a
   `lastapp_product→recipe_item`. Los 3 normales arrastran sus modificadores; los 2 combos = caso
   combo (frente acotado).
2. **Ciclo de vida de identidad de catálogo** (el frente real del §4): propuesta automática de
   identidad para `organizationProductId` desconocido, sirviendo migración + alta manual + alta en
   TPV. Sobre `mapping_proposal`. ESTE es el cimiento; diseñarlo (doc) antes de construir.
3. **Poblar `modifier_recipe_impact`** (manual asistido): pantalla donde el humano define el delta
   de cada modificador (ADD/SUBTRACT/SWAP/×), priorizando por dinero. Enciende el coste de
   modificadores. Modelo 1+3 del benchmark.
4. **Reescribir `compute_sale_line_cost` y el casado para leer canónico** (no JSON). Verificar
   paridad. Webhook → adaptador. Retirar lectura de JSON en el core.
5. **Señales sobre canónico** (fiabilidad, sin coste, sin mapear, sin impacto de modificador).

## 7. Deuda registrada hoy
- `lastapp_product_map`: migration `20260528T1100` desactualizado (dice menu_item_id; real
  recipe_item_id). Regenerar/corregir migration.
- Carga de `lastapp_product_map` es puntual, no proceso continuo → los productos nuevos quedan
  fuera (raíz de los 5 ausentes). Resolver con el ciclo de vida (§4/§6.2).
- `format_price_per_base.sql` y `supplier_format_prices.sql` sueltos en raíz (siempre fuera de commits).
