# A4 · los casos del ensayo, ESCRITOS ANTES DEL CÓDIGO

**11/09/2026, 13:30 (Madrid, reloj de la base).** Regla 32: un cambio de coste o de stock se
ensaya por sus CAMINOS, no por su fórmula. Y lo de A3: antes de ejecutar el
ensayo, escribir qué casos cubre la muestra y **forzarlos si no salen solos**.
Esta lista va primero, como pidió Julio, y el código se escribe contra ella.

Lo que se ensaya: `generate_sale_consumption` como **único escritor**, con el
corte por ingrediente; y A4, que no escribe movimientos — sólo decide qué
ventas regenerar y recalcula el coste.

---

## 0 · Antes de nada: la corrección de mi propio parte

En el parte de las 13:45 dije que lo de los dos escritores lo había encontrado
yo. **No es verdad, y hay que decirlo:** está diagnosticado y arreglado desde
el **15/08**, en `20260815T1300_fix_doble_consumo_venta_ddl.sql` y su hermana
de datos `…T1400_…_datos.sql`. Ese par cortó el grifo (`close_sale` pasó al
motor A) y limpió 16.940 duplicados. Ninguno de los dos ficheros está en
`supabase_migrations.schema_migrations`: se aplicaron por el SQL Editor, la
deriva conocida.

Lo que sí es nuevo, y es peor de lo que conté, es **por qué quedan 516**.
Medido:

| la copia (motor B) se escribió | el motor A se escribió | movimientos |
|---|---|---:|
| 08/07 – 04/08 | **25/08** | **516, todos** |

Los 516 motor-A se escribieron **el 25/08, sin una sola excepción**. O sea: el
15/08 esas 52 ventas tenían SÓLO motor B, así que la limpieza las respetó —
correctamente, porque borrar habría dejado la venta sin ningún consumo. Diez
días después, el reproceso del 25/08 les escribió el motor A **encima** del B
que seguía vivo, y el duplicado volvió a nacer.

**Conclusión que cambia el diseño:** esto no es un residuo histórico que se
limpia una vez. Es un **mecanismo que se re-crea** cada vez que se regenera una
venta que aún conserva movimientos del motor viejo. Mientras queden 3.277 filas
del motor B (1.224 con línea viva + 2.053 huérfanas), cualquier reproceso puede
volver a duplicar.

Por eso el escritor único, al regenerar una venta, tiene que **llevarse también
el motor B de esa venta** — con el corte delante, que es lo que impide tocar
por debajo de un recuento cerrado.

---

## 1 · Los siete caminos que pidió Julio

Cada uno dice: **qué se monta**, **qué tiene que pasar** y **cómo se fuerza** si
la muestra real no lo trae.

### C1 · Venta POSTERIOR al recuento
- **Monta:** venta con 2 ingredientes, `sold_at` después del último recuento
  aprobado de los dos en ese local.
- **Espera:** al regenerar, los dos se reescriben. Movimientos = los de la
  receta de hoy. `sale_line_id` puesto en todos.
- **Fuerza:** hay ventas de hoy en Alcalá (corte 11/09 00:33) — pero si el
  ensayo corre antes de que entren, se crea una venta de prueba con `sold_at`
  = ahora.

### C2 · Venta ANTERIOR al recuento
- **Monta:** venta cuyos ingredientes están todos por debajo del corte.
- **Espera:** **cero escrituras**. Ni un `DELETE`, ni un `INSERT`, ni un
  `UPDATE` de `updated_at`. Los movimientos que ya había quedan **byte a byte
  como estaban** — se comprueba con la lista de `id` y `qty_base` antes y
  después, no con un recuento.
- **Fuerza:** cualquier venta de julio en Alcalá sirve.

### C3 · Venta A CABALLO (un ingrediente de cada lado)
- **Monta:** una venta con dos ingredientes cuyo **último recuento aprobado es
  distinto**: uno contado después de la venta, otro antes.
- **Espera:** se reescribe SÓLO el que está por encima del corte; el otro,
  intacto. Éste es el caso que distingue «corte por ingrediente» de «corte por
  venta», y es el que se puede colar si el corte se toma por local.
- **Fuerza:** casi seguro hay que fabricarlo. Se aprueba un recuento de un solo
  ingrediente con fecha intermedia dentro de la transacción deshecha.

