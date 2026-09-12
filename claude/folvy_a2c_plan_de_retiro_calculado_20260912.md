# A2c · El plan de retiro, CALCULADO y no ejecutado · 12/09/2026, 13:50

Encargo de Julio (14:10): «Prepara el plan de retiro esperado marca por marca,
con los frenos, calculado, no ejecutado.»

Nada de esto se ha ejecutado. Todo sale de `SELECT` contra producción y de la
pasada **en seco** contra la versión desplegada.

---

## 0 · Dos cosas que hay que corregir antes de seguir

### 0.1 · El importador NO corre a las 03:20. Corre a las 05:20 de Madrid.

El cron es `20 3 * * *` y pg_cron lo evalúa **en UTC**. Las tres últimas
arrancadas, medidas en `cron.job_run_details`:

| arrancó (Madrid) | UTC | estado |
|---|---|---|
| 12/09 05:20:00 | 03:20 | succeeded |
| 11/09 05:20:00 | 03:20 | succeeded |
| 10/09 05:20:00 | 03:20 | succeeded |

El «03:20» es el número del cron leído como si fuera hora de Madrid. Es la
regla 4 otra vez, y la 36: un solo reloj. **No cambia el plan — da margen de
más, no de menos**: fusionando a las 23:45 quedan 5 h 35, no 3 h 30.

### 0.2 · El vigía de deriva no podía cazar esto, y no está roto

`edge_function_deploy_state` para `lastapp-catalog-import` dice hoy:

    estado: ok · contenido: igual · version 57 · desplegada 11/09 12:01
    comprobado 12/09 07:10

Y es **verdad**: lo desplegado coincide con `main` byte a byte. El vigía
responde «¿producción coincide con main?». La pregunta que nadie responde es
**«¿está en producción lo que dimos por aplicado?»**, y esa es la que falló:
A2c está en una rama sin fusionar, así que ni el vigía ni nadie la echaba de
menos. Queda apuntado como hueco, no como avería.

---

## 1 · Los datos de entrada, reconstruidos y cuadrados

La pasada **en seco contra lo desplegado** (línea base) trajo de Last:

    8 preguntas · 49 opciones · 30 asignaciones
    0 marcas propias rechazadas · 0 avisos
    preguntas 8: 0 nuevas, 0 actualizadas, 8 sin cambios
    opciones 49: 0 nuevas, 0 actualizadas, 49 sin cambios

En Folvy, las marcas cedidas tienen **55 opciones activas**. La diferencia son
6. Y se pueden nombrar una a una, sin suponer: el importador sella
`pos_modifier_id` (A1) en cada opción que toca, y la pasada real del 11/09 a
las 12:11 dejó esa marca de agua.

| marca | opciones activas | tocadas el 11/09 12:11 | sin tocar |
|---|---:|---:|---:|
| Milanesa Haus | 16 | 16 | 0 |
| Big Mike´s Burger Joint | 14 | 14 | 0 |
| Ay Mamita Bowls | 11 | 11 | 0 |
| Dos Coyotes | 9 | 8 | **1** |
| Lobbers | 5 | 0 | **5** |
| **total** | **55** | **49** | **6** |

**49 cuadra exactamente con las 49 que la pasada en seco dijo haber traído**, y
8 preguntas cuadra con 1 (Ay Mamita) + 3 (Big Mike) + 2 (Dos Coyotes) + 2
(Milanesa Haus). No es una estimación: es la misma cifra por dos caminos.

Las 6 que Last ya no sirve:

| marca | pregunta | opción | último toque |
|---|---|---|---|
| Dos Coyotes | Dos Coyotes, extra de proteína.** | Sin Extras | 20/06 22:13 |
| Lobbers | ¿Quieres acompañar con unas patatas? | Si, con patatas | 12/06 11:21 |
| Lobbers | ¿Quieres dos discos de carne o solo uno? | Quiero dos discos de carne | 12/06 11:21 |
| Lobbers | ¿Quieres dos discos de carne o solo uno? | Solo un disco de carne | 20/07 09:43 |
| Lobbers | ¿Quieres pepinillos? | Con Pepinillos | 20/07 09:43 |
| Lobbers | ¿Quieres pepinillos? | Sin pepinillos | 12/06 11:21 |

