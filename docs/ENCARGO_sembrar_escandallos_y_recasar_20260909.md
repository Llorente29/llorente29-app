# ENCARGO — «Sembrar escandallos y recasar»: que no siembre propias, que no siembre de junio, y que diga qué hizo

**Fecha:** 09/09/2026 · **Estado:** propuesta, sin construir · **Origen:** Julio, con el botón delante:
«¿qué hace exactamente? Qué tablas escribe y cuántas filas movería ahora mismo. No lo voy a pulsar hasta
saberlo.» De ahí salió la medición de abajo, y de la medición este encargo.

## §1 · Qué hace hoy, medido (09/09, sin escribir nada)

Son **dos RPC en cadena** detrás de un botón (`IntegrationsSection.tsx:264` → `seedAndRecast`).

### `seed_catalog_canonical(cuenta)` — escribe en 3 tablas

Lee del **espejo `external_catalog_product`** (el que llena `last-catalog-sync`), **no** del catálogo que
trae `lastapp-catalog-import`. Por cada `organization_product_id` resuelve la marca **por NOMBRE** (con el
alias «Dirty Burgers»→«Dirty Burger»); si no encuentra ya un `menu_item` con esa matrícula, crea un
`recipe_item` (`type='dish'`, `needs_review=true`) **y** un `menu_item` (`external_source='lastapp'`,
`needs_review=true`). Después revisa SIEMPRE `menu_item_override` de precio por canal.

| | cedidas | **propias** | sin marca | total |
|---|---|---|---|---|
| matrículas que mira | 208 | 193 | 18 | 419 |
| ya existen, no las toca | 179 | 128 | — | 307 |
| **`recipe_item` que crearía** | 29 | **65** | 0 | **94** |
| **`menu_item` que crearía** | 29 | **65** | 0 | **94** |
| **`menu_item_override` que crearía** | 21 | 28 | 0 | **49** |
| saltadas (marca que Folvy no tiene) | — | — | 18 | 18 |

**237 filas nuevas en tres tablas.**

### `recast_lastapp_sales(cuenta)` — esta mitad está bien

Se llama sin los otros dos argumentos → `p_incluir_bajo_conteo = false`, o sea que **respeta la regla 6**:
corta en el último conteo aprobado o en revisión.

| corte | protegidas | **reprocesa** |
|---|---|---|
| 08/09/2026 22:43 Madrid | 8.245 | **8** |

Cada una pasa por `reprocess_sale`: borra e inserta `stock_movement` de consumo, reescribe `sale_line`
(`adapt_lastapp_order` + `compute_sale_line_cost`), fija `sale.brand_id` y recalcula el stock del local.

## §2 · Los tres fallos, y por qué son de la misma familia que los de hoy

**1. No tiene la guarda de `ownership_type`.** Resuelve la marca por nombre y no mira si es cedida.
**65 de las 94 altas serían en marcas PROPIAS**, cuya fuente de verdad es Folvy, no Last. Es exactamente
el fallo que el importador tenía y que se corrigió el 08/09 — aquí sigue.

*Y muy probablemente esta función es la que dejó el cadáver que ya teníamos apuntado:* 206 platos vivos de
marcas propias con `external_source='lastapp'`. Nadie más los escribe.

**2. Siembra de un espejo rancio.** De las 94 que crearía, **sólo 8 se han visto en Last en las últimas
48 horas** — y **cero** de las 65 de propias. Diecinueve llevan más de 30 días sin aparecer y la más vieja
es del **21/06**. Crearía platos y escandallos a partir de cosas que Last ya no sirve.

**3. No dice qué hizo.** La función DEVUELVE sus contadores (`productos_base_creados`, `overrides_creados`,
`saltados_sin_marca`, `base_ya_existentes`) y la UI **no los lee**. Está escrito en el código como decisión
tomada: *«No se parsean los contadores de retorno a propósito … Surfacing de cifras = mejora menor»*
(`lastappIntegrationService.ts`). Pulsas y no sabes si creó 0 o 237 filas. Es la regla 8, y aquí no es
cosmética: es un botón que escribe en `recipe_item`.

## §3 · Lo que se construye

1. **Guarda de `ownership_type`.** Sólo se siembra sobre marcas **cedidas** (`licensed`). Una marca propia
   que aparezca en el espejo se cuenta y se lista —`saltadas_por_ser_propia`—, no se salta en silencio
   (regla 7). Misma expresión que el importador, y si es posible **la misma función**: `marca_reparte_propio`
   ya demostró que compartir la definición es la forma de que dos sitios no se desincronicen.
