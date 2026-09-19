# LISTA · Los formatos de compra, contra su maqueta aprobada

**Regla 1 del 16/09.** Esta lista va entera en cada encargo de formatos hasta que todo esté en ✅.
- Nada se aplaza sin quedar aquí con fecha.
- Nada pasa a ✅ sin captura de la pantalla real, visto bueno de Julio y comprobación en la aplicación.

**Maqueta:** «Los formatos de compra en la ficha del artículo», **aprobada por Julio el 19/09** («ok a todo») · https://claude.ai/artifact/H3wCwDSY1GdQ6uDky1BD7K

**Las cinco decisiones que manda (Julio, 19/09):**
1. **No hay pantalla nueva de formatos.** Todo dentro del flujo del artículo: al crearlo pregunta lo que hace falta; al modificarlo se despliega entero.
2. **Varios proveedores por artículo, cada uno con su formato y su referencia.**
3. **En qué se cuenta lo decide quien crea el artículo**, artículo por artículo.
4. **Si el proveedor cambia la caja, Folvy crea la versión nueva solo y avisa.** Lo pasado no se toca.
5. **Lo que está a medias sale en la propia lista de artículos**, con filtro. Sin zona dedicada.

**Leyenda:** ✅ hecho, visto y aprobado · 🟢 construido y probado, falta captura y el sí de Julio · 🟡 a medias · ❌ falta · ⏸ aplazado con fecha

> **Estado del 19/09, después del encargo.** Nada está en ✅ y nada puede estarlo
> todavía: las capturas a 1.280 px con datos reales no se pueden hacer desde el
> contenedor donde corre Code (no hay `.env` ni credenciales de la aplicación),
> así que el paso 1 de «lo que tiene que llegar» lo tiene que dar Julio sobre la
> rama. Lo que sí está: rama `claude/cool-thompson-msx9dg`, `npm run build`
> exacto y en limpio en verde, 1.619 pruebas en verde y el lint medido a los dos
> lados (6 problemas antes, 6 después, en los mismos ficheros).

## A · El alta del artículo (artboard 1)

| # | la maqueta dice | hoy | de dónde sale |
|---|---|---|---|
| A1 | El paso «De quién lo compras» trae **los dos modos desde el principio**: «De una pieza» y «Caja con piezas dentro» | 🟢 | los dos modos están ya en el alta de proveedor, y al crear un artículo la ficha se abre por ahí con el formulario abierto (`KitchenItemsPage.handleCreated` → `enfocarCompra`). Sin pantalla nueva |
| A2 | La fila se lee como una frase: **Caja · lleva · 6 · piezas de · Bote · de · 965 g** | 🟢 | `PurchaseSourcesSection`, modo «Caja con piezas dentro» |
| A3 | Debajo, la cuenta en verde: **«1 Caja = 6 Botes × 965 g = 5.790 g»** | 🟢 | `cuentaDelFormato` en `lib/formatosDeCompra.ts`, con prueba. El total se DERIVA, nunca se teclea |
| A4 | **Su referencia** y **cómo lo llama él**, uno al lado del otro, con su porqué debajo («con ella, sus albaranes casan solos») | 🟢 | los dos campos, en rejilla de dos columnas, con el porqué y el número real (73 enlaces sin referencia) |
| A5 | El precio es **el de la caja**, y al lado sale a cuánto queda el gramo y la pieza | 🟢 | €/base y €/pieza en vivo, idénticos a lo que guardará el motor |
| A6 | **«+ Añadir otro proveedor para este mismo artículo»**, con la nota de que hoy hay 71 artículos con más de uno | 🟢 | el botón cambia de texto cuando ya hay uno, con su nota |
| A7 | **«¿En qué lo cuentas?»**, a la derecha: Cajas · Botes · unidad base. Lo elige quien crea el artículo | 🟢 | escribe `use_in_count` en el nodo que toque. Sin migración: la columna existe desde el 10/09 |
| A8 | **«Cómo queda»**: las cuatro líneas juntas — lo compro, lo cuento, lo gasto, él lo llama | 🟢 | |
| A9 | Pie con **«Guardar y seguir luego»**: un artículo puede quedarse a medias a propósito | 🟢 | guarda el formato sin precio. `SimplePurchaseSetup.lastPrice` pasa a `number \| null` |

