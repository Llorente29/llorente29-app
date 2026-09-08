# B83 · Las tres pantallas de B79 al estándar de la maqueta

**08/09/2026 · rama `claude/schema-migrations-repo-40d7u8` · SIN publicar todavía.**
Las tres capturas van a Julio antes de publicar (§9.3: la captura la mira él antes).

Las tres comparaciones, generadas con los componentes REALES y el CSS del build,
a 1280 y con las mismas tipografías incrustadas en los dos lados:

| Pantalla | Maqueta | Comparación |
|---|---|---|
| Resumen | `Main.dc.html` | `docs/capturas/resumen_comparacion_20260908.png` |
| Rentabilidad | `Rentabilidad.dc.html` | `docs/capturas/rentabilidad_comparacion_20260908.png` |
| Ingeniería de menús | `Ingenieria.dc.html` | `docs/capturas/ingenieria_comparacion_20260908.png` |

---

## 1 · Lo que había que arreglar en Ingeniería, y por qué era reescritura

Era la única de las tres que no importaba **ni una** pieza del patrón (deuda
declarada en el §3.13): tenía su propio marcado de arriba abajo. Ahora usa
`CabeceraCocina`, `CampoCocina`, `CifrasCocina`, `CifraCocina`, `ChipCocina`,
`InterruptorCocina`, `PanelCocina`, `BotonCocina`, `CabeceraDeBloque` y
`RotuloDePanel`, y no queda marcado propio salvo la fila.

Las diferencias contra la maqueta, enumeradas y corregidas:

1. **La rejilla de fila.** Yo tenía el nombre elástico y la frase DEBAJO, con el
   nombre recortado por la mitad. La maqueta le da al nombre 250 px fijos y pone
   la frase en su propia columna, a la derecha de los números — así unidades y
   margen quedan pegadas y se leen de un vistazo, que es la pregunta de la
   pantalla. `REJILLA_INGENIERIA` pasa a `250px 90px 90px minmax(0,1fr) auto`.
2. **La negrita de la frase.** La maqueta destaca el número por el que se decide
   («habrías ganado **68 € más**», «Deja **11,69 €**, de lo mejor de la carta») y
   la pantalla lo pintaba todo en plano. `frasePorCuadrante` devuelve ahora
   `destacado` —el trozo, no HTML— y `parteLaFrase` lo parte en tres. La capa de
   regla sigue sin saber pintar: si devolviera `<b>` no se podría comparar con
   una cadena en una prueba, y el día que la frase vaya a un correo saldría con
   las etiquetas dentro. Se destaca **sólo donde hay algo que destacar**: si
   todas las frases llevaran negrita, la negrita no diría nada.
3. **Un panel por cuadrante → dos paneles.** Los tres que piden una decisión van
   juntos, con una cabecera de bloque cada uno: son la lista de trabajo y se lee
   de un tirón. Las estrellas van en su panel, con rótulo en vez de cabecera y
   filas más bajas: no son trabajo, son la parte de la carta que está bien.
4. **El orden de la barra.** Los dos mandos (pastillas + interruptor) juntos a la
   izquierda y la nota a la derecha. Un interruptor separado de las pastillas por
   medio metro de pantalla no se lee como parte del mismo filtro.
5. **Las unidades.** `149 uds` con «uds» en pequeño y apagado, como la maqueta;
   el número en tinta, no en gris.
6. **El peso del nombre.** 500, no 600. En la maqueta el peso fuerte es del
   margen, que es la columna por la que se decide; un nombre en negrita se lo
   robaba.
7. **Los botones.** El primero con borde y el resto en fantasma, y sólo cuando
   hay más de uno — un botón solo («Abrir» de una estrella) no es la acción
   principal de nada. Antes el primero iba en relleno.
8. **«Decide si se queda» → «Si se queda, que sea por algo que no sea el
   margen»**, y con «Abrir» detrás. Es lo que dice la maqueta y dice más: un
   lastre puede quedarse por ser el único plato vegano de la carta, y eso está en
   la ficha, no en esta pantalla. No rompe la regla del 06/09 —«Mantener» no
   existe, no decidir no es una acción—: prohíbe no decidir, no prohíbe mirar.
9. **«cada uno cuenta uno» → «cada plato cuenta uno»** (y «cada bebida» en la
   pestaña de bebidas), como la maqueta.
10. **El pie**: «Los 6 **platos** sin coste…».

### Lo que NO se ha igualado, y por qué

- **El «€» de la media va en pequeño**, y la maqueta de Ingeniería lo pinta
  grande. La de **Rentabilidad** lo pinta pequeño (`8,04<small>€</small>`), la
  pieza `CifraCocina` lo hace con `sufijo`, y las tres pantallas salen juntas: la
  maqueta se contradice a sí misma en esto y se ha elegido el lado con el que ya
  están las otras dos.
