# Folvy — Guion vivo (qué hacer, por impacto comercial)

> **Última actualización**: 8 jun 2026 (CIERRE — G3 modificadores completo + modelo canónico multi-TPV + fiabilidad reorientada a canónico).
> **Regla de oro**: el frente activo es el primero de "AHORA". Al cerrarlo, se mueve a "HECHO" y sube el siguiente.
> **Antes de abrir CUALQUIER frente: `conversation_search` del tema PRIMERO** (lección 08/06: el frente de modificadores ya estaba diseñado/benchmarkeado el 05/06 y se redescubrió a base de rodeos por no consultarlo). Luego RECON contra fuente primaria (BBDD+repo+dumps) y **AUDITORÍA TSPOON** (`tspoon_dump/`), nunca contra este guion.

---

## AHORA (el frente activo y los 2-3 siguientes)

### 1. 🔴 Subsistema de fiabilidad del casado — REORIENTADO a modelo canónico (EN CURSO)
El frente original (7 jun) leía `raw_products` de Last.app (acoplado al TPV). El 8 jun se construyó el **modelo canónico multi-TPV** (puerta única de entrada), lo que reorienta este frente: la identidad vive en el adaptador (por TPV), la fiabilidad lee el canónico (agnóstica). Hecho y pendiente:
- HECHO **Adaptador escribe `unmapped_reason`** (Camino A, commit 9e62e36): el adaptador calcula la razón (no_brand/no_recipe/no_menu_item) al poblar, en el sitio donde conoce el formato. La fiabilidad solo la LEE. Verificado: product 306 casan/17 no_recipe/4 no_menu_item; combo_item 121/22/8; 0 no_brand.
- **Capa 4 — señal de fiabilidad** (RPC central, SIGUIENTE): % ventas sin casar por importe/periodo, leyendo `unmapped_reason` del canónico. La consumen food cost, inventario y compras. Agnóstica del TPV.
- **Reescribir `compute_sale_line_cost` para leer CANÓNICO** (no `raw_products`): la otra mitad de la deuda. Hoy el coste aún lee el JSON crudo; debe leer la jerarquía `sale_line`. Verificar paridad.
- **Jubilar la parte de identidad del recast viejo** (`recast_lastapp_sales` lee raw_products): su auto-propagación multimarca (crear menu_item que faltan para productos con coste) se mantiene como paso útil; su cálculo de razón ya lo hace el adaptador.
- **Capas 5-7** (del diseño `docs/folvy_fiabilidad_casado_diseno.md`): impacto en stock (merma fantasma calculable + consumo desconocido); alarmas (producto nuevo sin receta, % ciego sobre umbral, campana manager + email); avisos en inventario y compras (proporcional a `pedido.origin`).
- **3 decisiones abiertas**: umbral ventas-ciegas (configurable vs fijo); alarma producto-nuevo (tiempo real vs cierre servicio); impacto en stock (€ vs % merma).
- **Por qué lidera**: sin casado fiable, food cost, inventario, consumo teórico y compras MRP II están todos envenenados. Cuello de botella de la torre del coste.

### 2. 🔴 Motor de consumo teórico (desbloqueado al casar fiable)
Explota `sale_line` casada (canónico) × `recipe_line` (reusa la explosión de `kitchen_recompute_item`, usa `quantity_gross`), escribe `stock_movement` tipo `consumo`. Hoy NO existe (0 movimientos de consumo). La capa 1 de inventario YA está construida. **Modificadores y combos YA están en el canónico** (líneas modifier/combo_item con su coste vía G3) → el consumo puede contemplarlos. Base del AvT.

### 3. 🟢 Limpieza de catálogo (eliminar/fusionar proveedores e ingredientes)
611 ingredientes muertos, proveedores duplicados/[Copia]. Dolor masivo, producto para cualquier cliente.

---

## SIGUIENTE (cuando se libere lo de AHORA)

### 4. 🟢 Sidebar "Modificadores por revisar" (repaso global G3)
Lista todos los modificadores sin impacto de todos los platos, ordenados por dinero, + "sugerir para todo". Reutiliza el componente de tarjeta de la pestaña. Disparador: cuando haya volumen real (escandallos poblados). La pestaña por plato YA está (uso contextual); esto es el barrido global.

