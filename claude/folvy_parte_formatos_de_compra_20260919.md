# PARTE · Los formatos de compra: que el artículo se pueda terminar de una vez

**19/09/2026** · rama `claude/cool-thompson-msx9dg` · un solo parte, como pide el encargo.

**Marcado de acciones operativas:** `npm run build` exacto y en limpio ✅ · pruebas
✅ · lint medido a los dos lados ✅ · commit ✅ · push a la rama ✅ · **fusión a
`main` NO** · **nada aplicado en la base** · **nada en producción**.

---

## 0 · Lo primero: el síntoma tenía razón, la causa no era esa

Julio, el 19/09: *«Tengo que poner el formato del proveedor y no me deja.»*

**La Salsa Smokey Baconesa YA tiene su caja de 6 botes de 965 g en la base.**
Cloudtown `520801061`, formato «Caja», `qty_in_base` 5.790, `qty_per_parent` 6,
0,00741 €/g. Está bien puesta. Lo que no había era **una pantalla capaz de
escribirla la primera vez**: el editor bueno solo aparecía DESPUÉS de guardar.

O sea: la herramienta existía y se enseñaba tarde. Eso es lo que arregla este
encargo.

---

## 1 · Lo que pedía el §5.1 — medido antes de tocar código

### 1.1 · Qué escribe hoy cada camino, y cuál deja formatos huérfanos

| camino | ¿crea formato? | ¿crea o toca el enlace? | ¿deja huérfanos? |
|---|---|---|---|
| **Alta de proveedor en la ficha** (`setupSimplePurchase`) | Sí, y **siempre PLANO**: solo `qty_in_base`. Aquí estaba el problema | `linkSupplierFormat` | **No.** Compensa: si el enlace falla, archiva el formato recién creado |
| **Editor inline del formato** (`SourceRow.saveFmt`) | Sí: plano (`createPurchaseFormat`) o árbol (`ensurePackTree`, dos nodos) | `updateArticleSupplier` | **SÍ.** No compensaba, y al pasar de «Un total» a «Caja con piezas» dejaba el plano viejo sin enlazar |
| **Recepción de albarán** (`resolve_goods_receipt_line_format`) | Sí: plano, `source='albaran'`, `needs_review=true`, y solo si el OCR resuelve y no hay ya uno igual | Inserta o actualiza `article_supplier` ella misma; al confirmar, además, `learn_from_receipt` | **No**: el formato nace ya pegado a la línea |
| **Importación de catálogo** | Sí, `source='import'` | — | **SÍ** |

**Huérfanos vivos hoy en Foodint** (formato activo, sin archivar, que no enlaza
ningún `article_supplier`, ninguna `goods_receipt_line` y del que no cuelga
ninguna caja): **9**.

| origen | n | ejemplos |
|---|---|---|
| `manual` | **5** | Tajin con Limon → Bote (400) · Nachos (tortilla Chip) → Formato (750) · Tapa Salsero 120 Cc → Paquete 100 · Carne Hamburguesa 150 gr → Ud (1) · **Salsa Smokey Baconesa → Caja (5.790)** ← ver abajo |
| `import` | **4** | Tomate Frito → Lata (2.600) · CAJA GENERICA 1350Ml → Paquete (50) · CAJA GENERICA 780 Ml → Pack (50) · Crema Agria → Paquete (500) — los cuatro del 14/06 |
| `albaran` / `ai_suggested` | **0** | — |

**De dónde sale el de la Baconesa, y que conste (Julio, 19/09):** la «Caja»
plana de 5.790 g (`87030000-d0a6-460e-8a12-a08be17da8e9`) **no la dejó suelta ni
Julio ni yo por descuido**. La provocó una instrucción del proyecto de ayer —
guardar primero el formato plano y editarlo después a «caja con piezas»—: el
editor creó el árbol nuevo y dejó el plano colgando, que es exactamente el
agujero que esta rama cierra. **Que el SQL de limpieza de los 9 huérfanos lo
incluya con ese id**, y que quede dicho de dónde salió.

**Lo he cerrado en el camino que ya estaba tocando** (y lo declaro, porque el
alcance está cerrado y esto no venía en la lista): el editor inline ahora
archiva el formato plano que queda suelto al pasar a «Caja con piezas», y el
alta hace lo mismo. Los 9 huérfanos que YA existen **no los he tocado**: son
datos, y los datos los limpia Julio con SQL revisable, no yo de paso.

### 1.2 · La guarda de inmutabilidad, exactamente

