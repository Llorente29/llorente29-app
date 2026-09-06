# F6 · B83 — Ni un identificador en pantalla de cliente

**06/09/2026 · lote de arreglos sobre el Resumen de Kitchen (§3.17)**

Cuatro cosas: una grave (la definición técnica pintada) y tres menores («Del» con
mayúscula, «Mejor plato» entre platos sin ventas, y Casado abriendo en la marca
equivocada).

---

## 1 · Lo grave: la pantalla enseñaba SQL

Las cinco filas del Resumen pintaban debajo, en cursiva, la regla con la que se
contó — y esa regla estaba escrita en el idioma de la base:

```
price_impact > 0
menu_item.recipe_item_id IS NULL
recipe_item.packaging_cost a NULL o a 0
kitchen_settings.target_food_cost_pct
```

**La intención era buena y se mantiene entera:** que el número no se separe nunca
de la regla con la que se contó. Lo que estaba mal era el idioma. Así que la
regla no se quita: se parte en dos.

| campo | qué es | ¿se pinta? |
|---|---|---|
| `definicion` | castellano de persona | **sí, y es la única** |
| `regla_tecnica` | las columnas exactas | **no. Viaja para soporte y para poder auditar el número** |

Las seis que se pintan hoy, tal cual salen de producción:

- **en carta** · «Un plato está «en carta» si está activo y no se ha retirado del catálogo.»
- **extras** · «Un extra que el cliente paga aparte y que, sumado lo que lleva, no añade ni un céntimo de coste. Cuenta también el que no tiene nada puesto.»
- **sin coste** · «Un plato de la carta del que Folvy no sabe lo que cuesta: o no tiene ficha de escandallo enlazada, o la tiene sin terminar.»
- **sin envase** · «Un plato cuya ficha tiene el envase a cero, así que su coste no incluye lo que cuesta servirlo.»
- **ingredientes** · «Un ingrediente en uso al que no se le ha puesto ningún precio, ni a mano ni por compras.»
- **sin objetivo** · «La cuenta no tiene un objetivo de comida sobre ventas al que apuntar, así que ninguna cifra puede llamarse buena ni mala.»

Nada más ha cambiado en la función: mismos contadores, mismo orden, misma firma,
mismos `peores`. Sólo el idioma de lo que se enseña.

---

## 2 · La migración, y el guarda que me abortó a mí

`20260906220851_b83_kitchen_catalog_gaps_castellano_de_persona.sql`.
Sustituye a `20260906172842`, que queda en el repositorio como historia.

**El primer intento lo abortó mi propio guarda, con las definiciones ya
correctas.** Escribí:

```sql
v_src like '%d_sin_coste  constant text := ''%recipe_item_id%'
```

Dos errores míos en una línea:

1. El `%` final busca en **TODO** el cuerpo, y `recipe_item_id` aparece más
   abajo, en los CTE, legítimamente.
2. En `LIKE` el `_` es un comodín de un carácter, así que `d_sin_coste` ni
   siquiera anclaba donde yo creía.

El guarda bueno saca las líneas `d_*` **una a una** y comprueba cada una sola,
con `d\_%constant text :=%` y una regex. **Se probó contra la función VIEJA antes
de aplicar: encontró las 6 y marcó las 6.** Un guarda que no se prueba en el
estado que debe rechazar es un guarda de adorno.

### Verificación, con la consulta, no con el «Success»

| qué | resultado |
|---|---|
| firmas de `kitchen_catalog_gaps` | **una sola**: `(uuid, interval)` — sin sobrecargas (regla 2) |
| `security definer` | sí |
| `anon` puede ejecutar | **no** (regla 16) |
| `authenticated` puede ejecutar | sí |
| líneas `d_*` (se pintan) | 6 |
| líneas `t_*` (viajan) | 6 |
| emisiones de `'definicion'` | 6, **todas por variable `d_*`**, ninguna literal |
| emisiones de `'regla_tecnica'` | 6, todas por variable `t_*` |
| barrida sobre las 6 `definicion` | 0 con snake_case · 0 con SQL · 0 con operadores · 0 con `()` |
| guarda de permiso | probado: llamarla sin permiso da `42501` con el mensaje en castellano |

