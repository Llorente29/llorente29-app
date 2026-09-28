# PARTE — El envase que viene de dos formas, y el envase del menú

> 28/09/2026, 10:45–12:3x (reloj de Madrid). Encargo de Julio del 28/09.
> Cuenta Foodint `51ad1792-6629-4ef7-833a-b57b09a86710` · proyecto `xzmpnchlguibclvxyynt`.

**No he escrito ni una fila en la base.** Todo son `SELECT`. La migración está
**propuesta y sin aplicar**, y el ensayo de los cuatro caminos está **escrito y
sin correr**. A las 11:55 quedaban 20 minutos para la banda, y esto toca el
camino del pedido de lleno: `_sale_line_raw_consumption` se ejecuta en cada
cierre y hay un `ALTER TABLE` sobre `menu_item`. Va **después de las 00:30**.

| fichero | qué es |
|---|---|
| `supabase/migrations/20260929T0100_envase_equivalente_y_envase_del_menu.sql` | La migración. Guarda de banda (G0), guarda de premisas (G1) y tres comprobaciones. Termina en `rollback;`. |
| `claude/folvy_ensayo_envase_equivalente_20260928.sql` | El ensayo por caminos: venta, albarán, merma y recuento, sobre filas reales. Se pega antes del `rollback`. |

## Lo primero: el apaño ya falla en Carabanchel, hoy

La limitación que el encargo apunta para el futuro («si Alcalá y Carabanchel
usan modelos distintos a la vez, el compuesto no puede representarlo») **ya
está pasando**. Es el stock vivo de hoy:

| artículo | Alcalá | Carabanchel |
|---|---|---|
| Salsero 120 Cc (vaso) | 750 | 500 |
| **Tapa Salsero 120 cc** | 1.330 | **sin fila (0)** |
| **Salsero Pp 120 Cc con Tapa** (una pieza) | 0 | **420** |
| Salsero con Tapa de 60cc (una pieza) | −1 | 607 |
| Salsero 60 cc / Tapa Salsero 60 cc | −1 / −1 | −18 / −18 |

El «Envase salsa 120 servido» baja **vaso + tapa**. En Carabanchel, cada
guacamole o consomé resta una tapa de 120 que allí no existe, mientras las 420
piezas únicas no se mueven. **El próximo recuento de Carabanchel va a traer el
mismo tipo de ajuste que el −848 de Alcalá**, pero al revés: tapas en negativo
y salseros de una pieza de sobra. Con el grupo, Carabanchel bajaría de la pieza
única (comprobación C2 de la migración).

## Parte 1 · El grupo de equivalencia

### Cómo lo he hecho, y por qué así

- **Tabla nueva `recipe_item_equivalente`**: grupo → miembros con `priority`.
  **Las 46 recetas no se tocan**: ya apuntan a los dos compuestos, y los dos
  compuestos pasan a ser los grupos.
- **Se toca un solo camino: el de descontar.** Hay una función nueva,
  `explode_recipe_to_raws_en_local`, que es copia literal de la de hoy con una
  diferencia: cuando llega a un grupo, elige miembro mirando el local.
  `_sale_line_raw_consumption` pasa a usarla, con la **misma firma** (la regla 2
  no se ve afectada).
- **`explode_recipe_to_raws` NO se toca.** Tiene seis lectores más (alérgenos,
  revisión de recetas compartidas, parte del día, cobertura…) que no saben de
  locales. Para ellos el grupo sigue siendo lo que diga su `recipe_line`, que
  apunta al **miembro 1**. La comprobación C1 verifica que sea así.

**Cómo se elige el miembro**, en este orden:

1. **Pegajoso.** Si lo congelado al cerrar la venta
   (`sale_line_consumo_esperado`) ya tiene las hojas de un miembro, se repite
   ese miembro. **Esto no venía en el encargo y hace falta:** el cron de las
   01:30 y los reprocesos regeneran ventas. Sin esta regla, regenerar una venta
   de ayer con el stock de hoy podría elegir el otro modelo y mover almacén
   entre artículos sin que nadie lo pidiera. Lo prueba el paso E1b del ensayo.
2. **Por stock.** Se elige el primer miembro cuyas hojas tienen **todas**
   existencias suficientes en el local. «Dos piezas» sin tapas no cuenta como
   disponible aunque haya vasos: el salsero se sirve con las dos o no se sirve.
