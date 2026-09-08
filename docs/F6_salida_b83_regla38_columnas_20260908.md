# B83 · §3.21 y §3.22 — las tres cosas, y la columna que descuadraba las cuatro pantallas

**08/09/2026 · rama `claude/schema-migrations-repo-40d7u8` · SIN publicar.**

---

## 1 · §3.22 · Regla 38 — cada título sobre su cifra

Julio: «los títulos de las columnas están totalmente descentrados». Tenía razón, y
la comparación maqueta-vs-construido no lo había visto **porque las dos estaban mal
igual**.

**La causa, medida en el construido antes de tocar nada:** la última pista de la
rejilla era `auto`. Esa celda está VACÍA en la cabecera (0 px) y lleva el botón en
las filas; como la primera columna es elástica, cada píxel del botón se lo quitaba
al nombre. Cabecera y filas tenían anchos distintos.

| tabla | celda de botones · CABECERA | · FILAS | desfase de cada título |
|---|---|---|---|
| Rentabilidad · carta | 0 px | 56 px | **56 px** |
| Resumen · por marca | 0 px | 85 px | **85 px** |
| Extras | 0 px | **197 y 206 px** | **206 px** |
| Ingeniería | (sin cabecera) | **56 · 150 · 189 · 191 · 230** | las filas bailan entre sí |
| Resumen · las 5 cosas | (sin cabecera) | 106 · 108 · 111 · 114 · 147 | ídem |

Ingeniería era la peor: cinco anchos distintos, así que la columna de la frase
cambiaba en cada fila.

**El arreglo:** la columna de botones tiene ancho FIJO, y la cabecera y la fila usan
literalmente la misma cadena de pistas. Con eso las columnas coinciden **por
construcción**, no por suerte. Las seis rejillas viven ahora en un solo fichero,
`src/modules/kitchen/lib/rejillasDeCocina.ts`, que importan la pantalla **y** su
captura — porque cada una estaba escrita dos veces y las dos copias tenían el mismo
fallo.

**Medido después, en el navegador, con las mismas fuentes:**

```
── rentabilidad  columnas 337px 105px 80px 95px 110px 75px 112px · botones [112] · desfaseMax 0
── resumen       columnas 472px 120px 90px 160px 100px           · botones [100] · desfaseMax 0
── extras        columnas 244px 120px 90px 110px 150px 214px     · botones [214] · desfaseMax 0
── ingeniería    250px 90px 90px 1fr 230px → [230]   ·  estrellas 1fr 70px → [70]
── resumen · 5 cosas   230px 1fr 150px → [150]       ·  rentabilidad · sin coste → [112]
```

**Cero de desfase en las tres tablas con cabecera, y un solo ancho de celda en las seis.**

**Los anchos:** los de Julio donde los dio (Resumen 100 · Rentabilidad 112 · Extras 214).
**Ingeniería lleva 230, no 200:** con 200 el par «Subir precio» + «Quitar de la carta»
—230 px medidos— se saldría. Nunca por debajo de lo medido.

**Y las estrellas de Ingeniería llevan su propia rejilla, de 70 px.** Están en OTRO
panel, así que no comparten columna con nadie: darles los 230 sería robarle 174 px a
la frase para dejarlos en blanco. Una columna sólo tiene que cuadrar dentro de su
propia tabla.

**Diferencia con el tablero que esto crea, y la digo:** en los tres cuadrantes de
decisión la frase tiene ahora 230 px menos, así que alguna envuelve en tres líneas
donde el tablero la pinta en dos. El tablero la tenía más ancha **porque sus filas no
cuadraban entre sí**. Es el precio de la regla 38 y me parece el correcto.

**La prueba** (`columnasCuadradas.test.ts`) no mide píxeles, y está escrito por qué:
con una pista fija y la misma cadena en cabecera y filas, las columnas coinciden por
construcción. Lo que vigila es exactamente eso —ninguna pista elástica salvo la del
nombre, ninguna `auto`— y que ninguno de los diez ficheros se escriba su propia copia.
La medición en el navegador se hizo a los dos lados y está pegada arriba.

---

## 2 · §3.21.1 · El orden de la foto sale de la misma función que el de la pantalla

Julio: «con "Por margen" marcado la captura enseña 4,02 · 4,02 · 3,67 · 4,03 · 4,79 ·
4,12: no está ordenada». No lo estaba **porque la foto no pasaba por la ordenación de
nadie**: la pantalla ordenaba en su `useMemo` y la foto listaba su array a pelo.

`ordenaLaCarta(filas, orden, margenPropio)` y `losSinCoste(filas)` bajan a
`lib/cartaYMargen.ts`. Las llaman la pantalla y la captura. Ahora la foto sale
11,81 · 11,69 · 11,42 · 10,38 …, que es lo que hace la pantalla.