### Repo = BBDD (regla 17)

```
version en supabase_migrations.schema_migrations : 20260906220851
md5 de statements en la BBDD                     : adcaec1bf947ef9aff542943da564aba  (15.293)
md5 del fichero del repo, rstrip('\n')           : adcaec1bf947ef9aff542943da564aba  (15.293)
```

Iguales. **A la primera no lo eran**: 15.294 contra 15.293. Un espacio de más en
la línea 198 al transcribir. Se localizó comparando **longitud y md5 línea a
línea** contra la base, no leyendo — 308 líneas, una sola distinta.

---

## 3 · Las tres menores

**«Del» con mayúscula.** `intervaloDeFechas(desde, hasta, { minuscula: true })`
en Rentabilidad y en el Resumen, donde la frase viene de antes. Ingeniería
mantiene la mayúscula: allí la frase empieza en esa palabra.

**«Mejor plato» salía de entre platos sin ventas.** `cartaYMargen.ts` ahora salta
`f.uds <= 0`. Un plato que no se ha vendido ninguna vez no puede ser el mejor de
nada: su margen es una división sin numerador.

**Casado abría en Ay Mamita.** Ahora el orden de preferencia es
`?marca=` de la URL → marca recordada → marca propia → primera; y el `onChange`
guarda. El botón del Resumen emite `casado?marca=<la marca con más platos sin
ficha>`, que hoy es Chivuos (17 de 45), no la primera de la lista.

---

## 4 · Las pruebas, contra la población real (regla 31)

La barrida anti-identificador que escribí ayer tenía el defecto que la regla 31
describe: **miraba `titulo`, `motivo` y `boton` — todo menos `definicion`, que es
el campo que se rompió.** Y la `definicion` del ayudante de pruebas la había
escrito yo («definición que da la base»), así que era un espejo.

Corregido en tres pasos:

1. `definicion` y «las que más» **entran** en lo que la barrida considera
   pintado. Ahora es la fila entera, igual que en el JSX.
2. Las **seis cadenas reales de producción** entran como fixture, copiadas
   literales de `prosrc` después de aplicar. Se barren una a una.
3. **La barrida tiene que saltar con algo.** Se afirma que las seis
   `regla_tecnica` reales —que son exactamente lo que se pintaba el 06/09—
   **sí** disparan los patrones, y se reconstruye la fila del incidente para
   comprobar que salta. Una barrida que no salta nunca no demuestra nada.

### Antes y después, con la misma vara

| | `HEAD` limpio | con B83 |
|---|---|---|
| pruebas | 6 fallan · 806 pasan · 812 | 6 fallan · **830 pasan** · 836 |
| lint | 1357 · 1057 errores · 300 avisos | **1357 · 1057 errores · 300 avisos** |
| `npm run build` | verde | verde |

+24 pruebas, todas verdes. Lint idéntico: cero avisos nuevos.

---

## 5 · Deuda que dejo declarada, y NO he tocado

**En `main` hay 6 pruebas rojas que no son mías.** Estaban antes de este lote y
siguen después; están en tres ficheros que no toco:

- `tests/unit/routes.test.ts` — afirma que `PUBLIC_AUTH_ROUTES` tiene 4 rutas.
  Hoy tiene 5: alguien añadió `/acceso` y no actualizó la prueba.
- `tests/unit/modules/multitenancy/brandsService.mappers.test.ts` — 2 fallos.
- `tests/unit/modules/multitenancy/salesChannelsService.mappers.test.ts` — 3
  fallos, del tipo «esperaba `null`, llegó `undefined`».

No las arreglo dentro de B83 porque no son de B83 y meterlas aquí ensucia el
lote. Pero hay que decirlo: **la suite de `main` está roja**, y una suite roja
deja de avisar. Las de los mapeadores hay que mirarlas contra el mapeador de
verdad antes de tocar la prueba — puede ser la prueba la que tenga razón.

Sigue abierto de antes: Ingeniería con su propio maquetado, el orden de cifras de
Ingeniería contra la maqueta, una prueba de render por pantalla, y las dos piezas
del OTA.