2. **Que el espejo tenga que estar fresco.** Ventana explícita (p. ej. `seen_in_catalog_at` de los últimos
   N días, con N como parámetro y valor por defecto dicho en pantalla). Lo que quede fuera se cuenta y se
   lista como «Last no lo sirve desde …», con su fecha. Sembrar de junio no es sembrar: es resucitar.
3. **Contadores en pantalla.** El botón dice qué hizo, con contenido, no un visto: «Creados 29 platos y 29
   escandallos en 6 marcas cedidas · 21 precios por canal · 65 saltados por ser marca propia · 18 sin marca
   en Folvy». Y si no creó nada, que lo diga también.
4. **Un ensayo antes de escribir.** Igual que el importador: `dry_run` que devuelve las mismas cifras sin
   tocar nada, para poder mirarlas antes. Hoy la única forma de saber qué haría es reproducir su lógica a
   mano en SQL, que es lo que ha habido que hacer para contestar a Julio.

**Lo que NO se toca:** el `recast`. Respeta el corte, mueve 8 ventas y hace lo que dice. Si acaso, que
también enseñe sus cifras — ya las devuelve.

## §4 · Orden y riesgo

No urge: el botón no está roto, hace lo que su código dice. Lo que pasa es que **su código no hace lo que
su nombre promete** desde que el importador crea los platos: de 419 matrículas, 307 ya existen, así que
«Sembrar escandallos» hoy sembraría 94, y 65 donde no debe.

**Mientras no se construya: no pulsarlo.** El recast por separado sí es seguro, pero hoy van juntos en el
mismo botón — separarlos es parte del §3 si Julio lo quiere antes que el resto.

---

## §5 · Hecho el 09/09 — paso 1: separar los dos botones

Julio: «separar los botones primero, luego el dry_run». Esto es lo primero, y **no toca ninguna RPC**: el
riesgo del §4 sigue intacto y **«Sembrar escandallos» se sigue sin pulsar** hasta que estén la guarda de
`ownership_type`, la ventana de frescura y el ensayo. Lo que cambia es que **el recast deja de estar
secuestrado**: hoy ya se puede recasar sin aceptar de paso 94 filas de catálogo, 65 de ellas donde no debe.

**Lo que se ha hecho:**

1. `seedAndRecast(cuenta)` —que encadenaba las dos RPC y devolvía `void`— se parte en
   `seedCatalogCanonical(cuenta)` y `recastLastappSales(cuenta)`. Cada una llama a **su** RPC y a ninguna más;
   hay una prueba que lo comprueba contando llamadas, no leyendo el código.
2. **Los dos botones dicen qué hicieron, con cifras** (regla 8). Las dos RPC ya las devolvían y la UI las
   tiraba a propósito («Surfacing de cifras = mejora menor»). Del sembrado: base creados, overrides creados,
   ya existentes y **saltados sin marca** —en rojo si los hay, porque son escandallos que NO existen y ventas
   que no van a casar—. Del recasado: el corte y las ventas protegidas de esta pasada, y aparte el estado del
   casado de la cuenta.
3. **El ámbito de cada cifra va escrito en la pantalla.** De `recast_lastapp_sales`, sólo `ventas_protegidas`
   y `corte_en` hablan de la pasada; las `lineas_*` son el estado del casado de **toda la cuenta**, medido
   después de reescribir —lo dice la propia función en su comentario—. Etiquetarlas como «lo que ha hecho
   este botón» sería inflar el resultado por un factor grande (21.140 líneas de la cuenta contra las 8 ventas
   que el corte deja reprocesar). La pantalla separa las dos zonas con su título.
4. **`corte_en` se pinta en hora de Madrid** (regla 4), con `fechaHoraDelNegocio()` nueva en `src/lib/fechas.ts`
   —que es donde la cabecera de ese fichero dice que vive el huso, y no en el componente—. El caso de prueba
   es justo el que muerde: 22:43 UTC del día 8 es **la 00:43 del 9** en Madrid; en UTC el aviso diría «corte
   el día 8» de algo que pasó el 9.
5. **Los botones salen de la ficha de integración.** Las dos RPC toman `p_account_id`, no la org. Dentro de
   cada ficha —y Foodint tiene **dos** integraciones— la pantalla enseñaba dos parejas de botones idénticos,
   cada una aparentando que sólo alcanzaba a su marca. Ahora hay una pareja, en un bloque que dice «toda la
   cuenta». Familia de la regla 30: el registro estaba bien, la pantalla mentía sobre su alcance.
