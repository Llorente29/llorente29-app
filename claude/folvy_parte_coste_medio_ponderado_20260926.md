# Parte · El coste es lo que se compró (media ponderada) · 26/09/2026

Encargo: «El coste del artículo pasa a media ponderada, y 68 artículos llevan
meses creyendo que ya la tenían».

**Estado (27/09 12:15): TODO EN PRODUCCIÓN.** Base aplicada a las 11:52, los 16
quietos a media desde las 12:05 y el front fusionado a `main` (`2325cc0`, avance
directo) con Vercel **READY** en producción (`dpl_9jAEBouoo7GCVVk1LPrgq5AHFT1i`).
Antes del push: `npm run build` exacto y en limpio ✓, 1676 pruebas ✓. El push
no toca `supabase/functions` (ningún despliegue de edge functions) y sí dispara
`build-apk` (paquete nuevo para las tablets, que lo aplican en su ventana).

- Migración: `supabase/migrations/20260927T0100_el_coste_es_lo_que_se_compro.sql`
- Ensayo (4 caminos, revertido): `docs/propuestas/ensayo_el_coste_es_lo_que_se_compro.sql`,
  se monta con `scripts/montar_ensayo_coste_medio.py`
- Front: `ItemCostBasisPanel.tsx` + `costAverageService.ts`, colgado en la
  ficha del ingrediente («De dónde sale el coste»).

**Orden para salir, y no se puede cambiar:**
1. Después de las 00:30, Julio aplica la migración (toca el `CHECK` de
   `recipe_item`, que el pedido lee: falla la condición 2 de la banda).
2. Julio corre `select * from encender_coste_medio_quietos('51ad1792-6629-4ef7-833a-b57b09a86710');`
   y pega el resultado: 16 filas, todas `encendido = true`, `antes = despues`.
3. **Solo después** se fusiona el front. Si el front sale antes, la sección
   «De dónde sale el coste» enseña el error de la RPC que no existe (regla 40:
   `article_cost_breakdown` y `approve_average_cost` van entre comillas y hoy
   NO existen en la base; se comprueban en `pg_proc` después de aplicar).
   `npm run build` exacto y en limpio antes del push a `main`, y READY en Vercel.

---

## 1 · Lo que se midió antes de escribir (26/09 ~17:50–18:30 Madrid)

Todo con `account_id`. Artículos raw/tool/packaging activos sin archivar:

| Cuenta | average_weighted | last_purchase | fixed | average_window |
|---|---|---|---|---|
| Foodint `51ad1792…` | **68** (58 raw + 10 packaging) | 66 | 52 | 0 |
| Folvy Interno (plantilla) | 159 | 24 | 12 | 0 |
| Kitchen Grill LstQ (suspendida) | 0 | 0 | 0 | 56 |

Los 134 del encargo cuadran (68 + 66). Con archivados, Foodint lleva 75
`average_weighted` (7 archivados, todos sin compras).

`kitchen_recompute_raw_cost` desplegado (md5 `f1ae243e8129bded94eba67aa26c4348`):
solo distingue `fixed`. Confirmado lo que decía el encargo.

**Cosas que el encargo no decía y salieron al medir:**

- **La pasada de las 04:00 NO recalcula materias primas.** `kitchen-recompute-nightly`
  → `cron_kitchen_recompute_all` → `kitchen_recompute_all`, que solo recorre
  `recipe`/`dish`. Una materia prima solo se recalcula si se toca su
  `article_supplier`. La pasada de la media tenía que ir ahí dentro, antes de
  los platos.
- **El disparador del albarán llega tarde para una media.** `_post_goods_receipt_lines`
  escribe `last_price` (y salta el recálculo) mientras el albarán sigue en
  `borrador`; `receive_goods_receipt` lo pasa a `recibido` después. Y solo
  salta si existe un `article_supplier` con ESE formato. Por eso hay dos
  disparadores nuevos: cambio de estado del albarán y corrección de una línea.
- **`onboard_account` siembra SIEMPRE `average_window`** (su `CASE` cae ahí en el
  `ELSE`). Retirar el valor del `CHECK` sin tocarla rompía el alta del cliente 2.
