# RECON — «Un umbral ordena, no esconde». Estado de TODO Folvy

**Fecha:** 29/08/2026
**Encargo:** `ENCARGO_CODE_umbral_ordena_no_esconde_20260829`
**Estado:** **cerrado — deuda 0.** Ningún sitio queda en «pendiente».

---

## Resultado en una línea

Se buscó por los cuatro caminos del §3. **Folvy ocultaba filas en UN solo sitio**, y el
detector de Julio (la nota al pie) lo encuentra sin ayuda: **una única coincidencia en
todo `src/`**. El backend estaba limpio: **ninguno** de los 10 RPC de informe descarta
filas por umbral.

| | |
|---|---|
| Sitios que **ocultaban** filas | **1** (arreglado) |
| Sitios que **mentían en el resumen** | **1** (arreglado) |
| Sitios verificados y **ya correctos** | **11** |
| Sitios pendientes | **0** |

---

## 1 · Los dos arreglados

### 1.1 `NegativeStockSection.tsx` — el caso que destapa la regla

**Qué hacía:** listaba solo los `is_alert` y resumía el resto en
`+9 artículo(s) en negativo por debajo del umbral (ruido, no listados aquí)`.
El encabezado decía «Sin alertas» en verde habiendo nueve negativos, uno de ellos
Coca-Cola Original Lata a **−10 ud**, fuera por **2,7 latas**.

**Qué hace ahora:** una sola lista con **todos** los negativos. Los que cruzan el umbral
arriba, marcados **«revisar»**; el resto debajo en gris, marcados **«menor»**, con su
cifra y su % sobre consumo. Columna nueva de prioridad. El encabezado dice la verdad:
*«9 artículos en negativo · ninguno supera el umbral de revisión»*. La nota al pie de los
«+N no listados» **ya no existe**.

El umbral **no se ha tocado**: sigue en 5 % / 5 uds y sigue ajustándose en
Recepciones → Ajustes de avisos. Ahora ordena.

Detalle que cambió de paso: la resolución de proveedor (para el atajo «Cargar recepción»)
se hacía solo para los de alerta. Ahora se hace para todos, porque todas las filas se
pintan y todas ofrecen sus remedios.

### 1.2 `InventoryPage.tsx` — la tarjeta de resumen, el mismo engaño un nivel arriba

**Qué hacía:** contaba solo `isAlert` y pintaba **`0` en verde con «sin alertas»**
habiendo 9 negativos. Es la puerta de entrada a la pantalla anterior, así que el verde
invitaba a no entrar.

**Qué hace ahora:** un contador **puede** priorizar con el umbral —la regla lo permite
expresamente, es un resumen— pero no puede decir «sin alertas» habiendo filas. Ahora:

- con alertas → `3 · artículos a revisar · 9 en negativo`
- sin alertas pero con negativos → `9 · en negativo · ninguno a revisar` (sin verde)
- sin negativos → `0 · sin stock negativo` (verde, y ahora es verdad)

---

## 2 · Verificados y ya correctos — con el motivo

Ninguno necesita cambio. Se listan con su fichero para que no haya que volver a mirarlos.

| Sitio | Qué hace | Por qué está bien |
|---|---|---|
| `OrderShortfallPanel.tsx:70` | parte en `faltan` / `completas` | **El patrón que queremos.** Faltan arriba; completas plegadas pero **listadas** tras «Ver N líneas completas». Nada oculto. |
| `KitchenProfitabilityPage.tsx:162` | `withCost` filtra nulos | Solo para calcular **la media** (no se puede promediar null). La lista va entera, ordenada por severidad. |
| `AvtSection.tsx:104` | filtra `countedQty !== null` | No es umbral: una línea sin contar no tiene desviación. Ya ordena por € desc. Excluye `consumo_incompleto` del **total**, no de la lista. |
| `AvtPeriodSection.tsx` | — | Sin filtros ni truncados. |
| `StockLevelsSection.tsx:64` | `below` / `with` / `without` | Control segmentado **elegido por el usuario**, y ofrece expresamente «sin nivel». |
| `InventoryCountSheet.tsx:114` | `quick` = uncounted/out/review | Filtro rápido **elegido por el usuario**, no umbral del sistema. |
| `IncidentsPage.tsx:147` | `severityFilter` | Filtro elegido por el usuario. |
| `pdfExportService.ts:554,706` | cuenta críticos | Conteos de un resumen de informe. |
| `SalesExceptionsPage.tsx:1170` | `tickets.slice(0, 6)` | **Declara** «+N ventas más…». Es detalle de apoyo dentro de una fila, no la lista de filas del sujeto. |
| `goods_receipt_cost_warnings` (SQL) | `where ratio > 1.8 o < 1/1.8` | El umbral **define el sujeto** (qué es un aviso de coste), no esconde filas: las líneas se ven todas en la recepción. |
| `hung_order_days_threshold` | define «pedido colgado» | Igual: define el sujeto. Un pedido de 3 días no es un colgado escondido. |
| Pickers (`ItemPicker`, `WasteSection`, `ModifierImpactsTab`, `RecipeEscandalloTab`) | `.slice(0, N)` | Typeahead de búsqueda. No son listados de datos. |

---

## 3 · Backend: limpio, y conviene que conste

Se comprobaron los 10 RPC que alimentan las pantallas del encargo:

```
negative_stock_report · availability_report · availability_panel · avt_period
warehouse_reliability_queue · sales_mapping_reliability · stock_levels_overview
menu_item_economics · list_costless_sold_products · availability_kpis
```

**Ninguno descarta filas por umbral.** `negative_stock_report` ya devolvía los nueve, cada
uno con `is_alert`, `cause` y `ratio_pct`. Todo lo necesario para ordenar y explicar estaba
servido y sin usar: quien escondía era el front. Por eso el arreglo salió barato.

---

## 4 · Cómo se buscó (por si hay que repetirlo)

1. **Texto de la UI** — `no listad|por debajo del umbral|ruido|sin alertas|no se muestran`
2. **Filtro en el front** — `.filter(` sobre `is_alert|isAlert|is_significant|within_tolerance|severity` y sobre comparaciones con `threshold|tolerance|_pct`
3. **Filtro en SQL** — `pg_proc` con vocabulario de umbral + `where/having` que descarte
4. **Truncados** — `.slice(0, N)` en todo `src/modules/supply` y `src/modules/kitchen`
5. **Ajustes** — cada umbral configurable de Recepciones → Ajustes de avisos

El camino 1 por sí solo habría encontrado el sitio. Los otros tres sirvieron para
**demostrar que no hay más**, que es la mitad del valor de un RECON.

---

## 5 · Cabo suelto reportado, no arreglado

`reparto_weather_poll` (cron cada 10 min) hace `FOR r IN SELECT id, lat, lng FROM
public.locations` **sin filtrar `active`**: llama a la API del tiempo por cada local,
incluidos el dado de baja y los duplicados por nombre. **Es gasto, no ruido** — no genera
avisos falsos. Sale del barrido del §5 y queda **pendiente de decisión de Julio**, no de
trabajo. Las otras 8 funciones de cron que tocan `locations` sin filtrar usan la tabla
como join de etiqueta o de configuración, y su driver son ventas, dispositivos o
empleados: un local cerrado no produce nada. Comprobadas una a una.
