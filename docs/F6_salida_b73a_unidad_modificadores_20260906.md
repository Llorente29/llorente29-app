# F6 · Consecuencia esperada — B73a: los modificadores que cobran y valen cero

Escrito **ANTES** de escribir en la base. **06/09/2026, 09:42 Madrid — fuera de la
banda 12:15 → 23:45.**

> ## ⚠️ SE APLICAN ONCE DE LAS DOCE. LA QUE FALTA ESTÁ MEDIDA, NO OLVIDADA
>
> El encargo aprobó **diez arreglos + dos altas**. Se aplican **nueve arreglos +
> las dos altas**. **El #10 («Base Pollo (The OG)») NO se aplica**, y el motivo
> es una cifra, no una duda: **315,63 € de los 458,76 € que añadiría serían
> coste INVENTADO**, no coste que falta. Está en el §4.
>
> **El envase no se toca** (B73b). **El histórico no se recalcula** (§5).

---

## 1 · Lo que estaba mal, medido

`_impact_cost` devuelve **0 en silencio** cuando falta la unidad. En Foodint hay
**13 impactos sin `unit_id`**; **10 de ellos cobran dinero**. Llamando a
`_impact_cost` uno a uno con la unidad propuesta, los diez pasan de **0 €** a su
coste real. Ninguno cae en el cuarto camino silencioso («no convertible»): las
diez fichas destino tienen como unidad base la **misma «Unidad (ud)» global**
(`869711c3…`, `account_id` NULL, `factor_to_base` 1, dimensión `unit`), así que
la conversión es 1/1 y **resuelve**.

### 1.bis · Regla 9, sexta vez, y esta vez en el propio encargo

El encargo dice «de los **36** impactos que existen, **16** no tienen `unit_id`».
Medido por cuenta:

| cuenta | impactos | sin unidad | sin unidad y cobran |
|---|---|---|---|
| **Foodint** | **33** | **13** | **10** |
| Folvy Interno (plantilla) | 3 | 3 | 2 |
| **total todas las cuentas** | 36 | 16 | 12 |

Los 36 y los 16 son **de todas las cuentas**. Y de paso: **los «3 impactos en
estado propuesto» del §2 del encargo son de `Folvy Interno`, no de producción** —
en Foodint no hay ni uno sin confirmar, así que no hay nada de lo que apartarse.

El contador «14» del §0.pre no sale con ninguna definición que haya podido medir:
da 10 (Foodint, sin unidad, cobran), 12 (idem todas las cuentas), 13 (Foodint sin
unidad), 16 (todas sin unidad). **Se dice y no se maquilla.**

## 2 · Lo que se aplica

**Nueve arreglos.** Unidad **Unidad (ud)**. Ocho quedan `add_item`; **la que
apunta a un PLATO pasa a `bundle`**, que es lo que usan los 15 que funcionan.

| # | marca | opción | destino | tipo | €/ud |
|---|---|---|---|---|---|
| 1 | Bendito Burrito | Agua. | Agua Mineral 50 CL | add_item | 0,3500 |
| 2 | Bendito Burrito | Coca Cola. (33cl) | Coca-Cola Original Lata | add_item | 0,5909 |
| 3 | Bendito Burrito | Coca Cola Zero. (33cl) | Coca-Cola Zero Lata | add_item | 0,7675 |
| 4 | Bendito Burrito | Fanta Naranja. (33cl) | Fanta Naranja Lata | add_item | 0,4950 |
| 5 | Bendito Burrito | Nestea Limón. (33cl) | Nestea Limón | add_item | 0,8000 |
| 6 | Bendito Burrito | Cheesecake de Nutella | Cheesecake de Nutella | add_item | 3,1580 |
| 7 | Bendito Burrito | Tarta 3 Leches | Tarta 3 Leches | add_item | 3,1580 |
| 8 | **Lobbers** | **Si, con patatas** | **Patatas Clásicas Meraki** | **bundle** | **0,876096** |
| 9 | Lobbers | Quiero dos discos de carne | Hamburguesa Mixta 85 Grs 142 Und | add_item | 0,7482 |

**Dos altas**, `bundle` → `Patatas Clásicas Meraki` → 1 ración:

| marca | opción | cobra | líneas agosto |
|---|---|---|---|
| Lovers Burgers | Si, con patatas | 3,95 € | 27 |
| Scandal Burgers | Si, con patatas | 3,95 € | 3 |

## 3 · La cifra, con la ventana escrita

Europe/Madrid. Semana `24/08 00:00 → 31/08 00:00`. Agosto `01/08 00:00 →
01/09 00:00`. Cuenta Foodint en toda consulta (regla 9). Solo líneas `product`
no ignoradas, ventas no canceladas.