- **La ventana ya tenía dos sitios y ninguno se leía**: `recipe_item.cost_window_days`
  (= 30 en todas las filas de todas las cuentas) y
  `kitchen_settings.cost_window_days_default` (= 30 en las tres). Ninguna
  función de coste los lee. `kitchen_settings.cost_strategy_default` =
  `'avg_window'`, un valor que `recipe_item` no admite.
- **El motor no está en el camino del pedido.** Contado: lo llaman
  `trg_article_supplier_recompute_cost`, `void_goods_receipt`,
  `classify_unmapped_product` (solo desde `commit_ai_action`) y
  `_kitchen_recompute_item_unguarded`. 1 cron (el de las 04:00), 0 disparadores
  de venta.

## 2 · La regla implementada

`_article_weighted_cost(item)` — el cálculo, sin escribir. Una sola vara para el
motor, la ficha, la aprobación y la lista de revisión (regla 31).

- Líneas que cuentan: albarán `recibido`/`confirmado`, la línea entró al
  almacén (tiene su movimiento `recepcion`), no es «no mercancía»,
  `qty_in_base > 0`, `doc_amount` no nulo, `receipt_date` dentro de la ventana.
- coste = Σ `doc_amount` ÷ Σ `qty_in_base` de las que entran.
- Guardia: mediana del €/unidad de la ventana; fuera la que pase de 3× o baje
  de ⅓. Fuera también `doc_amount <= 0` (abonos, regalos): hoy hay 3 en
  Foodint. Cada línea fuera lleva su motivo.
- Cascada: 2+ → `media`; 1 → `poco_dato`; 0 → la última compra conocida de
  cualquier fecha (`ultima_conocida`, `needs_review = true`); nunca comprado →
  `sin_compras`, conserva el coste que tenía y `needs_review = true`. Nunca 0.
  Los dos que hoy tienen NULL (Bolsa Lobber, Relish Pepinillo) siguen en NULL,
  pero marcados: no en silencio.
- El resumen queda en `recipe_item.completeness->'cost_basis'` (sin la fecha
  de corte, para que la fila no se reescriba cada noche sin cambiar nada).

**Criterio 2, medido:** Milanesa de Pollo Rebozado = 1.678,72 € ÷ 868,30 ud =
**1,93334 €/ud**. 9 líneas en ventana, 1 fuera (ALB-00103, 7,89 €/ud, más de 3×
la mediana de 1,895). Con ALB-00103 dentro daría 2,054. **Ojo:** la Milanesa
es `last_purchase`, no está entre los 68: el 1,93 es lo que enseña la ficha como
«con la media sería», no su coste hoy.

## 3 · Los 68, medidos con la función de la migración

Ensayo de solo lectura a las ~19:00 (en banda: función en `pg_temp`, ninguna
tabla tocada), con la ventana forzada a 90 porque la base aún dice 30:

| Grupo | N | >20 % fuera | Qué pasa |
|---|---|---|---|
| quieto | **16** | 4 | se encienden en el paso 2 de arriba |
| se_mueve | **30** | 5 | apagados; Julio los aprueba uno a uno |
| imposible | **2** | 1 | apagados; arreglar albaranes primero |
| sin_compras | **20** | 0 | apagados; comprar, archivar o coste fijo |
| archivado | 7 | — | `no_aplica` |

**El encargo decía 27 / 21 / 20, y el 27 no aguanta el criterio 7.** De los 27
con |Δ| ≤ 10 %, solo **16 están exactamente a 0,000 %** (a 8 decimales). Los
otros 11 se mueven entre 0,2 % y 7 %: Bacon Ahumado +0,20 %, Salsa Coreana
+0,22 %, Tortilla Maíz +0,98 %, Pulled Pork −2,0 %, Cilantro −2,2 %, Salsa Mayo
Chipotle −2,7 %, Pan Bocadillos −3,5 %, Pan Hamburguesa +5,3 %, Caja Genérica
780 ml −6,1 %, Queso Rulo de Cabra +6,4 %, Cebollino −6,9 %. «Ni un céntimo» es
ni un céntimo: esos 11 van a la lista de Julio con los 21 grandes. De esos
32, dos son los imposibles, que van aparte; quedan 30 en `se_mueve`.