**Y la captura de Rentabilidad usa ya los componentes de verdad** —`TablaDeCarta` y
`BloqueSinCoste`, sacados a `components/`— más los 33 productos reales de
`fixtures/cartaDeMeraki.ts`. Con eso se cierra la deuda que declaré el 07/09: **ya no
hay ni una unidad puesta a ojo**. Las cinco cifras las cuenta `cifrasDeRentabilidad`:
33 · 27 · 6 · 8,04 € · 15.791 € · 11,81 € · 89 de 2.053 — las mismas que verificó
Julio en producción (§3.17), porque salen de los mismos datos.

---

## 3 · §3.21.2 · «Caro de hacer» se mide contra el objetivo de la cuenta

Antes salía con un **40 % escrito a mano en el código**, y ese 40 no era de nadie: ni
de Julio, ni de la cuenta, ni de la carta. Una pantalla que llama «caro» a un plato
tiene que poder decir **caro comparado con qué**.

`etiquetasDeFila(f, objetivoPct)`: la pastilla sale cuando la cuenta tiene objetivo de
comida y el plato **lo supera** (estricto: llegar al objetivo es cumplirlo). `null` = no
hay vara, no se juzga a nadie — nunca se cae a un número por defecto, porque un umbral
inventado es peor que ninguno: parece medido.

**Consecuencia, y es la buena:** hoy Foodint no tiene objetivo puesto, así que **no sale
ni una pastilla** — y el Resumen dice, en su cuarta fila, «Sin objetivo de comida» con
su botón. Las dos pantallas cuentan la misma historia, en vez de que una juzgue con una
vara que la otra dice que falta. El día que Julio lo ponga en Ajustes, aparecen solas.

Cinco pruebas nuevas contra la carta real: sin objetivo, ninguna; al 40 %, exactamente
las cuatro de antes (el cambio es de dónde sale el número, no de la regla); al 25 %,
más; al 60 %, ninguna; y el límite estricto. «Sin ventas en el periodo» **no** depende
del objetivo y sigue con sus cuatro (dos marquesas y dos Daily Box, `uds === 0`).

**Lo que NO he tocado, y lo digo:** el 40 % de `frasePorCuadrante` —el «Cuesta el 44 %
del precio» de un lastre en Ingeniería—. Ahí no juzga, describe una proporción y ofrece
dos salidas; y esa pantalla la diste por buena anoche. Si quieres esa frase también
atada al objetivo, es un cambio de Ingeniería y va con su captura.

---

## 4 · §3.21.3 · «Coste conocido» — la pantalla ya estaba bien; mentía la foto

La columna llevaba en `text-cocina-tinta` desde B83.4. **La que estaba en gris era la
captura**, que tenía su propia copia del marcado. Es el mismo fallo que los motivos de
las cinco cosas y que la cabecera de bloque, y es de los caros: **da un veredicto de
«sin hacer» sobre trabajo ya hecho** (regla 30).

Arreglado por la vía estructural, no pintando: la tabla sale a
`components/TablaPorMarca.tsx` y la usan la pantalla y la foto. Ahí ya no hay nada que
copiar.

---

## 5 · De paso, un fallo que estaba en producción

«Vendidos sin saber el coste · **de 2053**». `String(n)` no agrupa nada, y
`toLocaleString` sin `useGrouping` explícito se salta las de cuatro cifras por su
`'min2'` de fábrica. Nace `enteroDeCocina` en `lib/`, con prueba que entra justo por las
cuatro cifras. Ahora dice «de 2.053», como el tablero.

---

## 6 · Medido a los dos lados, con la misma vara (regla 31)

| | `HEAD` (e3276302) | esta rama |
|---|---|---|
| `npx eslint .` | 1357 (1057 errores, 300 avisos) | **1357 (1057, 300)** |
| `npx vitest run` | 965 pasan / 6 fallan | **978 pasan / 6 fallan** |
| `npm run build` | ✅ | ✅ |

Los 6 fallos son los mismos de siempre en `main` —`brandsService.mappers`,
`salesChannelsService.mappers`, `routes`— deuda declarada; ninguno es de este trabajo.
**Cero problemas de lint nuevos**, y el número no se dio por bueno de entrada: la
primera medición salió 1359 y los dos de más eran míos (dos importaciones que dejé sin
uso al sacar la tabla del Resumen a su componente). Se quitaron y volvió a 1357.

---

## 7 · Lo que queda antes de publicar

- Las dos del §3.17 que siguen abiertas: `kitchen.marca` leído por Casado y las otras
  14 pantallas, y que «Casar o crear la ficha» abra en la marca que la propia fila
  nombra. («Mejor plato» entre los vendidos ya está, desde B83.)
- **Una sola publicación** con las tres pantallas cuando Julio dé el visto.
- Extras entra en la publicación aunque ya esté en producción: su rejilla también
  llevaba el `auto`, y era la que más desfase tenía (206 px).