| marca · opción | semana 24→30/08 | agosto | histórico |
|---|---|---|---|
| Lovers Burgers · Si, con patatas *(alta)* | 5,26 | 40,30 | 54,32 |
| Scandal Burgers · Si, con patatas *(alta)* | 5,26 | 5,26 | 12,27 |
| Bendito Burrito · Tarta 3 Leches | 3,16 | 6,32 | 41,05 |
| Bendito Burrito · Coca Cola. (33cl) | 1,18 | 1,18 | 1,77 |
| Lobbers · Si, con patatas | 0,00 | 0,00 | 87,61 |
| Lobbers · Quiero dos discos de carne | 0,00 | 0,00 | 74,82 |
| Bendito Burrito · Cheesecake de Nutella | 0,00 | 0,00 | 3,16 |
| Bendito Burrito · Coca Cola Zero. (33cl) | 0,00 | 0,00 | 1,54 |
| Bendito Burrito · Agua. / Fanta / Nestea | 0,00 | 0,00 | 0,00 |
| **TOTAL** | **14,86 €** | **53,06 €** | **276,54 €** |

En puntos de food cost, misma vara a los dos lados:

- Semana: coste 3.329,48 → 3.344,34 sobre neto 13.234,93 → **25,16 % → 25,27 %**.
- Agosto: coste 16.956,53 → 17.009,59 sobre neto 64.190,71 → **26,42 % → 26,50 %**.

> **Aviso de vara (regla 31):** este porcentaje es *coste de líneas `product` no
> ignoradas ÷ neto (`total − refund`, sin canceladas)*. **No es la misma vara**
> que el 24,45 % de base de B73b, que salió de otra consulta y no está
> reconciliada. El **delta** sí está medido con la misma vara a los dos lados.

### 3.bis · Dos de los nueve están muertos, y eso importa

**Las dos opciones de Lobbers dejaron de venderse en julio** (patatas el 21/07,
discos el 05/07). Sus 162,43 € son todos histórico: **hacia adelante suman cero**.
La marca se sustituyó por **Lovers Burgers**, cuyas opciones equivalentes **no
tenían ningún impacto**. Por eso las altas del §2 valen más que los arreglos.

Y de paso cierra media pregunta vieja: **la multiplicación de «Si, con patatas»
NO es un fallo de importación** — es una opción por marca, que es como está
montado el modelo. El agujero era que solo la marca extinta estuviera configurada.

## 4 · 🔴 EL #10 NO SE APLICA. La razón es una cifra

`Milanesa House · Base Pollo (The OG)`, grupo **«Escoge la base de tu bocata»**,
0,5 × `Milanesa de Pollo Rebozado`. **505 líneas, el más grande de todos.**

Ese grupo está colgado de **dos familias de plato distintas**, y sólo en una
falta el coste. Comprobado **por id de ficha**, no por nombre:

| | líneas | histórico | agosto | semana |
|---|---|---|---|---|
| **A) el plato padre YA lleva `Milanesa de Pollo Rebozado` en su receta** | **342** | **315,63 €** | 27,87 € | 0,00 € |
| B) el plato padre NO la lleva — coste que falta de verdad | 162 | 143,12 € | 26,36 € | 5,27 € |
| C) el padre no tiene receta | 1 | 0,00 € | 0,00 € | 0,00 € |
| **total** | **505** | **458,76 €** | **54,23 €** | **5,27 €** |

Las del caso A son milanesas —«Milanesa de Pollo Clásica», «The Bare Naked»,
«The Big Napo», «Milanesa de Pollo con Huevo Frito», «The Truffle Bomb», «The
Pepperoni Riot»— y **todas llevan `Milanesa de Pollo Rebozado x1` en su propio
escandallo**. Añadirles 0,5 más no rellena un hueco: **las pone a 1,5 milanesas**.
Las del caso B son bocadillos —«Bocadillo Parmigiana», «Bocadillo Mila's»,
«Bocadillo Clásico»…— que **no la llevan**, y ahí los 0,5 sí son la base que
eligió el cliente.

**Un impacto no puede servir a las dos familias**, y eso no se arregla con una
unidad: se arregla decidiendo a qué platos cuelga ese grupo. **Es de Julio.**
Aplicarlo tal cual metería **315,63 € de coste inventado**, más del doble de los
143,12 € que faltan de verdad. **Se queda como está, sin unidad y valiendo cero,
hasta que Julio lo diga.**

### 4.bis · Por qué el #9 SÍ, aunque la misma prueba lo señale

La prueba automática marca **56 de 56** líneas del #9 con el destino ya en la
receta del padre — y aun así **está bien**, porque el grupo se llama **«¿Quieres
dos discos de carne o solo uno?»**: el plato trae uno y el modificador añade **el
segundo**. Verificado plato a plato: los ocho padres son hamburguesas de **un
disco** (85 g, o «1 ud» en «Bacon Cheesburger»), ninguna doble.

