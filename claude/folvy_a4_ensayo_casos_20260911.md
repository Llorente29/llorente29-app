# A4 · los casos del ensayo, ESCRITOS ANTES DEL CÓDIGO

**11/09/2026, 14:20 (Madrid).** Regla 32: un cambio de coste o de stock se
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