Los 16 quietos: Aceite de Birria, Caja Burger Individual Chivuos, CAJA GENERICA
1350Ml, Caldo de Birria, Caracola Espinaca y Queso Feta, Carne de Birria,
Guacamole, Pan de Pita 21 cm, Pollo Mechado, Queso Cheddar Loncheado, Queso
Gouda Loncheado, Salsa BBQ, Salsa Melt, Salsa Mil Islas, Tapa Bowl, Tortilla
Trigo 30 cm.

**Cuatro de los quietos descartan más del 20 %** — Guacamole 2/5, Pan de Pita
1/2, Queso Gouda 6/26, Tortilla Trigo 5/13 — y su coste no cambia porque todas
las líneas que entran tienen el mismo precio. Se encienden igual: el coste no se
mueve y el aviso nocturno los destapa, que es lo que se busca.

`encender_coste_medio_quietos` vuelve a medir cada uno al encender: si entre hoy
y la aplicación entra un albarán que lo mueve, **no** lo enciende y lo dice.

## 4 · Los dos «imposibles» no huelen a ALB-00103

- **Servilletas 30 x 40** (0,0092 → 0,2767 €/ud). ALB-00056 (07/07) y ALB-00084
  (04/08): «Servilleta master servis (CAJA DE 4500 UNIDADES)» casada al formato
  **Paquete (150 ud)** → 150 ud en vez de 4.500. Son 2 de las 3 líneas de la
  ventana, así que la mediana es la mala y **el guardia tira la buena**
  (ALB-00105, 2 cajas «Caja 4500», 0,0092 €/ud). Un guardia por mediana no
  puede saber cuál está bien cuando la mayoría está mal: por eso existe el aviso
  del 20 %, y por eso este va antes que nada. De paso: la línea de ALB-00033
  lleva un formato «Unidad» que **pertenece a otro artículo** (`66a018eb…`).
- **Aceite de Oliva Suave 0,4º** (0,0045 → 0,1070 €/ml). ALB-00045 (03/07):
  «ACEITE OLIVA 0.4º GARRAFA 5 LT» casada al formato **Botella 250 ml**
  (archivado el 23/08) → 250 ml en vez de 5.000. 26,75 € ÷ 5.000 ml = 5,35 €/L.

Corrección: en la recepción, a mano, con el formato bueno. El motor no toca
albaranes. Ojo: corregir la cantidad de esas líneas **mete stock** (4.350
servilletas por línea, 4.750 ml de aceite); es la entrada corregida, que ya
asienta su movimiento (`20260924T0035`).

## 5 · Qué hace la migración, por orden

1. `_article_weighted_cost`.
2. Ventana de la cuenta a 90 **antes** de clasificar (si no, se clasificaría con
   30 y se encendería con 90: dos varas).
3. `recipe_item_cost_rollout`: quién estaba marcado, su grupo y su medida. Sin
   esta tabla, el paso siguiente borraba la única huella.
4. Los `average_weighted` y `average_window` pasan a `last_purchase`, que es lo
   que ya calculan. **Ningún `computed_cost` se mueve** (lo mide E1).
5. `average_window` fuera de los dos `CHECK`; `recipe_item.cost_window_days` a
   NULL y comentado como retirado; `onboard_account` escribe `last_purchase` y 90.
6. Motor: `_kitchen_recompute_raw_cost_unguarded` (la rama nueva) y
   `kitchen_recompute_raw_cost` con la misma firma (regla 2: sin sobrecarga).
7. Disparadores nuevos en `goods_receipt` (estado) y `goods_receipt_line`
   (cantidad, importe, artículo, no-mercancía). Solo actúan sobre artículos a media.
8. `_cost_average_nightly` dentro de `cron_kitchen_recompute_all`, antes de los
   platos. Aviso `coste_medio_descartes` (severidad `aviso`, 20 h de antirruido)
   con los albaranes; los fallos van como `coste_medio_fallo` (`alto`), no como
   `raise warning`.
9. `article_cost_breakdown` (ficha), `approve_average_cost` (uno a uno, devuelve
   antes/después), `encender_coste_medio_quietos`, `article_cost_review` (la
   lista entera de artículos con líneas fuera, sin umbral).