**La prueba señala; no dicta.** La diferencia entre el #9 y el #10 es que uno es
un **extra** y el otro una **elección de base** — y esa distinción está en el
nombre del grupo, no en los datos. Es la familia de la regla 30 y del selector de
B72: *la lista con la que se elige no es la lista con la que se lee.*

## 5 · El histórico NO se recalcula, y esto es una decisión que se dice

`sale_line_cost_sweep` lleva escrito en el cuerpo `and p.computed_cost is null
-- nunca recalcular`, en sus dos ramas; y la rama 1 exige además
`cost_computed_at < recipe_item.updated_at`, que tocar `modifier_recipe_impact`
no mueve. **Las líneas ya costeadas no las va a tocar el barrido de las 04:50.**

Así que **por omisión queda la opción A**: el coste entra sólo en las ventas
nuevas, y junio, julio y agosto no se mueven. La opción B —recalcular— sigue
disponible **en cualquier momento y sin pérdida**, porque nada la caduca:

| mes | food cost hoy | con B (las 12) |
|---|---|---|
| junio | 26,31 % | 26,99 % |
| julio | 25,12 % | 25,51 % |
| agosto | 26,42 % | 26,58 % |
| septiembre (1→4) | 24,65 % | 24,83 % |

*(Esa tabla incluye el #10, que ya no se aplica; con las once queda por debajo.)*
**Decide Julio. No se toca un mes cerrado sin su palabra.**

## 6 · Lo que puede salir mal

- **Que el coste suba menos de lo escrito.** Dos de los nueve están muertos: si
  Bendito Burrito no vende, el efecto real de la semana que viene es ~10 €, no 15.
- **Que aparezca un tercer «Si, con patatas»** en una marca nueva sin impacto.
  Para eso va el vigía; hoy hay **111 opciones activas que cobran y resuelven a
  0 €**, y **20 de ellas vendieron en agosto**. B73a cierra tres.
- **Que el `bundle` del #8 no cambie el número.** Es lo esperado: el motor trata
  `add_item` y `bundle` igual en `compute_sale_line_cost`. El tipo se cambia por
  lo que SIGNIFICA, no por lo que suma.

## 7 · Cómo se comprueba que ha funcionado

1. Los nueve devuelven `_impact_cost` **> 0**; el #8 exactamente **0,876096 €**
   (si diera 1,100176 se habría colado el envase → parar, es B73b).
2. Las dos altas existen, `bundle`, `confirmed`, con unidad y cantidad 1.
3. **Los 16 `bundle` previos, medidos antes y después con la misma consulta,
   no cambian de valor.**
4. El #10 y las tres de §2 siguen con `unit_id` nulo.
5. `npm run build` verde (B42: no `tsc --noEmit`).

---

## 8 · LO QUE PASÓ DE VERDAD (escrito después, 06/09 10:05 Madrid)

**Aplicado fuera de banda, 09:45 → 09:50 Madrid.** Respaldo previo:
`_backup_20260906_modifier_recipe_impact`, **36 filas**.

| verificación | resultado |
|---|---|
| 1 · las nueve resuelven a > 0 € | ✅ las nueve, con su euro delante |
| 2 · la #8 da 0,876096 € | ✅ **0,876096**, no 1,100176. El envase no se coló |
| 3 · los 16 `bundle` previos no cambian | ✅ md5 `c572ea1273122c3a9e6baafff73f2169`, 16 filas, 34,776973 € — **idéntico antes y después** |
| 4 · lo que no se toca sigue sin tocar | ✅ quedan **4** con `unit_id` nulo: el #10, el duplicado de ternera y los dos `none` |
| 5 · medición entregada antes | ✅ §3, antes de escribir |
| 6 · `npm run build` | ✅ verde en 11,55 s |

**Las dos altas existen**, `bundle`, `confirmed`, 1 ración, 0,876096 € cada una.

**Repo = base, comprobado con huella y no afirmado** (regla 17). Las tres
migraciones se escribieron al repo y su md5 normalizado coincide con el
`statements` que guardó la base:

| versión | md5 |
|---|---|
| `20260906074537` · el dato | `1909bd20d844b805acea4d29aa855209` |
| `20260906074927` · el vigía | `cfc20ca479a9926fa704d2889143c60d` |
| `20260906074951` · el cron | `c381d09ce8654556f1be46ec6c4eca2f` |

### El vigía, y la desviación que lleva escrita

Se construyó **con trinquete, no con «aviso si > 0»**, y el motivo es una cifra:
el contador no vale 14. Vale **101 en Foodint** (eran 111; los arreglos de esta
noche se llevaron 10 activas) y **77 en la cuenta plantilla**; de las 101,
**36 han vendido en 30 días**. Un aviso a «> 0» habría sonado en la primera
ejecución y no habría parado nunca — y entonces tampoco se vería el 102.

Probado, no supuesto:
- Primera pasada: **0 avisos**, marca sembrada en 36/101 (Foodint) y 2/77 (plantilla).
- Segunda pasada: **0 avisos**. No repica.
- Bajando la marca en 1 dentro de una transacción que se deshace: **1 aviso**,
  asunto *«Hay 36 modificadores que cobran y cuestan 0 EUR en Foodint (eran 35)»*.
  Comprobado después: marca de vuelta en 36 y **0 avisos en cola**. No le llegó
  nada a nadie.

**Si Julio prefiere el «> 0» tal cual, es cambiar un `>` por un 0.** La función no
hay que reescribirla.

### La pantalla

`bundle` ya se puede elegir («trae un plato entero»), y se pone **solo** cuando el
destino es un plato. Con destino plato **el desplegable de unidad desaparece**, la
unidad se fija a `ud` sola y la cantidad se rotula **«raciones»**. Y «Confirmado»
deja de ser verde cuando el impacto no aporta: dice **«Confirmado, pero sin coste
— le falta la unidad»**, y **sale de la cobertura** sin salir de la pantalla.

### La prueba llevó la contraria, que es para lo que está

El fixture son los **33 impactos reales** de Foodint copiados del respaldo, con el
coste real de cada ficha. Yo daba el cuarto camino de `_impact_cost` —«unidad no
convertible»— por teórico. **No lo es:** `Big Mike´s · Sweet Chili T` cobra 0,60 €,
su impacto pide **50 g** y la ficha de la salsa está en **ml**. Verificado contra
la base: `_impact_cost(...) = 0` y `recipe_item_unit_conversion` **no tiene ni una
fila** para esa ficha. **36 líneas en agosto, 21,60 € cobrados, cero de coste.**
Por eso `no_calculable` tampoco se pinta verde.

Con la cobertura nueva, esos 33 impactos daban **100 %** con la cuenta vieja
(todos confirmados) y dan **64 %** con la nueva: 21 aportan, 11 no aportan, 1 no
se puede calcular.

### Medido a los dos lados, con la misma vara

| | `origin/main` | con el cambio |
|---|---|---|
| `npm run lint` | 1363 problemas (1061 errores, 302 avisos) | **1363 (1061, 302)** |
| `npx vitest run` | 6 fallan · 703 pasan (709) | 6 fallan · **718 pasan** (724) |

Los **6 fallos son de `main`**, no míos: `routes.test.ts`,
`brandsService.mappers`, `salesChannelsService.mappers`. Están rojos antes de
tocar nada y siguen igual. **Eso es una deuda abierta que no era de este frente y
va dicha.** Los +15 que pasan son las pruebas nuevas.

*(Y una corrección de vara: el «7 problemas, 3 errores» que reporté en B72 salía
de un alcance más estrecho de eslint. No se puede leer contra este 1363.)*

---

## 9 · §1.ter · LA RUTA REAL, leída del código y no deducida del nombre del fichero

Te di dos veces una navegación inventada, la última «Cocina → Recetas». **Ninguna
de las dos existe**, y salieron de leer el *path* del fichero en vez del rótulo de
la pantalla. Esto es lo que dice `module.tsx` y `routes.ts`:

**Para llegar a los impactos de un modificador:**

> **Folvy Kitchen** (barra superior) → **Cartas** (barra lateral) → **pulsar el
> producto** → pestaña **«Modificadores»** → bloque **«Impacto en coste»**

También se llega por **Folvy Kitchen → Platos** (la ficha del plato) o por
**Folvy Kitchen → Casado**: las tres abren la misma ficha con las mismas pestañas.

**Dónde estaba la trampa, para que no vuelva a picar nadie:**

| en el código | en la pantalla |
|---|---|
| módulo `kitchen`, URL `/kitchen/...` | se llama **«Folvy Kitchen»**, no «Cocina» |
| `path: 'menu'` | se rotula **«Cartas»**, no «Menú» |
| `path: 'recetas'` | se rotula **«Platos»**, no «Recetas» ← *la que inventé* |
| `CatalogFichaPage` | **no tiene URL propia**: se abre pulsando un producto dentro de Cartas / Platos / Casado |

`recetas` es el *path* de la entrada rotulada **«Platos»**. Leer el path y decir
«Recetas» es exactamente el mismo error que la regla 30 describe un piso más
arriba: **el nombre con el que el código la guarda no es el nombre con el que el
usuario la lee.**

**«Platos» y «Precios» piden `show_costes`; «Cartas» y «Casado» solo rol
`manager`.** Así que quien no tenga el permiso de costes llega igual por Cartas.

*(El aviso del vigía lleva esta ruta escrita dentro, con estos rótulos.)*
