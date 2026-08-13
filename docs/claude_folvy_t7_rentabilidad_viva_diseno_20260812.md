---
name: folvy_t7_rentabilidad_viva_diseno_20260812
description: DISEÑO de T7 — matriz margen × popularidad (ingeniería de menú) por plato, marca y canal. Incluye el RECON de calidad de escandallos medido en producción el 12/08 (solo el 67,4% de la facturación tiene coste fiable) y la regla de no evaluar lo que no se puede calcular. Leer antes de tocar rentabilidad, ingeniería de menú, o cualquier pantalla que cruce coste con ventas.
sources:
  - cowork
---

# T7 · Rentabilidad viva — DISEÑO

> **Estado: RECON ✅ medido en producción 12/08 · DISEÑO PENDIENTE DE APROBACIÓN.**
> Es la única pieza del mapa funcional del TPV que **no** es ponerse al día con la competencia.

---

## 1. Qué es y por qué golea

Cruzar **cuánto se vende** con **cuánto deja**, plato a plato, y decir qué hacer con cada uno.
La matriz clásica de ingeniería de menú:

| | Deja mucho | Deja poco |
|---|---|---|
| **Se vende mucho** | ⭐ **Estrella** — protégelo | 🐴 **Caballo** — sube precio o baja coste |
| **Se vende poco** | 🧩 **Puzzle** — promociónalo, muévelo en la carta | 🐕 **Perro** — fuera |

**Nadie lo tiene nativo.** R365 y Crunchtime dan food cost. Toast da ventas. Apicbase da
escandallos. Cruzar margen real con popularidad **y además por canal** —donde un plato puede ser
estrella en Glovo y perro en tienda por la comisión— no lo hace ninguno de serie.

**Folvy puede porque tiene las dos mitades en el mismo sitio:** escandallos con coste real y tres
años de ventas. Ese es el foso.

---

## 2. 🔴 RECON: la mitad de los datos no aguanta (medido 12/08)

**Esto es lo que decide el diseño entero.** Un primer cálculo en crudo daba resultados absurdos:

| Plato | Coste calculado | Margen aparente |
|---|---|---|
| The Mixed Master (Pita Mixta Gyros) | **2,17 €** | 91 % |
| The Bare Naked (Milanesa House) | **0,72 €** | 97 % |
| The Heritage Classic | 9,32 € | 62 % (plausible) |

Un pita gyros completo no cuesta 2,17 €. El food cost real de la casa es **30,1 %**.

**Causa medida** — 116 recetas en uso:

| Estado | Recetas | Facturación 90 d | % del total |
|---|---|---|---|
| **Completa** (todos los ingredientes con coste) | 77 | 74.904 € | **67,4 %** |
| Con ingredientes sin coste | 21 | 29.334 € | 26,4 % |
| **Receta vacía** (0 líneas) | 17 | 6.906 € | 6,2 % |

Enlaza con la deuda ya anotada: **93 de 336 ingredientes sin coste**. Una receta con la mitad de
los ingredientes a cero da un coste bajísimo y parece rentabilísima.

### La regla no negociable
> **Un plato cuyo coste no se puede calcular NO entra en la matriz.**
> No se estima, no se rellena con la media, no se pinta en un cuadrante.
> Se muestra aparte, en la lista de "no evaluables", con el dinero que mueve.

Es el mismo principio que `disabled_since_known`: *un dato derivado que no se puede conocer se
declara desconocido, no se rellena con un valor plausible.* Si se incumple, la pantalla dirá que
las Pitas dejan un 91 % y Julio tomará decisiones de carta y de precio con eso.

---

## 3. Otros dos hallazgos del RECON que condicionan el diseño

### 3.1 Las cedidas facturan el doble, y no controlas su precio
| | Recetas | Facturación 90 d |
|---|---|---|
| **Cedidas** (`licensed`) | 64 | **101.563 €** |
| Propias (`own`) | 75 | 49.478 € |

En cedidas **el precio lo pone el cedente**. "Sube el precio" no es una acción ejecutable ahí.
→ **La matriz separa propias de cedidas** y cambia las acciones que propone (§5).

### 3.2 Los canales están duplicados por mayúsculas 🔴
`Glovo` (91.626 €) y `glovo` (17.816 €) son el mismo canal contado dos veces. Igual `Uber`/`uber`
y `JustEat`/`justeat`. **Sin normalizar, la matriz por canal sale partida en dos y todos los
porcentajes mienten.** Hay que normalizar en la RPC (`lower()` + mapa), y aparte investigar por qué
existen las dos formas — huele a `sales_channel.name` frente a `external_channel_text`.

---

## 4. Datos y cálculo