`trg_recipe_item_purchase_format_immutable` (migración `20260815T0000`), `BEFORE
UPDATE ... FOR EACH ROW` sobre `recipe_item_purchase_format`.

- **Qué bloquea:** ÚNICAMENTE un cambio de `qty_in_base`, y solo si existe al
  menos una `goods_receipt_line` con ese `purchase_format_id` que tenga un
  `stock_movement` con `source_type = 'goods_receipt_line'`.
- **Qué NO bloquea:** el nombre, `use_in_count`, `is_active`, `archived_at`,
  `parent_format_id`, `qty_per_parent`, `needs_review`… todo lo demás pasa.
- **Mensaje, literal:**
  > `Este formato tiene movimientos de stock asociados. Archívalo y crea uno nuevo -- no se puede editar su contenido (qty_in_base).`
- `purchase_format_has_stock_movements(uuid)` es esa misma comprobación
  expuesta al cliente.

**Eso es lo que la pantalla C traduce a castellano**, y con el mismo número:
`historiaDelFormato` cuenta **líneas con movimiento**, no líneas a secas, para
que el aviso diga la cifra con la que la guarda decide y no una parecida.

### 1.3 · De qué tabla sale la línea del albarán

**`goods_receipt_line`.** Con el esquema delante, es la única de las tres que
tiene a la vez lo que hace falta:

| tabla | `purchase_format_id` | `supplier_code` | `qty_in_base` |
|---|---|---|---|
| **`goods_receipt_line`** | **sí** | **sí** | **sí** |
| `supplier_invoice_line` | no | sí | no |
| `purchase_order_line` | sí | no | no |

El texto entero del proveedor es **`goods_receipt_line.raw_text`** (con
`product_name` de reserva): es justo lo que `learn_from_receipt` copia a
`article_supplier.supplier_item_name`.

---

## 2 · El estado de la cuenta, con la vara dicha (regla 9 y regla 31)

Todo con `account_id = 51ad1792-…` (Foodint). Sin eso, el catálogo plantilla de
Folvy Interno entra en la cuenta y el número no es de nadie.

| | encargo (08:00) | medido ahora | vara |
|---|---|---|---|
| Artículos `raw` activos | 136 | **136** | `recipe_item` type='raw' e `is_active` |
| Con proveedor y formato | 105 | **104** | tiene ≥1 enlace activo con formato |
| A medias (sin formato) | 31 | **32** | ningún enlace activo con formato |
| …de esos, con movimientos | 26 | **27** | `stock_movement` > 0 |
| Enlaces activos | 269 | **269** | `article_supplier` `is_active` |
| Sin referencia | 73 | **73 enlaces** / **46 artículos** | `supplier_code` nulo o vacío |
| Enlaces sin formato | 7 | **7** | |
| Artículos con ≥2 enlaces | 71 | **71** | |
| …con ≥2 proveedores DISTINTOS | — | **55** | |
| Coste a mano (`fixed`) | 36 | **36** | |
| Formatos anidados **vivos** | 38 | **38** | `parent_format_id` no nulo **y activos** |
| …contando también los archivados | — | 50 | `parent_format_id` no nulo, sin filtrar |

**Dos avisos honestos sobre estas cifras:**

1. **«71 artículos con ≥2 proveedores» son en realidad 71 con ≥2 ENLACES.**
   Proveedores distintos son 55. La diferencia son 33 pares (artículo,
   proveedor) duplicados — ver §5.4.
2. **~~«38 formatos anidados» eran 38 a las 08:00 y son 50 ahora.»~~
   CORREGIDO (Julio, 19/09).** Era lo segundo: **mi consulta contaba los
   archivados**. Con la misma tabla y cuatro varas: Foodint activos **38** ·
   Foodint con archivados **50** · todas las cuentas activos 84 · todo 96. No
   se movió nada entre medias. **Vivos son 38**, y uno de ellos lo creó Julio
   esta mañana a las 08:09. Era yo midiendo con otra vara y llamándolo
   «hallazgo»: justo lo que la regla 31 dice que no se hace.

**El peor caso sigue siendo el que decía el encargo:** «Colorador amarillo
alimenticio», **651 movimientos de almacén**, sin formato, sin proveedor,
`computed_cost` nulo.

---

## 3 · Lo construido

Todo dentro del flujo del artículo. **Ninguna pantalla nueva** (decisión 1).

### 3.1 · El alta (A)

`PurchaseSourcesSection`, el formulario de «Añadir proveedor»:

- **Los dos modos desde el principio.** «De una pieza» y «Caja con piezas
  dentro». Es mover lo que ya existía en el editor, no inventarlo.