---

## 2 · El plan, marca por marca, con los frenos aplicados

Los frenos son los que trae la firma: `p_max_por_marca = 3` y
`p_max_pct = 20`. El importador la llama sin pasarlos, así que rigen esos.
Y antes de los frenos está **el raíl**: sólo entran las marcas cuyas preguntas
ha recorrido ESTA pasada (`marcasVisitadasParaExtras`), menos las que tengan
algún catálogo ilegible.

| marca | ¿en el raíl? | sobran | activas | % | freno | retira |
|---|---|---:|---:|---:|---|---:|
| Milanesa Haus | sí | 0 | 16 | 0 % | — | **0** |
| Big Mike´s Burger Joint | sí | 0 | 14 | 0 % | — | **0** |
| Ay Mamita Bowls | sí | 0 | 11 | 0 % | — | **0** |
| Dos Coyotes | sí | 1 | 9 | 11,1 % | pasa (1 ≤ 3 y 11,1 % ≤ 20 %) | **1** |
| Lobbers | **NO** | 5 | 5 | — | fuera del raíl | **0** |

### Lo que retiraría esta noche: UNA opción

**Dos Coyotes · «Dos Coyotes, extra de proteína.**» · «Sin Extras».**

Comprobada antes de darla por buena:

    vendida en 30 días ......... 0
    vendida alguna vez ........ 21
    tiene decidido qué lleva ... no

O sea: Last dejó de servirla, no se vende desde hace más de un mes y no
descuenta nada de nadie. Retirarla no le quita nada a nadie.

**Un detalle que sí hay que decir:** no tiene `pos_modifier_id`, así que se
apagaría **sin código**. El propio informe lo avisa
(`retiradas_sin_codigo: 1`): si en el futuro llega una línea de pedido con ese
nombre, no se enlazará. Con 0 ventas en 30 días es un riesgo pequeño, pero es
un riesgo y va dicho.

### Lo que NO retiraría, y por qué importa

**Los 5 de Lobbers se quedan encendidos.** Lobbers no aparece en el raíl porque
esta pasada **no recorrió ninguna de sus 3 preguntas** — sus 5 opciones están
sin tocar desde junio y julio. Es exactamente el caso para el que se escribió
el raíl, y aparece cumpliendo su función el primer día.

Si Lobbers hubiera entrado en el raíl, habría saltado el freno igualmente:
5 sobran de 5 activas es 100 %, y son 5 > 3. **Los dos frenos, los dos por
separado.** Nada se habría retirado tampoco, pero con aviso.

### Lo que se reencendería: nada

Ninguna marca cedida tiene hoy opciones retiradas (`ya_retiradas = 0` en las
cinco), así que `opciones_reencendidas` sale 0. La vuelta de A2c no tiene nada
que devolver en su primera pasada.

---

## 3 · Cómo se verifica esto a las 23:45, y qué tiene que dar

1. **Fusión a `main`** — con el visto de Julio al tablero 1, porque la fusión
   publica también el front y el tablero 1 va en la misma tanda.
2. **`edge_function_deploy_state`** para `lastapp-catalog-import`:
   `estado = ok` y `contenido = igual`, con `deploy_version` > 57.
3. **Pasada en seco ya desplegada.** Tiene que dar:
   - `cinturon_marca_propia`: **0 preguntas, 0 opciones protegidas**;
   - `tablas.modifier_group`: 8 total, 0 nuevas, 0 actualizadas, **0 protegidas**;
   - `tablas.modifier_option`: 49 total, 0 nuevas, 0 actualizadas, **0 protegidas**;
   - `sobrantes.extras_que_last_no_sirve`: **1 opción en Dos Coyotes**,
     Lobbers fuera del raíl, 0 frenos saltados, `retiradas_sin_codigo: 1`.
4. Si el punto 3 no da eso, **no se enciende el retiro**: la pasada de las
   05:20 va con `aplicar_retiro: false` y se mira al día siguiente.

Si el punto 3 cuadra, la decisión de encenderlo o no es de Julio, con esta
tabla delante.