## B · La ficha abierta (artboard 2)

| # | la maqueta dice | hoy | de dónde sale |
|---|---|---|---|
| B1 | Cabecera: **«Se gasta en g · Se cuenta en cajas»** y el coste grande, diciendo **de qué proveedor sale** | 🟢 | «según CLOUDTOWN, S.L.» debajo del coste |
| B2 | **Una tarjeta por proveedor**, con su referencia, su texto, su precio y su formato en una línea legible | 🟢 | la fila pasa a tarjeta; el formato se lee con `cuentaDelFormato` |
| B3 | El principal va marcado, y se ve **la fecha de su último albarán** | 🟢 | `ultimoAlbaranPorProveedor` (goods_receipt_line → goods_receipt) |
| B4 | **Aviso cuando dos proveedores no se parecen**: «este sale a un tercio del principal» con «Revisar el formato» / «Está bien» | 🟢 | salta al doble o a la mitad del principal. «Está bien» escribe `verified_at` y el aviso no vuelve |
| B5 | Pie de la ficha: en qué saldrá en el recuento · en qué se gasta · cuántos platos lo usan | 🟢 | |

## C · Editar un formato con historia detrás (artboard 3)

| # | la maqueta dice | hoy | de dónde sale |
|---|---|---|---|
| C1 | Arriba, en ámbar: **«Este formato ya se ha usado N veces desde el <fecha>»** | 🟢 | `historiaDelFormato` cuenta EXACTAMENTE lo que mira la guarda: líneas de albarán con movimiento de stock |
| C2 | Y la frase que quita el miedo: **no se tocan las entradas ni los costes de antes; lo de ahora es una versión nueva desde hoy** | 🟢 | |
| C3 | **«Lo que va a cambiar»**: hasta hoy / desde hoy, con el coste de cada uno | 🟢 | el precio del formato no cambia; lo que cambia es cuánto trae, y por eso cambia el €/g |
| C4 | «¿En qué lo cuentas?» también aquí | 🟢 | |
| C5 | Pie: **queda apuntado quién lo cambió y cuándo** | 🟢 | se dice ANTES, que es cuando sirve. Lo escribe `archiveAndReplacePurchaseFormat` en `created_by` / `created_by_name` |

## D · La caja ha cambiado (artboard 4)

| # | la maqueta dice | hoy | de dónde sale |
|---|---|---|---|
| D1 | Salta **al recibir el albarán**, citando su texto entero | ⏸ 19/09 | medido: la línea sale de **`goods_receipt_line`**, y su texto entero es `raw_text` (`product_name` de reserva). Ver §5.1.3 del parte |
| D2 | **Folvy ya ha creado el formato nuevo** y lo deja a la espera del sí | ⏸ 19/09 | **SQL propuesto y sin ejecutar**: `claude/sql/20260919_D_aviso_cambio_de_caja_PROPUESTA.sql` |
| D3 | Antes y después, con **cuánto sube o baja el gramo** | ⏸ 19/09 | la tabla propuesta guarda el «antes» (`current_qty_in_base`) |
| D4 | **A qué platos afecta**, por su nombre | ⏸ 19/09 | `pending_format_affected_dishes`, vía `recipe_line` |
| D5 | Botones: «Sí, la caja ahora trae N» · «Ver el albarán» · «No era eso: lo miro yo» | ⏸ 19/09 | `accept_pending_format` / `reject_pending_format` |
| D6 | La nota de que **el recuento en piezas sigue valiendo** si la pieza no cambia | ⏸ 19/09 | |

