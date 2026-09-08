# RECON — Gestión de modificadores (08/09/2026)

**Qué es esto:** reconocimiento antes de tocar nada. Ninguna decisión tomada, ningún
código escrito. Todas las cifras son de **Foodint** y llevan `account_id` (regla 9);
la cuenta plantilla `Folvy Interno` comparte tablas y nombres y está excluida a
propósito, salvo donde se dice.

---

## 1 · El mapa: cuatro tablas y una que no se usa

| tabla | filas (Foodint) | qué guarda |
|---|---|---|
| `modifier_group` | 64 activos | el grupo («Elige tu salsa»), con `min/max_selections`, `group_type`, `brand_id` |
| `modifier_option` | 225 activas | la opción («Salsa Yogur»), con `price_impact` |
| `modifier_group_assignment` | 264 | qué grupo va en qué plato, y en qué orden |
| `modifier_recipe_impact` | 54, todos `confirmed` | lo que la opción CONSUME: ficha, cantidad y unidad |

🔴 **`modifier_option.recipe_item_id` está a NULL en las 225 opciones.** La columna
existe, el editor la lee (`modifierEditService.ts:82`) y **nadie la escribe nunca**:
el enlace al coste vive entero en `modifier_recipe_impact`. Son dos caminos para
decir lo mismo y uno está muerto — el defecto 7 de la auditoría, en pequeño. Quien
llegue nuevo va a leer esa columna y va a concluir que 225 opciones no tienen ficha.

**`modifier_option` y `modifier_recipe_impact` NO son 1 a 1**, y eso está bien: una
opción puede consumir varias cosas (lo arregló Extras). Por eso el enlace bueno es la
tabla de impactos, no la columna.

---

## 2 · Quién gestiona hoy, y desde dónde

**Un solo sitio: la ficha del plato.** `CatalogFichaPage` → `ModifierEditorSection` →
`modifierEditService`. Ocho operaciones de escritura: crear grupo, editarlo, asignarlo
a un plato, quitarlo de un plato, añadir opción, editarla, borrarla (soft-delete), y
asignar un grupo existente.

**Extras NO gestiona: sólo costea.** Va por `modifierImpactService` y toca únicamente
`modifier_recipe_impact`. Nombres, precios, grupos y asignaciones no se tocan desde ahí.

**Consecuencia medida:** para crear un grupo hay que entrar por un plato. No existe
ninguna pantalla que liste los 64 grupos de la cuenta.

### Lo que el editor SÍ hace bien, y hay que decirlo
- **Avisa de a cuántos platos afecta:** «Este grupo se usa en N productos. Los cambios
  afectan a todos» (`ModifierEditorSection.tsx:245`). No es un detalle: **20 de los 64
  grupos están en más de 5 platos y el más compartido está en 32.** Sin ese aviso,
  editar «Elige tu salsa» desde una hamburguesa cambiaría otras 31 sin que se vea.
- **Pide confirmación antes de borrar** (grupo y opción), desde la fase 6.
- **Borra en blando** (`is_active = false`), no destruye.

### Lo que el editor NO deja tocar, y la base sí tiene
`allow_repetition` · `is_active` de un grupo · el `position` de las opciones dentro
del grupo · `internal_name`. Son columnas vivas que sólo se pueden cambiar por SQL.

---

## 3 · 🔴 Lo grave: el TPV no manda ningún modificador desde el 20/06

**Medido, y con las dos varas escritas porque la primera lectura me engañó a mí:**

| tabla | última fila importada del TPV |
|---|---|
| `menu_item` | **05/09/26** |
| `modifier_group_assignment` | **06/09/26** |
| `modifier_group` | **20/06/26** |
| `modifier_option` | **20/06/26** |

Al ver sólo las dos últimas escribí «la última importación fue el 20/06, hace 80
días». **Es falso como afirmación general:** el importador corre y trae platos. Lo
que no trae, desde hace 80 días, es **un grupo o una opción nueva**.

Y hay dos lecturas posibles, que es justo donde no se puede elegir a ojo:
**(a)** el TPV no ha creado ningún grupo nuevo, o **(b)** el importador los está
dejando caer.

**El discriminador, medido:**

| platos importados del TPV | con algún modificador |
|---|---|
| hasta el 20/06 (481) | 130 · **27,0 %** |
| después del 20/06 (32) | 1 · **3,1 %** |

**Y los 31 sin ninguno no son bebidas.** Son «DOBLE SMOKEY Cheeseburger BM»,
«QUESATACOS DE BIRRIA DE CERDO DC», «WRAP CESAR (CH)», «Pita de Falafel»,
«Vegan Bowl (AMB)»… En una marca de hamburguesas, una hamburguesa sin un solo grupo
de modificadores no es creíble. **Apunta a (b), pero no lo prueba.**

### El mecanismo candidato, con fichero y línea
`lastapp-catalog-import/index.ts:111`, `upsertByExternalId`, **no hace upsert**: hace
insertar-o-saltar. Selecciona los que ya existen por `external_id` y sólo
`.insert(newRows)` los que faltan (línea 150). Nunca actualiza.

