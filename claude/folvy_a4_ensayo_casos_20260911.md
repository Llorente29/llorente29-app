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