## 6 · `average_window`: lo retiro

Lo tienen 56 artículos de Kitchen Grill LstQ (suspendida) y ninguno de Foodint.
Ninguna función lo distinguía. La ventana pasa a ser **una por cuenta**,
`kitchen_settings.cost_window_days_default`, que ya existía. No veo hoy ningún
artículo que pida ventana propia; si aparece, se hace por artículo y en la
pantalla.

**Deuda declarada:** la columna `recipe_item.cost_window_days` queda vacía y
comentada, no borrada (borrarla es `ACCESS EXCLUSIVE` sobre `recipe_item` y
tocar `migrate_kitchen_core` y los tipos del front). Y **qué estrategia llevan
las cuentas nuevas** es una decisión que no he tomado: hoy siembran
`last_purchase`, que es lo que calculaban de verdad.

## 7 · La plantilla (Folvy Interno)

Sus 159 `average_weighted` también pasan a `last_purchase` (grupo `plantilla`,
`no_aplica`). Si se quedaban marcados, la rama nueva se habría encendido sola
sobre la plantilla —que tiene 87 líneas de albarán propias— y la pasada nocturna
habría marcado `needs_review` en los que no tienen compras.

## 8 · Lo que falta y se dice

- **Lima** (sin compras en ventana): ALB-00030 y ALB-00033 son del mismo día
  (24/06) con las mismas «Limas 2 kg» a 7,10 € y 13,10 €. La función coge la
  última registrada (13,10 → 0,0066 €/g); la simulación del encargo cogía la
  otra (0,0036). Con dos líneas empatadas no hay «última» buena: mirarlo al
  decidir los 20.
- **El guardia con 2 líneas es arbitrario** (Pan de Pita: una de dos fuera).
  Con dos precios distintos no hay mayoría. Sale en la lista y en el aviso.
- **Los platos** se recalculan con el coste nuevo a las 04:00 (como hoy tras un
  albarán). Tras aprobar desde la ficha, el front recostea el artículo y sus
  platos en el acto.
- **Lista de revisión con pantalla propia:** no la he hecho. Existe la RPC
  (`article_cost_review`), el aviso nocturno con albaranes y el aviso en la
  ficha. Una pantalla que la liste es el siguiente paso si Julio la quiere.

## 9 · Verificación del front (26/09 ~19:20)

- `npm run build` exacto, borrando `*.tsbuildinfo`: **✓ built**.
- `vitest`: **1676 passed (1676)**.
- Lint, misma vara a los dos lados sobre los ficheros tocados: `origin` 11
  problemas / 5 errores → con el cambio 11 / 5. (Los dos errores que metí al
  principio —`any` y `setState` en el efecto— corregidos.)

## 10 · Ensayo de los cuatro caminos (regla 10)

Corrido el **27/09 a las 08:20 y a las 09:12 (Madrid)**, fuera de banda, con 0
ventas en la media hora anterior a cada pasada. Contra la base viva, con la
migración entera dentro de un único `DO` que termina en `RAISE`: no queda nada
escrito. Se montó con `scripts/montar_ensayo_coste_medio.py`, quitando del SQL
solo las líneas en blanco y las de comentario.

**Pasada 1 (08:20), el ensayo entero.** Resultado literal:

```
E1 computed_cost, tabla entera: antes 190dec4f despues 190dec4f → IGUAL
 rollout Folvy Interno · plantilla · no_aplica: 159
 rollout Foodint · archivado · no_aplica: 7
 rollout Foodint · imposible · pendiente: 2
 rollout Foodint · quieto · pendiente: 16
 rollout Foodint · se_mueve · pendiente: 30
 rollout Foodint · sin_compras · pendiente: 20
 rollout Kitchen Grill LstQ · ventana_retirada · no_aplica: 56
 estrategias ahora: fixed=696, last_purchase=391
E2 quietos encendidos 16, no encendidos 0, diferencia máxima 0 €/base
E3 Patatas Bastón: {"antes": 0.00728, "despues": 0.00191855813953488372, "metodo": "media",
   "lineas": 20, "descartadas": 2, "pct_descartadas": 10.0, "encendido": true, "aviso_descartes": false}
E3b Sweet Potato «solo si no cambia»: {"antes": 0.0224, "con_media": 0.00550971428571428571,
   "motivo": "el coste se movería", "encendido": false}
E4 pasada: recalculados 17, cambiados 0, avisos 4, fallos []
 AVISO Coste medio: 4 artículo(s) descartan más del 20 % de sus compras
   Guacamole: 2 de 5 líneas fuera de la media (ALB-00098, ALB-00173)
   Pan de Pita 21 cm: 1 de 2 líneas fuera de la media (ALB-00090)
   Queso Gouda Loncheado: 6 de 26 líneas fuera de la media (ALB-00041, ALB-00045, ALB-00048, ALB-00053, ALB-00058, ALB-00059)
   Tortilla Trigo 30 cm: 5 de 13 líneas fuera de la media (ALB-00041, ALB-00045, ALB-00048, ALB-00058, ALB-00059)
E5 ventana 30 d, sin albarán: cambiados 1 de 17 · Patatas Bastón 0.0019186 → 0.0017368
E5b de vuelta a 90: cambiados 1
P1 recibido (recibido): 0.01915 → 0.01988653846153846154 · esperado 0.01988653846153846154 · OK
   anulado: 0.01915 · vuelve al de antes
P2 merma 10 g: 0.28725 € (10 × coste 0.01915 = 0.1915)
P3 venta 01bff565 (open → closed): 3 líneas, coste 14.4005 €, movimientos de birria 0
P4 FALLÓ: Faltan motivos en 10 productos: Caldo de Birria, Cilantro, … (P0001)
```

**Pasada 2 (09:12), P3 y P4 corregidos.** Llevó E1 y E2 (para tener los 16 a
media) y los dos caminos que en la pasada 1 no midieron nada. E3–E5, P1 y P2 no
se repitieron: ya habían pasado y el código que miden no cambió.

```
E1 computed_cost, tabla entera: antes 190dec4f despues 190dec4f → IGUAL
E2 quietos encendidos 16, no encendidos 0, diferencia máxima 0 €/base
P3 venta 3e534a98 (closed → closed): 1 líneas, coste 5.6262 €, movimientos de birria 1
P4 recuento 2fa2ff32 (en_revision): ajustes 22, artículos recalculados 25
```

Después de cada pasada, comprobado: `recipe_item_cost_rollout` no existe,
0 funciones nuevas en `pg_proc`, 0 albaranes `ENSAYO-COSTE`, siguen los 234
`average_weighted`, las 3 ventanas en 30, U093 sigue abierta y el recuento
`2fa2ff32` sigue en revisión, sin ningún motivo puesto.

**Lectura, criterio por criterio:**

- **Criterio 7** (los quietos, ni un céntimo): 16 encendidos, diferencia
  máxima **0**. La migración no mueve **ningún** `computed_cost` de toda la
  tabla (huella igual antes y después, las tres cuentas). Medido dos veces.
- **Criterio 8** (los que se mueven, apagados): la guarda «solo si no cambia»
  NO enciende Sweet Potato y lo dice (0,0224 → 0,00551).
- **Criterio 4** (aviso con albaranes): sale, con sus albaranes, en la pasada.
- **Criterio 6** (la ventana caduca sola): con la ventana en 30 días y ningún
  albarán, la pasada mueve Patatas Bastón 0,00192 → 0,00174. La caducidad se
  simuló acortando la ventana: el paso de los días no se puede ensayar.
- **P1 recibir → confirmar → anular:** la media sube exactamente a lo esperado
  (a 20 decimales) y al anular vuelve **exactamente** al coste de antes. El
  disparador nuevo del albarán hace su trabajo: el recibido salta con el
  albarán ya en `recibido`.
- **P2 merma:** sale sin error. **Ojo, no es un fallo, pero hay que saberlo:**
  la merma se valora a **0,0287 €/g**, no al coste del escandallo (0,0192): usa
  el coste medio de ALMACÉN. Son los dos números que el encargo pide no mezclar,
  y esto lo confirma: el cambio no toca la valoración de la merma.