- **La frase:** `Caja · lleva · 6 · piezas de · Bote · de · 965 g`, y debajo
  `1 Caja = 6 Botes × 965 g = 5.790 g`. **El total se deriva**, nunca se teclea
  por separado: no puede descuadrarse del desglose.
- **Su referencia** (monoespaciada) y **cómo lo llama él**, con su porqué.
  `supplier_item_name` se podía escribir desde la ficha: hasta hoy solo lo
  escribía `learn_from_receipt` al confirmar un albarán.
- **El precio es el de la caja**, y al lado el €/g y el €/pieza en vivo,
  idénticos a lo que guardará el motor.
- **«¿En qué lo cuentas?»** por artículo → `use_in_count`. **Sin migración**:
  la columna existe desde el 10/09.
- **«Cómo queda»**: lo compro · lo cuento · lo gasto · él lo llama.
- **«Guardar y seguir luego»**: guarda el formato sin precio. Un artículo puede
  quedarse a medias a propósito; lo que no puede es quedarse a medias en
  silencio.
- **Al crear un artículo**, la ficha se abre por la compra con el formulario ya
  abierto: el alta y «de quién lo compras» son un solo flujo seguido.

### 3.2 · La ficha abierta (B)

- Cabecera **«Se gasta en g · Se cuenta en cajas»**, el coste grande y **de
  quién sale** («según CLOUDTOWN, S.L.»).
- **Una tarjeta por proveedor** con su referencia, su texto, su formato leído
  como frase y su precio.
- El principal marcado y **la fecha de su último albarán**.
- **Aviso cuando dos proveedores no se parecen.** Salta al doble o a la mitad
  del principal. Caso real: Alubias rojas, Makro 0,00054 contra Cloudtown
  0,00160 €/g → «sale a un tercio del principal». «Está bien» escribe
  `verified_at` y el aviso no vuelve; «Revisar el formato» abre el editor de ese
  proveedor.
- Pie: en qué sale en el recuento · en qué se gasta · cuántos platos lo usan.

### 3.3 · Editar con historia detrás (C)

La guarda **no se toca ni se rodea**: se explica antes.

- **«Este formato ya se ha usado N veces desde el <fecha>»**, con N = líneas de
  albarán **con movimiento de stock**, que es con lo que la guarda decide.
- La frase que quita el miedo: no se tocan las entradas ni los costes de antes.
- **«Lo que va a cambiar»**: hasta hoy / desde hoy, con el €/g de cada lado, y
  la explicación de que el precio de la caja no cambia — cambia cuánto trae.
- El botón pasa a decir **«Crear la versión nueva»** cuando ese es el caso.
- **Queda apuntado quién y cuándo**, dicho ANTES, que es cuando sirve.
- Y si el formato **no** tiene movimientos, también se dice: se puede corregir
  tal cual. Un aviso que solo aparece cuando hay peligro enseña a leerlo.

### 3.4 · Lo que está a medias (E)

En la propia lista de artículos, sin zona dedicada:

- Franja con el número **contado en vivo** y el porqué en la misma línea.
- Tres filtros con su cifra: **Sin formato · 32** · **Sin referencia · 46** ·
  **Coste a mano · 36**.
- Filas a medias con fondo distinto y sus sellos.
- **«Terminarlo»** abre la ficha por la sección de compra, y con el formulario
  abierto si no hay ni un proveedor.
- **«✓ terminado»** en lo que está listo, sin más ruido.

---

## 4 · Lo que no se ha construido, y por qué, con fecha

### D · «La caja ha cambiado» — ⏸ 19/09, esperando el sí de Julio

Es lo único del encargo que necesita **base nueva**, y la regla es que Claude
Code propone y Julio ejecuta. El SQL está escrito entero y **sin ejecutar**:

`claude/sql/20260919_D_aviso_cambio_de_caja_PROPUESTA.sql`

- Tabla `purchase_format_pending` **aparte**, no una columna en
  `recipe_item_purchase_format`. Si el formato en espera viviera en la misma
  tabla, todo lo que hoy lee formatos (el conteo, el coste, el catálogo del
  proveedor, los 50 nodos anidados) tendría que aprender a ignorarlo — y el día
  que uno se olvidara, un formato que nadie ha aprobado estaría costeando platos.
- `accept_pending_format` crea el formato nuevo (plano o árbol), repunta el
  enlace y **archiva** el viejo. Archivar no es borrar: su id sigue vivo en los
  albaranes y en `stock_movement`, y por eso no hace falta pelearse con la
  guarda — no se edita ningún `qty_in_base`, se crea uno nuevo.
