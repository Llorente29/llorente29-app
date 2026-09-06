# F6 · B82 — «Invalid time value» tumbaba las tres pantallas nuevas de Kitchen

**06/09/2026 · incidente en producción (web de oficina) · hotfix**

## 1 · La causa, exacta. Y NO es la del §2 del encargo

`intervaloEnCastellano` lee `YYYY-MM-DD HH:MM`, **con espacio**, porque `parte()`
hace `v.split(' ')`. Las tres pantallas le pasaban `date.toISOString()`, que lleva
**«T»**. A partir de ahí:

```
'2026-09-06T18:01:02.123Z'.split(' ')   → ['2026-09-06T18:01:02.123Z']  (hora = undefined → '00:00')
'2026-09-06T18:01:02.123Z'.split('-')   → ['2026', '09', '06T18:01:02.123Z']
Number('06T18:01:02.123Z')              → NaN                    ← el día
hora === '00:00'                        → finExclusivo = true    ← entra en diaAnteriorDe
Date.UTC(2026, 8, NaN)                  → NaN
new Date(NaN).toISOString()             → RangeError: Invalid time value
```

`aLe` de la traza es **`diaAnteriorDe`**; `wF` es **`intervaloEnCastellano`**.

**Los tres llamadores rotos son míos** (`KitchenDashboardPage:152`,
`KitchenProfitabilityPage:186`, `KitchenMenuEngineeringPage:167`). El cuarto
llamador, `InformesPage`, nunca falló porque pasa la cadena tal cual la manda la
RPC, ya en el formato bueno.

## 2 · Por qué no lo cazaron 805 pruebas — y no fue el navegador

El §2 del encargo lo atribuye a que Node y Chrome parsean distinto, «el mismo
agujero que el ICU de esta tarde, en la otra dirección». **No es eso.** `Date.UTC`
con un `NaN` da `NaN` en Node exactamente igual que en Chrome, y
`new Date(NaN).toISOString()` lanza en los dos. Lo comprobé antes de escribir el
arreglo.

**La razón real es más simple y peor: ninguna de las 805 pruebas pintaba una
cabecera.** Las mías son de lógica pura (`cartaYMargen`, `lasCosasQueArreglar`,
`objetivoDeComida`) y la única de render (`patronDeKitchen`) sólo monta `Cifra` y
`Campo`. Era código sin probar, sin más. Que la línea de regla de las tres
pantallas —lo primero que se ve— no tuviera ni una prueba es culpa mía y del lote,
no del entorno.

## 3 · El arreglo, en las dos capas

**Capa 1 — que no pueda volver a lanzar en render.** `parte()` comprueba que año,
mes y día sean números finitos y que el mes esté entre 1 y 12; si no,
`intervaloEnCastellano` devuelve **`null`** en vez de seguir con un `NaN` dentro.
El tipo pasa a `string | null`, así que quien llame tiene que decidir qué dice.

**Capa 2 — que los llamadores pasen lo que la función lee.** Nace
`fechaParaIntervalo(d: Date)`, que formatea `YYYY-MM-DD HH:MM` **en hora local** —la
que hay que enseñarle a una persona, y la misma que manda la RPC— y
`intervaloDeFechas(desde, hasta)`, para que nadie tenga que volver a saber el
formato de memoria. Las tres pantallas usan ésta.

**Y lo que dice la pantalla cuando no hay fecha legible:** «periodo sin fechas» en
el Resumen, «en el periodo elegido» en Rentabilidad e Ingeniería. La pantalla se
pinta con sus datos; lo único que se pierde son las fechas de la frase.

`InformesPage` no se toca: recibe `string | null` y en JSX un `null` no pinta nada.
Su entrada viene de la RPC en el formato bueno, así que en la práctica no cambia.

## 4 · La prueba, contra la cadena REAL

15 pruebas nuevas en `tests/unit/modules/ventas/textoInforme.test.ts`, y la primera
es **la cadena exacta que reventó** (`'2026-09-06T18:01:02.123Z'`), más la ventana
de 30 días construida igual que en la pantalla. Antes lanzaba; ahora devuelve
`null`.

**Un fallo mío dentro de la propia prueba, y lo digo porque es la lección del
día:** escribí que `'2026-08-24 00:00' → '2026-08-31 00:00'` debía dar «Del 24 al
**31**» y la función daba «al **30**». **La equivocada era mi prueba**: el límite
superior es EXCLUSIVO y la docstring lo decía desde el principio («al 30, no al
31»). Corregí la prueba, no la función. Si lo hubiera hecho al revés, habría roto
Informes «arreglando» Kitchen.

## 5 · Números

| | antes del hotfix | después |
|---|---|---|
| `npm run build` | verde | **verde** |
| lint | 1357 (1057 · 300) | **1357 (1057 · 300)**, idéntico |
| pruebas | 6 rojas (las de `main`) | **6 rojas, las mismas tres ficheros** |

## 6 · Publicación

**23:50 de Madrid, pasado el cierre de los tres locales (23:45).** Así que este
bundle sale ya dentro de la ventana buena para las tablets, aunque no usen estas
rutas.

## 7 · Lo que queda pendiente y no arregla este hotfix

La regla que sale de aquí —**la línea de regla de una pantalla se prueba, porque es
lo primero que se ve y hoy no la probaba nadie**— pide una prueba de render por
pantalla, no sólo del componente compartido. No la hago en un hotfix a las 23:50:
va anotada para el lote siguiente.
