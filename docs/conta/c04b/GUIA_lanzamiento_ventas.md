# C04b · Guía de lanzamiento: la regla de ventas por plataforma (0100–0140)

Para Julio. Dos lanzamientos, en este orden, **desde la rama
`conta/c04b-diez`, sin fusionar**. **Entre el ensayo y el real no se empuja
nada a la rama**: el real exige un ensayo en verde **del mismo commit**, y
si no lo hay, ni empieza.

Los dos, en: GitHub › **Actions** › **Aplicar SQL en PRODUCCIÓN
(contabilidad)** › **Run workflow**.

## La tanda (`supabase/produccion/aplicar.txt`)

| # | Fichero | Qué hace | Análisis (contra producción, 13/10) |
|---|---|---|---|
| 1 | `20261020T0100_ventas_por_plataforma.sql` | la regla por empresa, la unidad del resumen, la propuesta por unidad y las cuatro funciones del proponedor | sigue |
| 2 | `20261020T0105_ventas_por_plataforma_permiso.sql` | `conta_unidad_ventas` de quien llama y con permiso para authenticated (sin ella, el Libro diario no abre) | sigue |
| 3 | `20261020T0110_ventas_por_plataforma_indice.sql` | el índice único del resumen, por unidad | **AUTORIZO** |
| 4 | `20261020T0120_ventas_por_plataforma_foodint.sql` | Foodint: Glovo por marca; las 18 subcuentas de marca; 70800003, 70800007 y 70800008 | sigue |
| 5 | `20261020T0130_ventas_por_plataforma_rehacer.sql` | retira los asientos del día entero propuestos (24 el 13/10), con copia | **AUTORIZO** |
| 6 | `20261020T0140_libro_lectura_registro.sql` | `conta_lectura` lee el registro del cierre del día (el agente) | sigue |

## Lanzamiento 1 · ENSAYO

| Campo | Valor |
|---|---|
| Use workflow from | `conta/c04b-diez` |
| `confirmo` | `produccion` |
| `modo` | `ensayo` |
| `autorizo` | `20261020T0110_ventas_por_plataforma_indice.sql 20261020T0130_ventas_por_plataforma_rehacer.sql` |

El `autorizo` va también en el ensayo: el análisis corre en los dos modos y
sin él se para. Son los dos nombres enteros, sin carpeta, separados por un
espacio.

En verde: los seis ficheros, la 0110 y la 0130 abiertas por tu nombre, el
aviso de la 0130 con cuántos asientos retiraría y en qué días, y **«ensayo
deshecho»**.

## Lanzamiento 2 · REAL

**Mismo commit** que el ensayo (en «Use workflow from» la misma rama, sin
que nadie haya empujado entre medias).

| Campo | Valor |
|---|---|
| Use workflow from | `conta/c04b-diez` |
| `confirmo` | `produccion` |
| `modo` | `real` |
| `autorizo` | `20261020T0110_ventas_por_plataforma_indice.sql 20261020T0130_ventas_por_plataforma_rehacer.sql` |

En verde: los seis en el historial de producción con su huella, y la
comprobación de después (D1, recuento, agentes y salud del pedido) en verde.
Si la comprobación falla, se deshace sola en orden inverso y sale en rojo.

## Qué pasa después, sin que nadie haga nada

- **En la siguiente pasada del cierre del día (a los :07 de la hora)** se
  proponen los asientos por unidad de los días retirados: 105 si se lanza el
  13/10. Si se lanza más tarde, son más, porque el cierre habrá propuesto
  más días enteros, y la 0130 los retira todos.
- **A las 02:07** se propone el día que acaba de cerrar, ya por unidad.

## Mientras el front no se publique

El Libro de producción es todavía el de antes:

- **Se abre y se lee normal**: es justo lo que arregla la 0105.
- **«Proponer» no deja proponer ventas del día entero.** Dice: «Las ventas se
  asientan ahora por plataforma (y Glovo por marca), y las propone el cierre
  del día cada hora. Recarga la página.». Las propone el cierre, no el botón.
  Lo demás que propone el botón (facturas, liquidaciones, nóminas) sigue
  igual.
- Las líneas de marca dicen «Marcas propias» en vez del nombre de la marca,
  hasta que se publique el front (siguiente paso).

## Comprobación (Claude, solo leyendo), después del real

- los asientos del día entero retirados, con su copia en
  `_retirado_ventas_por_plataforma`;
- los propuestos por unidad: cuántos, que ninguno descuadra y que el cobro de
  cada día es el de antes, al céntimo;
- que la pasada de las 02:07 propone las unidades del día sin duplicar.

## Vuelta atrás

Modo `vuelta_atras` (`supabase/produccion/vuelta-atras.txt`, seis ficheros
en orden inverso). Cada uno para si ya no se puede deshacer solo: por
ejemplo, si alguna unidad está validada o alguna 708 nueva tiene apuntes.