Eso tiene dos caras, y las dos importan:
- **Buena:** una corrección hecha en Folvy sobre algo del TPV **no se pisa** en la
  siguiente importación. (Hoy sólo hay 2 opciones tocadas a mano, del 20/07.)
- **Mala:** un cambio hecho en el TPV **no llega nunca**. Si en LastApp suben «Salsa
  Yogur» de 1,50 € a 1,80 €, Folvy cobra 1,50 € para siempre. Y Extras costea contra
  esa foto.

Y un segundo candidato en el mismo fichero (líneas ~424-432): `modifier_group.brand_id`
es NOT NULL y se resuelve por el **nombre de la primera marca** que usa el grupo
(`resolveBrand(groupBrand.get(gid))`); si no resuelve, `continue` — **el grupo se salta
en silencio**, y sin grupo tampoco se crea su asignación. Anclar por nombre es lo que
avisa la regla 9.

**Lo que lo cerraría, y no lo he hecho porque es ejecutar, no proponer:** una pasada
del importador con `dry_run` y leer su `report` (`modifier_groups`, `modifier_options`).
Si el informe dice que ve grupos y en la base no entra ninguno, es (b) y está
localizado. Es lectura pura, pero es invocar una función contra producción: lo ejecutas
tú, o me dices que lo lance.

---

## 4 · Lo demás que se ha medido

| medida | Foodint |
|---|---|
| opciones activas | 225 |
| que cobran (`price_impact > 0`) | 120 |
| **que cobran y no tienen coste confirmado** | **82** |
| grupos activos sin ningún plato | 5 |
| **asignaciones que apuntan a un plato ARCHIVADO** | **31** |
| impactos que apuntan a una ficha archivada | 0 |
| impactos por estado | `confirmed`: 54 |

- **Las 82 cuadran con lo que enseña Extras** (E31 de la lista de deudas, 08/09). Dos
  caminos distintos, el mismo número: la pantalla no miente.
- **Las 31 asignaciones a platos archivados** son basura silenciosa: no se ven en
  ninguna pantalla y engordan cualquier recuento que cruce grupos con platos.
- **Los 5 grupos sin plato** no son alcanzables desde ninguna ficha: para editarlos
  habría que entrar por un plato que no los tiene.

### Y un hallazgo de rebote, fuera del encargo
De los 32 platos importados después del 20/06, **11 llegaron con precio 0 €** —
«Milanesa de Pollo Napolitana (MH)», «Korean crispy Chicken Burger KDB», «Deep Mamma's
Pizza DP»… Un plato a 0 € en Rentabilidad no da margen: da una fila sin sentido. Es de
la familia de B90 (el casado por id), no de esta RECON, pero queda contado.

### Nota semántica (B89 confirmada, con los números de hoy)
`group_type` en Foodint, **grupos**: `choice` 45 · `extras` 12 · `removal` 6 ·
`cross_sell` 1. Y las **120 opciones que cobran**, repartidas: 68 de grupos `choice`,
**47** de grupos `extras` y 5 de `cross_sell`. Lo que la pantalla llama «extra» no es
`group_type='extras'` — sólo 47 de 120 lo son. **El enum no es la definición.**
(Cuadra con el 47/120 de B89, medido por otro camino.)

---

## 5 · Lo que yo propondría, en orden — y ninguna está decidida

1. **Cerrar el (a)/(b) del §3 con el `dry_run`.** Es media hora y decide si lo demás
   se construye sobre un catálogo vivo o sobre una foto de junio. Nada más debería ir
   antes.
2. **Que la importación actualice, no sólo inserte** — y que diga qué pisa. Aquí hay
   una decisión de concepto que es tuya, no mía: cuando el TPV y Folvy discrepan,
   **¿quién manda?** Hoy manda Folvy por accidente (no se pisa nada). Si pasa a mandar
   el TPV, las 2 correcciones hechas a mano se pierden — y la regla 1 dice que una
   corrección que el siguiente despliegue borra es una corrección con fecha de
   caducidad. Lo mismo aquí con la siguiente importación.
3. **Una pantalla de grupos de la cuenta**, con el mismo patrón que Extras: una fila
   por grupo, dónde se usa, y desde ahí editar. Hoy los 5 grupos sin plato no se
   alcanzan y crear un grupo obliga a entrar por un plato.
4. **Limpiar las 31 asignaciones a platos archivados** y decidir si un grupo sin
   plato se archiva o se enseña.
5. **Borrar `modifier_option.recipe_item_id`** o escribirlo. Las dos cosas valen;
   dejarlo como está, no.

**Lo que NO propongo todavía:** nada de la gestión en sí hasta saber si el catálogo
que se gestiona está vivo. Construir una pantalla de grupos sobre una foto de junio
sería trabajo bien hecho sobre datos muertos.
