# F6 · B79 lote 4 — las dos piezas de base del Resumen

**06/09/2026 · rama `claude/b79-lote1-la-regla` · ESCRITO Y VERIFICADO, SIN APLICAR**

Las dos piezas que pide el lote 4: el §3.4 (`food_cost_dashboard.by_brand` con
`brand_id` y `ownership_type`) y la RPC de «las 5 cosas que arreglar», con la
definición de cada contador **en el cuerpo**.

Se aplican **cuando abra la ventana (23:45)**, no antes. Aquí está todo lo que
haría falta para decidir si se aplican, medido antes de tocar nada.

---

## 0 · Marcado de acciones operativas

| Acción | Estado |
|---|---|
| Ficheros de migración escritos en el repo | **hecho** (2) |
| Cuerpo de cada uno probado contra producción **sin crearlo** | **hecho** |
| Aplicado a la BBDD | **NO — la banda 12:15→23:45 está abierta** |
| Commit + push a `claude/b79-lote1-la-regla` | **hecho** |
| OTA | **no** — sale con los cuatro lotes juntos, después de las 23:45 |

Los dos ficheros llevan un nombre con la hora prevista de aplicación
(`20260906214600`, `20260906214700` = 23:46 y 23:47 de Madrid). Si al aplicar la
BBDD registra otra versión, **el fichero se renombra a la que registre la BBDD**
y se vuelve a comparar el md5 (regla 17). Se dice ahora para que no parezca
después que el nombre estaba elegido de antemano.

---

## 1 · Cómo se ha probado sin tocar la BBDD

Las dos son funciones. Una función se puede probar entera sin crearla: se coge
el CUERPO, se sustituyen los parámetros por literales y se ejecuta como consulta
de lectura. Eso es lo que se ha hecho con las dos, contra Foodint y contra los
datos de hoy.

### Pieza A — el «no he roto nada», con las dos cifras y la misma vara (regla 31)

No es una opinión: es el JSON viejo contra el JSON nuevo, en la misma sentencia,
con la misma ventana y el mismo `now()`.

| Comprobación | Resultado |
|---|---|
| `salud` idéntica | **true** |
| `by_dish` idéntico | **true** |
| `total` idéntico quitando las dos claves nuevas | **true** |
| `by_brand`: nº de filas | **17 antes · 17 después** |
| `by_brand` idéntico quitando `brand_id` y `ownership_type` | **true** |

La última fila es la que importa: `by_brand` pasa de agrupar por NOMBRE a agrupar
por `brand_id`, y el resultado sale **byte a byte igual**. Se puede afirmar por
qué: medido, en toda la tabla `brand` no hay ni un solo nombre repetido dentro de
la misma cuenta (cero grupos con `count(*) > 1`). Hoy el cambio no mueve nada; el
día que haya dos marcas con el mismo nombre, evita que se fundan en una fila sin
avisar — que es la regla 9 mordiendo por donde ya mordió con AMIRSA.

### Pieza B — los cinco contadores, contra la población real

| Contador | Hoy | De |
|---|---|---|
| Extras que cobran y valen 0,00 € | **100** (35 venden) | 120 que cobran |
| Platos en carta sin coste | **129** | 558 en carta |
| Platos en carta sin envase | **314** | 558 en carta |
| Ingredientes sin precio | **23** | 133 activos |
| Sin objetivo de comida | **sí** | — |

Y la comprobación de la condición de Julio: `todas_llevan_su_definicion` = **true**.
Cada uno de los cinco sale con su `definicion` y su `por_que_aqui` no vacíos, en
la salida, no en un comentario.

Las listas `peores` suman exactamente el total de su contador (100, 129 y 314,
comprobado sumando a mano las filas devueltas). No es un top tres: es la lista
entera. El corte a tres es de la pantalla, y la pantalla tiene que decir cuántas
deja fuera (regla 7).

---

## 2 · TRES COSAS DE LA MAQUETA APROBADA QUE LOS DATOS NO SOSTIENEN

Van aquí arriba y no en un anexo, porque dos de ellas cambian lo que la pantalla
tiene que decir, y una cambia el ORDEN de las filas.

### 2.1 · «23 ingredientes sin precio · por ellos, 16 recetas no cierran su coste»

Los 23 son exactos. **Las 16 no existen.**