### C4 · REGENERAR DOS VECES
- **Espera:** la segunda pasada deja **exactamente** los mismos movimientos: mismo
  número, mismas cantidades. Se compara la suma por ingrediente y el recuento de
  filas a los dos lados (regla 31: la misma vara).
- **Fuerza:** sale solo. Pero hay que mirar también que el `stock` calculado no
  se mueva, no sólo los movimientos.

### C5 · Venta con EXTRA QUE CAMBIA
- **Monta:** venta con una línea de extra que pasa de `unmapped` a enlazada
  (que es justo lo que hace A3 + A4).
- **Espera:** A4 marca esa venta para regenerar; al regenerar aparece el
  consumo del extra y **sólo la diferencia** respecto a lo que había. El coste
  de la línea se recalcula.
- **Fuerza:** se coge una venta con `unmapped_reason = 'extra_desconocido'` o
  se fabrica enlazando a mano una línea de extra dentro del ensayo.

### C6 · COMBO
- **Monta:** venta con una cabecera de combo y sus `combo_item` hijos.
- **Espera:** consume por los hijos, **una sola vez**; la cabecera no duplica.
  Es el caso que la guarda D1 de `generate_sale_consumption` ya contempla y que
  hay que no romper.
- **Fuerza:** hay combos reales (KDB, hoy mismo). Si no, se fabrica.

### C7 · Venta CANCELADA
- **Monta:** venta con consumo escrito que pasa a `cancelled` / `rejected` /
  `is_active = false`.
- **Espera:** el consumo se retira **sólo por encima del corte**. Y aquí hay una
  pregunta que hay que contestar con la medición, no con la intuición: si la
  venta está por debajo de un recuento cerrado, **anularla no puede devolver
  stock** (sería escribir por debajo del corte). Lo que toca entonces es
  dejarlo y **decirlo**, no callarlo.
- **Fuerza:** se cancela una venta de prueba dentro de la transacción.

## 2 · Cuatro más que añado, porque el día de hoy los ha pedido

### C8 · La venta que conserva motor B (el caso de los 516)
- **Monta:** una de las 52 ventas con movimientos de las dos llaves.
- **Espera:** al regenerar **por encima del corte**, el motor B de esa venta se
  va con el resto; por debajo, **no se toca nada** y el informe lo dice.
- Sin esto, el reproceso del 25/08 se repite.

### C9 · Venta sin líneas enlazadas
- Como la de las 13:20 de hoy (KDB, 5 líneas, 0 enlazadas, `no_menu_item` /
  `no_brand`). **Espera:** cero movimientos, cero fallos, y no se registra un
  fallo de consumo por algo que no es un fallo.

### C10 · Venta con un ingrediente SIN NINGÚN recuento aprobado
- **Espera:** no hay corte que respetar → se reescribe. El `NULL` del corte no
  puede leerse como «no tocar» ni como «tocar»: hay que elegirlo a propósito y
  dejarlo escrito. **Elijo: se reescribe**, porque sin recuento no hay nada
  cerrado que proteger.

### C11 · Los permisos, dentro de la migración
- `proacl` de `generate_sale_consumption` **medido dentro de la propia
  migración**, no después. Hoy es `authenticated` sin guarda de cuenta; la
  migración no lo empeora, y si lo toca, lo dice.

## 3 · Lo que el ensayo mide a los dos lados (regla 31)

Con la misma consulta antes y después, pegando las dos cifras:

1. `count(*)` y `sum(qty_base)` por (ingrediente, local) de los movimientos de
   consumo de la ventana del ensayo.
2. `qty_on_hand` de `recipe_item_location_stock` de los pares tocados.
3. Número de filas de `stock_movement` en total.
4. `md5(prosrc)` de las funciones tocadas, antes y después.

Y el ensayo entero dentro de `DO $ensayo$ … RAISE EXCEPTION`, para que la
transacción se deshaga y el informe salga en el mensaje de la excepción.

## 4 · La vuelta atrás

Antes de aplicar: el cuerpo actual de `generate_sale_consumption` guardado con
su huella `97a3533602349f6cebb7f55f3ab15fc3`, en
`claude/vuelta_atras/`, probado con ida y vuelta hasta que la huella vuelva a
salir exacta. Como la de A3.

