# RECON · Lo que llega del TPV y Folvy no reconoce

**07/09/2026 · antes de construir nada · no se ha tocado la BBDD ni la aplicación**

Medido contra Foodint (`51ad1792-…`) con `account_id` en cada consulta (regla 9).
Donde mi número no coincide con el del encargo, lo digo.

---

## 1 · El hallazgo que cambia el encargo: los packs SÍ traen identificador

El §1 dice: *«28 de los 56 llegan SIN identificador de producto: son los packs.
Last no manda id para la cabecera del pack, sólo para sus componentes.»*

**Es cierto para `organizationProductId`, y sólo para ése.** La cabecera del pack,
tal y como llega en `raw_products`:

```json
{ "name": "PACK PA 2  (DC)",  "type": "COMBO",  "price": 4490,
  "organizationProductId": null,                            ← lo único que se lee hoy
  "catalogProductId":      "48ef8248-d8a5-4ffd-a0b7-b7c11c0f2e03",
  "organizationComboId":   "e83b04f0-a52e-4640-8b9f-5a6f7d983940" }
```

Sobre las **645 cabeceras de pack** de los últimos 30 días:

| campo | cuántas lo traen |
|---|---|
| `organizationProductId` | **0** |
| `catalogProductId` | **645 (100 %)** |
| `organizationComboId` | **642 (99,5 %)** |

Y el id es **más limpio que el nombre**: 52 `organizationComboId` distintos para 53
nombres distintos, y **ningún id tiene dos grafías**. El id ya funde
«Birria + Tequeños AMB» con «Birria + Tequeños (AMB)» sin normalizar nada.

**Dónde se pierde:** `adapt_lastapp_order`, línea 41 del cuerpo, lee
`organizationProductId` y nada más. Para un combo (líneas 72-77) el único intento
de casado es **por nombre exacto dentro de la marca del ticket**
(`lower(unaccent(...))`). Si el nombre no coincide al carácter, cae a
`no_menu_item` (línea 87).

**Consecuencia para el diseño:** la propuesta «por componentes» del §2.1 es
ingeniosa pero probablemente innecesaria como camino principal. Un pack se puede
casar por id igual que un producto. Los componentes valen como **respaldo** para
el 0,5 % sin `organizationComboId` y para componer el combo al crearlo.

---

## 2 · «No hay forma de enterarse antes» — no es así

El §1 dice: *«el catálogo de Last no los tiene… La venta es la única fuente. No
hay forma de enterarse antes.»* La búsqueda por API dio 0, pero nuestro **propio
espejo del catálogo** (`external_catalog_product`, que puebla `last-catalog-sync`)
sí los tiene: **19 de los 22 nombres de pack**.

Y los tenía **antes de la primera venta**:

| pack | fila del catálogo creada | primera venta |
|---|---|---|
| `PACK PA 2  DC` | **31/08 00:00** | 01/09 20:54 — **44 h después** |
| `Korean Crispy  Menu (Para 1) KDB` | **12/08 11:16** | 31/08 14:51 — **19 días** |

Con `seen_in_sale_at` **NULL** y `catalog_name` real
(«_______Dos Coyotes (Delivery-GLOVO)»): esas filas vinieron del catálogo, no de
la venta.

**Cuidado con el campo:** `seen_in_catalog_at` **se refresca en cada pasada** (lo
dice la cabecera de `last-catalog-sync`: *«last_synced_at se refresca SIEMPRE»*).
Mirarlo da «visto hoy a las 15:00» para todo y hace creer que el catálogo se
enteró tarde. El campo que dice cuándo lo supimos es **`created_at`**. Yo mismo
me equivoqué con esto en la primera consulta.

Por qué la búsqueda por API dio 0: los nombres reales llevan **doble espacio**
(«PACK PA 2  DC», «Korean Crispy  Menu»). Buscar «PACK PA 2» con un espacio no
casa.

**Esto abre una pantalla mejor que la del encargo:** avisar cuando un producto
nuevo aparece en el CATÁLOGO, no cuando ya se ha vendido 31 veces. El §2.3
propone un correo con lo vendido sin casar; con esto puede decir *«Dos Coyotes ha
sacado PACK PA 2: aún no se ha vendido»*. Es la diferencia entre un parte de
daños y un aviso.

---

## 3 · Las cifras del §1, con la vara puesta

El 609 mezcla tres cosas que no son la misma. Desglose de las líneas sin
`menu_item_id` (30 días, sin canceladas):

| tipo | razón | líneas | euros | nombres |
|---|---|---|---|---|
| `product` | `no_menu_item` | 283 | **5.509,69 €** | 35 |
| `product` | `no_recipe` | 14 | 176,50 € | 8 |
| `combo_item` | `no_menu_item` | 315 | **0,00 €** | 14 |
| `modifier` | *(NULL)* | **1.331** | 800,35 € | 73 |

Tres avisos para la pantalla:

1. **Los 315 componentes valen 0,00 €.** Se insertan con `unit_price = 0` y
   `line_total = 0` (`adapt_lastapp_order`, línea 183): el dinero del pack está
   entero en la cabecera. Contarlos como «cola» **duplica el trabajo aparente**:
   casar el pack los resuelve solos. No son filas que arreglar.