Medido:
- esos 23 ingredientes aparecen en **0 líneas de receta** (`recipe_line`);
- en Foodint no hay **ni una** ficha activa de tipo `recipe` o `dish` con
  `computed_cost` a NULL.

Hoy no bloquean nada. La frase «por ellos, 16 recetas no cierran su coste» es
una relación de causa que no se puede probar y que además apunta a un efecto que
no está ahí.

**Qué he hecho:** el contador devuelve `usados_en_lineas_de_receta` (0) y
`recetas_que_bloquean` (0), y la fila baja del tercer al **cuarto** puesto. No es
una decisión de diseño mía: la propia maqueta dice que el orden es «ordenadas por
lo que más pesa en el 24,0 %», y con el dato corregido esta pesa poco. He aplicado
la regla aprobada a un dato corregido. Si prefieres el orden de la maqueta tal
cual, se cambia el campo `orden` y ya está — pero entonces la fila no puede
llevar la frase de las 16.

### 2.2 · «130 platos sin coste» son 129, y 128 de ellos **no tienen ficha**

`menu_item.recipe_item_id IS NULL` en 128 de los 129. El único que sí tiene ficha
es **«Tarrina Salsa Smokey (BM)»**, que apunta a un `raw` llamado «Salsa Smokey
Baconesa» con el `computed_cost` a NULL.

No es que su coste esté sin calcular: es que no hay a qué calculárselo. La acción
no es «poner coste», es «enlazar o crear la ficha». El contador devuelve
`sin_ficha` (128) y `con_ficha_sin_coste` (1) para que la pantalla pueda decirlo
bien y el botón lleve a donde tiene que llevar.

### 2.3 · «El envase que sí está puesto pesa 3,5 puntos del 24,0 %»

El número de hoy es **3,7**, y la forma de decirlo está mal.

Ese 3,7 sale del `packaging_cost` de las fichas de **hoy** aplicado a lo que se
vendió. El 24,0 % sale del coste **congelado en la venta** (`sale_line.computed_cost`,
B44). Son dos varas distintas: el 3,7 **no se puede restar del 24,0 como si fuera
un trozo suyo**. Es una estimación del orden de magnitud, y sirve para sostener la
única afirmación que de verdad importa en esa fila — que el food cost real es
MAYOR, porque 314 de 558 platos tienen el envase a cero. Esa parte se sostiene
entera.

Para que se vea de dónde sale: con todas las líneas, 2.707 € y 3,7 puntos; contando
sólo las líneas `product`, 2.378 € y 3,3. La diferencia son 329 € de líneas hijas
de combo y modificadores. Se devuelve la primera, porque el coste congelado del
padre sí incluye lo de sus hijos.

**Propuesta de texto para la pantalla:** «314 de 558 platos tienen el envase a
cero. El envase que sí está puesto vale unos 2.707 € de lo vendido en 30 días: el
food cost real es mayor que el 24,0 %.» Sin «puntos del 24,0».

---

## 3 · Qué hace cada pieza

### Pieza A · `food_cost_dashboard` — `CREATE OR REPLACE`, no `DROP` + `CREATE`

La regla 2 manda DROP+CREATE cuando cambia la **firma**. Aquí no cambia: mismos
cinco parámetros, mismos tipos, mismo `returns jsonb`. No puede nacer una
sobrecarga. Sólo cambia el contenido del jsonb, y de forma aditiva.

1. **`by_brand` gana `brand_id` y `ownership_type`.** El `ownership_type` porque
   la separación «tuyas / de terceros» **invierte la lectura**: 24,0 % en total,
   **18,5 %** en las propias, **26,8 %** en las cedidas, y las cedidas son el 67 %
   de lo vendido. El 24,0 % no es «cómo cocina Foodint»: es sobre todo la carta
   que manda el TPV de otro. Sin esa columna, la pantalla enseña un número que el
   usuario atribuye a lo que él controla, y no lo es.

2. **`by_ownership`**, el mismo corte ya sumado en SQL. No se deriva en el cliente
   sumando las filas de `by_brand` porque esas van redondeadas a euros enteros:
   sumar 17 redondeos es otra vara (regla 31). Y devuelve **tres** cubos, no dos:
   hay **3 unidades de venta, 31 €, sin marca ninguna**. Un corte de dos las
   tiraría en silencio. Salen como `sin_marca`; que la pantalla decida cómo
   decirlo, pero que no pueda no saberlo.