---

## 5 · Resultado del primer ensayo completo (13:55, reloj de la base)

Once casos, **diez en verde y uno rojo que era mío, no del código**.

```
C11 permisos         -> postgres | authenticated | service_role (intactos)
C2  anterior al corte-> escritos=0  movs 5->5  huella IGUAL  notas=10
C1  posterior        -> escritos=27 movs 27->27 suma igual  con_linea=27
C4  dos veces        -> movs 27->27 suma igual
C3  a caballo        -> protegido 1 mov (sigue), libre 1, nota=1, escritos=26
C7  cancelada        -> el protegido conserva su mov, el resto 0, escritos=0
    nota: «anulacion por debajo del corte: no se devuelve stock, el recuento
           posterior ya conto lo que habia»
C6  combo            -> movs 17->15  suma igual  con_linea=12   ← ROJO
C9  sin enlazar      -> escritos=0 movs=0
C5  extra cambia     -> 9/-448,089 · 9/-448,089 · 9/-448,089 (vuelve al sitio)
C8  motor B          -> filas del motor viejo 13->11, protegidos=13
C10 sin corte        -> corte NULL, sin nota: se reescribe
```

**C6 no era un fallo del código: era una aserción mía mal escrita.** Yo exigía
que las 15 filas llevaran `sale_line_id`, y sólo lo llevan 12. Medido aparte,
con una consulta que no toca nada: esa venta (08/09 23:21) implica **15
ingredientes, 12 libres y 3 protegidos** por recuentos posteriores. Los 12
libres se reescriben y llevan línea; los 3 protegidos conservan sus asientos
viejos, que no tienen línea porque nadie se la puso nunca. 12 + 3 = 15. El
código hace exactamente lo que debe.

La aserción correcta, y la que va en la pasada definitiva:
**todo movimiento sin `sale_line_id` tiene que pertenecer a un ingrediente con
nota de protección en esa venta**. No «todos llevan línea».

## 6 · El hallazgo que cambió el escritor: dos índices únicos dormidos

Al rellenar `sale_line_id` saltó un `23505`. Hay **dos** índices únicos
—`stock_movement_sale_dedup` y `stock_movement_sale_line_dedup`, idénticos—
sobre `(sale_line_id, recipe_item_id) WHERE source_type='sale'`. Llevaban meses
sin morder porque la columna estaba a NULL en las 68.582 filas: alguien diseñó
la garantía y nunca se armó.

Tienen razón: el motor viejo escribía una fila por cada renglón de
`_sale_line_raw_consumption`, y el mismo ingrediente puede venir dos veces en
una línea —una por la receta y otra por un extra—. Así que el escritor pasa a
**sumar por (línea, ingrediente)**.

**Medido a los dos lados, sobre 129 ventas reales de los últimos 2 días
(regla 31):**

| | antes | después |
|---|---:|---:|
| filas de movimiento | **1.474** | **1.367** |
| suma total de `qty_base` | **74.950,7183** | **74.950,7183** |

85 pares (línea, ingrediente) traían más de un renglón; 1 grupo se anula a cero
y deja de tener asiento. **El número de asientos baja un 7,3 %; la cantidad
total no se mueve ni una milésima.** El stock queda igual; el libro, más
limpio.

## 7 · Lo que falta antes de aplicar

El ensayo de arriba corrió con el cuerpo **sin los comentarios** del fichero, y
por eso su huella (`7b47480b…`) no es la del fichero (`3aa6ffcc…`). Eso no vale
como prueba final: lo que se aplica es el fichero. Antes de las 23:45 se vuelve
a correr **el fichero tal cual**, con la aserción de C6 corregida, y la huella
que salga tiene que ser `3aa6ffcccc5a9719d58e33eaebb4309c`.

---

## 8 · C14, que lo pidió Julio al dar luz verde a la clave ajena

**Reprocesar un pedido de Last que YA tenga movimientos con `sale_line_id`.**

- **Monta:** una venta de Last reciente, pasada primero por el escritor nuevo
  para que sus movimientos lleven la llave de línea.