> **Por qué D queda aplazado y con fecha (19/09):** D es lo único del encargo que
> necesita base nueva, y la regla de Julio es que **Claude Code propone, Julio
> ejecuta y verifica**. El SQL está escrito entero, transaccional, con sus
> guardas y con las tres medidas de la banda de servicio delante; no se ha
> ejecutado nada. La pantalla se construye **en cuanto esa base esté aplicada**:
> construirla antes sería front llamando a una tabla que no existe, que es
> exactamente lo que la regla 40 dice que no se ve hasta meses después.

## E · Lo que está a medias, en la lista (artboard 5)

| # | la maqueta dice | hoy | de dónde sale |
|---|---|---|---|
| E1 | Franja arriba: **«31 artículos están a medias»**, con el porqué en una línea | 🟢 | el número se cuenta en vivo y es la **UNIÓN** de los tres filtros. Medido hoy: **77**, no 31 — ver la nota de abajo |
| E2 | Tres filtros con su número: **Sin formato · 26** · **Sin referencia · 73** · **Coste a mano · 36** | 🟢 | contados en vivo. Hoy: **32 · 46 · 36** por artículo (el 73 de la maqueta son ENLACES, no artículos) |
| E3 | Las filas a medias van **con fondo distinto** y sello «Falta el formato» | 🟢 | |
| E4 | Botón **«Terminarlo»** que abre justo el paso que falta, no la ficha entera | 🟢 | abre la ficha por la sección de compra y, si no hay proveedor, con el formulario abierto |
| E5 | Sellos de lo que no cuadra: **«No cuadra»** y **«Repetido»** | 🟢 | reglas medibles, probadas contra los 165 enlaces reales. Ver §5.4 del parte |
| E6 | Lo terminado dice **«✓ terminado»**, sin ruido | 🟢 | |

> **Los números de E1 y E2 no son los de la maqueta, y eso es un hallazgo, no un
> fallo (19/09).** La maqueta dice «31 a medias» con «26 sin formato + los que
> solo faltan de referencia», y eso no puede cuadrar consigo mismo: solo «sin
> referencia» ya son 46 artículos. El «73» de la maqueta son **enlaces**, no
> artículos. La franja construida dice el número de la UNIÓN y el desglose en la
> misma línea, porque una franja que diga 31 mientras los filtros suman más es
> justo la nota al pie que prohíbe la **regla 7**: el operario aprende que los
> números de Folvy no cuadran y deja de creerse también los que sí.

## F · Palabras y tamaños

| # | | hoy |
|---|---|---|
| F1 | Nada de «unidad base», «conversión» ni «factor» en pantalla: **«se gasta en gramos»**, **«cómo viene»**, **«en qué lo cuentas»** | 🟢 |
| F2 | Sin emojis. Iconos del sistema | 🟢 |
| F3 | Pantalla de oficina, 1.280 px, y que se pueda usar en un portátil de 1.366 | 🟡 |
| F4 | La referencia del proveedor, en monoespaciada | 🟢 |

> **F3 está en 🟡 a propósito.** El diseño es de ancho fluido y las filas nuevas
> van con `flex-wrap`, así que no hay motivo para que se rompa; pero **no lo he
> medido**, y decir que está bien sin medirlo es exactamente lo que costó el
> 16/09 tres veces. Se cierra con la captura.

## Lo que tiene que llegar para pasar a ✅

1. Capturas de cada pantalla real a 1.280 px, con **datos de verdad** (no inventados).
   **Esto lo tiene que hacer Julio**: Code no tiene credenciales de la aplicación
   en su contenedor y no puede entrar a Foodint para capturar.
2. Claude las cruza con esta lista, punto por punto.
3. `npm run build` exacto, fusión y READY en Vercel.
4. Julio lo ve en la aplicación y cada punto pasa a ✅.