6. **Bajar del corte no se expone.** `recast_lastapp_sales` tiene desde hoy dos parámetros más
   (`p_incluir_bajo_conteo`, `p_ventas_esperadas`) y la pantalla **no manda ninguno** — hay una prueba que
   comprueba que la llamada lleva exactamente una clave. Reprocesar por debajo de un conteo cerrado es una
   decisión con autorización explícita (regla 6), no un botón.

**Deuda vista de paso, no arreglada:** `src/types/database.ts` va por detrás de la base en estas dos RPC —no
trae `ventas_protegidas`, ni `corte_en`, ni los dos parámetros nuevos—, así que la fila se lee por nombre
contra el objeto crudo, con un comentario que lo dice. Es el mismo frente que documenta `src/lib/rpcSinTipar.ts`.
Y el literal `'Europe/Madrid'` sigue suelto en **6 sitios** de `src/` fuera de `fechas.ts`, contra lo que dice
la cabecera de ese fichero. Ninguna de las dos es de este encargo.

**Medido a los dos lados, misma vara (regla 31):**

| | sin el cambio | con el cambio |
|---|---|---|
| `npm run lint` | 1376 problemas (1076 errores, 300 avisos) | **1376 problemas (1076 errores, 300 avisos)** |
| `npx vitest run` | 6 rojas, 1005 verdes (1011) | **6 rojas, 1020 verdes (1026)** |

Las 6 rojas son las mismas de antes, ya declaradas en `main` (`routes.test.ts` espera 4 rutas y hay 5, y dos
mapeadores de multitenancy que esperan `null` donde el código devuelve `undefined`). Las 15 nuevas son de este
cambio. `npm run build`: verde.

Y la prueba es falsable, que es el punto (regla 31): cambiando **una letra** en el mapeo
(`ventas_protegidas` → `ventas_protegida`) se ponen 2 en rojo. Con las cifras tiradas a la basura, como estaban
hasta hoy, ese mismo error no lo habría notado nadie: el contador habría salido a 0, y el 0 parece un dato.

**Siguiente:** el `dry_run` de `seed_catalog_canonical`, y con él la guarda de `ownership_type` y la ventana
de frescura del §3.

---

## §6 · Hecho el 09/09 — paso 2: el ensayo, con las dos guardas dentro

Propuesto, **no aplicado**: `supabase/migrations/PENDIENTE_seed_catalog_canonical_ensayo_y_guardas.sql`.
Es `DROP` + `CREATE` porque añade parámetros — con `CREATE OR REPLACE` quedarían dos firmas y las llamadas
de un argumento serían ambiguas (regla 2). Nadie más la llama: 0 funciones la mencionan en `prosrc`.

### Lo que devuelve el ensayo, corrido de verdad

No está calculado a mano: este cuerpo exacto se creó como copia desechable sin `SECURITY DEFINER`, revocada
de `public`/`anon`/`authenticated`, se corrió sobre Foodint y se borró (quedan 0 copias). Salió:

| | | |
|---|---:|---|
| matrículas miradas | **419** | predicho ✓ |
| ya existen, no se tocan | **307** | ✓ |
| se crearían | **17** | ✓ |
| fuera, sin marca en Folvy | **18** | ✓ · `Van Van` |
| fuera, marca propia | **65** | ✓ · 5 marcas |
| fuera, no está en la última foto | **12** | ✓ |
| | 419 | = la suma de las cinco |
| precios por canal | 43 | no predicho: para esto es el ensayo |
| …de ellos, de foto vieja | 2 | se cuenta, no se corta |

**94 → 17.** Y no escribió nada, medido a los dos lados en la misma sentencia (regla 31):
`recipe_item` 394→394, `menu_item` 633→633, `menu_item_override` 58→58, mientras decía que crearía 17 y 43.
La prueba que menos se puede falsear: dos pasadas seguidas dieron las **mismas** 307 ya existentes y los
**mismos** 17 a crear — si la primera hubiera escrito, la segunda habría dicho 324 y 0.

### La guarda de frescura no se mide contra `now()`, y eso cambió el diseño

El §3.2 pedía «vistos en los últimos N días». Medido, esa vara está mal. Las dos orgs de Foodint tienen
fotos de fechas distintas: **Cloudtown 08/09 23:00 (hace 10,5 h)** y **Foodint 05/09 23:00 (hace 82,5 h)**.
Un corte de «3 días desde hoy» se llevaría la org de Foodint entera, y no porque Last haya dejado de servir
nada: porque nadie ha refrescado ese espejo desde el 5. `seen_in_catalog_at` mide **cuándo miramos**, no
cuándo lo sirvió Last, y la pantalla diría «Last no lo sirve desde el 05/09» de algo que sí sirve — regla 30
otra vez, y regla 39: la vara tiene que ser la del sistema al que gobierna.