- **Espera:** `reprocess_sale` borra y rehace las líneas **sin 23503**; los
  movimientos siguen vivos, con su `source_id` y la llave **a NULL** (lo que
  hace `ON DELETE SET NULL`); el escritor los reescribe; y **el stock queda
  idéntico**, medido por ingrediente con la misma consulta a los dos lados.
- **Fuerza:** sale solo desde que la clave ajena está en SET NULL
  (`20260911221932`). Antes de eso reventaba, y eso fue el hallazgo del C13.

Y una cosa que salió del repaso «sobre base sucia» y no estaba en ningún caso:
**las puertas de lo nuevo venían abiertas de fábrica.** La tabla
`sale_consumption_skip` que quedó aplicada a mano tenía
`authenticated=arwdDxtm` —INSERT, UPDATE y DELETE— porque los privilegios por
defecto de la cuenta los dan, y mi bloque revocaba a PUBLIC y a `anon` pero no
a `authenticated`. Lo tapaba la RLS, que no tiene política de escritura; pero
confiar en la segunda puerta teniendo la primera abierta es el fallo de p21
otra vez. Arreglado, y la migración lo comprueba dentro: si la tabla o
`_corte_motor_viejo` quedan abiertos, aborta.

---

## §9 · EL ENSAYO ENTERO, EN VERDE (12/09 00:33)

Una sola llamada, contra el fichero tal cual, acabada en `RAISE EXCEPTION`.
Transacción deshecha. **Fallos: 0.**

```
huellas: escritor 6c04a3e1abaa035549d286315f6c893f
         revert   e66eb22634582aa69cad84d0cef9478b
         reprocess 14e1e332a2bf552e9e6ae4793fb22f56
C2  anterior al corte  -> escritos=0  movs 5->5  huella=IGUAL  notas=10
C1  posterior          -> escritos=19 movs 19->19  suma -829,976->-829,976  con_linea=19
C4  dos veces          -> movs 19->19  suma -829,976->-829,976
C3  a caballo          -> protegido 2 movs, libre 1, nota=1
C12 revert a caballo   -> borro 17, protegido conserva 2, el resto 0
C7  cancelada          -> protegido 2, escritos=0
C6  combo              -> movs 16->14  suma -1.060,579->-1.060,579  sin_linea=0
C9  sin enlazar        -> escritos=0  movs=0
C5  extra cambia       -> con 6/-704,000 · sin 6/-704,000 · otra vez 6/-704,000
C8  motor B            -> filas viejas 14->3  protegidos=3
C13 reprocesar vieja   -> lineas=1, filas viejas 3->0
C14 reprocesar Last    -> antes con_linea=19 suma -829,976 · despues movs=19 suma -829,976 con_linea=17
C10 sin corte          -> corte NULL, sin nota
C11 permisos           -> postgres=X | authenticated=X | service_role=X
```

### Lo que hay que decir del ensayo, no solo su resultado

**1. El rojo de la pasada anterior era del guion, no del fichero.** C12 salio
«borro 19, protegido conserva 0» y arrastro a C7. Motivo MEDIDO, no supuesto:
mi guion instalaba `generate_sale_consumption` y `reprocess_sale` pero NO el
`revert_sale_consumption` nuevo, asi que corria el viejo —el que no sabe de
cortes— y borraba tambien lo protegido. C7 llegaba despues y no encontraba
nada que mirar.

Repetido con el revert del fichero instalado y su huella comprobada DENTRO del
ensayo: C12 pasa a «borro 17, protegido conserva 2, el resto 0».

*La leccion, que es la que cuesta:* un ensayo que instala parte de un cambio
prueba parte de un cambio. Y el resultado no se distingue de un defecto real.
Si el ensayo instala funciones, comprueba la huella de TODAS las que instala,
no solo la del protagonista. Es la regla 17 aplicada al ensayo y no solo a la
migracion.

**2. C14 cayo esta vez sobre la misma venta que C1.** Medido: las dos busquedas
resolvieron a `0f3ec074-2ac1-4eda-b782-0170d9c19cc8`. O sea que C14 no ensayo
un pedido de Last independiente, sino ese mismo, ya con el recuento aprobado de
C3 y el cancelar/restaurar de C7 encima. Paso igual, y en un estado mas duro que
el previsto. En la pasada anterior si eran distintas (17 movimientos, -629,976)
y tambien paso: ha pasado en las dos formas. Pero la coincidencia es del sorteo
del fixture, no del diseno, y por eso queda escrito.