3. **Si no hay ninguno**, se usa el miembro 1 y queda en negativo (punto 4 del
   encargo).

**Los miembros, por prioridad** (la que se compra hoy, según el encargo):

| grupo | 1 | 2 |
|---|---|---|
| Envase salsa 60 servido | Salsero con Tapa de 60cc (una pieza) | **nuevo** «Envase salsa 60 · dos piezas» = vaso 60 + tapa 60 |
| Envase salsa 120 servido | **nuevo** «Envase salsa 120 · dos piezas» = vaso 120 + tapa 120 | Salsero Pp 120 Cc con Tapa (una pieza) |

Los dos «dos piezas» nuevos son `recipe`, no stockables y con
**`batch_yield = 1`**, por las dos trampas del encargo. Las dos líneas del 120
se trasladan al miembro nuevo y el grupo pasa a tener una sola línea, que
apunta a él.

**El recuento no cambia.** `build_inventory_count` arma la lista con
`ri.type IN ('raw','packaging')`. Los grupos y los «dos piezas» son `recipe` y
no entran; los seis físicos sí (punto 5 del encargo, y el paso E4 lo cuenta).

## Parte 2 · El consumo propio del menú

### Por qué no se hace con `menu_item.recipe_item_id`

Es la pregunta obvia, y la respuesta está medida. De los **68 combos vivos**,
**uno** tiene artículo: «Menú Coca Cola Milanesa de Pollo Napolitana» (Milanesa
Haus). Su receta es **el menú entero**: Milanesa de Pollo Napolitana MH ×1 más
Coca-Cola Original Lata ×1. Y sus **11 ventas de 30 días llegan con
`combo_item`**. Si la rama combo del motor empezara a descontar `recipe_item_id`,
esas ventas descontarían **la milanesa y la lata dos veces**.

Así que va en una **columna nueva, `menu_item.combo_own_recipe_item_id`**. El
motor la descuenta **además** de los `combo_item`, y el coste de la línea la
suma. Si tiene consumo propio y su coste no se conoce, la línea queda
incompleta (`NULL`), igual que cuando falta un hijo: callar el coste de la caja
daría un coste falso, no uno más barato.

### 🔴 Lo que NO he puesto: la caja de Chivuos. Antes necesito una respuesta

He mirado qué gasta hoy cada hijo del «MENÚ BURGER MELT + PATATAS + BEBIDA CH»
(44 ventas en 30 días):

| hijo | envase que ya descuenta |
|---|---|
| BURGER MELT 2.0 CH | **Caja Burger Individual Chivuos** + servilletas + pergamino + bolsa |
| Ración patatas | **CAJA GENERICA 780 Ml** (una de las dos fichas; la otra no lleva envase) |
| bebidas | nada |

**La «Caja Burger Individual Chivuos» está en las 9 recetas de hamburguesa de
Chivuos.** Si la «Caja Hamburguesas Menú Chivuo´s» es la caja donde van juntas
la hamburguesa y las patatas, **sustituye** a las otras dos. Sumarla, como pide
el encargo («los componentes siguen descontando lo suyo»), haría gastar **tres
cajas por menú**.

La columna y el motor valen para los dos casos. Lo que cambia es qué se pone:

- **Si va ENCIMA** (la hamburguesa lleva su caja dentro de la caja del menú):
  una línea en la migración, `combo_own_recipe_item_id = caja` en los 10 menús.
- **Si SUSTITUYE:** la hamburguesa del menú no puede ser la misma ficha que la
  suelta, o su caja se descuenta igual. Eso es otro diseño, y no lo invento.

### Los 68 combos: cuáles necesitan envase propio

La lista para decidirlo: 68 fichas vivas, **861 ventas en 30 días**, y todas
menos 2 llegan con `combo_item`. O sea que el consumo propio las cubriría.