- **P3 cerrar una venta.** En la pasada 1 eligió **U093** (abierta desde el
  24/09), que **no tiene ni un movimiento de consumo**, ni antes ni después del
  cierre. No medía nada. Cae casi seguro en el corte del último recuento
  aprobado (regla 6), pero **no lo he verificado**: queda como pregunta, no como
  conclusión. En la pasada 2 se eligió la venta más reciente que sí tiene
  consumo asentado: cierra, cuesta y asienta la birria (1 movimiento).
- **P4 aprobar un recuento.** En la pasada 1 lo paró la regla de negocio
  «Faltan motivos en 10 productos». En la pasada 2 se pusieron motivos
  `error_conteo` DENTRO del ensayo, y se aprobó: 22 ajustes, 25 artículos
  recalculados, sin error.

**Los cuatro caminos pasan con la migración puesta.** Queda pendiente lo que
dice el orden de salida de arriba: aplicarla (Julio) y encender los 16.

## 11 · Aplicado (27/09, por Claude Code, por orden de Julio)

**Antes de aplicar (10:16 Madrid):** 0 ventas en la última media hora (la
última, el 26/09 a las 23:35); motor sin tocar (md5 `f1ae243e…`); huella de
`computed_cost`, tabla entera: `190dec4f13c9bc56d375ac3b29554903` (1.087 filas).

**11:52 — migración aplicada.** `supabase_migrations`: `20260927095235
el_coste_es_lo_que_se_compro`. Comprobado después:

- Las 8 funciones existen; `kitchen_recompute_raw_cost` tiene **una** sola firma
  (regla 2); md5 del motor nuevo `726293f8d44e82034a3d0af193a88b82`.
- Los dos disparadores del albarán existen.
- `kitchen_settings`: las tres cuentas, 90 días y `last_purchase`.
- Grupos, idénticos al ensayo: Foodint quieto 16 · se_mueve 30 · imposible 2 ·
  sin_compras 20 · archivado 7; plantilla 159; ventana_retirada 56.

**La huella de costes NO coincidió** (`f1b00d01…` después), y no es la
migración. A las **11:03:48**, entre la huella y la aplicación, alguien cambió a
mano el precio de proveedor de **Patatas Bastón** (0,00728 → **0,00182 €/g**,
1,82 €/kg). Eso recalculó la patata y 35 platos: son las 36 filas con
`cost_updated_at` entre las 10:16 y las 11:52. Con coste recalculado durante o
después de la migración: **0 filas**. La migración no escribe `computed_cost`.
Mi error de método: la huella tenía que tomarse en la misma transacción que la
migración, no una hora y media antes. Patatas Bastón sigue `pendiente` en
`se_mueve`: con 1,82 €/kg a mano, la media (1,92) ya solo la movería un +5 %.

**12:05 — los 16 quietos, encendidos** con `encender_coste_medio_quietos`,
suplantando a Julio (la función pide admin). 16 de 16, `antes = despues`
exacto en los 16. En `recipe_item_cost_rollout.decidido_by_name` queda escrito
«lo ejecutó Claude Code por orden de Julio». Platos recalculados por el
encendido: **0**.

**Estado final en Foodint:** `average_weighted` 16, `last_purchase` 136,
`fixed` 254. Rollout: encendido 16 · pendiente 52 · no_aplica 7. Los 16 llevan
su `cost_basis`. Regla 40, las dos RPC del front probadas contra la base:
`article_cost_breakdown` (Milanesa: media, 1,93334 €/ud, 9 líneas, 1 fuera) y
`article_cost_review` (13 artículos con alguna línea fuera).

**Lo que queda:**
1. Fusionar el front (`npm run build` en limpio, y READY en Vercel).
2. Arreglar Servilletas y Aceite en la recepción.
3. Julio aprueba los 30 que se mueven, uno a uno, desde la ficha.
4. Decidir los 20 sin compras.
5. La primera pasada nocturna con la media es **esta noche a las 04:00**:
   mañana hay que mirar su resultado en `cron.job_run_details` y si ha llegado
   el aviso `coste_medio_descartes` (se esperan 4: Guacamole, Pan de Pita,
   Gouda y Tortilla Trigo).