**3. HALLAZGO: un movimiento protegido pierde su `sale_line_id` al reprocesar.**
Es el `con_linea=19 -> 17` de C14. `adapt_lastapp_order` borra y recrea las
lineas, la clave ajena (`ON DELETE SET NULL`) pone la llave a NULL, y los libres
se reescriben con las lineas nuevas — pero los protegidos NO se pueden
reescribir, por definicion, asi que se quedan sin llave.

El stock no se mueve (-829,976 a los dos lados) y la venta sigue siendo el
origen; lo que se degrada es la trazabilidad POR LINEA de esas filas
congeladas. Es el precio de congelarlas. Se dice ahora para que no aparezca
dentro de tres semanas en un tablero como si fuera un fallo nuevo.

### El repaso sobre la base sucia (00:25)

Lo que quedo aplicado a mano en los resbalones de la noche, y como lo atraviesa
el fichero:

| Lo que quedo | Estado medido | El fichero |
|---|---|---|
| `sale_consumption_skip` | existe, RLS ON, politica puesta, `authenticated=arwdDxtm` | `CREATE TABLE IF NOT EXISTS`, politica tras `IF NOT EXISTS`, `REVOKE`/`GRANT` incondicionales -> corrige el `arwd` |
| `cortes_aprobados`, `_corte_motor_viejo` | ya con las huellas del fichero | `CREATE OR REPLACE` |
| `idx_icl_item_count` | ya existe | `IF NOT EXISTS` |
| gemelo `stock_movement_sale_dedup` | ya borrado | `DROP INDEX IF EXISTS` |
| `consumo_sin_descontar_watchdog` | ACL abierta a PUBLIC y anon | los tres `REVOKE` la cierran |
| clave ajena | `confdeltype='n'`, validada | no se toca |

Regla 17 contra el FICHERO, no contra lo ensayado de memoria:

```
cortes_aprobados            364a73db64e9586cd04fa7903c1d581c    403 b  OK
_corte_motor_viejo          fbccf734a5d59f36cf6498bc01f8823a     45 b  OK
generate_sale_consumption   6c04a3e1abaa035549d286315f6c893f  9.048 b  OK
revert_sale_consumption     e66eb22634582aa69cad84d0cef9478b  4.325 b  OK
reprocess_sale              14e1e332a2bf552e9e6ae4793fb22f56  1.525 b  OK
consumo_sin_descontar_watchdog 743757af9cd59b26de88793d7102dcb5 3.038 b OK
```

Fichero == ensayo, byte a byte, en las seis.

### Estado antes de aplicar (00:35 Madrid)

Nada aplicado. Escritor vivo `97a3533602349f6cebb7f55f3ab15fc3` (el viejo),
0 movimientos con `sale_line_id`, 68.159 de consumo, 0 fallos de consumo
abiertos, 0 notas residuales. La unica venta de las ultimas 6 h sin consumo es
`ec1600dc-a5c9-4531-b200-a7289fd162a6` de HubRise, CANCELADA — correcto, no es
hallazgo.

Para el paso 3: `compute_sale_line_consumption` no la llama NADIE (ni funcion
ni trigger, barrido sobre `pg_proc.prosrc` y `pg_trigger`). El `DROP` es limpio.

---

## §10 · APLICADA, Y LA PRUEBA LLEGO SOLA (12/09 01:03 – 01:12)

### Lo que se aplicó, en orden y verificando cada paso

| hora (Madrid, reloj de la base) | qué | versión registrada |
|---|---|---|
| 01:03:26 | A4a, escritor único con corte | `20260911230326` |
| 01:05:30 | `DROP compute_sale_line_consumption` | `20260911230530` |

Las dos llevan su verificación DENTRO: si una sola huella no cuadra, la
migración se deshace entera. Pasaron.

### La cronología completa, medida — no reconstruida de memoria

El registro de `lastapp_webhook_log` es lo que la cierra:

