# C04b · Respuesta 6 — informe (13/10)

**Sin importes**: el repositorio es público. Los importes están en el chat.

## 1 · La rama

Los dos commits de la R5 (b4d5960d y 8732c791) están en `conta/c04b-diez`,
por avance rápido y sin fusionar nada más. Detrás de ellos, en la misma rama:

- `481167ff`: arreglo del agente (§3);
- `cdb5b4e2`: la prueba de Milanesa House y Milanesa Haus (§4);
- `eeee6d2e`: la 0105 (§2).

**`claude/epic-bohr-k6c7i4` sigue en el remoto**: desde la sesión, el proxy
de git corta la conexión al borrarla (los envíos a `conta/c04b-diez` sí
entran). Hay que borrarla a mano en GitHub (Branches › la papelera).

## 2 · Staging

| Run | Qué | Resultado |
|---|---|---|
| Aplicar 144 | ensayo 0100–0130 con la prueba; 0100–0140 aplicadas; la prueba otra vez | verde (5 de 5 partes, ensayo y real) |
| e2e 180 | toda la batería | **rojo, 9 pruebas**: el Libro diario no pinta |
| Aplicar (eeee6d2) | ensayo de la 0105 con la prueba; la 0105; la prueba | verde (6 de 6) |
| e2e 38360553092 (eeee6d2, lanzado a mano: el arreglo no toca `src`) | toda la batería | **verde** |

**El rojo del e2e 180 era mío.** Al abrir, el Libro diario llama a
`conta_dias_por_asentar` como el usuario (authenticated). Desde la 0100 esa
función pregunta `conta_unidad_ventas`, y a esa le había quitado el permiso a
authenticated: «permission denied» y la página sin filtros. El cierre del día
no lo notaba (corre como postgres) y el ensayo local tampoco (lo corrí como
superusuario, sin roles). **La 0105** la deja como función de quien llama
(con la RLS de `conta_ventas_canal`) y con permiso para authenticated. La
prueba de staging tiene una parte 6 que llama COMO USUARIO: sin la 0105 falla
con «permission denied for function conta_unidad_ventas», con ella pasa. En
producción la 0105 va detrás de la 0100, en la misma tanda.

## 3 · El agente de la empresa B: el porqué, medido

Al empujar, el cumplimiento de staging salió en rojo dos veces:

1. **Run 53: un fallo mío.** En `agente-libro.sql` metí la línea del permiso
   (`\gset`) entre el `with libro as (…)` y su `select`: «relation "libro"
   does not exist». Probé el trozo de `dia_sin_asiento`, no el fichero
   entero. Arreglado en `481167ff`. Probado con el psql real sobre el fichero
   real y con el fichero entero resuelto en producción (solo lectura): 14.933
   asientos, 0 hallazgos en las doce comprobaciones.
2. **Run 54: el rojo de verdad, ahora con su porqué.** «2026-10-04 local
   c01b0000: 1 pedido de tus marcas, sin resumen ni asiento, 199 h después de
   su cierre: el cierre del día no lo ha propuesto: la última vez, sin
   propuesta — «Falta el IVA de tus ventas (Tu empresa) o su 477, o la 700 en
   el plan.»». **La empresa B de staging no tiene el IVA de sus ventas.** El
   rojo es correcto: un día que no se puede asentar nunca.

No espera a esta noche: el porqué ya está. Para quitarlo hay dos caminos, y
es de Julio:

- darle a la empresa B su IVA de ventas en staging (una semilla). Entonces
  el cierre propone ese día y el rojo se va;
- o dejarla así a propósito (la prueba del cierre del día de la R2 la usa
  como «empresa sin IVA») y que el agente lo cuente como aviso de
  configuración, no como día sin asiento.

## 4 · Milanesa House y Milanesa Haus

Prueba nueva (`ventasPorPlataforma.test.ts`): con los dos nombres reales, uno
propio y otro cedido, la cedida no abre unidad en Glovo; en Uber solo la
propia va a 70000001 y la cedida queda fuera y dicha; el asiento de Glovo de
Milanesa House no lleva el pedido de Milanesa Haus.

## 5 · La fecha de la venta: PARADO, Glovo cuadra peor

Julio: «el día de una venta es el de entrega, cuando se cierra el pedido… si
Glovo o Just Eat cuadran peor con esa fecha, para y me lo dices». Medido,
septiembre (1 al 27), las tres plataformas, Alcalá y Carabanchel, día×marca
contra Diez, con la misma vara (al céntimo o a tres céntimos) y cuatro
fechas:

| Plataforma · local | Días×marca | Día del pedido (hoy) | Día natural del cierre | Cierre con la frontera de las 2:00 | Día de la entrega real (`delivered_at`, si no el cierre) |
|---|---:|---:|---:|---:|---:|
| Uber · Alcalá | 84–85 | 63 | **77** | 58 | 76 |
| Uber · Carabanchel | 34–35 | **30** | 28 | 26 | 27 |
| Glovo · Alcalá | 126–129 | **67** | 59 | 50 | 60 |
| Glovo · Carabanchel | 58–59 | **25** | 24 | 22 | 23 |
| Just Eat · Alcalá | 11 | 11 | 11 | 11 | 11 |

(El número de días×marca cambia un poco de una columna a otra: un día que
solo tiene ventas con una de las fechas cuenta en esa.)

**Lo que dice:**

- **Solo Uber en Alcalá mejora** con la fecha de cierre (de 63 a 77).
  **Glovo empeora en los dos locales** (Alcalá de 67 a 59; Carabanchel de 25
  a 24), y **Uber en Carabanchel también** (de 30 a 28). Just Eat no cambia.
- **Con la frontera de las 2:00 sobre la hora de cierre, todo empeora**: un
  pedido entregado a las 0:30 vuelve al día de antes, y Diez lo tiene en el
  de después.
- **Con la hora de entrega real que trae Glovo** (255 de sus 337 pedidos la
  llevan), Glovo sigue peor que con el día del pedido (60 frente a 67). Así
  que **Diez fecha Glovo por el día del pedido**, no por el de entrega.
- La hora de cierre no siempre es la de entrega: en Glovo · Alcalá, 28
  pedidos se cerraron más de 2 h después de pedirse. Uber trae la hora de
  entrega en 84 de 253 pedidos de Alcalá.

**No se ha tocado nada**: ni el núcleo, ni la SQL, ni la paridad. Los 105
siguen con el día del pedido. Lo que pide a Julio está en el chat.