3. **`total` gana `envase_eur` y `envase_pts`**, con el aviso del §2.3 escrito en
   el cuerpo, no sólo aquí.

4. **Se corrige un comentario que ya no es verdad.** El bloque del umbral de 40
   decía «Foodint NO TIENE FILA en `kitchen_settings`». Medido hoy: **la fila
   existe** y es `target_food_cost_pct` quien está a NULL. La conclusión no cambia
   —el 40 sigue interino porque no hay objetivo con el que hacerlo relativo— pero
   la causa se cuenta como es. Un comentario que miente cuesta lo mismo que una
   pantalla que miente.

**Consumidores mirados antes (regla 32):** `foodCostService.ts` (`getFoodCost`) y,
a través de él, `MargenPlatoPage.tsx` y `RecomendacionesPage.tsx`. Los tres leen
claves por nombre; ninguno desestructura de forma exhaustiva ni cuenta claves.
Añadir campos no les toca. El tipo TS `FoodCostBrand` se amplía en el lote de front.

### Pieza B · `kitchen_catalog_gaps(p_account, p_ventana)`

**La condición de Julio, y cómo se cumple.** «La definición de cada contador
escrita EN EL CUERPO, no sólo en el comentario.» Viene de un caso real: la palabra
«interino» de `menu_item_economics` vivía en un `COMMENT ON FUNCTION`, Julio la
buscó en el cuerpo y no estaba — y tenía razón.

Aquí la definición **no es un comentario: es un dato que sale por la salida**.
Seis constantes de texto en el `DECLARE`, y cada contador devuelve la suya al lado
de su número, con las columnas exactas que ha mirado. La pantalla la puede
enseñar, un grep del cuerpo la encuentra, y el número no se puede separar de su
regla.

Las definiciones, tal y como las fijaste:

- **en carta** = `is_active IS NOT FALSE` **y** `archived_at IS NULL`.
  *(Medido: `menu_item.is_active` es NOT NULL, así que hoy `IS NOT FALSE` equivale
  a `is_active` a secas. Se escribe como lo pediste porque el día que la columna
  admita NULL la regla no cambia de significado sola.)*
- **con coste** = `recipe_item.computed_cost IS NOT NULL`.
- **extras que cobran sin coste** = la consulta del vigía de B73a, tal cual.
- **ingredientes sin precio** = el aviso que ya da el Resumen hoy.
- **sin envase** = `packaging_cost` a NULL o a cero.

**`SECURITY DEFINER`, y levanta en vez de devolver vacío.** Definer como su
hermana `kitchen_dishes_incomplete`, y por tanto sin RLS: cada consulta lleva su
`account_id` escrito, sin excepción (regla 9). Pero al revés que ella, si no hay
permiso **no devuelve cero filas: levanta**. Una pantalla que recibe cero de una
consulta denegada no distingue «no tienes permiso» de «no hay nada que arreglar»,
y eso es exactamente lo que B79 vino a matar (reglas 7 y 8).

`VOLATILE`, no `STABLE`, porque llama a `_impact_cost`, que es `VOLATILE`.
Nace declarada: `revoke execute … from public, anon` (regla 16).

---

## 4 · Lo que NO he hecho, y por qué

- **No la he aplicado.** La banda está abierta.
- **No he tocado el objetivo de comida.** `target_food_cost_pct` sigue a NULL:
  ponerle un número es una decisión de negocio, no de código. La RPC lo cuenta
  como lo que es, la quinta cosa que arreglar.
- **No he tocado la pantalla del Resumen.** Va después, con las dos piezas ya en
  la BBDD.
- **No he cambiado la maqueta.** Las tres correcciones del §2 están dichas aquí
  para que decidas tú; el código está escrito con la lectura corregida y se
  revierte con un campo.

---

## 5 · Respondido por el §3.10 del encargo, y aplicado a la pieza B

Julio cerró las dos preguntas y cambió un destino. Ya está en el código (la pieza
no se había aplicado todavía, así que es una edición limpia, no un parche):