- `reject_pending_format` **guarda el «no»**. Sin eso, el mismo albarán vuelve a
  proponer lo mismo la semana que viene y el operario aprende a ignorar avisos.
- **Ningún disparador. Nada en el camino del pedido.** Lo llama la aplicación al
  CONFIRMAR un albarán.
- Las tres medidas de la banda de servicio van escritas en el fichero, como
  consultas para ejecutar y pegar. Y aun así: **esto no es urgente, si hay dudas
  a las 23:45.**

La pantalla D se construye **en cuanto esa base esté aplicada**. Construirla
antes sería front llamando a una tabla que no existe: la regla 40 dice que eso
no se ve al desplegar, se ve meses después y delante de quien menos culpa tiene.

**Y una advertencia que me salió del propio fichero:** en el primer borrador de
ese SQL escribí **`recipe_item_line`** (la tabla se llama **`recipe_line`**) y
**`stock_movement.qty`** (la columna es **`qty_base`**). Los dos habrían pasado
cualquier revisión de lectura y habrían reventado al ejecutarlos. Los cacé
preguntando al esquema, no releyendo. Está anotado dentro del fichero.

### F3 · 1.280 / 1.366 px — 🟡

No lo he medido y no voy a decir que está bien. El diseño es fluido y las filas
nuevas llevan `flex-wrap`, pero eso es un argumento, no una medida.

---

## 5 · Las reglas que había que proponer antes, y lo que dieron

### 5.1 · «No cuadra»

Una magnitud del texto del proveedor que el formato guardado **no explica de
ninguna manera**.

1. Del texto se sacan las magnitudes: número + unidad de **lista blanca**
   (lista blanca y no «letras sueltas», porque «2 Latas» se leería como 2
   litros). `gne` entra a propósito: es como escribe Makro los gramos netos.
2. Solo cuentan las de la **misma dimensión** que la unidad base. «AGUA MINERAL
   FUENTEVERA 50CL» sobre un artículo que se cuenta en unidades no dice nada del
   formato: no se sella.
3. Una magnitud queda **explicada** si coincide (±1 %) con el total del formato,
   con su nº de piezas, con el contenido de una pieza, **o si algún entero
   suelto del propio texto multiplicado por ella da el total**.
4. Se sella solo si había magnitud comparable y **ninguna** quedó explicada.

**El punto 3 es el que hace la regla honesta, y lo descubrió la prueba, no yo.**
Sin él salían **8** sellos, y seis eran *cajas aplanadas correctas*: «CAJA 8
BOLSAS DE 500 GR» guardada como un único nodo de 4.000 g. 8 × 500 = 4.000 — el
número no miente; lo que se perdió es la FORMA, que es justo lo que arregla A1.
Sellarlas de «No cuadra» habría sido mentir, y habría enseñado a ignorar el sello.

**Y falta un quinto punto, que es la corrección de Julio del 19/09.**

5. Una magnitud **solo habla del envase si lleva delante una palabra de envase
   o de tamaño** («caja», «bolsa», «botella», «de», «contiene», «x»…) en los 16
   caracteres anteriores. Un número pegado al NOMBRE DEL PRODUCTO dice lo que
   pesa una **pieza**, no lo que trae la caja.

**Por qué, y midiendo antes de decidir, como pediste.** La pregunta era cuántos
de los 115 textos comparables nombran el peso de la pieza, para quitar esa
magnitud «si son varios». **No son varios: es UNO**, y es justo el de las
Delicias — al mismo resultado con cuatro umbrales distintos (1/4, 1/5, 1/10 y
1/20 del total). O sea que tu condición no se cumplía.

**Aun así he cambiado la regla, y digo por qué.** No por esa fila —eso sería
ajustar la regla a un caso, que es el espejo de la regla 31 por el otro lado—
sino porque el criterio que diste es correcto por su significado: 35 g es un
meteorito de pollo y 2.200 g es la caja; que uno no sea múltiplo del otro no
dice nada malo del formato. Y un sello que grita en falso enseña a no leer
sellos, que es la familia de las reglas 7 y 8.

**El coste, medido y dicho:**

| | comparables | sellados |
|---|---|---|
| sin el punto (c), caja aplanada | 165 | **8** — seis eran cajas correctas |
| con (c), sin (c-bis) | **115** | **2** — el segundo, falso |
| con (c) y (c-bis) ← **lo que va en la rama** | **93** | **1** |