Así que la vara es **la última foto de su propia org**: ¿estaba este producto la última vez que miramos ESE
catálogo? El corte es nítido —una pasada sella todas sus filas en la misma hora, así que a 1 h y a 1 día
salen los mismos números— y el margen queda como parámetro. Y la antigüedad de cada foto sale en el
resultado y en pantalla, porque sembrar de una foto de hace tres días es una decisión.

### Los 12 que la guarda de foto deja fuera son, casi todos, packs

Nueve son del 21/06 y dos del 30/08:

- **Chivuos** — Pack Single Hero · Pack Chicken Single Hero · Pack Deluxe Para Dos · CHIVUO´S® BURGER *(30/08)*
- **Ay Mamita Bowls** — Birria Lunch · Mamita Duo · Birria Chicken Bowl · Birria + Tequeños · GRINGAS DE QUESO *(30/08)*
- **Dos Coyotes** — PACK UNO PA UNO · PACK PA 2
- **Big Mike´s** — Menú Doble Big Mikes

Sembrarlos crearía doce `recipe_item type='dish'` para packs que Last ya no sirve como producto. Es
exactamente lo que la guarda evita, y son los mismos packs de los que habla `PENDIENTE_casa_por_id_externo`.

### Las 5 marcas propias que se dejan de sembrar

Milanesa House (24) · Meraki Pita (16) · Smash Brothers Burgers (14) · Dirty Burgers (6) · Bendito Burrito (5).

⚠️ **«Milanesa House» es PROPIA y «Milanesa Haus» es CEDIDA.** Dos marcas distintas a una letra. Hoy no se
confunden porque la resolución es por nombre exacto normalizado — pero conviene saberlo antes de tocar el
alias de `Dirty Burgers`, que es el único que hay escrito a fuego ahí dentro.

### Y de paso: esa función la puede llamar `anon`

Medido con `has_function_privilege('anon', …, 'EXECUTE')` → **TRUE**. Es `SECURITY DEFINER` y escribe en tres
tablas; su guarda de tenancy la salva, pero no tiene por qué estar al alcance. No estaba entre las 21 del
barrido de ayer. Y como esto es un `DROP` + `CREATE`, la nueva **nacería otra vez abierta** —
`ALTER DEFAULT PRIVILEGES` concede EXECUTE a `anon` y `authenticated` en cada función nueva de `public`—, así
que el revoke va en la misma migración, revocando de **PUBLIC además de los nombres**, y la verificación va
dentro de la transacción: si `anon` sigue pudiendo, la migración no entra.

### La pantalla

Botón **«Simular sembrado»** al lado de **«Sembrar escandallos»**, como el importador. La tarjeta enseña las
cinco cifras que cuadran con las matrículas miradas, y **lista** lo que deja fuera: la marca sin resolver, las
marcas propias, y los doce productos con su fecha de «visto por última vez» en hora de Madrid. Más la foto de
cada org con su antigüedad. Nada de «y además hay N que no te enseño» (regla 7).

**Medido a los dos lados (regla 31):** `lint` 1376 problemas (1076 errores, 300 avisos) sin el cambio y con él;
`vitest` 6 rojas / 1005 verdes antes, 6 rojas / 1024 verdes después — las 6 son las ya declaradas en `main`.
`npm run build`: verde.

### Orden, y lo que se rompe

1. **Julio aplica la migración.** En ese momento «Sembrar escandallos» de la pantalla **deja de funcionar**:
   `p_dry_run` no tiene valor por defecto a propósito, así que la llamada de un argumento que hace el panel
   hoy ya no existe y da error. Es la dirección correcta del fallo — y ese botón no había que pulsarlo igual
   (§4). «Recasar ventas» no se toca.
2. **Se renombra el fichero** a la versión que registre la base (regla 17).
3. **Se fusiona la rama** y la pantalla nueva llama con `p_dry_run`.
4. **Primero se simula**, se mira la tarjeta, y sólo entonces se decide si se siembra.

**Sigue abierto:** los overrides no llevan guarda de foto — se cuentan (2 de 43) y la decisión es de Julio.
Y el excluido `'FOODINT'`, el alias `'Dirty Burgers'→'Dirty Burger'` y el uuid de la unidad «Unidad» siguen
escritos a fuego dentro de la función: deuda vista, no de este encargo.