| marca | fichas | ventas 30 d |
|---|---|---|
| Koreans do it better | 6 | 347 |
| Chivuos | 12 | 119 |
| Dos Coyotes | 6 | 118 |
| Big Mike´s Burger Joint | 7 | 92 |
| Ay Mamita Bowls | 5 | 62 |
| Smash Brothers Burgers | 2 | 34 |
| Deep Pizza | 5 | 32 |
| Milanesa Haus | 4 | 23 |
| Meraki Pita | 4 | 22 |
| Milanesa House | 4 | 7 |
| The Urban Kebab | 2 | 2 *(sin `combo_item`: son de antes de publicarlo como combo)* |
| Mila's Sandwiches | 2 | 2 |
| Birria Burrito | 1 | 1 |
| Bendito Burrito, Dirty Burger, Scandal, Lovers, Lobbers | 8 | 0 |

**Decir cuáles llevan caja propia es cosa de cocina**, no de la base: la base
no sabe si un menú de Koreans va en una bolsa o en una caja. Con la lista, se
decide marca a marca.

## Lo que el ensayo tiene que demostrar (regla 10)

Está escrito para **filas reales**: 2 albaranes en `borrador` y 14 recuentos
abiertos disponibles hoy. Son cuatro caminos:

- **E1a · venta.** La última venta de Carabanchel con el grupo de 120, con su
  «esperado» borrado dentro del ensayo. Tiene que bajar **la pieza única, y ni
  vaso ni tapa**.
- **E1b · regeneración de la misma venta.** Tiene que dar el mismo número de
  movimientos antes y después (pegajoso).
- **E1c · venta de menú de Chivuos**, con la caja puesta **solo dentro del
  ensayo**. Tiene que salir la caja además de las de los componentes, y el
  coste de línea no puede ser nulo.
- **E2 · albarán, E3 · merma, E4 · recuento.** Tienen que salir sin fallo, y el
  E4 tiene que tener **0 líneas de recuento que sean un grupo**.

**Hallazgo ya, antes de correrlo:** `stock_waste` no tiene **ni una fila** de
Foodint. La merma nunca se ha usado en esta cuenta, así que el motivo del E3
(`'merma'`) sale de leer `register_waste`, no de datos reales. Si falla por eso,
lo que falla es el ensayo, no la migración; se pega y se decide.

**Sin los cuatro pegados en el parte, no hay `commit`.**

## Lo que la regla 40 cazó en mi propio fichero

Había escrito `references public.account(id)`. **La tabla se llama `accounts`**:
lo dice la clave ajena `recipe_item_account_id_fkey`. `tsc` y el lint no lo
habrían visto; habría reventado a las 00:30 en el primer `create table`.
Corregido y comprobado contra `pg_class`, junto con el resto de nombres
entrecomillados de la migración y del ensayo: `locations`,
`sale_line_consumo_esperado`, `belongs_to_account`, `_qty_in_base`,
`_impact_cost`, `inventory_count_line.recipe_item_id`, `goods_receipt.created_at`
e `inventory_count.created_at`.

## Anotado, y no es de este encargo

- **Hay un octavo artículo:** «Tapa Salsero 120 Cc» (`133862c7…`, con «Cc» en
  mayúscula), con 0 de stock en dos locales y 0 recetas. Es un duplicado de
  «Tapa Salsero 120 cc» (`bb458e8a…`), igual que «Salsero Grande 120cc» lo es
  del vaso. El encargo habla de siete.
- **«Salsero 60 cc» y «Tapa Salsero 60 cc» tienen `is_stockable = false`**, y
  aun así tienen stock (−18 en Carabanchel). No afecta ni al recuento (que
  filtra por tipo) ni a la explosión (un `packaging` es hoja lo sea o no), pero
  es incoherente con sus hermanos y conviene igualarlo.
- **Los dos compuestos tienen `computed_cost` NULO.** Las 46 recetas que los
  usan sí se recalcularon hoy (46 de 46 con `cost_updated_at` del 28/09). No he
  comprobado si ese coste incluye el envase; es lo primero que miraría si un
  plato de salsa sale más barato que ayer.

## Lo que necesito de ti, Julio

- **P1 · La prioridad de los miembros.** ¿Es correcta la de arriba (60: primero
  la pieza única; 120: primero vaso + tapa)?
- **P2 · La caja del menú de Chivuos: ¿va encima de la caja de la hamburguesa y
  de la de las patatas, o las sustituye?**
- **P3 · ¿Paso la migración esta noche** (después de las 00:30), primero con
  `rollback` y el ensayo, y solo después con `commit`?
