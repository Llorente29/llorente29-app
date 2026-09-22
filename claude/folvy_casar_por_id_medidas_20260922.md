# Casar por id, no por nombre — las medidas que cambian el encargo

> 22/09/2026, noche. Cuenta Foodint `51ad1792-6629-4ef7-833a-b57b09a86710`.
> Continúa `claude/folvy_recon_casar_por_id_20260922.md`. Todo lo de aquí está
> MEDIDO contra la base; las consultas están en
> `claude/folvy_casar_por_id_consultas_20260922.sql` para poder repetirlas.

## 1. Lo que ya está escrito (puntos 1 y 2)

`supabase/migrations/20260923T0015_casar_el_combo_por_su_id.sql`, commit `df313d0`.
**NO APLICADA**: `adapt_lastapp_order` es el camino del pedido.

- La matrícula del padre sale de `organizationProductId` **o** `organizationComboId`.
- El combo casa por id primero, por nombre después.
- `catalogProductId` queda fuera: otro espacio de ids (0 de 75 casan por él).

Para los **productos sueltos** no hacía falta cambio: el adaptador **ya** casaba
por `external_id` y marcaba `map_source='pos'`. El agujero era solo del combo.

## 2. La premisa del encargo que NO se sostiene

El encargo dice: «**1.567 € se arreglan con solo mirar el id antes que el
nombre**, sin tocar un solo nombre ni crear nada».

Medido sobre las 553 líneas sin casar de 30 días (lastapp, sin `ignored`/`delisted`),
simulando la carta de HOY por las dos vías:

| vía | líneas | euros |
|---|---|---|
| **A · casaría SOLO por id** | **0** | **0,00 €** |
| B · casaría por id y por nombre | 313 | 1.748,34 € |
| C · casaría solo por nombre | 183 | 4.217,60 € |
| D · por ninguna de las dos | 57 | 1.146,70 € |

**La casilla A está vacía.** No hay una sola línea que el id rescate y el nombre
no. Las 313 de la casilla B son recuperables —y son más euros que los 1.567 del
encargo— pero **no las recupera el id**: las recupera *volver a casar con la
carta de hoy*, porque el artículo que les falta ya existe (lo creó alguien a
mano después). El nombre, hoy, ya basta.

Dicho en corto: **casar por id no recupera nada hacia atrás. Su valor es
íntegramente preventivo.** Lo mismo que ya dije de los combos, ahora medido
sobre el universo entero.

### El caso que lo enseña mejor: «Cochinita Bowl AMB»

51 líneas, 730,14 €, `no_menu_item` — y el artículo existe **desde el 26/07**,
activo, con **ese id exacto y ese nombre exacto**. Frontera limpia: sin casar
del 01 al 14/09, casadas desde el 15/09 sin excepción. No es un renombrado del
canal: es que durante esos catorce días el casado falló por algo que **desde el
estado de hoy no se puede reconstruir** (no hay traza de qué tenía la carta
entonces). Lo digo así y no lo adorno.

*Deuda que deja:* no hay histórico de `menu_item.external_id`. Cuando el casado
falla por el estado de la carta en ese momento, no se puede auditar después.

## 3. El punto 3 está BLOQUEADO, y es la decisión de Julio

El encargo pide «recasado retroactivo del **casado**, no del stock», y añade:
«Si eso choca con la regla del 18/09, se para y se pregunta a Julio».

**Choca.** Medido:

```
CREATE TRIGGER trg_sale_line_consumption
  AFTER INSERT OR UPDATE OF menu_item_id ON public.sale_line
  FOR EACH ROW EXECUTE FUNCTION tg_sale_line_consumption()
```

Tocar `menu_item_id` **es** mover stock: el disparador llama a
`generate_sale_consumption(sale_id)`. No hay forma de recasar sin consumir,
salvo cambiando el motor, que este encargo prohíbe.

Y el corte lo remata:

| | líneas | euros |
|---|---|---|
| rescatables **por debajo** del último conteo (21/09 23:45) | **553** | **7.112,64 €** |
| rescatables por encima | 0 | — |

**Todas.** No hay una sola línea rescatable por encima del corte, así que no
existe la versión inocua de este punto. `recast_lastapp_sales` ya existe y ya
protege el corte (exige `p_ventas_esperadas` con la cifra exacta), pero lo que
protege es *no bajar*; si se baja, reprocesa consumo por debajo de un conteo
aprobado — la regla 6, el incidente del 25/08.

**Las tres salidas, y ninguna la elijo yo:**

1. **No recasar.** El pasado queda como está; el vigía aprende a leerlo. Coste:
   los informes siguen mintiendo hacia atrás sobre 7.112,64 €.
2. **Recasar solo el casado, con el disparador desarmado** para esa pasada
   (`alter table ... disable trigger`, dentro de la transacción). Recupera el
   casado, los informes y el coste de plato; **el stock no se mueve**. Coste: el
   consumo de esas ventas queda para siempre sin registrar, así que
   `sale_line.menu_item_id` y `stock_movement` dejan de contar la misma
   historia — y hay que decirlo donde se lea.
3. **Recasar y consumir**, aceptando reprocesar por debajo del conteo del 21/09.
   Coste: contradice la regla 6 y la del 18/09 de frente.

Mi recomendación es la **2**, y con una condición: que el vigía del encargo
hermano sepa distinguir «esta línea no consumió porque se recasó en frío» de
«esta línea no consumió porque está rota». Si no, la 2 le mete ruido al 100 %
que estamos construyendo.

## 4. Duplicados de carta (punto 4) — medidos

| agrupando por | grupos | artículos |
|---|---|---|
| nombre exacto (lo que dice el encargo: 11 / 22) | **9** | **18** |
| normalizador tolerante (paréntesis, dobles espacios) | **43** | **88** |

Los 43 grupos tienen **los dos artículos activos**. Reparto por riesgo:

- **28 grupos**: los dos apuntan a la MISMA ficha. Archivar el que sobra es seguro.
- **12 grupos**: combos o sin ficha propia.
- **3 grupos PELIGROSOS**: apuntan a **fichas distintas**, así que elegir mal
  cambia lo que descuenta:
  - Big Mike´s · `classic french fries bm`
  - Chivuos · `burger melt 2.0 ch`
  - Koreans · `loaded korean porky fries kdb`

## 5. El punto 5 DEPENDE del 4, y en ese orden

Hacer el normalizador tolerante hoy no es una red de seguridad: es meter
**ambigüedad** en 43 casos donde hoy hay dos artículos activos con el mismo
nombre suave, y en 3 de ellos con ficha distinta. El casado por nombre elegiría
uno de los dos con un `LIMIT 1` sin criterio.

**Primero se limpian los duplicados (punto 4), después se afloja el
normalizador (punto 5).** Al revés se rompe lo que hoy funciona.

## 6. Lo que queda, y no está bloqueado

- Punto 4: la pantalla/informe de duplicados (la medida ya está; falta la pantalla
  y el botón de archivar-y-llevar-la-historia).
- Punto 6: el aviso de renombrado en caliente.
- Los 57 líneas / 1.146,70 € de la casilla D necesitan artículo de carta. Eso no
  lo arregla el adaptador y no se inventa solo (condición del encargo).
