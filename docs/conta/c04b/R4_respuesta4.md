# C04b · Respuesta 4 — informe (12/10)

Lo que se ha hecho y medido tras la respuesta 4 de Julio. **Sin importes**: el
repositorio es público. Los importes de la comprobación están en el chat.

## 0 · Paso 5: el histórico traído, comprobado en solo lectura

| Ejercicio | Estado | Histórico marcado | Asientos de Diez (serie 1 · 2 · 3 · 4 · 9) | Líneas | «En Diez iba en negativo» |
|---|---|---|---|---:|---:|
| 2023 | cerrado | sí | 565 · 158 · 153 · 45 · 4 | 2.790 | 0 |
| 2024 | cerrado | sí | 196 · 778 · 1.544 · 8 · 37 | 6.471 | 72 |
| 2025 | cerrado | sí | 279 · 1.281 · 725 · 1.926 · 11 | 10.704 | 155 |
| 2026 | abierto (mixto) | sí | 1.234 · 2.852 · — · 3.134 · 3 | 19.482 | 333 |

- **14.933 asientos y 39.447 líneas**, iguales a la tanda (`import_run`:
  traídos 14.933, ya estaban 0, distintos 0, rechazados 0).
- **La cadena de huellas, entera**: 14.933 eslabones, 0 que no encadenan, 0 con
  el contenido cambiado.
- **El testigo, otra vez y con la misma vara**: las cuatro huellas de la base
  son las de `scripts/conta/diez/testigo-huellas.json` (45, 82, 102 y 149
  subcuentas).
- **Las migraciones 0100–0160**, las siete en el historial de producción.
- **Los 22 propuestos de octubre**, del 01/10 al 11/10, serie 1: ninguno con
  número ni cadena. Esperan (punto 2).
- **Ninguna línea traída tiene local ni marca** (0 de 39.447): es el punto 1.

## 1 · La analítica del histórico — medir antes de diseñar (PARA)

### Qué entra en la huella

`journal_entry_canonico` mete en el texto de cada línea `location_id`,
`is_common` y `brand_id`. Rellenarlos ahora en las 39.447 líneas cambiaría el
canónico de los 14.933 asientos, y con él su huella y la de todos los que
vienen detrás: **la cadena entera se rompería**. No se toca.

### Lo que hay medido, y lo que falta

- T1 contó **0 de 14.937** asientos con analítica, pero **en el listado** de
  apuntes. En la C0009 (T2 §6) se vio que la analítica guardada **solo sale
  por `analitica/asiento/{ej}/{serie}/{doc}`**, asiento a asiento.
- El catálogo de Diez tiene 5 grupos, 12 subgrupos y 3 de nivel 3 (T1).
- Para saber qué hay, va la lectura `[lectura:analitica]`
  (`scripts/conta/diez/analitica.ts`). Pide la analítica de cada asiento de
  cuatro meses de muestra y cuenta cuántos la tienen, en qué subcuentas y con
  qué códigos. Mide también si el reparto cubre el importe de cada subcuenta,
  si una subcuenta se reparte entre varios locales y lo que costaría traerla
  entera. Solo GET, solo recuentos.

### La propuesta para guardarla (a falta de la medida)

Un **reparto analítico aparte**, fuera de la huella:

- tabla nueva `journal_line_analytic`: una fila por línea traída y por trozo
  del reparto, con local, marca, plataforma, los códigos de Diez tal cual
  (grupo, subgrupo, nivel 3) y el importe del trozo en céntimos;
- origen «Diez» e `import_run` de la lectura;
- RLS por cuenta, como el resto del libro;
- **no entra en `journal_entry_canonico`**: la cadena no se mueve;
- la traducción de códigos, con `diezAnalitica.ts` (CAM y BAR → Carabanchel,
  FLO → Alcalá, CAN → Plaza Castilla, 9 y 11 → Lovers Burger). Lo que no
  tenga traducción se guarda con el código de Diez y se dice: no se adivina.

**Al leer** (Libros, mayor, sumas y saldos):

- el local de una línea es el suyo (lo de Folvy) o, si no tiene, el de su
  reparto;
- una línea repartida entre dos locales cuenta en cada local por su trozo;
- una línea sin local ni reparto sale en **«Sin local»**, no desaparece
  (regla 7).

**La pantalla**: el mismo filtro de local que tiene Ventas, arriba de Libros,
mayor y sumas y saldos. Con un local elegido, las cifras son las de ese local
y lo dice el título («Sumas y saldos · Alcalá»).

**El testigo**: los listados de Diez **por centro** (sumas y saldos filtrados
por grupo de analítica) de los ejercicios que la tengan. Se piden a Julio
cuando la lectura diga cuáles son.

## 2 · El asiento de ventas como lo lleva Diez — la regla, para confirmar

Sacada del histórico traído de **julio a septiembre de 2026**, serie 1. Antes,
Diez lo llevaba de otras dos formas, y no se copian:

- enero a marzo: un asiento al día de Uber, todo a 70000000;
- abril a junio: uno al mes por marca y tienda de Uber, todo a 70000000.

| | Uber Eats | Just Eat | Glovo |
|---|---|---|---|
| Unidad | uno por **local y día** | uno por **local y día** | uno por **marca, local y día** |
| Concepto | «UBER EATS FLO 27/09» | «JUST EAT FLO 27/09» | «GLOVO Meraki Pita FLO 27/09» |
| Cliente (debe) | 43000002 | 43000003 | 43000001 |
| Ventas (haber) | **7000000x por marca** | **7000000x por marca** | **70000000** (la marca va en el concepto) |
| Devoluciones (debe) | **7080000x por marca** | **7080000x por marca** | **70800000** |
| IVA (haber) | 47700000 | 47700000 | 47700000 |

Las subcuentas de marca: 70000001 Milanesa House · 02 Meraki Pita · 03 Scandal
Burger · 04 Smash Brothers · 05 Mila's Sandwiches · 06 Bendito Burrito · 07 The
Urban Kebab · 08 Dirty Burger · 11 Lovers Burger. Las devoluciones, igual con
708 (708000xx).

**Medido contra Folvy, con la misma vara** (septiembre, Alcalá; las cifras, en
el chat):

- **Uber Eats**: lo de cada 7000000x es la venta de esa marca en Folvy, sin
  IVA, **al céntimo o a un céntimo** en seis de nueve marcas. En las otras tres
  (Meraki Pita, Mila's Sandwiches, Lovers Burger) hay una diferencia que **aún
  no está explicada**: no es su devolución ni el IVA. Se mira antes de
  aplicar.
- **Glovo**: un asiento por cada día con ventas de la marca: **los mismos
  días** en Diez y en Folvy, marca a marca (salvo Scandal Burger: 13 asientos
  en 12 días). Tres marcas al céntimo o a un céntimo; en las otras, diferencias
  sin explicar todavía, como en Uber.
- **Las marcas cedidas** (Milanesa Haus y las otras de socios) **no están en
  Diez**: van por la liquidación con el socio.
- **El día del asiento es el día de la venta** (en los tres, el día del
  concepto es el de la fecha del asiento).

**Lo que necesita a Julio antes de aplicar nada:**

1. **¿Se confirma la tabla?** En particular, Glovo a 70000000 y no a la
   subcuenta de la marca, como Uber y Just Eat.
2. **Lovers Burgers en Glovo.** En Folvy vende en Alcalá; en Diez aparece
   como «GLOVO French Tacos Club **BAR**» (14 asientos de julio a septiembre).
   Al enviar, ¿«Lovers Burgers» y el local de Folvy, o como estaba?
3. **Las devoluciones (708).** ¿Qué cifra de Folvy es: lo que la plataforma
   reembolsa al cliente por pedido? Folvy hoy no la separa.
4. **IVA en 47700000**, no en 47700010 como propone Folvy hoy. ¿Se queda la
   de Diez?

Con eso confirmado, los 22 de octubre se rehacen con la regla, retirando los
de ahora y proponiendo los nuevos con la misma clave de día y local (como en el
cierre del día), sin duplicar.

## 3 · El cierre del día a las 2:00 — hecho

- **0170**: la hora de serie pasa a 2:00. Cambian tres funciones, cada una
  copiada de lo vigente y declarada con su prueba de staging:
  - `conta_ultimo_dia_cerrado` y `conta_cerrar_dias` usan 2:00 cuando la
    empresa no tiene hora guardada;
  - `conta_propuestos_antes_del_cierre` hace **la misma pregunta que el
    cierre**. La noche del 25/10 las 2:00 pasan dos veces, y Postgres lee
    «25/10 a las 2:00» como la segunda (01:00 UTC; comprobado). El cierre ya
    habría cerrado el día con la primera, una hora antes.
- **0175** (`autorizo`): Foodint, de las 6:00 a las 2:00. Va anclada por id y
  cuenta, y no pisa una hora que no sea la de serie de antes.
- **Prueba de staging**, con 13 instantes de octubre y de marzo, iguales a
  los de la unitaria:
  - un pedido de las 23:00 sigue abierto a la 1:59 y se cierra a las 2:07
    con «(2:00)»;
  - «propuesto antes del cierre» coincide con el cierre en la hora repetida;
  - la hora de cada empresa manda.
- **La vuelta atrás** devuelve las tres funciones **byte a byte** como están
  hoy (md5 medido).
- **La pregunta nueva de «propuesto antes del cierre» da lo mismo que la vieja**
  sobre las 22 propuestas de producción con la hora de hoy: 0 y 0, 0 distintas.
- El agente «día cerrado sin resumen o sin asiento» no cambia: lee la hora de
  la empresa.

## 4 · El 303 del 3T

Se presenta desde Diez. Va en su propio encargo, después del C04b.