**22 enlaces dejan de poder comprobarse.** Su tamaño va pegado al nombre del
producto («ACEITE GIRASOL 25 LT», «Falafel Preparado 1kg Take») y desde fuera
no hay manera de saber si habla de la caja o de la pieza. Ese es el precio de
no mentir, y prefiero pagarlo: un «no cuadra» falso cuesta más que un «no lo sé».

La ventana de 16 caracteres también está medida: con 10 se pierden enlaces
buenos («… CAJA 6 UD DE 3 KG»), y con 24 vuelve a colarse el falso.

**El único sello vivo hoy, y el único que vale como caso de prueba:**

| artículo | proveedor | su texto | formato | por qué |
|---|---|---|---|---|
| **Aceite de Oliva Suave 0,4º** | Makro `137211` | «RIOBA aceite oliva virgen extra **botella** 250ml» | Botella de **1.000 ml** | «botella» va delante, así que la magnitud habla del envase; y ningún entero del texto × 250 da 1.000 |

**DELICIAS DE POLLO SOUTHERN ya no se sella**, y además queda dicho que no sirve
de caso de prueba: no está en ninguna receta y su último consumo fue el 07/08.
Está muerto.

### 5.2 · «Repetido»

**Dos o más enlaces VIVOS del mismo artículo con el mismo proveedor.** Medido:
**33 pares, 22 artículos.**

**Y no es descuido de nadie.** `learn_from_receipt` tiene dos `INSERT … ON
CONFLICT` con claves distintas: uno por `(supplier_id, supplier_code,
recipe_item_id)` cuando hay referencia, y otro por `(recipe_item_id,
supplier_id) WHERE supplier_code IS NULL` cuando no la hay. Así que el mismo
proveedor acaba con **una fila por referencia distinta MÁS una fila con
referencia nula**, y se duplica solo. Se ve clavado en los dos casos del encargo:

- **Aceite Alto Oleico**: Cloudtown `510101002` y Cloudtown sin referencia — y
  **el principal es el que NO tiene referencia**.
- **Agua Mineral 50 CL**: Bodega de Vallecas `3841236` y Bodega de Vallecas sin
  referencia.

Eso es una deuda de la base, no de la pantalla. **Va al parte, no al código**,
como manda el encargo. El sello sirve para verla; arreglarla es otro encargo.

### 5.3 · La prueba, contra la población real

`tests/unit/modules/kitchen/formatosDeCompra.test.ts`, contra los **165 enlaces
reales** leídos de la base el 19/09 (`formatosDeCompra.poblacionReal.ts`, con la
consulta que los sacó escrita dentro). **13 pruebas, 13 en verde.**

Con ejemplos inventados la regla del punto 3 no habría existido: los inventados
confirman la suposición que los escribió. Fueron los nombres de verdad los que
llevaron la contraria.

---

## 6 · Lo que he encontrado y no he tocado (va aquí, no al código)

1. **Los 33 pares duplicados** y su causa en `learn_from_receipt` (§5.2).
2. **Los 9 formatos huérfanos vivos** (5 manuales, 4 de la importación del 14/06).
   He cerrado la puerta; la limpieza es un SQL que ejecuta Julio.
3. **`resolve_goods_receipt_line_format` reutiliza formatos sin mirar
   `archived_at`.** Su búsqueda es `f.account_id = … and f.item_id = … and
   f.is_active and abs(f.qty_in_base - v_ocr_qty) < 0.01`. Como `archiveFormat`
   pone `is_active=false` Y `archived_at`, hoy no muerde; pero cualquier camino
   que archive poniendo solo `archived_at` haría que un albarán resucite un
   formato archivado.
4. **Las cajas aplanadas.** Al menos 6 enlaces tienen un formato plano cuyo total
   es correcto pero cuya forma se perdió (Guacamole 8×500, Pulled Pork 3×2 kg,
   Solomillo 5×1 kg ×2, Bacon…).

5. **Sweet Potato Fries NO es una curiosidad: es un recuento que miente.**
   Corregido de categoría por Julio el 19/09, y con la base delante:
   - Cloudtown `220202001`, su texto: **«BONIATO BASTON CAJA 5 BOLSAS DE 2 KG CONG»**.
   - Lo guardado: **Caja 10.000 g = 4 × Bolsa de 2.500 g**.
   - Y el enlace de Coheldi del mismo artículo tiene **`use_in_count = true`**.

   O sea: **hoy, en el recuento, ese artículo se cuenta en bolsas de 2,5 kg que
   no existen.** Quien cuenta ve bolsas de 2 kg. Cinco bolsas reales se apuntan
   como 12,5 kg cuando son 10.

   **No lo arreglo yo**: va al parte de almacén,
   `claude/folvy_parte_almacen_20260919_sweet_potato_recuento.md`.
