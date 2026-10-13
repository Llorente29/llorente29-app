# C04b · Respuesta 9 — informe (13/10)

**Sin importes**: el repositorio es público. Los importes están en el chat.

## 0 · Lo que pasó el 13/10 (R8), en una línea cada cosa

- **El rojo**: la comparación de agentes. El libro estaba verde antes y rojo
  después: 22 días×local sin asiento. La 0130 retiró los 24 y la comprobación
  corrió antes del cierre de las :07.
- **La vuelta atrás**: deshacer.sh ejecutaba los `.down.sql` y decía «como
  antes» sin contar nada. La bajada de la 0130 no devolvía los asientos, y el
  paso «D1 y recuento» no corría en un real deshecho solo.
- **El cierre de las 08:07** los rehízo él solo: 24 de 24 iguales que la copia
  (total, tickets, pedidos, líneas, concepto, fecha), sin descuadres ni
  duplicados.

## 1 · La 0130 sin hueco

En la misma transacción: retira, propone por unidad (`conta_proponer_dias`,
la del cierre del día) y comprueba cada local×día retirado:

- tiene sus asientos por unidad;
- ningún pedido suyo queda por asentar;
- el cobro (430, debe menos haber) es el del asiento retirado, al céntimo.

Si uno no, RAISE con el día, las unidades y los dos cobros, y no se aplica
nada: ni la retirada, ni la copia.

**Lo que no se puede rehacer no se retira.** Un resumen del día entero sin sus
pedidos (la lista vacía) no tiene de dónde sacar las unidades; retirarlo sería
borrar sin reponer. Se queda como está y el aviso lo dice. Salió en staging:
la semilla del C04 tiene un 05/10 así, y la 0130 paró, como debía. En
producción, 0 de los 24 propuestos están así (medido el 13/10: los 24 con todos
sus pedidos).

Probado en local, sobre la tanda entera:

- en verde, el recuento queda igual tras deshacer;
- con un pedido cambiado de importe, para con «cobro … antes y … ahora» y no
  queda nada (ni la tabla de la copia);
- con una copia vieja delante (la de las 07:52, otros ids), la bajada devuelve
  la más reciente.

## 2 · La bajada devuelve desde la copia

Retira los propuestos por unidad (si alguno está validado o en borrador,
PARA). Después devuelve, de cada local×día, la copia más reciente: el asiento
con su id, sus líneas y su resumen. Se salta los días con un asiento vivo.

Comprueba que vuelven enteros (el resumen con su asiento, las mismas líneas,
el mismo cobro), y si no, RAISE. No depende del cierre.

## 3 · Una vuelta atrás que cuenta, para todas las tandas

- **El manifiesto declara qué cuenta**:
  `cuenta: scripts/conta/produccion/cuentas/<f>.sql`. Lo lee
  `manifiesto.sh`, y en la tanda de aplicar es obligatorio: sin él, para.
  Aquí, `ventas-del-dia.sql` mide, de toda la tabla y dicho así (regla 9):
  - los asientos de ventas por estado y sus líneas;
  - el cobro 430 de los vivos;
  - los resúmenes del día (enteros, por unidad, sin asiento);
  - una huella de los resúmenes.
- **Antes de la tanda**, el workflow lo toma (`cuentas.sh`) y lo pone en el
  informe.
- **deshacer.sh lo vuelve a tomar** después de deshacer y lo compara
  (`cuentas-comparar.mjs`). Sale con:
  - 0: deshecho y contado igual;
  - 1: algún `.down.sql` falta o falla;
  - 3: deshecho, pero no sale igual; dice cuánto falta.
- **«Producción está como antes» solo sale con el 0** («Vuelta atrás hecha y
  contada»).
- **«D1 y recuento» corre también cuando un real se deshace solo**. El
  recuento de serie se toma ya en el «antes» y se compara.
- **El ensayo de la vuelta atrás cuenta dentro de su transacción**: la tanda,
  sus `.down.sql` y las cuentas. Si no sale igual que antes, **el ensayo para**
  y el real no se puede lanzar. Con la bajada del 13/10 habría parado.

## 4 · Staging, forzando el fallo

`aplicar-staging-conta.yml` tiene dos modos nuevos, `real-con-fallo` y `real`.
Corren la tanda de producción (`supabase/staging/tanda-de-produccion.txt`: la
de producción más la 0125, que da a la empresa A la regla que la 0120 da a
Foodint) con las mismas piezas: `manifiesto.sh`, `cuentas.sh`, el registro en
el historial, `deshacer.sh` y `cuentas-comparar.mjs`.

Antes de empezar, el script deja staging como estaba producción: deshace la
tanda que ya tenía y propone dos días enteros de A con las funciones de antes.

| Run | Modo | Resultado |
|---|---|---|
| 38370539442, 38371141503 | real-con-fallo | **rojo, bien parado**: la 0130 paró en el 05/10 de la semilla (0 unidades, 0 pedidos por asentar), no aplicó nada, y la vuelta atrás de lo anterior salió contada igual |
| 38371645516 | real-con-fallo | rojo igual, ya con el diagnóstico: 212 tickets en el resumen, la lista vacía, 0 pedidos existen |
| **38372326025** | **real-con-fallo** | **verde**: 7 aplicados; 2 días retirados y rehechos con el mismo cobro; el 05/10, no retirado y dicho; fallo forzado → 7 deshechos → **10 de 10 medidas iguales**, D1 5.480 pares sin diferencias, serie igual, 0 registros en el historial |
| **38372534499** | **real** | **verde**: la tanda entera con su registro; 2 días por unidad con el mismo cobro; D1 sin diferencias |

Para que no sea un espejo, en local: con la bajada de la 0130 del 13/10,
`real-con-fallo` sale en **rojo** con «faltan 2» asientos y el cobro que falta.

## 5 · Lo que el real miró y el ensayo no

El ensayo aplica la tanda en una transacción y la deshace. Mide D1 y el
recuento dentro de esa transacción. No corre:

- **los agentes de después**: van con `conta_lectura` por otra conexión y no
  ven una transacción sin commit;
- **la salud del pedido**: en el ensayo no pasan los 15 minutos;
- **lo que hagan otros procesos después** (el cierre de los :07, los
  disparadores de los pedidos que entren).

El 13/10 el real se deshizo por el agente del libro, que vio el hueco que el
ensayo no podía ver. Desde este commit el informe del ensayo lo escribe en
cada lanzamiento.

## 6 · La lista de antes de subir

Paso 7 de `antes-de-subir.sh`, dos lecciones nuevas:

- **«Un ensayo en verde no garantiza el real si la comprobación de después mira
  algo que el ensayo no ve.»** Se mira que la tanda declare qué cuenta, y se
  imprime lo que el ensayo no ve.
- **«Una retirada nunca deja un hueco que tape otro proceso más tarde: se
  rehace en la misma transacción.»** Un fichero de la tanda que borra
  asientos o resúmenes del día los rehace en el mismo fichero
  (`conta_proponer_dias`) o dice por qué no (`-- sin hueco: …`). Con la 0130
  del 13/10, el paso para.

## 7 · Lo que queda dicho

- Staging se queda con la tanda puesta y con la regla de la empresa A. La
  prueba de la R5 (`20261020_ventas_por_plataforma_prueba.sql`) ya no se
  puede volver a lanzar tal cual: su guarda pide que A no tenga regla.
- Si el real de producción falla a medias (un fichero da error), lo aplicado
  antes se queda y la comprobación de después decide. Es como era, no lo
  toca este paquete.