| §3.10 dice | En la pieza B |
|---|---|
| Orden final: extras · sin ficha · sin envase · **sin objetivo** · **ingredientes** | `orden` 1..5 en ese orden, y el array sale en ese orden |
| «129 platos **sin ficha** de coste», botón **«Casar o crear la ficha» → Casado** | `accion` = `'Casar o crear la ficha'`; el desglose `sin_ficha` (128) / `con_ficha_sin_coste` (1) ya estaba |
| Frase nueva del envase, con los 244 que sí lo tienen | 558 − 314 = **244**, y `envase_eur` = 2.707 € sale de la pieza A |
| Ingredientes al último con su frase honesta | `por_que_aqui` reescrito; `usados_en_lineas_de_receta` = 0 lo sostiene |

Al reordenar los bloques rompí dos costuras del array (un cierre duplicado en el
cuarto y uno que faltaba en el quinto). **Lo cazó volver a ejecutar el cuerpo, no
mirarlo.** Corregido y re-ejecutado: los cinco contadores salen en el orden nuevo,
con `todas_llevan_su_definicion` = true.

---

## 6 · 🔴 UN CUARTO HALLAZGO, DEL MISMO DÍA: el botón «Poner objetivo» no tiene dónde ir, y hay ocho objetivos que no lee nadie

Salió de comprobar el destino del cuarto botón, como manda la regla «ningún botón
sin destino que exista hoy». Las dos mitades son la misma medición.

**`target_food_cost_pct` existe en DOS tablas.** En `kitchen_settings`, uno por
cuenta. Y en `menu_item`, uno por plato de carta. Medido hoy:

- **`kitchen_settings`: 3 filas, una por cuenta, y las TRES con el objetivo a NULL.**
  La fila la crea `NuevaCuentaPage` al dar de alta la cuenta y **no vuelve a
  tocarla nadie**: en todo `src/` no hay una sola pantalla que lea ni escriba
  `kitchen_settings.target_food_cost_pct`. «Ajustes» (`KitchenSettingsPage`) no lo
  menciona. *(Corrige de paso lo que yo mismo escribí ayer en el comentario del
  umbral de 40: no es que Foodint no tenga fila — la tiene, y el valor está vacío.)*

- **`menu_item`: 8 platos de Foodint SÍ tienen objetivo propio**, puesto a mano
  desde la pestaña Ficha, que es la única que lo edita. El más reciente es
  **«Budapest» (Lovers Burgers, 25 %), guardado HOY a las 12:09 de Madrid** — el
  mismo plato de B80. Los otros siete son de entre el 1 y el 2 de septiembre.

- **Y ni `menu_item_economics` ni `menu_item_channel_economics` los miran.** Las dos
  toman el objetivo de `ks.target_food_cost_pct`, el de la CUENTA; ninguna lee
  `mi.target_food_cost_pct`. Comprobado sobre el texto de las dos funciones, no
  sobre la suposición.

**Ocho objetivos rellenados a mano, uno de ellos hoy mismo, que no entran en ningún
cálculo.** Es la regla 30 en su forma exacta: trabajo YA HECHO que la pantalla no
ve, y que quien lo mire concluirá que no está hecho.

**Qué he hecho y qué no.** La RPC devuelve `platos_con_objetivo_propio` (hoy **8**)
para que la pantalla **no pueda decir «no hay objetivos» habiéndolos**. No he
tocado las dos funciones del motor ni la pantalla de Ajustes: son otro encargo, y
`menu_item_economics` la reescribe entera la fase C.

**Y el botón: por tu propia regla, no lo pinto.** «Poner objetivo» apuntaría hoy a
una pantalla que no tiene el campo. La fila sale con su cifra y su frase, sin
botón, hasta que decidas:

- **(a)** meter el campo en Ajustes (es un input y un `update`, media hora), o
- **(b)** que el motor lea el objetivo del plato cuando exista y el de la cuenta
  cuando no — que además rescata los 8 que ya están puestos.

**(b) me parece la buena**, y no por elegancia: hay ocho decisiones tomadas que
hoy se pierden. Pero toca `menu_item_economics`, que es de la fase C, así que la
decisión es tuya. Con (a) sola, los 8 siguen sin contar.


---

# 7 · §3.11 · (a) + (b), las dos, en este lote