- **El pie no nombra los platos uno a uno.** La maqueta dice «(menús, Daily Box,
  dos platos sin receta) y las 2 marquesas sin ventas»; la pantalla dice cuántos
  hay de cada clase pero no puede clasificarlos así sin inventarse una regla.
- **El carril de la izquierda** es el del menú REAL de la app, no el de la
  maqueta. Es el marco, no la pantalla, y las otras dos capturas llevan el mismo.

---

## 2 · Lo que se ha arreglado de rebote en las otras dos

Al escribir la cabecera de bloque de Ingeniería salió que había **cuatro copias
escritas a mano** de la misma pieza y que **sólo la de Extras estaba bien**.
Rentabilidad e Ingeniería habían escrito la suya con el marcado de `.panel-h`
—11 px, versalitas, separadas a los extremos— cuando la maqueta ahí pone `.qh`,
que es 14 px y con la explicación AL LADO. Comparando cada pantalla consigo
misma esto no se ve nunca.

- Nuevas piezas: **`CabeceraDeBloque`** (`.qh`, agrupa filas dentro de un panel)
  y **`RotuloDePanel`** (`.panel-h`, rotula el panel entero), con su contrato de
  píxel en `patronDeKitchen.test.tsx`.
- **Rentabilidad**: «Sin coste · 6» pasa a `CabeceraDeBloque`.
- **Resumen**: «Por marca · comida sobre ventas» pasa a `RotuloDePanel`. Pierde
  el fondo gris —`.panel-h` no lo lleva; con él el rótulo pesaba lo mismo que una
  fila de datos— y la mitad derecha vuelve al mismo tono que la izquierda. La
  tenía yo en `text-cocina-tinta-2` con un comentario que decía «como el
  tablero», y el tablero no hace eso: era mío.
- Y una de regla 37 que no habría cazado nadie: la captura del Resumen pintaba
  esa mitad derecha en `text-[11.5px] text-cocina-tinta-3` y la pantalla en
  `text-[11px] font-bold … tinta-2`. **La foto y la pantalla no coincidían.**
  Ahora las dos usan la pieza, así que no pueden separarse.

---

## 3 · La población de la foto, y una sola copia de ella

`tests/unit/modules/kitchen/fixtures/cartaDeMeraki.ts`: los 33 productos activos
de Meraki Pita el 06/09/2026 con su precio, su IVA, su `computed_cost` y las
unidades vendidas en la ventana FIJA `[2026-06-08 00:00+02, 2026-09-06 00:00+02)`,
de la cuenta Foodint (regla 9). Antes vivían dentro de `cartaYMargen.test.ts`.

La usan la prueba de la regla **y** la de la captura. Si cada una tuviera su
copia, la foto podría acabar enseñando una carta que la regla no ha visto nunca
(regla 31: una población, la misma vara a los dos lados).

Los cuadrantes de la captura **no** están colocados a mano: salen de
`construyeMatriz` sobre esos 33 productos, y la propia prueba comprueba que dan
4 · 2 · 5 · 8 sobre 19 platos, media 7,98 € y 94 unidades — las cifras de la
maqueta aprobada. Las frases y los botones salen de `frasePorCuadrante`. Ni una
letra escrita a mano en la foto (regla 37).

Y tres candados nuevos en `capturaIngenieria.test.tsx`: los selectores de la
captura son los mismos que los de la pantalla, no hay selector de **Local**
—`menu_item_units_sold(p_brand_id, p_from, p_to)` no lo acepta, medido en la
base (regla 35)— y la rejilla de fila es la misma cadena en las dos.

---

## 4 · Medido a los dos lados, con la misma vara (regla 31)

Tomado el 08/09 con el mismo comando y en el mismo minuto:

| | `origin/main` | esta rama |
|---|---|---|
| `npx eslint .` | 1357 problemas (1057 errores, 300 avisos) | **1357 (1057, 300)** |
| `npx vitest run` | 941 pasan, 8 fallan | **965 pasan, 6 fallan** |

Los 8 de `main` son 6 fallos reales + 2 pruebas de captura que fallan en un árbol
sin `dist` (piden el CSS del build). Los 6 son los mismos de siempre —
`brandsService.mappers`, `salesChannelsService.mappers`, `routes` — deuda
declarada, ninguna es de este trabajo. **Cero problemas de lint nuevos.**

`npm run build` en verde (B42: se compila con el build, no con `tsc --noEmit`).

---

## 5 · Lo que queda antes de publicar

- Las cinco cosas del §3.17 que siguen abiertas: «Mejor plato» tiene que ser el
  mejor margen **de los vendidos** en el periodo, y `kitchen.marca` lo tienen que
  leer Casado y las otras 14 pantallas.
- Rehacer la captura de Rentabilidad con las unidades vendidas reales (hoy mezcla
  las que Julio verificó con algunas puestas a ojo; precios y costes sí son de
  producción, y está escrito en la cabecera del fichero).
- **Una sola publicación** con las tres pantallas, cuando Julio haya visto las
  tres capturas.