6. **El `parent_format_id` se lee al revés de lo que suena:** el PADRE es la
   PIEZA y el HIJO es la CAJA. Los 50 formatos anidados vivos dependen de ello.
   Lo he documentado en el código en vez de cambiarlo.

---

## 7 · Comprobaciones, con las cifras a los dos lados

| | antes (`origin/main`) | después |
|---|---|---|
| `npm run build` exacto, tras borrar `*.tsbuildinfo` | — | **✓ built in 9.49s** |
| Pruebas | — | **106 ficheros, 1.619 pruebas, todas en verde** |
| Lint, `PurchaseSourcesSection` + `KitchenItemsPage` | **6 problemas (6 errores)** | **6 problemas (6 errores)** |
| Lint, `KitchenItemDetailPage` + `types/kitchen` + `purchaseFormatService` | **11 (5 errores, 6 avisos)** | **11 (5 errores, 6 avisos)** |
| Lint, los 4 ficheros nuevos | no existían | **0** |

El lint no es una opinión: se midió `origin/main` en un `git worktree` aparte con
el mismo `eslint` y los mismos ficheros. Dos errores nuevos míos
(`react-hooks/set-state-in-effect`, de abrir un panel dentro de un efecto) se
cerraron pasando la apertura a `requestAnimationFrame`, que además es lo
correcto: el scroll necesita que la sección esté pintada.

**Lo que NO se ha comprobado: las capturas a 1.280 px.** Lo intenté con el
preview que me pasaste y **lo dejo medido, no supuesto**:

```
curl -L https://folvy-lqetsb2ma-llorente29s-projects.vercel.app/
  → curl: (56) CONNECT tunnel failed, response 403

$HTTPS_PROXY/__agentproxy/status → recentRelayFailures:
  { "kind": "connect_rejected",
    "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
    "host": "folvy-lqetsb2ma-llorente29s-projects.vercel.app:443" }
```

La política de red de este entorno deniega ese host. Y aunque la abriera, las
cinco pantallas con **datos reales** necesitan una sesión de Foodint, y aquí no
hay `.env` ni credenciales. **Las capturas son tuyas**, y hasta que llegues con
ellas no hay ningún ✅ en la lista.

**Apuntado para el próximo parte:** el enlace del preview va siempre. Es lo que
convierte «lo he construido» en «se puede ver» — y esta vez me lo has tenido que
dar tú.

---

## 7 bis · Tercera vuelta (19/09) — el cruce contra la maqueta

Cruzado en el preview `a55a57e`: 17 de 25 puntos tal cual se aprobaron, y tres
cosas bloqueando. Las tres, corregidas, más los cuatro reparos menores.

### El plural, medido antes de arreglarlo

El fallo que se veía: **«Se cuenta en latases y cajas y latas»**, y «boteses» en
la Baconesa. Tres cosas en una frase.

**La medida, que era lo que pedías:** de los **281 formatos vivos** de Foodint,
**4** tienen el nombre ya en plural —«bolsas», «botes», «Latas»— y **ninguno** es
una palabra singular acabada en «s». Así que la regla es **«si acaba en s, no se
toca»**, que sale de los datos, y no una lista de excepciones.

**Y la medida cambió el diagnóstico de lo otro: NO había unidad repetida.**
Alubias rojas tiene de verdad **tres** formatos marcados para contar:

| formato | contenido | conteo |
|---|---|---|
| Caja | 18.000 g | sí |
| Lata | 1.600 g | sí |
| **Latas** | **3.000 g** | sí |

«Lata» y «Latas» **no son un duplicado**: son dos envases distintos con el mismo
nombre —la lata de Makro y la lata de dentro de la caja de Cloudtown—. Iba a
fundirlos por nombre, y habría escondido una fila que existe, que es justo lo que
prohíbe la **regla 7**. Lo que hace ahora: cuando dos nombres chocan al ponerlos
en plural, **cada uno lleva detrás cuánto trae**:

> Se cuenta en **cajas · latas de 1.600 g · latas de 3.000 g**

Unidos con «·». Y de paso, «Bidón» → «Bidones», que la tilde se cae.

### El alta pregunta de quién lo compras