Julio cerró la decisión: el campo entra en Ajustes **y** el motor lee el objetivo
del plato. No una sola. El motivo, con el que estoy de acuerdo y que no se me
había ocurrido decir así: **(a) sola fabricaría a sabiendas el defecto 7 de la
auditoría** — un objetivo en la ficha del plato que no hace nada y otro en Ajustes
que sí, dos verdades sin decir cuál manda.

## 7.1 · Una corrección de mi propia cifra: son 10, no 8

Cuando dije «8 platos» estaba contando **en carta** (`is_active IS NOT FALSE` y
`archived_at IS NULL`). El motor no filtra por `is_active`: filtra sólo
`archived_at IS NULL`, y por esa vara son **10**. Las dos cifras son ciertas y
miden cosas distintas; escribo las dos y de qué es cada una, que es lo que faltaba
la primera vez. **10 los ve el motor · 8 están en carta**, y los otros dos están
desactivados sin archivar.

## 7.2 · Pieza C (b) — el `COALESCE`, en las dos funciones

`supabase/migrations/20260906214800_b79_l4_el_objetivo_del_plato_manda_sobre_el_de_la_cuenta.sql`

- **`menu_item_economics`**: una línea.
  `COALESCE(mi.target_food_cost_pct, ks.target_food_cost_pct) AS target_food_cost_pct`.
- **`menu_item_channel_economics`**: la variable `v_target_own` se carga en el
  `SELECT` que ya lee el `menu_item`, y después
  `v_target := COALESCE(v_target_own, v_target)`.
  **Va después del `SELECT ... INTO` y no dentro, a propósito:** si una cuenta no
  tuviera fila en `kitchen_settings`, un `SELECT ... INTO` sin filas **no asigna
  nada**, y meter el `COALESCE` dentro dejaría sin objetivo a un plato que sí lo
  tiene. Hoy las tres cuentas tienen fila, pero la cuarta no tiene por qué.
- **El objetivo de COSTE DE PLATO no se toca:** `menu_item` no tiene esa columna
  (comprobado en `information_schema`). Sigue siendo sólo de la cuenta.
- `CREATE OR REPLACE` en las dos: ni la firma ni el tipo de retorno cambian, así
  que no puede nacer una sobrecarga (regla 2).

**De dónde sale el texto de cada función, porque no se reescribe de memoria:**
`menu_item_economics` del fichero cuya huella ya casaba con la función viva
(`ca61a77588db57bee15549718df10b30`), y `menu_item_channel_economics` de
`20260817215259_iva_1_menu_item_channel_economics.sql`, **cuyo cuerpo tiene la
huella exacta del `prosrc` vivo** (`2beefa9c5ab27289d162c8ec15e5fad1`, 8.296
caracteres). Comprobado antes de tocar nada.

> **Aviso para quien venga:** en el repo hay otro fichero,
> `20260817T2350_iva_1_menu_item_channel_economics.sql`, con un cuerpo distinto y
> más largo (9.425 caracteres) que **no** es el que corre en producción. No lo he
> tocado; queda anotado para que nadie lo tome por bueno.

### Qué cambia de verdad, contado antes de aplicarlo

Con la misma vara a los dos lados, sobre las **1.144** filas de `menu_item` sin
archivar de las tres cuentas: **cambian 6. Ni una más.**

| plato | marca | objetivo | food cost | antes → después |
|---|---|---|---|---|
| Birria Chicken Bowl | Bendito Burrito | 30 | 25,6 | `no_target` → `under` |
| Budapest | Lovers Burgers | 25 | 15,8 | `no_target` → `under` |
| Cheeseburger | Lovers Burgers | 25 | 15,8 | `no_target` → `under` |
| Marquesa de Choco-Avellanas | Bendito Burrito | 50 | 41,4 | `no_target` → `under` |
| Marquesa de Choco-Avellanas | Dirty Burger | 50 | 41,4 | `no_target` → `under` |
| Marquesa de Dulce de Leche | Dirty Burger | 50 | 41,6 | `no_target` → `under` |

Los otros cuatro de los diez son de marcas **cedidas**, y para una cedida las dos
funciones devuelven `'n_a'` pase lo que pase: su semáforo no se mueve. Uno de
ellos es **«Agua pet.» de Ay Mamita, con objetivo de comida del 30 % y coste 0** —
ruido del catálogo, no algo que arreglar aquí.