2. **Las 1.331 líneas de modificador NO son productos sin casar.** Su
   `unmapped_reason` es NULL: un modificador se enlaza por `modifier_option_id`,
   no por `menu_item_id`. Si el bloque filtra por `menu_item_id IS NULL` sin más,
   **enseñará 1.331 filas fantasma**. Y además son el encargo de Extras, no éste.
3. Con eso, lo que de verdad va en el bloque son **297 líneas de producto y
   5.686,19 €**, en **43 nombres** (no 56: los 56 salían de sumar los nombres de
   componente).

**Y el dinero está donde dice el encargo:** separando los productos que son pack
de los que no:

| | líneas | nombres | euros | líneas sin `organizationProductId` |
|---|---|---|---|---|
| packs | 188 | 22 | **4.208,90 €** | 184 de 188 |
| productos sueltos | 109 | 23 | 1.477,29 € | 14 de 109 |

Los packs son el **74 % del dinero sin casar**. La tesis del encargo se sostiene
entera; lo que cambia es que tienen id.

**Otra corrección menor:** el §3.1 predice «56 → ~45 filas». Ya hay **43 nombres
crudos** antes de normalizar nada; tras fundir grafías quedarán ~41.

---

## 4 · Buena parte del §2.1 ya existe, y nadie la encuentra

El §1 dice *«la cola de sin casar existe pero nadie la ve — no está en Casado»*.
No está en Casado, cierto. Pero **existe una pantalla entera**:

- `src/modules/kitchen/pages/SalesExceptionsPage.tsx` — **1.513 líneas**
- `src/modules/kitchen/services/salesReliabilityService.ts` — 630 líneas, con
  `resolve` en modo `'link'` (casar con un plato existente) y crear plato nuevo
  desde una venta huérfana

Se llega desde **Cartas → banner de fiabilidad → «Ver excepciones»** o
«Arreglar paso a paso» (`KitchenMenuPage.tsx:2698`). No está en el carril: no hay
entrada de menú, así que sólo la encuentra quien ya sabe que está ahí.

**Esto es una decisión tuya, no mía.** Las opciones no cuestan lo mismo:

- **(a) Mover/enlazar lo que hay** a Casado como tercer bloque, y añadirle lo que
  le falta (agrupar por nombre, packs por id, propuesta compuesta). Reaprovecha
  2.100 líneas probadas en producción.
- **(b) Construir el bloque nuevo** desde cero con el patrón de Casado, y decidir
  qué pasa con `SalesExceptionsPage` — dejar dos sitios que hacen lo mismo es
  exactamente la regla 30 esperando a morder.

Sin verla no puedo recomendarte una con honestidad. Lo que sí digo: **no se
construye un segundo sitio sin decidir qué pasa con el primero.**

---

## 5 · Las tres preguntas del §5, respondidas

**(a) Dónde se decide `no_menu_item`** — `adapt_lastapp_order`, cuerpo:

```
80  IF v_menu IS NOT NULL              THEN v_reason := NULL;
82  ELSIF v_matricula IS NULL AND NOT v_is_combo THEN v_reason := 'no_recipe';
84  ELSIF v_is_combo AND v_sale.brand_id IS NULL THEN v_reason := 'no_brand';
86  ELSE                                    v_reason := 'no_menu_item';
```

Producto suelto: por `organizationProductId`, con desempate por marca del ticket
si hay varios (líneas 46-70). Combo: **sólo por nombre exacto** (72-77).
Componentes de combo: por id, igual que un producto (145-167).

**(b) El alta automática de los 19** — los 19 `menu_item` `lastapp` creados en 30
días tienen **`created_by_name` NULL** (automáticos) y **todos con `external_id`**.
Salen de `lastapp-catalog-import`, que da de alta lo que trae
`organizationProductId`. Los packs quedan fuera **no porque no estén en el
catálogo** —están, §2— sino porque su identificador es `organizationComboId` y el
importador no lo mira.

**(c) `external_brand_map`** — `(account_id, source, external_location_id,
external_brand_id) → brand_id`, más `is_ignored`. 109 filas. Admite N ids por
marca y **ya se está usando así**: «Koreans do it better - Fried Chicken» tiene
**TRES** ids mapeados (`ddf75f61…`, `ef2ceaf9…`, `ffd0cfc1…`), no dos. El §2.2
está resuelto para este caso; lo que falta es la fila de «marca desconocida»
para un id que **no** esté mapeado.

---

## 6 · Lo que hace falta de ti antes de maquetar

1. **¿Casado por `organizationComboId`?** Es un cambio pequeño en
   `adapt_lastapp_order` y resuelve el 74 % del dinero por id, sin adivinar. Si
   sí, ¿se guarda en `menu_item.external_id` o en una columna propia? (Hoy
   `external_id` guarda el `organizationProductId`; meter dos clases de id en la
   misma columna es la trampa del §1 del RECON de Extras.)
2. **¿Avisar desde el catálogo, además de desde la venta?** Es lo que convierte
   el §2.3 en un aviso de verdad y no en un parte de daños.
3. **¿(a) o (b) con `SalesExceptionsPage`?** Necesito que la mires.
4. **Confirmar que el bloque excluye modificadores y componentes**, y que los
   euros son los de la cabecera.

Nada de esto se toca hasta que decidas. No he creado rama de trabajo todavía:
este documento va a la rama de la sesión, que no publica.