Tenías razón y mi commit se pasó de título. Lo que había era el ENLACE: al crear
un artículo, la ficha se abría por la compra con el formulario desplegado. Pero
«+ Nuevo ingrediente» seguía preguntando tres cosas y punto, y la decisión 1 dice
que **al crearlo pregunta lo que hace falta**.

Ahora el alta tiene **dos pasos**, y el segundo es **la misma sección de la
ficha** (`modoAlta`), no un formulario nuevo:

1. Nombre · ¿Cómo se mide? · Precio (opcional) → **«Siguiente: de quién lo compras»**
2. La sección de compra, con el formulario abierto, sin los botones de escandallo
   ni el pie —que en un artículo recién nacido no dicen nada—. Sale por «Listo»,
   y **se puede salir sin proveedor**: el artículo queda a medias a propósito y
   la lista lo dirá con su sello.

Si el paso 2 fuera una copia del formulario, habría dos sitios donde arreglar el
mismo fallo. Por eso es el mismo componente con dos cosas calladas.

### «Cómo queda» estaba, y escondido es como no estar

A8 sí estaba construido, pero **solo aparecía cuando el formulario ya estaba
relleno**, o sea justo cuando ya no hacía falta: quien lo abría en blanco no veía
las cuatro preguntas por ningún lado. Es el mismo error de fondo que la regla 8,
un piso más abajo — esconder que algo existe hasta que ya da igual.

Ahora sale **siempre** con el formulario abierto, con «—» y una frase en lo que
falta («— dime cuántas piezas trae y cuánto lleva una —»). Enseñar el hueco es la
mitad del trabajo del resumen. Y se le ha añadido la cuarta línea que faltaba, la
del precio.

### Los cuatro reparos

| | qué se ha hecho |
|---|---|
| **El €/pieza (A5)** | la tarjeta dice ya `28,84 € / caja · 4,81 € / lata` cuando la caja tiene piezas |
| **El separador de miles** | una sola función en toda la sección. En es-ES el separador se omite por defecto en los números de cuatro cifras, así que «5790» y «5.790» eran las dos «correctas»: cantaba verlas juntas, no cada una por su lado |
| **Cuatro sellos en una fila** | **uno**. Manda lo que está MAL (No cuadra, Repetido) sobre lo que FALTA (formato, referencia, coste); el resto va como «+N» y en el título, y se sigue contando en los tres filtros — no se esconde nada. Y «sin terminar» se calla cuando ya hay sello: repetía en vago lo que el sello dice con nombre |
| **C5 en pasado** | en futuro: «Cuando guardes quedará apuntado que lo cambiaste tú, …» |

### C3 · lo que preguntas, contestado

**Sí está construido.** Es el bloque «Lo que va a cambiar» dentro del ámbar, y
sale cuando el formato tiene movimientos **y** el contenido cambia de verdad.

**Con qué caso lo probé: con ninguno en pantalla, y eso lo digo.** No puedo
escribir en un formato de producción — igual que a ti te lo bloqueó el entorno, a
mí me falta la sesión. Decir «lo he probado» sería lo que costó el 16/09.

**Lo que sí he hecho esta vuelta**, para que deje de ser una promesa: he sacado
la cuenta del componente a `lib/formatosDeCompra.ts` (`loQueVaACambiar`) y la he
probado **con los números reales de Alubias**:

| | |
|---|---|
| hasta hoy | Caja de **18.000 g**, 28,84 € → **0,0016022 €/g** |
| si pasara a 6 × 2.500 | Caja de **15.000 g**, **los mismos 28,84 €** → **0,0019227 €/g** |

Que es lo que dice la pantalla: **el precio de la caja no cambia; cambia cuánto
trae, y por eso cambia el gramo.** La aritmética está fijada por prueba; lo que
falta por ver es el montaje, y para eso hace falta que alguien teclee. **Déjalo
en 🟡 hasta entonces**, no en ✅ — y si al mirarlo en el preview puedes abrir el
editor de un formato con movimientos (Alubias sirve: 15 usos desde el 23/06),
con verlo aparecer basta.

### F3

Aceptado como **deuda aparte**: la barra horizontal es de toda la aplicación.
No la cuelgo de esta rama ni la arreglo aquí.

## 7 ter · Cuarta vuelta (19/09) — los dos retoques y el alta que escribía

**La dirección de la rama, que es la que vale a partir de ahora:**
`folvy-app-git-claude-cool-thompson-msx9dg-llorente29s-projects.vercel.app`.
Apunta siempre al último commit, así que Julio no tiene que volver a entrar
cada vez que empujo. La de cada despliegue queda retirada.

