# Conteo de inventario: el teórico congelado (diagnóstico + corrección)

**Fecha:** 25-08-2026 · **Estado:** propuesto, NO ejecutado. Claude Code propone; Julio ejecuta y verifica.
**Caso de partida:** INV-00181 (Alcalá, 24-08-2026).

---

## 1. Qué pasa

Un conteo tiene tres funciones y **dos de ellas usan un teórico distinto**:

| Función | De dónde saca el teórico | ¿Correcto? |
|---|---|---|
| `build_inventory_count` | `recipe_item_location_stock.qty_on_hand` en el momento de **crear** el conteo | no |
| `close_inventory_count` | `l.system_qty`, o sea esa misma foto | **no — es el bug** |
| `apply_inventory_count` | ledger cortado en `counted_at` de cada línea | sí (desde 20260801T1300) |

Consecuencia: **el ajuste de stock es correcto, el informe de merma miente.** Todo lo que se
vendió entre la creación del conteo y el momento de contar cada línea se imputa a esa línea
como merma o sobre-porción.

En INV-00181 (líneas creadas a las 09:30, contadas entre las 14:03 y las 21:13) el descuadre
es visible sin salir del propio conteo — **el asiento y el informe del mismo conteo no dicen
lo mismo**:

| Artículo | Ajuste realmente asentado | Variación informada |
|---|---|---|
| Crispy Wings | **+250** | 0 |
| Cilantro | **+8,1585** | +4,4542 |
| Kebab Ternera | −100 | −100 |

Y línea a línea, teórico informado vs teórico real en el instante del recuento:

| Artículo | `system_qty` (09:30) | Ledger en `counted_at` | Contado | Informado | Real |
|---|---|---|---|---|---|
| Pan Hamburguesa | 140 | 137 | 120 | −20 | **−17** |
| Tequeños | 118 | 98 | 85 | −33 | **−13** |
| Queso Mozarela | 3.500 | 3.370 | 2.000 | −1.500 | **−1.370** |
| Pepinillos | 4.300 | 4.220 | 3.800 | −500 | **−420** |
| Tomate Frito | 7.640 | 7.510 | 8.000 | +360 | **+490** |
| Crispy Wings | 0 | −250 | 0 | 0 | **+250** |

---

## 2. La corrección, y por qué al CERRAR y no al guardar

`system_qty` deja de ser una foto y se reconstruye siempre desde el ledger:
`SUM(qty_base)` de `stock_movement` para ese artículo y local con `occurred_at < counted_at`.

**Se recalcula al cerrar, no al teclear cada cantidad.** Esta era la duda del encargo y la
respuesta la da el propio ledger: **el motor de consumo asienta las ventas con retraso.**
Medido en producción: una venta de las 20:19:58 entró en el ledger a las 21:01:53 (42 min),
y otra de las 21:34 del día 23 entró a las 05:06 del día 24 (7,5 h). Congelar el teórico en
el instante en que el trabajador teclea la cantidad dejaría fuera las ventas de las últimas
horas y **volvería a inventar merma**, solo que menos. Al cerrar, el ledger ya está
prácticamente completo; y como `close_inventory_count` es idempotente sobre `en_revision`,
el gestor puede volver a cerrarlo para refrescar el teórico antes de aprobar.

El corte es **estricto** (`occurred_at < corte`), idéntico al de `apply_inventory_count`, por
dos motivos: (a) informe y asiento tienen que dar el mismo número; (b) el propio ajuste del
conteo se asienta con `occurred_at = counted_at`, así que el corte estricto lo excluye y
volver a cerrar un conteo ya aplicado en parcial no lo cuenta dos veces.

**Ficheros (`supabase/migrations/`)**

`20260825T1000_inventory_system_qty_desde_ledger.sql`
1. `theoretical_qty_at(item, location, instante)` — helper único, corte estricto, usa el índice
   existente `idx_sm_item_loc_time`. Revocada a `anon`/`authenticated` (solo la llaman
   funciones `SECURITY DEFINER` que ya validaron el acceso).
2. `rebase_count_system_qty(count_id)` — reconstruye `system_qty` de todas las líneas del conteo.
3. `close_inventory_count` — llama a (2) antes de calcular variaciones. **Es el fix.**
4. `build_inventory_count` — siembra `system_qty` desde el ledger, no desde `qty_on_hand`.
5. `check_count_variance` — el aviso blind (±3×) juzga contra el ledger vivo, no contra la foto
   de la mañana (evita avisos "low" falsos al trabajador en conteos de tarde).

No toca `stock_movement`, ni el cliente, ni `App.tsx` / `AppContext.tsx`.

---

## 3. Verificación de INV-00181: **no da 0, da −17** (y eso es un segundo hallazgo)

El encargo esperaba `variance ≈ 0` en Pan Hamburguesa. **No sale.** Con el teórico
reconstruido queda **−17**, y el ledger no tiene más consumo que absorber: el 24-08 fue un
lunes flojo en Alcalá (18 tickets, ~385 €, frente a 52-80 tickets los días anteriores) y solo
se descontaron 3 panes.

