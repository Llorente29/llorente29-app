# C04b · Respuesta 11 — el ensayo #57 lo paró el analizador (13/10)

**Sin importes**: el repositorio es público.

## 1 · El porqué

**La regla que salta** es `pareceAplicado` (`scripts/conta/produccion/analizar.mjs`,
línea 612): un fichero BLOQUEA si todo lo que crea (tablas, vistas y
funciones) ya existe en producción y no está en el historial. Lo que crea la
0130 es una sola tabla, `_retirado_ventas_por_plataforma`, y existe: la creó
el real de las 07:52 y su vuelta atrás la dejó, a propósito, con los 24 de
aquel real. El `create or replace function` de la 0130 no cuenta como
creación para esa regla.

**No es la llamada a `conta_proponer_dias`.** El «autorizo no lo necesita»
sale del mismo bloqueo: un BLOQUEA no se abre con `autorizo`.

La prueba es la consulta de contexto del workflow, lanzada en producción en
solo lectura: `tablas` trae `public._retirado_ventas_por_plataforma` y
`public._backup_ventas_por_plataforma`, y `registro` va vacío. Con ese
contexto, el analizador da para la 0130 de fe7f0883:

> **bloquea** · todo lo que crea ya existe en producción, y no está en el
> historial — parece aplicado antes de que hubiera historial

Queda como prueba en `tests/conta/produccion/analizar.test.ts` («R11»), con
la 0130 de fe7f0883 y ese contexto.

## 2 · Por qué no lo vi

En la R9 y la R10 cambié la 0130 y **no volví a medir el contexto de
producción**. Lo que pasé fue la prueba de la tanda viva de
`analizar.test.ts`, con el contexto medido el 13/10 a las 06:26, antes del
real de las 07:52. En ese contexto no estaban ni `_retirado` ni `_backup`, y
con él la 0130 salía «autorizo», en verde. Era una señal parecida: el
analizador correcto, con un contexto que ya no era el de producción.

## 3 · El arreglo, sin tocar el analizador

La regla es correcta. Visto desde la base, la 0130 de entonces «estaba» en
producción a medias: su tabla sí, su historial no.

**Se cambia el fichero.** La copia va en una tabla nueva,
`_copia_ventas_dia_entero`, que la 0130 crea de verdad. La bajada restaura
desde ella. La de las 07:52 no se toca: es el rastro de aquel real, con sus
24 filas.

Con el contexto real (medido a las 09:43 UTC):

| Fichero | Antes (fe7f0883) | Ahora |
|---|---|---|
| 0100 | sigue | sigue |
| 0105 | sigue | sigue |
| 0110 | AUTORIZO | AUTORIZO |
| 0120 | sigue | sigue |
| 0130 | **BLOQUEA** | **AUTORIZO** (los dos `delete`) |
| 0140 | sigue | sigue |

El analizador no se ha tocado.

**Una nota, sin tocar nada.** El informe pone `_backup_ventas_por_plataforma`
en «Crea (nuevo)» de la 0100, y ya existe (también la dejó el real de las
07:52). No cambia el veredicto: la 0100 crea más cosas nuevas, y su `insert`
lleva `on conflict do nothing`. Es la etiqueta, no el freno. Si se cambia, es
cosa de Julio.

## 4 · El paso 8 de antes de subir

`node scripts/conta/produccion/analisis-tanda-viva.mjs`:

- El contexto real va en
  `tests/conta/produccion/contexto-produccion-tanda-viva.json`, con la hora
  de la medida y el md5 de cada fichero de la tanda.
- **Para** si la tanda no es la medida (otro fichero, otro orden u otro md5):
  hay que volver a medir.
- **Para** si algún fichero sale BLOQUEA.
- Si no, saca el estado de cada fichero y los `autorizo`. Con `--informe`,
  el informe entero, que va debajo de los datos de Julio.

Lo que no mide: que producción no haya cambiado desde la hora de la medida.
Por eso la hora va siempre con la salida.
