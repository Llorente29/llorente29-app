# 03/09/2026 — Las dos operaciones que escribieron DATOS, no esquema

> ## ⚠️ ESTO NO ES UN SCRIPT. ES UN REGISTRO.
>
> **No va a `supabase/migrations/` ni se ejecuta.** Las dos operaciones de aquí
> **no son idempotentes**: un fichero que vuelva a sellar 230 ventas o a
> recostear 103 líneas **hace daño la segunda vez**. Por eso viven en `docs/`,
> en pasado y sin SQL ejecutable.
>
> ## ⚠️ DOCUMENTO RECONSTRUIDO (03/09/2026)
>
> El original de esta ficha **no llegó a la sesión de repositorio**. Lo que sigue
> está **reconstruido a partir de la evidencia que quedó en la base**: la tabla
> de respaldo `_backup_b49_julio_contaminado_20260903`, el rastro de `updated_at`
> de las ventas selladas y las cabeceras de las cuatro migraciones del 03/09.
> **Las cifras están medidas hoy contra producción, no copiadas.** Si el
> original aparece y algo no cuadra, **manda el original**.

**Cuenta:** Foodint (`51ad1792-6629-4ef7-833a-b57b09a86710`) — las dos
operaciones tocaron **una sola cuenta**, comprobado (regla 9).

---

## A5 · Sellado de 230 ventas atascadas

**Qué se hizo.** Se pasó `close_sale()` sobre las 230 ventas que estaban en
`order_status='completed'` pero seguían sin sellar, algunas desde el 12/08.

**Rastro que dejó:** `sale.updated_at` entre las 05:00 y las 06:00 UTC del
03/09, `status='closed'`.

| | |
|---|---:|
| Ventas selladas | **230** |
| Líneas afectadas | 769 |
| Líneas con coste congelado tras el sellado | 385 (50,1 %) |
| Venta más antigua | 12/08/2026 |
| Venta más reciente | 02/09/2026 |

**Desglose por origen** — es el dato que justificó poner el guardián en la BBDD
y no en la edge function:

| origen | ventas |
|---|---:|
| `hubrise` | 146 |
| `lastapp` | 83 |
| `folvy_shop` | 1 |

Arreglar sólo `hubrise-order-status` habría dejado **un tercio fuera**. De ahí
salió la migración `20260903050319_trg_sale_close_on_complete.sql`, que evita
que esto se vuelva a acumular.

**Detalle que conviene no perder:** `close_sale` puso `closed_at` **en el día de
la venta, no en el de hoy** — las 230 tienen `closed_at::date = sold_at::date`,
ninguna quedó fechada el 03/09. El sellado **no reescribió el calendario**: una
venta del 12/08 sigue contando en agosto.

**Por qué no es repetible.** Volver a lanzarlo hoy no encontraría las mismas
230 (ya están cerradas), pero un fichero que lo re-ejecutara a ciegas sobre
«las completadas sin sellar» dispararía `compute_sale_line_cost` sobre lo que
pillara en ese momento, **costeando con la receta de HOY**. Eso es exactamente
B44, y es el motivo por el que el trigger nuevo cubre sólo el `UPDATE` y no el
`INSERT`.

---

## B49 · Recosteo de 103 líneas contaminadas de julio

**Qué se hizo.** Se recostearon las 103 líneas de venta congeladas entre el
**7 y el 11 de julio** con un coste inflado hasta ×50, previo respaldo íntegro.

**Respaldo:** `public._backup_b49_julio_contaminado_20260903`
(`id`, `sale_id`, `product_name`, `quantity`, `unit_price`,
`computed_cost_antes`, `cost_computed_at_antes`, `sold_at`, `snapshot_at`).
**Snapshot:** `2026-09-03 05:24:27.824416+00`. **No borrar sin decidirlo:** es
la única vuelta atrás.

| | |
|---|---:|
| Líneas recosteadas | **103** |
| Ventas afectadas | 94 |
| Rango | 07/07 – 11/07/2026 |
| Coste **antes** | 5.151,67 € |
| Coste **después** | 179,92 € |
| **Coste fantasma retirado** | **4.971,75 €** |
| Líneas que quedaron sin coste | 0 |

**Los peores del lote** (coste unitario congelado vs PVP):

| plato | líneas | antes | después | peor coste ud. | PVP ud. |
|---|---:|---:|---:|---:|---:|
| Street Fries & Truffle | 11 | 607,12 € | 19,87 € | 43,37 € | 5,50 € |
| Classic French Fries BM | 10 | 477,03 € | 9,05 € | 43,37 € | 3,90 € |
| Milanesa de Ternera Setas y Trufas | 5 | 444,30 € | 30,48 € | 88,87 € | 17,50 € |
| The OG Cheese-Sticks | 7 | 355,37 € | 15,02 € | 44,42 € | 10,90 € |
| Patatas Clásicas Meraki | 8 | 346,93 € | 6,58 € | 43,37 € | 5,50 € |
| PATATAS FRITAS (DC) | 6 | 303,56 € | 5,76 € | 43,37 € | 3,90 € |
| Rollitos de Queso Feta (3 ud.) | 7 | 302,87 € | 11,49 € | 43,27 € | 6,30 € |
| Cheese-Sticks BM | 6 | 266,53 € | 11,27 € | 44,42 € | 11,90 € |

**Por qué había que hacerlo ANTES que B44, y no después.** El panel de food
cost leía `recipe_item.computed_cost` —la receta de hoy—, así que **el 115 % de
food cost de esas líneas nunca llegó a la pantalla**: el bug de lectura llevaba
dos meses tapando el dato corrupto. Al cambiar la lectura al coste congelado
(B44), julio habría saltado de 22,01 % a **29,42 %**, y los 7,4 puntos habrían
salido enteros de estas 103 líneas. Se reparó el dato primero y se cambió la
lectura después; por eso julio quedó en 22,87 % y no en 29,42 %.

**Por qué no es repetible.** Un segundo recosteo sobre estas mismas líneas ya
no encontraría el coste inflado: **volvería a costear con la receta de hoy** y
machacaría el congelado bueno, esta vez sin respaldo del estado correcto.
Además rompería la política de los DOS RELOJES (congelado en la venta / vivo en
el ingrediente).

---

## Lo que quedó pendiente y no es de código

- **Rotar el secreto de Last.app.** La migración `b50` cerró la lectura de
  `lastapp_webhook_log`, pero **el token sigue escrito en 39.243 filas** en
  texto plano. Cerrar la puerta no borra la llave. Decidir además si se limpia
  la columna (dato de producción → decisión de Julio).
- **`_backup_b49_julio_contaminado_20260903`**: decidir cuándo se jubila. Hasta
  entonces, es la vuelta atrás de B49.