### 5. 🟢 Unidades de uso amigables + renombrar formatos confusos ("Uni" -> "Bote 200 g")
Gestos de cocina (memoria), toca `recipe_item_purchase_format` + varias pantallas. RECON propio.

### 6. 🔴 Migración Llorente29 (poblar la cuenta real desde Folvy Interno)
Paso físico hacia producción.

### 7. 🟠 Pulido de demo
Responsive/móvil (permiso App.tsx), www.folvy.app DNS, editar perfil propio.

### 8. ⚪ Deudas técnicas
`qty_in_base` server-side; almacén/ubicación por línea; drift SQL (`format_price_per_base.sql`, `supplier_format_prices.sql` sueltos en raíz -> a `supabase/migrations/`); poblar escandallos base de los platos (muchos cascarón sin receta — sin esto los impactos de modificador y el consumo no calculan del todo).

---

## HECHO (para no repetir ni olvidar lo ganado)

- HECHO Folvy Kitchen (escandallos, coste a la décima, recompute cascada).
- HECHO Recipe Steps E8 (pasos enlazados a ingredientes) — diferenciador vs tspoon.
- HECHO Last.app webhook (ventas automáticas).
- HECHO Casado de ventas lastapp arreglado (07/06): cache por `brand_id|recipe_item_id`, marca vía `catalogProductId`.
- HECHO **MODELO CANÓNICO multi-TPV (08/06):** puerta única de entrada. El core NO lee formato de ningún TPV; solo el adaptador. Adaptador Last.app `adapt_lastapp_order` (descompone raw_products en jerarquía product/modifier/combo_item; backfill 201 ventas/761 líneas). Añadir un TPV = 1 adaptador + mapeos, CERO cambios en core. Otter (acceso manager de un cliente) entrará por su adaptador.
- HECHO **MOTOR DE COSTE DE VENTA REAL (08/06):** `sale_line.computed_cost` = escandallo ± modificadores (impactos confirmados) + combos (Σ componentes). `compute_sale_line_cost` + `_impact_cost`. OJO: aún lee raw_products, pendiente pasar a canónico (frente 1).
- HECHO **G3 MODIFICADORES — COMPLETO (08/06):** el frente que el 05/06 se diseñó (decisión B: normalizar en ingesta; modelo delta xtraCHEF/Craftable + multiply). Construido:
  - `modifier_recipe_impact` con ciclo de vida (proposed/confirmed/rejected, confidence, source). El motor de coste SOLO usa confirmed -> propuesta de IA nunca toca el coste sin humano.
  - Pestaña "Modificadores" en el editor de receta: cobertura, tarjetas diff SALE->ENTRA (sin jerga), confirmar/ajustar/rechazar, crear ingrediente al vuelo (needs_review, visible).
  - Edge `propose-modifier-impacts` (Nivel 2 IA): aprendizaje cruzado + IA por nombre+catálogo + anti-invención. Botón "Sugerir con IA".
  - Latido de coste en vivo (`preview_modifier_impact_cost`, server-side).
  - **3 niveles:** 1 (memoria) + 2 (propuesta IA) operativos; 3 (auto-confirmación) DORMIDO hasta histórico. Humano siempre entre IA y coste.
  - Diseño en `docs/folvy_g3_editor_impacto_modificadores_diseno.md`; reconciliación en `docs/folvy_reconciliacion_identidad_modificadores.md`.
- HECHO Folvy AI v1++ (streaming, ve 3 módulos).
- HECHO APPCC (corrección + foto + notificación) — diferenciador.
- HECHO Supply: pedido sobre catálogo (3 modos, multi-local, PDF, PED-correlativo). Recepción C2.2 OCR. C3 factura + three-way (pendiente probar vivo).
- HECHO Motor de IVA versionado por fecha.
- HECHO Inventario perpetuo capa 1 (crear->contar ciego->cerrar->aprobar->ajuste).
- HECHO Web pública folvy.app (7 páginas EN/ES).
- HECHO Auditoría competitiva (tspoon a fondo + mapa competitivo mundial).

---

## Regla de oro del guion
**No empieces una sesión preguntándote qué hacer. Abre este documento: el frente 1 de AHORA es lo que toca.** Si algo cambió las prioridades, se reordena aquí — siempre con la pregunta: *¿qué acerca más a Llorente29 en producción, que es lo que dispara las ventas?*
