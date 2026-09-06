# F6 · Consecuencia esperada — B79: la economía por plato colgaba de un eje que no existe

Escrito **ANTES** de tocar la base. **06/09/2026, 10:36 Madrid — fuera de la banda
12:15 → 23:45.**

> ## ⚠️ ESTO ES UN INTERINO Y LO DICE EN PANTALLA
>
> El arreglo definitivo es reescribir `menu_item_economics` sobre el eje de canal
> **donde de verdad está** (la capa de precios). Eso es fase C y no es hoy. Lo de
> hoy hace que las tres pantallas dejen de mentir; **no** hace que el margen por
> canal exista.

---

## 1 · La causa, con la consulta delante

`menu_item_economics` —la RPC de la que cuelgan **Resumen**, **Rentabilidad** e
**Ingeniería de menús**— empezaba así:

```sql
FROM menu_item mi
  JOIN brand b          ON b.id = mi.brand_id
  JOIN sales_channel sc ON sc.id = mi.channel_id   -- INNER
  JOIN recipe_item ri   ON ri.id = mi.recipe_item_id -- INNER
```

Y en producción:

| medida | valor |
|---|---|
| `menu_item` de Foodint | **584** |
| …con `channel_id` | **0** |
| `menu_item` con `channel_id` en **toda la tabla, todas las cuentas** | **0** |
| `brand_channel` (marca × canal) | **0 filas. Vacía** |
| marcas de Foodint afectadas | **18 de 18** · 564 productos vivos |
| filas que sobrevivían al INNER JOIN | **0** |

**La RPC devolvía cero filas de verdad.** Las tres pantallas decían fielmente lo
que se les contestaba. **No es una regresión:** la función es del 27/05, las filas
de `menu_item` empiezan el 20/06 — **no ha habido un solo día en que enseñaran algo
en esta cuenta.**

## 2 · Dónde está el eje de canal DE VERDAD (RECON del §2.bis)

La pantalla de **Precios** sí enseña una columna por canal. Sale de
`brand_price_grid`, que expande cada producto con:

```sql
lateral menu_item_channel_economics(p.id, …) e
```

Y esa función **no menciona `mi.channel_id` ni una vez**. Construye el eje así:

```sql
WITH ch AS (
  SELECT sc.id, sc.name, sc.channel_type
  FROM sales_channel sc
  WHERE sc.account_id = v_account_id AND sc.is_active = true
)
```

**El canal es una propiedad de la CUENTA (5 canales: Glovo, JustEat, Mostrador,
Shop, Uber), no una columna del producto.** Un producto tiene un precio por canal,
no una fila por canal. Confirmado: **rellenar `menu_item.channel_id` habría sido
construir el modelo obsoleto y crear dos verdades sobre el mismo eje.** La opción
(b) queda descartada con prueba, no con opinión.

Y `menu_item_channel_economics` **ya calcula `net_margin`, `net_margin_pct` y
`contribution_margin_pct` por canal**. La fase C es, casi literalmente, hacer que
`menu_item_economics` delegue en ella. **Es más pequeña de lo que parecía.**

## 3 · El cambio de hoy: dos líneas

```
-     JOIN sales_channel sc ON sc.id = mi.channel_id
-     JOIN recipe_item ri   ON ri.id = mi.recipe_item_id
+     LEFT JOIN sales_channel sc ON sc.id = mi.channel_id
+     LEFT JOIN recipe_item ri   ON ri.id = mi.recipe_item_id
```

`JOIN brand b` **se queda INNER** a propósito: un producto sin marca no puede
existir con el `WHERE mi.brand_id = p_brand_id` delante.

**`recipe_item` también pasa a LEFT, y es deliberado.** Un producto sin escandallo
existe y hay que verlo: la función ya tiene el estado `no_cost` y la columna
`cost_available` para decirlo. Esconderlo sería la regla 7 al revés — el umbral
ordena, no decide la existencia.

`CREATE OR REPLACE` es correcto aquí (regla 2): **no cambia ni la firma ni el tipo
de retorno**, así que no puede crear una sobrecarga.

## 4 · Qué va a pasar, en números

Con el LEFT JOIN, `menu_item_economics` pasa de **0 filas** a **una fila por
producto vivo de la marca**, con:

- `channel_id` y `channel_name` a **NULL** → la pantalla escribe **«sin canal»**.
- `commission_pct`, `net_margin`, `net_margin_pct` a **NULL** en las marcas
  propias: sin canal no hay comisión que aplicar. **Esto es lo que el interino NO
  arregla, y por eso la cabecera lo dice.**
- `cost`, `packaging_cost`, `food_cost`, `food_cost_pct`, `contribution_margin`,
  `plate_cost_pct` **sí salen**: no dependen del canal.

Verificación con ventana **fija**, no relativa (regla 31 y la lección de B74):

- **Ay Mamita Bowls**, `menu_item_economics` tras el cambio: **23 filas**, de ellas
  **18 con `cost_available = true`**.
- Ventas 90 días de esa marca (`01/06/2026 00:00 → 06/09/2026 00:00`, Europe/Madrid,
  definición: `sale_line` de productos de la marca, `line_total` con IVA, ventas no
  canceladas): **21 platos con ventas · 16 de ellos con coste**.
- **Las cifras del §1 del encargo quedan derogadas como verificación**, incluida la
  mía de 9.995,13 €, que salía de una ventana relativa y de otra definición de
  ingreso que la de 8.565 €. **Dos varas, y ninguna escrita. No se usan.**

## 5 · Lo que puede salir mal

- **Que alguien lea «sin canal» como un dato y no como un hueco.** Por eso va con
  la nota en la cabecera, no solo en la celda.