### Fuentes
- **Ventas:** `sale_line` × `sale` (90 días por defecto, ventana configurable).
- **Coste:** `recipe_item.computed_cost` del escandallo del plato.
- **Salud del escandallo:** líneas de `recipe_line` y coste de cada ingrediente hijo.
- **Comisión de canal:** `brand_channel_rate` (ya existe) — es lo que hace único el eje canal.

### RPC nueva `menu_engineering(p_account, p_from, p_to, p_ownership, p_channel, p_location)`
`SECURITY DEFINER` + `belongs_to_account`. Devuelve por plato:

`plato · marca · ownership_type · unidades · ingresos · pvp_medio · coste_ud · margen_ud ·
margen_total · food_cost_pct · comision_canal · margen_neto · cuadrante · salud_escandallo`

**Cuadrante:** popularidad por encima/debajo de la media del grupo (marca o carta), margen unitario
por encima/debajo de la media ponderada. Los umbrales se calculan **dentro del mismo grupo**: no
tiene sentido comparar una pita con un refresco.

**`salud_escandallo`** ∈ `completa` · `incompleta` · `vacia`. **Solo `completa` recibe cuadrante**;
las otras dos van a `null` y a la lista aparte.

---

## 5. Pantalla

**Cabecera honesta, lo primero que se lee:**
> *"Evaluando 77 platos · 74.904 € (67 % de tu facturación). 38 platos sin coste fiable —
> 36.240 € — no se pueden evaluar."*

Sin esa línea, el usuario cree que ve todo su negocio.

**Bloque 1 — La matriz.** Cuatro cuadrantes, punto por plato, tamaño = facturación. Filtros:
`Propias / Cedidas / Todas` · canal · local · periodo. Al pinchar un punto: ficha con coste,
margen, unidades y su desglose.

**Bloque 2 — Acciones concretas**, distintas según quién manda en el precio:

| Cuadrante | Marca propia | Marca cedida |
|---|---|---|
| ⭐ Estrella | Protegerlo: vigilar coste, no romper stock | Igual, y negociar volumen con el cedente |
| 🐴 Caballo | **Subir precio** o rebajar escandallo | *Precio no editable* → bajar coste o renegociar |
| 🧩 Puzzle | Subirlo en la carta, foto, promoción | Proponer al cedente cambio de posición |
| 🐕 Perro | Quitarlo de la carta | Informar al cedente |

**Bloque 3 — "No puedo evaluar estos"**, ordenado por facturación descendente. Este panel vale casi
más que la matriz: es la **campaña de escandallos priorizada por dinero**, no por orden alfabético.
Arreglar las 21 recetas incompletas sube la cobertura del 67 % al 94 %.

**Bloque 4 — Margen por canal** (el diferencial). El mismo plato, su margen neto tras comisión en
Glovo, Uber, Just Eat y tienda propia. Es donde se ve que un plato rentable en tienda pierde dinero
en una plataforma.

---

## 6. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | **Decidir con costes falsos** | La regla de §2: sin escandallo completo, no hay cuadrante. Es el riesgo principal. |
| 2 | Canales duplicados por mayúsculas | Normalizar en la RPC + investigar el origen |
| 3 | `computed_cost` desactualizado | Mostrar `cost_updated_at`; avisar si supera X días |
| 4 | Comparar peras con manzanas | Umbrales por grupo, no globales |
| 5 | Consejos no ejecutables en cedidas | Acciones distintas por `ownership_type` (§5) |
| 6 | Rendimiento | La consulta cruza `sale_line` (26 k filas). Medir con `explain analyze` **antes** de la pantalla — hoy `list_stock_movements` sigue dando timeout por no haberlo hecho. |

---

## 7. Fases

| Fase | Contenido | Riesgo |
|---|---|---|
| **T7.a** | RPC `menu_engineering` + normalización de canales. **Solo lectura.** Verificable por consulta. | ninguno |
| **T7.b** | Pantalla: matriz + lista de no evaluables | ninguno |
| **T7.c** | Eje canal con comisiones (`brand_channel_rate`) | bajo |
| **T7.d** | Acciones ejecutables (cambiar precio desde la matriz, propias) | medio: escribe en la carta |

**T7.a ya entrega valor sin pantalla:** da la lista priorizada de escandallos a arreglar.

---

## 8. Pendiente de Julio

1. Aprobar el diseño y el orden de fases.
2. **Decisión:** ¿la matriz arranca solo con propias (49.478 €, precio controlable) o con las dos?
   Recomendación: **las dos, separadas**, porque las cedidas son el 67 % de la facturación y su
   margen también importa aunque no puedas tocar el precio.
3. La campaña de escandallos (21 recetas incompletas + 17 vacías) es trabajo de cocina, no de
   código. T7.a dice **cuáles** y **en qué orden**.
