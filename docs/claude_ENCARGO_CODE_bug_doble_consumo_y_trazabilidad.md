# ENCARGO CODE — BUG CRÍTICO doble descuento de stock + pantallas de trazabilidad de artículo

## PARTE 0 — CONTEXTO Y GRAVEDAD

Folvy está descontando el stock de cada ingrediente **DOS VECES por cada venta**.
Verificado en producción con el ingrediente "Milanesa de Pollo Rebozado"
(id `52aa4147-d2de-4bfd-9679-5a757247c16c`) en Foodint Alcalá
(account `51ad1792-6629-4ef7-833a-b57b09a86710`):

- Consumo REAL (lo que las ventas justifican plato a plato): **35 unidades**.
- Consumo DESCONTADO del stock: **67 unidades** (casi el doble).

Esto deja TODO el inventario permanentemente en negativo y rompe el AvT (teórico
vs real) de todos los ingredientes. Es el bug más grave del sistema de stock.

## PARTE 1 — DIAGNÓSTICO EXACTO DEL BUG (ya investigado, NO re-investigar desde cero)

Hay **DOS sistemas de consumo de stock corriendo a la vez**, ambos sobre `sale`,
ambos escribiendo en `stock_movement` con `movement_type='consumo'` y
`source_type='sale'`, pero con distinta etiqueta en `notes`:

**Sistema A — "Consumo por venta" (EL CORRECTO, conservar):**
- Función: `generate_sale_consumption(p_sale_id)`.
- Disparador: trigger `trg_sale_consumption_on_complete` (AFTER UPDATE ON sale),
  cuando `order_status` pasa a `'completed'`.
- Es IDEMPOTENTE: borra el consumo previo de esa venta antes de reinsertar.
- Explota correctamente combos y modificadores vía `_sale_line_raw_consumption`.
- En la prueba: 27 movimientos, 35 milanesas → CUADRA con lo esperado.

**Sistema B — "consumo teorico" (EL DUPLICADO, eliminar):**
- Función: `compute_sale_line_consumption(sale_line_id)`.
- Disparador: se llama desde `close_sale(p_sale_id)`, que hace un bucle por cada
  `sale_line` de tipo product y llama a `compute_sale_line_consumption`.
- NO es idempotente respecto al sistema A: añade sus propios movimientos ENCIMA.
- En la prueba: 25 movimientos, 32 milanesas → DUPLICADO sobre el sistema A.

**Resultado:** cada venta pasa por `close_sale` (→ sistema B) Y por el trigger de
`completed` (→ sistema A). Doble descuento.

Evidencia reproducible (ejecutar para confirmar antes de tocar):
```sql
SELECT sm.notes, count(*), sum(abs(sm.qty_base)) AS milanesas
FROM stock_movement sm
JOIN locations l ON l.id = sm.location_id
WHERE sm.recipe_item_id = '52aa4147-d2de-4bfd-9679-5a757247c16c'
  AND l.name = 'Foodint Alcalá'
  AND sm.movement_type = 'consumo'
  AND sm.occurred_at >= (now()::date - interval '1 day')
GROUP BY sm.notes;
-- Debe salir: "Consumo por venta" ~35  +  "consumo teorico" ~32
```

## PARTE 2 — ARREGLO DEL BUG (con máximo cuidado, es el corazón del inventario)

### 2.1 RECON obligatorio antes de tocar nada
1. Leer el cuerpo COMPLETO de: `close_sale`, `compute_sale_line_consumption`,
   `generate_sale_consumption`, `tg_sale_consumption_on_complete`,
   `_sale_line_raw_consumption`, `reprocess_sale`, `recompute_sales_consumption`,
   `revert_sale_consumption`.
2. Averiguar QUIÉN llama a `close_sale` y CUÁNDO (¿lo llama el webhook de Last?
   ¿el cierre de pedido del front? ¿un cron?). Buscar en repo y en pg_proc.