- **Que Rentabilidad ordene por margen neto y ahora sea todo NULL** en marcas
  propias. La tabla tiene que aguantar la columna vacía sin romper el orden.
- **Que las licenciadas sí tengan margen neto** (va por `revenue_share_pct`, que no
  depende del canal) y las propias no. Es correcto y va a chocar a la vista: la
  cabecera lo explica.
- **Coste**: la RPC pasa de devolver 0 filas a devolver ~30 por marca. El Resumen
  las pide para las 18. Es lo que ya hacía; ahora traen datos.

## 6 · Cómo se comprueba que ha funcionado

1. `menu_item_economics('092fb053-…')` → **23 filas**, 18 con coste, todas con
   `channel_id` NULL.
2. Ninguna otra cuenta ve cambiar su número de filas a peor (hoy todas están a 0).
3. Rentabilidad e Ingeniería enseñan esas filas; **no** «no tiene platos».
4. Resumen: food cost medio y margen por marca **con valores**.
5. Fallo forzado: con la RPC rechazando (cuenta ajena) la pantalla dice **qué ha
   pasado**, no «no hay datos».
6. `npm run build` verde (B42). Lint y pruebas medidos **a los dos lados**.

---

## 7 · LO QUE PASÓ DE VERDAD (escrito después, 06/09 10:55 Madrid)

**Aplicado fuera de banda, 10:38 Madrid.** Migración **`20260906083848`**.

### La función: exacta, no «parecida»

No se reescribió a mano. Se sacó la definición viva, se comprobó que la copia era
byte a byte (`md5 ad879271ce87b4c47220de7ad761f312` a los dos lados), se cambiaron
**las dos líneas** y se aplicó. Después:

| | md5 |
|---|---|
| definición ANTES | `ad879271ce87b4c47220de7ad761f312` |
| definición DESPUÉS, en la base | `ca61a77588db57bee15549718df10b30` |
| el fichero que edité, en local | `ca61a77588db57bee15549718df10b30` ✅ |

**Idénticos.** Lo que corre es exactamente lo editado: sin deriva de transcripción
en 7.400 caracteres.

Y el fichero del repo coincide con lo que la base guardó como `statements`:
`0cd9a835391324404174f88f550950e3` (regla 17). *Nota de honestidad: la primera
comparación no cuadró. Dije que era porque la base había partido la migración en dos
sentencias — **falso**, era una sola. La diferencia real era un salto de línea antes
del `;` final. Corregido el fichero, no la explicación.*

### El efecto

| | antes | después |
|---|---|---|
| `menu_item_economics`, Foodint, marcas con filas | **0 de 18** | **18 de 18** |
| filas totales | **0** | **564** |
| …con coste | 0 | **435** |
| …con canal | 0 | **0** *(lo que el interino no arregla)* |
| Ay Mamita Bowls | **0 filas** | **23 filas · 18 con coste · 5 sin escandallo** |

Predicho en el §4 antes de aplicar: «23 filas, 18 con `cost_available`». **Clavado.**

**Ventana fija** `01/06/2026 00:00 → 06/09/2026 00:00` Europe/Madrid, definición:
`sale_line` de productos vivos de la marca, `line_total` con IVA, ventas no
canceladas → **21 platos con ventas, 16 de ellos con coste**, 1.049 uds,
9.693,93 €. La verificación del §2.bis («≥ 16 filas con coste») **pasa**.

### El front

`EstadoDeLaConsulta`: un componente, tres estados, y el error **manda** sobre el
vacío. Las tres pantallas lo usan. Las dos de canal llevan la nota de interino en
cabecera y «sin canal» en cada celda, en cursiva y atenuado — un hueco con nombre,
no un hueco.

El selector de canal de Ingeniería deja fuera los canales nulos (hoy, todos): una
opción sin valor vaciaría la tabla al elegirla. **Salen del selector, no de los
datos** — la matriz los sigue contando bajo «Todos los canales» (regla 7).

### Medido a los dos lados, misma vara

| | `origin/main` | con el cambio |
|---|---|---|
| `npm run build` | — | **verde, 7,88 s** |
| `npm run lint` | 1363 (1061 err · 302 avisos) | **1363 (1061 · 302)** |
| `npx vitest run` | 6 fallan · 718 pasan (724) | 6 fallan · **722 pasan** (728) |

Los **6 fallos son de `main`** (`routes`, `brandsService.mappers`,
`salesChannelsService.mappers`), los mismos de siempre. Los +4 son las pruebas
nuevas de `EstadoDeLaConsulta`.

### Dos decisiones mías que no estaban en el encargo, dichas

1. **`recipe_item` pasa a `LEFT`.** Hace visibles los productos sin escandallo
   (5 de 23 en Ay Mamita), marcados `no_cost`. Motivo: esconderlos es la regla 7 al
   revés. **Volver atrás es cambiar una palabra.**
2. **El selector de canal filtra los nulos.** Sin esto ofrecía una opción vacía que
   al pulsarla dejaba la tabla a cero — cambiar un cartel que miente por un
   desplegable que miente.

### Lo que NO se ha hecho, y por qué

- **§3.3, el rediseño con el patrón de Casado:** espera la maqueta. Principio 6.
- **La fase C:** que `menu_item_economics` delegue en `menu_item_channel_economics`.
  El RECON dice que es más pequeña de lo que parecía, pero es una decisión de
  arquitectura y no es de hoy.
- **Buscar otras funciones que hagan `JOIN` contra `menu_item.channel_id`.** Esa
  columna está vacía en la tabla ENTERA, todas las cuentas: cualquier otra consulta
  que la use está devolviendo cero y nadie lo ha notado. Se sale de B79. **Es una
  consulta y está sin hacer.**