**Los seis van a `under`. Ninguno se pone en rojo.** Lo único que pasa mañana es
que seis platos dejan de decir «sin objetivo» y empiezan a decir «dentro del
objetivo». Es información, no alarma.

### La verificación del §3.11, hecha sin aplicar nada

El cuerpo de `menu_item_economics` con el `COALESCE` puesto, ejecutado como
consulta contra producción (Lovers Burgers):

| plato | objetivo | food cost | estado |
|---|---|---|---|
| Budapest | **25** | 15,79 | **under** |
| Cheeseburger | **25** | 15,78 | **under** |

Y la otra mitad de la verificación —«sus vecinos contra el de la cuenta»—: Lovers
Burgers tiene **23 platos sin archivar, 2 con objetivo propio y 21 que usan el de
la cuenta**, que está a NULL y por tanto siguen en `no_target` hasta que se ponga.

**Lo que NO he podido verificar sin aplicar:** la sintaxis completa de
`menu_item_channel_economics`. Es plpgsql con variables, y no hay forma de que
Postgres la analice sin crearla — y crearla es tocar la base dentro de la banda.
Se verifica **en el momento de aplicar**, con `pg_get_functiondef` y una llamada
sobre Budapest, que es la lección de la regla 2: se prueba inmediatamente después
de aplicar, no al día siguiente.

## 7.3 · Pieza D (a) — el campo en Ajustes

- **`src/modules/kitchen/services/kitchenSettingsService.ts`** (nuevo). Nace
  porque **no había ni una línea en todo `src/` que leyera o escribiera
  `kitchen_settings`**. Lee, guarda (update, y sólo inserta si no había fila, que
  funciona sin depender de que exista una restricción única sobre `account_id`) y
  cuenta los platos con objetivo propio.
- **`KitchenSettingsPage.tsx`**: sección nueva «Objetivo de comida sobre ventas»,
  entre Comisiones y Costes de escandallo. Ancla `#objetivo-de-comida`, que es a
  donde apuntará el botón del Resumen.
- **La confirmación lleva contenido, no un visto** (regla 8): al guardar dice
  «Guardado: 28 %. Se le aplica a 550 platos de la carta; los otros 8 siguen con
  el suyo propio». Y el fallo se enseña donde se ha producido.
- **Las dos verdades se dicen las dos:** debajo del campo, «la cuenta apunta al
  X %» **y** «N platos tienen el suyo propio y no usan éste (de M en carta)».
  Nadie tiene que adivinar cuál manda.
- **Una sola regla de validación** (`objetivoValido`), compartida por la pantalla y
  el servicio. Estaba escrita dos veces y las he juntado: si cada uno tiene la
  suya, un día el campo deja pasar algo que la base rechaza. **El cero no vale y
  no es lo mismo que vacío**: «sin objetivo» es un estado legítimo; «que la comida
  no cueste nada» pondría en rojo la carta entera.

## 7.4 · Números, con la misma vara a los dos lados

| | antes de la pieza D | después |
|---|---|---|
| `npm run build` | verde | **verde** |
| lint | 1359 (1058 · 301) | **1359 (1058 · 301)** |
| pruebas | 775, 6 rojas | **784, las mismas 6 rojas** |

Las 6 rojas son **las mismas que tiene `main`** (medido: `main` da 6 rojas de 609).
Ni una nueva.

**Y un fallo mío, cazado por medir los dos lados:** el primer intento del servicio
usaba `(supabase! as any)` cuatro veces y el lint pasó de 1058 a **1062 errores**.
Cuatro nuevos, todos míos. El servicio vecino (`channelRateService`) usa el cliente
tipado sin `any`; cambiado a eso, el número volvió **exacto** a 1058. Sin medir los
dos lados se habrían ido con un «no he roto nada» encima.

## 7.5 · Lo que queda de este lote

- Aplicar A, B y C cuando abra la ventana, y renombrar los ficheros a la versión
  que registre la base (regla 17).
- La pantalla del Resumen, con la fila «8 platos tienen su objetivo; los otros 550
  usan el de la cuenta, que no está puesto» → **botón «Poner objetivo», que ahora
  sí lleva a algún sitio**.
- Y una corrección pendiente de front que sale de la pieza C: el comentario de
  `priceGridService.ts` dice que no usa `food_cost_status` «porque sale
  `'no_target'` en toda la cuenta». Deja de ser cierto hoy.