3. Confirmar que TODA venta que pasa por `close_sale` también llega a
   `order_status='completed'` (si no, quitar B dejaría ventas sin consumo).
   Query de apoyo: comparar, sobre stock_movement de los últimos 30 días,
   cuántas ventas tienen solo "Consumo por venta", solo "consumo teorico", o ambas.

### 2.2 Decisión de arreglo (validar en RECON, esta es la hipótesis fuerte)
El sistema A (`generate_sale_consumption`) es el bueno: idempotente, explota
combos/modificadores, es el diseño moderno. El sistema B es legacy que quedó vivo.

**Arreglo:** quitar de `close_sale` el bucle que llama a
`compute_sale_line_consumption` (dejando intacto el cálculo de COSTE de línea,
`compute_sale_line_cost`, que NO es consumo y debe seguir). Así el consumo lo
genera SOLO el sistema A.

IMPORTANTE: NO borrar la función `compute_sale_line_consumption` todavía (por si
algo más la usa); solo dejar de llamarla desde `close_sale`. Marcar como
deprecada en un comentario.

Si el RECON revela que hay ventas que SOLO pasan por `close_sale` y nunca por
`completed`, entonces NO se puede simplemente quitar B: habría que hacer que
`close_sale` dispare el sistema A (`generate_sale_consumption`) en vez de B.
Elegir la vía según lo que muestre el RECON, y explicarla antes de aplicar.

### 2.3 Migración de datos (limpiar el histórico duplicado)
Tras arreglar el disparo, hay que borrar los movimientos duplicados ya escritos:
- Los movimientos con `notes='consumo teorico'` son los del sistema B.
- Verificar en una muestra que, por cada venta, existe su equivalente en
  "Consumo por venta" antes de borrar (no dejar ventas sin consumo).
- Borrar los "consumo teorico" duplicados en una migración de datos separada del
  DDL, con recuento antes/después y dentro de una transacción revisable.
- Recalcular el stock por ingrediente/local tras la limpieza (o dejar constancia
  de que el stock quedará descuadrado hasta el próximo inventario físico, que es
  la vía honesta si el histórico es muy sucio).

### 2.4 Reglas SQL del proyecto (OBLIGATORIAS)
- NUNCA ejecutar una función SECURITY DEFINER en la misma transacción que la
  crea/modifica (auth.uid() es null en SQL Editor → EXCEPTION).
- DROP FUNCTION antes de CREATE si cambia la firma.
- DDL y migración de datos en ficheros separados.
- Verificación en transacción separada de la creación.
- Tras cualquier cambio de esquema, regenerar `src/types/database.ts`.
- Versionar TODO en `supabase/migrations/` (no dejar nada vivo solo en BD).

### 2.5 Verificación del arreglo
Tras aplicar, una venta nueva de un plato con milanesa debe generar UN solo
movimiento de consumo, no dos. Repetir la query de la Parte 1 sobre una venta
posterior al fix: solo debe aparecer "Consumo por venta".

---

## PARTE 3 — DOS PANTALLAS DE TRAZABILIDAD DEL ARTÍCULO

Objetivo: que Julio pueda auditar el movimiento de cualquier ingrediente y, al
pulsar el "ojo" de una línea, ver el TICKET/venta que originó ese movimiento.
Referencia visual: las dos capturas adjuntas (estilo tspoon/AvT).

### PANTALLA 1 — Movimientos del artículo (lista + gráfico)
Es una vista de detalle de un `recipe_item` (materia prima). Encabezado con el
nombre del artículo, stock actual, desviación, coste total.

**Gráfico superior (barras apiladas por día):** evolución de la CANTIDAD del
artículo en el tiempo, con series diferenciadas por tipo de movimiento:
Inventarios, Compras, Producciones, Ventas, Otros (leyenda con checkboxes para
mostrar/ocultar cada serie, como en la imagen). La última barra puede ser la
proyección/actual (color distinto).

