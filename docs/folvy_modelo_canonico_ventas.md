# Folvy — Modelo Canónico de Ventas multi-TPV (diseño aprobado)

**Fecha:** 2026-06-08
**Estado:** APROBADO por Julio. En construcción.
**Principio rector (Julio):** el modelo canónico NO es para calcular costes. Es la
**puerta única de entrada de TODOS los datos externos** a Folvy. El coste es el primer
consumidor, no el dueño. Por la misma puerta entran (hoy o mañana): coste/food cost,
consumo de inventario, analítica, economía de plataforma, previsión/MRP II,
monitorización, y cada TPV/canal futuro (Otter, Square, Glovo directo, Deliverect…).

---

## 1. El problema que resuelve

El core (casado, motor de coste) leía el JSON crudo de Last.app (`raw_products`,
`modifiers[]`, `comboProducts[]`, `organizationModifierId`). Eso ata Folvy a un TPV.
Otro cliente con Otter/Square/etc. tiene otro formato → nada funciona. El formato de un
proveedor no puede vivir en el núcleo.

## 2. Patrón del sector (benchmark — validado)

Deliverect, Otter, OrderOut, Toast, Revel: TODOS usan **adaptadores + modelo canónico**.
Un pedido es universalmente: `item { name, price, quantity, external_id,
modifiers:[{ external_id, name, price, quantity }] }` (+ combos). La diferencia entre
TPVs es solo NOMBRES DE CAMPO (`organizationModifierId` de Last.app = `external_id` de
Otter = PLU de Deliverect). El adaptador traduce esos nombres; el núcleo es idéntico.
→ El canónico no es una apuesta: es el patrón universal probado del sector.

## 3. La frontera (regla de oro)

```
  TPV crudo        ADAPTADOR (1 por TPV)      MODELO CANÓNICO        CONSUMIDORES
 (Last.app,   →  (traduce su formato a   →   (sale + sale_line   →  coste · inventario
  Otter,          líneas canónicas         con jerarquía)           · analítica · economía
  Square…)        completas y fieles)                               · previsión · monitor)
```
- El JSON crudo se guarda (auditoría/reproceso) pero **NADIE del core lo lee**. Solo el
  adaptador lo toca.
- El core NUNCA contiene un nombre de campo de un TPV. Si aparece, es bug de capa.
- El adaptador traduce el pedido **completo y fiel**, no solo lo costeable (porque sirve
  a todos los consumidores, no solo al coste).

## 4. HALLAZGO: el esquema canónico YA EXISTE

`sale` y `sale_line` ya están diseñadas como canónicas (no hay que crear tablas nuevas):

**`sale`** (neutra): `source`, `external_ref`, `external_brand_text`,
`external_location_text`, `external_channel_text`, `channel_id`, `brand_id`,
`location_id`, `sold_at`, `total`, `tax`, `taxable_base`, `service_type`, `raw_products`
(crudo, solo para el adaptador).

**`sale_line`** (canónica con jerarquía recursiva — más elegante que tablas separadas):
- `parent_sale_line_id` → jerarquía (un modificador/componente cuelga de su línea padre)
- `line_type` → `product` | `modifier` | (componente de combo)
- `modifier_option_id` → la línea-modificador apunta a su opción canónica
- `combo_slot_id` → la línea-componente apunta a su slot
- `menu_item_id`, `map_source`, `map_confidence`, `map_needs_review`, `unmapped_reason`
- `computed_cost`, `cost_computed_at` (coste congelado — primer consumidor)
- `quantity`, `unit_price`, `line_total`

Mecanismo de identidad/mapeo asistido: **`mapping_proposal`** ya existe y es genérico
(`source_kind`/`target_kind`/`source_text`/`confidence`/`method`/`status`) — IA propone,
humano confirma. No hay que crearlo.

## 5. Estado actual (RECON)

- `sale_line`: 311 líneas, TODAS `line_type='product'`, jerarquía VACÍA
  (`parent_sale_line_id`/`modifier_option_id`/`combo_slot_id` = 0).
- → El esquema canónico existe pero **no se puebla**: el webhook mete todo plano y deja
  modificadores/combos enterrados en `raw_products`. **El adaptador no existe aún.**
- Tablas de modificadores/combos (`modifier_group/option/recipe_impact`, `combo_slot/
  _option`) existen y pobladas, salvo `modifier_recipe_impact` (vacía) y desajuste de
  ids multi-marca (los `organizationModifierId` vendidos no están en `modifier_option`).

## 6. Qué se construye (corte directo — Llorente29 aún no usa esto en producción)

1. **Adaptador `adapt_lastapp_order(sale)`**: descompone `raw_products` en líneas
   canónicas COMPLETAS: producto + líneas-modificador (`line_type='modifier'`,
   `parent_sale_line_id`→producto, `modifier_option_id` resuelto) + líneas-componente de
   combo. Resuelve identidad vía mapeo (generalizar `lastapp_product_map` con `source`, y
   resolver modificadores por `mapping_proposal`/nombre). Lo no resuelto → visible, no
   enterrado.
2. **Backfill**: pasar las 311 líneas actuales por el adaptador → poblar la jerarquía.
3. **Motor de coste sobre canónico**: reescribir `compute_sale_line_cost` para leer
   `sale_line` + sus líneas hijas (NO el JSON). Lógica intacta (escandallo ±
   modificadores; combo = Σ componentes). Verificar paridad de números.
4. **Casado sobre canónico**: `recast` opera sobre líneas canónicas.
5. **Señales sobre canónico**.
6. **Webhook → adaptador**: el live entra ya descompuesto en canónico.
7. **Retirar** lo que leía JSON crudo en el core.
8. **Mapeos multi-TPV**: `source` en el mapeo de productos; resolver modificadores
   multi-marca (N ids → opción canónica) vía `mapping_proposal`.
9. **Sólo entonces**: poblar `modifier_recipe_impact` y retomar el coste de
   modificadores/combos — ya multi-TPV desde el cimiento.

## 7. Adaptador Otter (fase futura)

- Otter API = **Programa de Socios** (partner), igual que Last.app. El acceso de manager
  (panel) sirve para validar datos, NO para el conector productivo → requiere alta de
  socio con Otter.
- Cuando llegue: `adapt_otter_order` traduce su payload a las MISMAS líneas canónicas.
  Cero cambios en el core. Es la prueba de que el canónico cumple su promesa.

## 8. Criterio de "está bien" (deuda 0)

- Añadir un TPV = 1 adaptador + poblar mapeos. CERO cambios en core ni en consumidores.
- El core/consumidores no contienen ni un nombre de campo de ningún TPV.
- El adaptador traduce el pedido COMPLETO (sirve a coste, inventario, analítica…), no
  solo lo costeable.
- Todo lo no mapeado es VISIBLE (señal), nunca enterrado.
- Una entrada (canónico), muchos consumidores. El coste es el primero, no el único.
