# Folvy — Subsistema de fiabilidad del casado de ventas y alarmas transversales

**Fecha:** 7 jun 2026
**Estado:** DISEÑO aprobado por Julio (concepto + maqueta). NO construido. Pendiente de diseño técnico detallado y de su propio tramo.
**Origen:** al arreglar el casado del webhook lastapp (marca+receta), Julio señaló que el manejo de "lo que no casa" debía ser un sistema con avisos, no un flag plano, y que el daño se propaga a stock y a compras (pensamiento MRP II de ciclo cerrado).

---

## 1. El problema, hasta el final de la cadena

Una venta sin casar no es solo un food cost incompleto. El daño se propaga:

```
venta sin casar → no descuenta su receta → STOCK TEÓRICO INFLADO
   ├─ food cost   → se calcula sobre datos incompletos (miente por omisión)
   ├─ inventario  → al contar, "falta" producto que sí se gastó → MERMA FANTASMA
   ├─ pedido To-Par / plantilla → cree que hay stock de sobra → PIDE DE MENOS → rotura
   └─ pedido MRP II → la previsión (ventas×escandallo) ignora esas ventas
                       → demanda infravalorada → PIDE DE MENOS → rotura
```

El dolor de bolsillo final es **rotura de stock en servicio** (plato 86'd = venta perdida + cliente cabreado). Por eso el aviso más potente no es "X% sin coste" (abstracto), sino su traducción a stock/merma/compras.

---

## 2. Principio de diseño: UNA señal de fiabilidad, propagada

No son alarmas sueltas por módulo. Es **una sola métrica central** — el % (por importe) de ventas sin casar en un periodo — que **cada consumidor del dato lee y respeta**, negándose a fingir que el dato está limpio.

- **Food cost** → "calculado sobre el 57% fiable".
- **Inventario** → "merma fantasma estimada de X € / Y%".
- **Pedido To-Par / plantilla** → "stock poco fiable, pedirás de menos".
- **Pedido MRP** → "stock inflado + demanda infravalorada".

**Proporcional al origen del pedido** (`pedido.origin`, ya previsto):
- `manual` → NO avisa (no usa stock ni previsión).
- `par` / `template` → avisa (stock inflado).
- `mrp` → avisa doble (stock inflado + demanda infravalorada).

Así no se satura: el aviso solo salta donde el dato sucio falsea de verdad la decisión.

---

## 3. Modelo de estados (excepciones del casado)

Benchmark tspoon (captura real, pantalla por marca): distingue cinco estados, no un binario —
Productos a la venta (vinculados+coste), "menús sin coste actualizado", Productos NO vinculados,
NO vinculados IGNORADOS (a propósito), Descatalogados. Y separa el análisis en
"con coste / sin coste / pendiente". Folvy lo replica y lo afina.

`sale_line` gana una **razón** del no-casado (hoy `map_source` solo dice que no casó, no por qué):

| Estado / razón | Significado | Dónde se rompe la cadena | Acción |
|---|---|---|---|
| casado OK | marca+receta+plato | — | entra al consumo |
| `no_recipe` | vendido, sin escandallo | `organizationProductId` sin `lastapp_product_map` | mapear/crear escandallo |
| `no_menu_item` | tiene receta, no está en la carta de esa marca | `brand_id\|recipe_item_id` sin `menu_item` | completar carta o revisar |
| `no_brand` | marca del ticket no casa | `lastapp_brand_name` sin `brand` | alias de marca |
| `ambiguous` | >1 candidato | colisión marca\|receta (hoy 0) | desambiguar |
| `ignored` | excluido a propósito | decisión humana | excluir del análisis (NO es error) |
| `delisted` | existió, ya no en catálogo | producto retirado | histórico |

**Folvy golea a tspoon:** separa `no_recipe` de `no_menu_item` (tspoon los junta en "no vinculado", pero la acción es distinta); propone el match con IA (confirmar/crear, no solo listar); y los estados deliberados (`ignored`, `delisted`) evitan que el food cost mienta por omisión.

---

## 4. Cómo se calcula el impacto en stock (honesto, no estimación vaga)

De las líneas sin casar:
- Las que **tienen receta** (`no_menu_item`): se PUEDE calcular qué ingredientes habrían descontado y cuánto stock teórico/€ representan → **merma fantasma calculable**.
- Las que **no tienen receta** (`no_recipe`): no se sabe qué gastaron → se cuentan aparte como **consumo desconocido** (N líneas), no se inventa.

Así el aviso da dos cifras honestas: "merma fantasma calculable: X kg / Y €" + "consumo desconocido: Z líneas sin receta".

---

## 5. Capa de alarma (activa, no pasiva)

Tres/cuatro disparadores, con severidad y ubicación:

| Disparador | Severidad | Cuándo/dónde | Mensaje |
|---|---|---|---|
| Producto nuevo vendiéndose sin receta | alta | ingesta (webhook sabe en qué paso cayó) → campana manager | "X se vendió hoy y nunca se vio; su coste está ciego" |
| % ventas ciegas sobre umbral | media | cierre de servicio, lee `ingestion_monitor_config` | "estás ciego en el N% de las ventas de hoy" |
| Marca no resoluble | config | ingesta → pantalla excepciones | "marca del ticket sin alias" |
| Inventario con datos sucios | alta | al ABRIR un `inventory_count` | "vas a contar con N ventas sin descontar → ~M% merma falsa" |
| Pedido To-Par/MRP sobre stock sucio | media/alta | al construir el pedido | "stock poco fiable → pedirás de menos" |

**Decisiones pendientes (preguntadas a Julio, sin respuesta aún):**
- Umbral de "ventas ciegas": ¿configurable por cuenta (defecto ~20%) o fijo de producto?
- Alarma "producto nuevo sin receta": ¿tiempo real o agrupada al cierre del servicio (menos ruido)?
- Impacto en stock: ¿€, % de merma, o ambos? (dueño piensa en €, jefe de cocina en producto/%).

---

## 6. Datos verificados (RECON 07/06, cuenta Folvy Interno)

Simulación de la lógica nueva sobre las ventas reales (374 líneas de `raw_products`):
- con_marca: 374/374 (100%) — la marca resuelve perfecto vía `catalogProductId → lastapp_catalog_product.lastapp_brand_name → brand`.
- con_receta: 318/374 — 56 sin receta (`no_recipe`).
- casarían a menu_item: 214/374 — ~104 con receta pero sin plato en carta (`no_menu_item`).
- Webhook ya desplegado (commit del casado por marca, `--no-verify-jwt`); casa ventas NUEVAS. Las existentes esperan al recasado.

---

## 7. Alcance y orden de construcción (cuando se ataque el tramo)

Cada capa usable sola; enchufa en la siguiente (principio MRP II):

1. **Razón en `sale_line`** (`unmapped_reason`) — calculada en ingesta y en recasado. Sin esto, "unmapped" es caja negra.
2. **Recasado de las existentes** — una pasada que aplica la lógica del webhook a las ~286 líneas (la simulación SQL del RECON es su núcleo).
3. **Pantalla de excepciones** — grupos por razón + acción guiada + propuesta IA. Estados deliberados `ignored`/`delisted`.
4. **Señal de fiabilidad** (RPC central) — % por importe, por periodo/cuenta. La consumen food cost, inventario y compras.
5. **Impacto en stock** — merma fantasma calculable (líneas con receta) + consumo desconocido (sin receta).
6. **Alarmas** — los disparadores de §5, en campana del manager + email opcional, leyendo `ingestion_monitor_config`.
7. **Avisos en inventario y compras** — al abrir conteo y al construir pedido To-Par/MRP (proporcional a `pedido.origin`).

**Checkpoint tspoon:** hecho para el modelo de estados (captura de la pantalla por marca). El dump `73_ventas_albaranes` resultó ser el flujo B2B del obrador (cocina central facturando a marcas), no el casado de plataforma — útil para el frente de cocina central, no para esto.

**Nota lateral (no perseguir ahora):** la línea de venta de tspoon trae `codeCustomerProduct` como UUID con formato igual a `organizationProductId`/`catalogProductId` de Last.app. Posible puente determinista tspoon↔Last.app por ID — relevante para migración/Cloudtown, no para este frente. Verificar cruzando contra `lastapp_catalog_product` / `menu_item.external_id`.