```
01:00:03.038  tab:closed  -> G007  |  el MOTOR VIEJO regenera: 10 filas, 0 con llave
01:00:08.275  tab:closed  -> G546  |  el MOTOR VIEJO regenera:  7 filas, 0 con llave
01:00:08.732  tab:closed  -> U446  |  el MOTOR VIEJO regenera:  6 filas, 0 con llave
01:03:26      A4a aplicada
01:05:30      DROP del motor B
01:09:47.524  yo regenero esas tres con el escritor nuevo: 23 filas, 23 con llave
01:10:05.564  tab:closed  -> U936  |  el ESCRITOR NUEVO, SOLO, sin que yo lo llame
```

### El susto, y por qué no era un susto

La población congelada se movió: 68.159 -> 68.136, 23 filas menos. No lo dejé
pasar. Las 23 son exactamente esas tres ventas, y **`con_llave = 0` es la firma
de quién las escribió**: si las hubiera escrito el motor nuevo traerían
`sale_line_id`. Las escribió el viejo, en los 13 minutos entre mi foto (00:50:14)
y la aplicación (01:03:26).

*La lección de la vara:* «población congelada por `created_at`» no está
congelada — una regeneración legítima BORRA filas de ella. Con trafico vivo,
entre la foto y el cambio hay una ventana, y esa ventana hay que medirla, no
suponerla. La foto se toma lo más cerca posible del cambio, y si no se puede,
se explica fila a fila lo que se movió en medio.

### U936: la prueba que pedía Julio, y llegó sola

Julio pidió 2 o 3 ventas reales cerradas DESPUES de A4a. El último pedido de
anoche entró a las 23:38 (en 8 días, el más tardío es 23:59): no iba a entrar
ninguno. Pero a las 01:10:05 llegó un `tab:closed` de Last para U936 —creada
23:08:02, cerrada 23:20:13— y el escritor nuevo corrió SOLO:

```
U936  16 -> 14 movimientos  ·  suma -1.060,579 -> -1.060,579  ·  14 de 14 con sale_line_id
```

Las 14 son la misma suma en menos filas: una fila por (línea, ingrediente),
que es lo que despierta el índice único al rellenar la llave. Es el caso C6 del
ensayo, pasando en producción con el mismo número.

Las otras tres, por el camino real (`generate_sale_consumption`):

```
G007  10 movs, 10 con llave, 3 líneas  ·  -491,6700 -> -491,670
G546   7 movs,  7 con llave, 1 línea   ·  -306,7500 -> -306,750
U446   6 movs,  6 con llave, 1 línea   ·  -216,0000 -> -216,000
```

### El «no he roto nada», con las dos cifras (regla 31)

| medida | 00:47 (antes) | 01:12 (después) |
|---|---|---|
| suma `qty_base` de consumo | **-3.679.387,6226** | **-3.679.387,6226** |
| artículos con `qty_on_hand` movido | — | **0 de 726** |
| negativos | 207 | **207 · 0 nuevos** |
| movimientos con llave vieja | 1.224 | **1.224** |
| fallos de consumo abiertos | 0 | **0** |
| notas de corte | 0 | 0 |
| vigía del atajo | — | **0** |
| `compute_sale_line_consumption` | viva | **fuera** |
| movimientos con `sale_line_id` | **0** | **37** |

### Idempotencia, probada y no afirmada

La migración entera (37.752 caracteres), **leída de donde quedó registrada** —no
una copia mía de ella— se volvió a pasar sobre la base ya migrada dentro de una
transacción acabada en `RAISE EXCEPTION`: **no abortó**, y las seis huellas
salieron idénticas a los dos lados.

### Andamio, declarado y retirado

Para comparar artículo a artículo hicieron falta dos tablas de copia
(`_foto_stock_a4a`, `_foto_movs_a4a`). Se crearon con `execute_sql`, nunca las
leyó ni escribió nada del producto, y se borraron al terminar: 0 quedan. Se dice
aquí porque una tabla que aparece en la base sin migración es deriva, aunque
dure veinte minutos.

### Lo que queda dicho y NO arreglado

- Un movimiento protegido por el corte **pierde su `sale_line_id` si la venta se
  reprocesa**: la línea se borra y se recrea, y lo congelado no se puede
  reescribir. El stock no se mueve; se degrada la trazabilidad por línea de esas
  filas. Medido en C14.
- Quedan **1.224 filas del motor viejo** y los **516 duplicados**. Autorizados
  por Julio, van en su propia ventana, con la lista de artículos y cantidades
  por local delante.