### La pregunta: sí, «Siguiente» creaba. Era mi fallo y está cambiado

**Con el camino delante, no de memoria.** Lo que había:

```
handleSubmit()  →  await createRecipeItem(...)  →  setCreado(created)
```

O sea: **pulsar «Siguiente: de quién lo compras» escribía el artículo**. Y
tienes razón en lo que eso significa: cada alta empezada y abandonada dejaba un
artículo vacío en la lista, justo la que la franja de «a medias» intenta
ordenar. **El alta era la fábrica de lo que la pantalla E cuenta.**

**Cómo queda:**

| | |
|---|---|
| Paso 1, «Siguiente» | **no escribe nada.** `handleSubmit` no tiene ni un `await`: solo guarda lo tecleado en memoria como BORRADOR (`id` vacío) y avanza |
| Paso 2, la sección de compra | trabaja contra el borrador: no consulta proveedores ni formatos del artículo porque todavía no existe |
| «Guardar compra» | **aquí nace el artículo**, lo primero de todo, porque el formato y el enlace cuelgan de su id |
| «Guardar y seguir luego» con el formulario en blanco | crea **solo el artículo** y lo dice: «… creado, todavía sin proveedor. Saldrá en la lista como "Falta el formato"» |
| Cerrar o «Cancelar» | **no se crea nada**, y el pie lo avisa antes: «Si sales ahora no se crea nada» |

`crearArticulo` se llama desde exactamente dos sitios, los dos dentro de
`handleAdd`. Comprobado con `grep`, no con la cabeza.

### Los dos retoques

1. **«4,81 € / latas» → «/ lata».** Es el mismo animal que el plural, con la
   otra piel: en la base ese formato se llama «Latas», y en un precio unitario
   se dice cuánto cuesta UNA. `singular()` es el inverso exacto de `plural()`:
   «-ones» → «-ón», «-ces» → «-z», y si no, se quita la «s».
   **Y la prueba lo cazó**: mi primera versión quitaba «es» y devolvía
   «botes» → «bot». En castellano «botes» es ambiguo —puede venir de «bote» o
   de «bot»—, y en esta población todos los plurales son del tipo «+s».
2. **El orden de la cabecera.** Ordenar por nombre agrupaba, pero dejaba
   «botes · cajas»: el envase pequeño primero. Ahora **cada grupo va donde lo
   pone su miembro más grande**, y dentro también de mayor a menor:

   > Se cuenta en **cajas · latas de 3.000 g · latas de 1.600 g**

### Comprobado

`npm run build` exacto y en limpio ✓ · **1.633** pruebas en verde · lint **6 → 6**
en los ficheros tocados (misma vara sobre `origin/main`), limpio en los nuevos.

## 8 · Lo que espera tu sí

1. ~~Capturar las cinco pantallas~~ **hecho por Claude el 19/09.** Ahora:
   **volver a mirar el preview del commit nuevo** con las tres correcciones, y
   dar o no el visto. Lo que conviene mirar primero:
   - **Alubias rojas**: la cabecera debe decir «cajas · latas de 1.600 g · latas
     de 3.000 g», y la tarjeta de Cloudtown el €/lata.
   - **«+ Nuevo ingrediente»**: el botón dice «Siguiente: de quién lo compras» y
     el paso 2 trae el formulario abierto.
   - **Cualquier artículo a medias**: un solo sello por fila.
   - **Alubias → editar formato**: si puedes teclear ahí, C3 se cierra.

   **El primer caso que hay que probar es la Salsa Smokey Baconesa**, y no por
   simetría: su enlace tiene `supplier_item_name` **vacío** y **ningún formato
   del artículo con `use_in_count`**, así que hoy ese artículo **no se puede
   contar**. Los dos huecos los rellena la pantalla nueva del tirón — y si no
   los rellena, la pantalla está mal.
2. **El SQL de D** (`claude/sql/20260919_D_aviso_cambio_de_caja_PROPUESTA.sql`):
   leerlo, decidir, y ejecutarlo tú si te convence — **fuera de la banda**, y
   con las tres medidas pegadas. Después construyo la pantalla D.
3. **Fusionar a `main`**, sabiendo que eso publica también el front de las
   tablets. Y que **no está hecho hasta que Vercel diga READY**, no cuando el
   commit esté en `main`.
4. Decidir si los **33 pares duplicados** y los **9 huérfanos** son un encargo
   aparte. Yo creo que sí: son datos, y el arreglo de verdad está en
   `learn_from_receipt`, no en una pantalla.