**Tabla inferior — cada movimiento una fila** (ya existe base en
`stock_movement`), columnas:
- Icono del tipo de movimiento (carrito compra, venta, ajuste, producción…)
- FECHA + hora
- Origen legible: para venta → marca/plato ("Milanesa House · 1 Pax The
  Parmigiana Vibe"); para recepción → nº albarán; para ajuste → autor + motivo.
- CANTIDAD (con signo y color: rojo negativo, verde positivo)
- COSTE unitario
- DESVIACIÓN (si aplica)
- CANTIDAD TOTAL acumulada (running balance tras ese movimiento)
- COSTE TOTAL acumulado
- **Icono "ojo"** al final → abre la PANTALLA 2 (detalle de la venta/ticket).

Filtros: rango temporal (7 días / 30 días / Este mes / Todo — ya presentes en la
UI actual), buscador de texto, y filtro por local (default: el local activo de la
sesión, NO selector manual salvo que ya exista el patrón).

Reutilizar lo que YA existe del módulo Almacén/Movimientos
(`list_stock_movements` y la ficha de artículo actual); esto es una evolución de
esa pantalla, no una nueva de cero. RECON de lo que hay antes de construir.

### PANTALLA 2 — Detalle de la venta (se despliega al pulsar el ojo)
Es la vista de UN ticket/venta (segunda imagen). Cabecera: marca ("Milanesa
House"), fecha, estado (Aceptada/Enviada), Base / IVA / Total, Descuento,
Coste, Aportación, Margen %, Nº Ticket, canal.

**Tabla de líneas del ticket:**
- CANTIDAD (x Pax / x Uni)
- PRODUCTO + código (con chips: DELIVERY, DISCOUNT, combo, etc.)
- Precio unitario, Coste unitario, Aportación/Pax, Margen % por línea
- ALMACÉN (zona de stock de la que salió, ej "3 · CONGELADOS")
- LOTES (si hay trazabilidad de lote; si no existe, dejar hueco preparado)
- IMPORTE
- Iconos de acción por línea (ver escandallo, etc.)
- Pie: desglose de IVA (base, %, cuota) + Total base.

Origen de datos: la venta (`sale`), sus líneas (`sale_line`), el escandallo de
cada línea (coste vía `compute_sale_line_cost` / `_sale_line_raw_consumption`),
y el margen real (precio − coste). Todo server-side y con el MISMO cálculo que ya
usa el motor de coste (no reimplementar la conversión).

**Navegación:** ojo en Pantalla 1 → abre Pantalla 2 de esa venta. Botón volver
que regrese a la lista SIN perder el scroll ni los filtros. (Patrón lista+detalle
del módulo Kitchen; no react-router con params si el resto del módulo no lo usa.)

### Reglas Pantalla
- NO tocar App.tsx / Shell.tsx sin permiso explícito.
- Frontend-design del proyecto (design tokens, sin colores hardcodeados).
- Aislamiento multi-tenant: la RLS ya filtra por cuenta; verificar que no se ven
  datos de otras cuentas.
- Build verde. Regenerar database.ts si se añaden RPC/columnas.

## PARTE 4 — ORDEN DE EJECUCIÓN SUGERIDO
1. Parte 2 (el bug) PRIMERO y en sesión cuidada: RECON → decisión → DDL →
   migración de datos → verificación. Es lo que sangra dinero cada día.
2. Parte 3 (las pantallas) después: primero Pantalla 1 (evolución de la ficha),
   luego Pantalla 2 (detalle del ticket) enganchada al ojo.

## PARTE 5 — ENTREGABLES
- Migración(es) DDL + migración de datos, versionadas.
- database.ts regenerado.
- Servicios y componentes de las dos pantallas.
- Un resumen de: qué se cambió en el disparo de consumo, cuántos movimientos
  duplicados se borraron, y el estado del stock tras la limpieza.