Los −17 restantes no son merma: en su mayor parte son **ventas que el motor de consumo no
puede descontar porque el producto no tiene receta**. En la ventana del conteo (desde el
ajuste anterior, 23-08 15:28, hasta el recuento, 24-08 21:11) se vendieron en Alcalá
`Cheeseburger` ×4 y `DOBLE BBQ Cheeseburger (BM)` ×2 — ambos mapeados a `menu_item` pero con
`recipe_item_id` nulo → **cero movimientos de stock** —, más otros productos de hamburguesa sin
receta (`Combo Individual Smash`, `Combo Duo Smash`, `The Guilty Pleasure`, `CHICKEN BURGER
MELT`, `THE HEURA CHIVUO'S`). Son del orden de **10 panes que se vendieron y nunca se
descontaron**.

El tamaño del agujero en ese local, últimos 30 días: **762 líneas de venta, 844 unidades y
11.030,69 € de 49.591,38 € (22 % de la facturación) a través de 97 productos sin receta**.
Mientras eso siga así, todo conteo enseñará merma que en realidad es catálogo incompleto.
Es trabajo de catálogo, no de motor, y queda fuera de esta corrección — pero es el siguiente
cuello de botella y ya hay herramienta para verlo (`avt_incomplete_raws` / "consumo incompleto").

---

## 4. Tercer hallazgo: la materialización de stock va atrasada

`recompute_location_stock_core` define `qty_on_hand` exactamente como `SUM(qty_base)` del
ledger, pero el motor de consumo asienta ventas **sin** recomputar. Medido hoy: **144 de 716
filas** de `recipe_item_location_stock` no coinciden con el ledger (caso extremo: Crispy Wings
con `qty_on_hand` 0 y ledger −250; Patatas Bastón con 13.400 frente a 190.510).

Esto es lo que explica que el histórico se mueva en las dos direcciones: la foto congelada no
solo se quedaba vieja durante el conteo (infla la merma), es que además salía de una tabla
desalineada (a veces la **oculta**). Con el fix, el conteo ya no depende de esa tabla. Pero
`qty_on_hand` es lo que la app enseña como "stock actual" en todas partes: la resincronización
está propuesta y comentada en `claude/sql/20260825_verificacion_system_qty.sql` §6 (escribe:
decisión de Julio).

---

## 5. Qué hacer con el histórico

**Propuesta: reparar el informe, no tocar el stock.** Los ajustes ya aplicados eran correctos
(apply ya cortaba por `counted_at`); lo único equivocado era el informe que se enseñaba encima.
Reparar el informe no es deshacer nada: es dejar de mentir sobre lo que ya pasó.

`20260825T1100_backfill_variance_historico.sql` recalcula `system_qty`, `variance_qty`,
`variance_pct`, `variance_value` y `within_tolerance` de los conteos en `aprobado` /
`en_revision`. No toca `stock_movement`. Cada línea queda registrada con valores viejos y
nuevos en `inventory_count_line_rebase_log`, y el fichero incluye el UPDATE de marcha atrás.

Dos decisiones de diseño:

- **No se re-tarifica el histórico.** Se conserva el coste unitario implícito de cada línea
  (`variance_value / variance_qty` original) en vez de aplicar el `avg_unit_cost` de hoy, para
  que el delta en € sea 100 % atribuible a la corrección de cantidades.
- **Se usa el ledger de hoy.** Para 363 líneas eso incluye movimientos retroactivos
  (documentos registrados tarde con `occurred_at` anterior). Es lo correcto para un informe de
  merma: es la mejor estimación disponible del teórico de aquel instante.

**Alcance medido antes de ejecutar** (102 conteos cerrados desde el 14-06; 1.948 líneas contadas):

| | |
|---|---|
| Líneas que cambian | 1.452 (en 95 conteos), de ellas 1.099 con cantidad contada |
| De esas 1.099, cambiarían igual usando solo los movimientos que ya existían al cerrar | 1.021 → **el grueso es el bug, no el retroactivo** |
| Dejan de ser anomalía | 76 |
| Pasan a ser anomalía | 211 |
| Merma informada antes | −8.506,44 € |
| Merma informada después | **−15.836,82 €** |

*(excluida `INV-00004`, una línea de pruebas de junio con `system_qty` = 5×10¹⁵ que el rebase
deja en 12.000)*

**Ojo a la cifra de abajo: la merma real es MAYOR, no menor.** El bug del teórico congelado
infla la merma en los conteos largos (el caso de Julio), pero el desfase de la materialización
la ocultaba en más casos todavía. El efecto neto de decir la verdad es **7.330 € más de merma
informada** en dos meses y medio. También aparecerán 211 líneas fuera de tolerancia sin motivo
en conteos ya aprobados: es consecuencia esperada, no un error del backfill.

---

## 6. Orden de ejecución

1. `claude/sql/20260825_verificacion_system_qty.sql` §1 y §2 → foto del daño.
2. Aplicar `20260825T1000_inventory_system_qty_desde_ledger.sql`.
3. §3 y §4 → re-cerrar INV-00181 y comprobar que informe y asiento ya coinciden
   (Pan Hamburguesa debe quedar en −17).
4. Aplicar `20260825T1100_backfill_variance_historico.sql` — **mirar el informe que imprime
   antes de hacer commit.**
5. §5 → contraste antes/después del histórico.
6. Aparte, cuando Julio decida: §6(b), resincronizar `recipe_item_location_stock`.
7. Aparte, catálogo: recetas para los 97 productos sin receta (22 % de la facturación de Alcalá).
