# Folvy — SISTEMA 2x1 AUTOMÁTICO · Diseño formal (congelado, pendiente de construcción)
**v1 · 05/07/2026 · Estado: DISEÑADO Y CONGELADO por decisión de Julio.**
Orden acordado: (1) reorganizar el motor de ofertas para Glovo+Uber+JustEat → (2) construir este sistema. Este documento existe para que la reapertura arranque de un diseño aprobado, no de cero.
Complementa a `folvy_espejo_2x1_procedimiento.md` (v2: el QUÉ del espejo — dos artículos desde Ómnibus, ★/kitchen_name, receta compartida, precio de fórmula). Este documento es el CÓMO automático.

## Objetivo
La táctica 2x1-espejo (validada ×6 en Meraki) ejecutada de máquina a máquina con **UNA sola mano humana: la aprobación** (modo b de la casa). Si el sistema no es más fiable Y más barato en tiempo que hacerlo a mano, no merece existir (vara de Julio, 05/07).

## Descubrimiento que habilita el diseño
La asunción "Folvy no puede escribir en Last" es FALSA a nivel de API: el token que usa el importador es de la API completa de Last, que tiene endpoints de escritura de producto (el 86 vía `PUT /catalogs/{catalogId}/products/{productId}` ya estaba documentado del frente catálogo; la creación de producto vive en la misma API). Además Last modela **catálogos por canal** (el override de Glovo de Scandal vive así) → el espejo puede existir SOLO en el catálogo de Glovo, resolviendo de raíz el riesgo señalado por Julio: **Uber/JustEat jamás verán un producto a precio de espejo sin su promo**.

## Flujo completo (máquina→máquina, una aprobación)
```
1. AGENTE (offers-agent, regla R3 hoy tras BOGO_ENABLED=false):
   hueco urgente → elige estrella CON escandallo → preview_bogo_mirror_price
   → propone campaña kind='bogo' (precio espejo + plan en el razonamiento)
2. HUMANO: aprueba en Kitchen→Ofertas (LA única mano del ciclo)
3. EDGE mirror-sync (NUEVA, por construir):
   a. ¿existe el espejo en Last? (búsqueda por external_id guardado o por nombre '★')
      NO → CREARLO vía API: nombre '{Plato} ★', precio de fórmula CON IVA,
           foto/categoría/descr del original, SOLO catálogo Glovo, DESHABILITADO
      → verificar contra la API que quedó creado y en qué catálogos (verdad, no fe)
   b. ADOPTARLO en Folvy (lo que el 05/07 se hizo a mano, codificado):
      menu_item con external_id de Last · price SIN IVA (÷1,10 — trampa cazada 05/07)
      · mirror_of_item_id → original · kitchen_name '⚠2x1 {Plato}'
      · recipe_item_id = EL DEL ORIGINAL (receta COMPARTIDA — jamás subreceta 2×:
        Glovo marca 2 uds en el pedido → consumo y coste salen solos)
   c. 86-ON (enable:true en el catálogo Glovo)
4. ROBOT v3.19 (por construir — BLOQUEADO por capturas del asistente 2x1 de Glovo):
   publica la promo 2x1 apuntando SOLO al ★, en el POS del local de la campaña
   (pos_hint), con verificación dura contra la lista de Promociones (patrón v3.18)
5. FIN DE CAMPAÑA (Finalizar o caducidad):
   robot cancela el 2x1 (rutina end existente) → mirror-sync 86-OFF
   → carta EXACTA a como estaba. Cero cadáveres por construcción.
```

## Guardarraíles (heredan las lecciones de la sesión 05/07)
- **Verificar contra la verdad en cada paso**: creación confirmada leyendo la API; visibilidad confirmada leyendo los catálogos; publicación confirmada contra la lista de Glovo; kill-switch del operador (v3.18) vigente.
- **Idempotencia total**: espejo se crea UNA vez (búsqueda antes de crear); reintentos jamás duplican (external_promotion/ledger como en % y Uber).
- **El original JAMÁS se toca** (Ómnibus). Cedidas: jamás. Suelo de margen: siempre de la fórmula.
- **Guardarraíl de cocina** (pedido Julio): pedido de artículo-espejo con cantidad 1 → aviso en KDS/ticket "⚠2x1: llega 1 ud, el cliente puede esperar 2" (pieza del frente KDS/ticket).
- **Umbral de dignidad de estrella** (lección Dirty Burger: 'estrella' con 1 ud/30d es ruido): mínimo de ventas para que un plato sea elegible como base del 2x1 (parámetro, sugerido ≥10 uds/30d o top real de marca con ventas).

## Prerrequisitos para la reapertura (en orden)
1. **Reorganización del motor multi-plataforma (Glovo+Uber+JE)** — decisión de Julio, frente previo.
2. **RECON de la API de escritura de Last**: campos exactos del create-product; confirmar que el token actual tiene permiso de escritura (UNA llamada de prueba sobre un producto basura reversible); modelo de catálogo-por-canal en Bendito confirmado.
3. **Capturas del asistente 2x1 de Glovo** (Julio — los pasos del wizard hasta el resumen, sin crear).
4. Construcción: Edge `mirror-sync` + robot v3.19 + reencendido de R3 (`BOGO_ENABLED=true`) + guardarraíl cocina.

## Estado de las piezas hoy (05/07)
| Pieza | Estado |
|---|---|
| Cerebro (preview_bogo_mirror_price, migr T1700) | ✅ construido y validado (Meraki 16€ clava el rango 14-16 de Julio) |
| Regla R3 del agente | ✅ construida, APAGADA (BOGO_ENABLED=false, v1.7) |
| Procedimiento del espejo | ✅ v2 en repo (modelo real de la casa) |
| Espejo de referencia | ✅ 'Burrito Colosal de Cochinita ★' certificado, dormido en Last |
| Edge mirror-sync | ⛔ sin construir (diseñada aquí) |
| Robot v3.19 (manos 2x1) | ⛔ sin construir, bloqueado por capturas |
| Guardarraíl cocina qty-1 | ⛔ sin construir (frente KDS/ticket) |
| Guardia anti-accidente | ✅ v3.17: un bogo aprobado por error se rechaza, jamás se publica como 50% |
