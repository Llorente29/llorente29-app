# Traer de ERP10 por la conexión · fase 1: medir y parar (X11, 20/11/2026)

Qué da la API de ERP10 (apiCON de Cegid, la misma que la de Diez) de cada cosa que hoy trae
«Traer de ERP10» por fichero (N07), y cuánto tardaría una empresa grande. **No se ha escrito
nada en Sumied ni en ERP10.**

De dónde sale cada dato:
- **El Swagger público de apiCON**, leído el 19/11 desde el runner de GitHub: 108 operaciones,
  sin ningún texto explicativo.
- **Lo medido en Diez el 12/10** (C04b, `docs/conta/c04b/T1_comprobaciones.md`): es la misma
  API, con 14.937 asientos y 7.346 facturas leídos.
- **Lo medido en QBO Integrity**: lo lee Julio con «Medir lo que se puede traer» y el texto se
  pega en el PR. Desde la sesión no se puede leer: el contenedor no tiene salida a apiCON y las
  claves están en la base (§4).

## 1. Qué trae hoy por fichero, qué da la API y qué falta

Todas las listas paginan igual (medido en Diez): **200 por página como máximo**, aunque se pida
más con `$top`, y **`$skip` cuenta páginas, no elementos**. Al pasarse del final, ERP10 devuelve
la primera página otra vez sin avisar; el lector lo detecta y para. `$filter` funciona, por fecha
(`Fecha ge AAAAMMDD and Fecha le AAAAMMDD`) y por ejercicio (`Ejercicio eq 'AAAA'`).

| Lo que trae «Traer» | Del fichero usa | Ruta de la API | Qué da la API | Qué falta frente al fichero |
|---|---|---|---|---|
| **Plan de cuentas** | Grupo, subgrupo, subcuenta y descripción | `GET /api/subcuentas` | `Subcuenta`: código (12 como máximo), descripción, grupo, subgrupo, cuenta, tipo; y, si es de un tercero, NIF y dirección | Nada para el plan. Solo vienen las subcuentas, no los nombres de los grupos ni de las cuentas de 3 y 4 cifras, que tampoco usa «Traer». Sin saldo: ni el listado ni la subcuenta suelta lo traen (Diez) |
| **Proveedores y acreedores** | Código, nombre fiscal, nombre comercial, NIF y población | En una sociedad, **`/api/proveedores` no existe**: los terceros son las subcuentas 40 y 41 de `GET /api/subcuentas` | NIF, dirección (por partes o entera), código postal, población, provincia, país, teléfonos, nombre comercial y correo | **La forma de pago y los tipos de IVA de su ficha.** Están en `SubCuentaCompleta` (`TipoIva1…3`, `TipoVencimiento`, `TipoFactura`, `IBAN`, `SubCuentaGastoIngreso`). El Swagger la declara solo para el alta y la modificación: el listado y la subcuenta suelta devuelven `Subcuenta`, sin ellos. La medida mira si la suelta los trae aunque no lo declare. El fichero de hoy tampoco los trae |
| **Clientes** | Lo mismo | `/api/clientes` tampoco existe en una sociedad: son las subcuentas 43 y 44 | Lo mismo | Lo mismo |
| **Inmovilizado** | Código, subcuenta, descripción, fecha de compra, precio, amortizado, valor contable y amortización fiscal | Solo `GET /api/facturasestimaciones/inmovilizados/{empresa}`, la de Estimaciones (autónomos). En Diez, las rutas de Estimaciones contestan «endpoint de Estimaciones/Autónomos para una empresa Estándar/Sociedades» | `InmovilizadoConDetalle`: denominación, fecha y precio de compra, porcentaje anual, venta, valor residual y la amortización año a año | **Todo, para una sociedad**: no hay ruta, y la de autónomos no trae subcuenta, amortizado acumulado ni valor contable. **Sigue por fichero** |
| **Diario** (los asientos de un ejercicio) | Serie, fecha, asiento, subcuenta, nombre, concepto, debe y haber | `GET /api/apuntes` con `Ejercicio eq 'AAAA'` | `Apunte`: ejercicio, serie, documento, **`TipoAsiento` (0 a 5)**, fecha y descripción; por línea, cuenta, debe, haber, descripción, contrapartida, justificante, punteo y tercero; y la analítica | El nombre de la subcuenta en cada línea, que sale del plan. Lo que quiere decir cada `TipoAsiento` no está documentado: la medida los cuenta. En Diez, `/api/apuntes/resumen` cuenta **líneas**, no asientos |
| **Facturas emitidas y recibidas** (libros de IVA) | Las del libro AEAT: identificación, fechas, periodo, NIF, nombre, tipo de factura, hasta 3 tramos de base, tipo y cuota, total y retención | `GET /api/facturas` con `Ejercicio eq 'AAAA'` | `Factura`: **hasta 8** tramos de base, tipo y cuota, 4 de recargo, la retención (base, porcentaje, cuota y tipo), total, `TipoFactura` (1 a 13), intracomunitaria, claves del SII, rectificativas, número, nombre y NIF del tercero, fechas de factura, de operación y de introducción; y sus apuntes, sus líneas y sus vencimientos | **Si es emitida o recibida**: la API no lo dice, se deduce de la serie o de la cuenta del tercero (40/41 recibida, 43/44 emitida); la medida cuenta las dos. El tipo de NIF y el país del libro, que salen de la subcuenta del tercero. El periodo, que se calcula de la fecha |
| **Sumas y saldos** (y los saldos de apertura) | Subcuenta, debe, haber, deudor y acreedor | `GET /api/subcuentas/getSumasYsaldos/{ejercicio}/{desde}/{hasta}` | En Diez, **líneas de asiento, no saldos**, y en 2025 solo de 22 de las 102 cuentas con movimiento: no es un testigo independiente | **El saldo.** Se calcula sumando los asientos leídos, como ya hace el paso 3 de la salida (X10). La apertura es el asiento de apertura del diario; qué `TipoAsiento` es, lo dirá la medida |

Lo que la API da y el fichero no: el tipo de asiento, la contrapartida y el punteo de cada
línea, la analítica, los vencimientos de cada factura, hasta 8 tipos de IVA y la dirección
completa de cada tercero.

## 2. Cuánto tarda una empresa grande (2.000 clientes y 2.000 proveedores)

Con los tiempos medidos en Diez el 12/10:
- subcuentas: 781 en 0,4 s;
- asientos: 5,4 s por página de 200;
- facturas: 8,9 s por página de 200;
- ningún 429 ni cabecera de límite en 341 peticiones.

| Qué | Lecturas | Tiempo |
|---|---:|---|
| **Los 4.000 terceros y el plan** (unas 4.800 subcuentas) | **24** páginas | **Segundos** (menos de 30 s) |
| Los 4.000 terceros, **uno a uno** (solo si la forma de pago y el IVA hubiera que pedirlos a la subcuenta suelta) | **4.000** | **Media hora larga** (unos 27 a 33 min a 0,4–0,5 s cada una) |
| Un ejercicio de **15.000 asientos** (lo de Diez en tres años y medio) | 75 páginas | ~7 min |
| Un ejercicio de **7.000 facturas** | 35 páginas | ~5 min |

**Los terceros no son incómodos**, la duda de Julio del 17/11: vienen en el listado de
subcuentas, 200 por lectura. **Lo incómodo sería pedirlos uno a uno**, y la propuesta (§3) no lo
hace. Lo que pesa son los asientos y las facturas: minutos, no segundos. Por eso se leen por
meses, una llamada de la función por mes (la función tiene un límite de tiempo por llamada).

La medida de QBO Integrity da los mismos tiempos con lo de verdad (columna «Por página, ms» y
«Una empresa con 4.000 terceros»).

## 3. La propuesta: «Traer de ERP10 › Empresa nueva: traerlo todo», con la conexión

Sin construirlo, en la pantalla que ya hay (N07, de N), con sus tres pasos:

1. **Paso 1, «Qué traes» › Empresa nueva.** Si la sociedad tiene la conexión con ERP10 (la
   tarjeta de la salida, con su código y el NIF comprobado), arriba de la lista de los ocho
   aparece **«Traerlo de ERP10»** al lado de «Subir los ficheros». Al pulsarlo,
   cada fila de la lista se va llenando sola con lo que lee: «Leído por la conexión · 781
   cuentas», «Leído por la conexión · enero a octubre, 1.418 asientos», con el mismo «Leído»,
   «Mira esto» o «Falta» de hoy. Lo que no da la API se queda con su botón de subir:
   - **Inmovilizado**: «Sube el fichero: ERP10 no lo da por la conexión para una sociedad».
   - **Sumas y saldos**: no se pide. Se calcula de los asientos leídos y la comprobación de hoy
     (cuenta a cuenta contra el sumas y saldos) se queda para cuando se suba el fichero, que
     sigue siendo el testigo independiente.
2. **Lo que lee y cómo:** el plan y los terceros en una sola pasada del listado de subcuentas
   (segundos). Los asientos y las facturas, **mes a mes**, con la barra de cuántos meses van y
   «Seguir» si se corta. La forma de pago y los tipos de IVA de cada tercero se **aprenden de
   sus facturas**, como hoy aprende «Traer» de los ficheros (`aprender.ts`), y no se piden uno a
   uno.
3. **Pasos 2 y 3, sin cambios**: «Qué entra», «Traerlo», «Darlo por bueno» y «Deshacer» son los
   mismos, con los mismos datos. La conexión solo cambia de dónde salen, no qué se hace con
   ellos. Lo leído entra por el mismo camino que lo que sale de un Excel (`lib/traer`,
   `paraLaBase.ts`).

Lo que es de N: la pantalla y el camino a la base. Lo de X: leer de ERP10 y dejarlo con la forma
que ya lee `lib/traer` (`PlanLeido`, `TercerosLeidos`, `DiarioLeido`, `LibroLeido`).

## 4. Cómo se mide QBO Integrity

En **Libros › Cierre › Salida a ERP10**, tarjeta «Conexión con ERP10», con QBO Integrity como
sociedad abierta y su código probado, Julio pulsa **«Medir lo que se puede traer»**.

Lo que hace la medida (`supabase/functions/_shared/erp10Medir.ts`, en `conta-erp10-leer`):
- Lee: solo GET, por el mismo cliente que ya para cualquier escritura, con la lista cerrada y
  el NIF comprobado.
- Del ejercicio anterior (2025), como mucho 3 páginas de asientos y 3 de facturas, y las
  subcuentas enteras. Lo que no lee lo calcula con el total que da ERP10 y el tiempo medido, y
  lo marca «(calculado)».
- Para a los 110 s (la función tiene un límite) y lo dice.
- Deja el texto para copiar: recuentos, nombres de campo, códigos de serie y de tipo, prefijos
  de dos cifras y tiempos. **Ni nombres, ni NIF, ni direcciones, ni importes, ni conceptos**
  (T11; lo prueba `tests/conta/erp10/medir.test.ts`).

El texto se pega tal cual en el PR, debajo de esta línea.

### Medido en QBO Integrity

*(Pendiente: lo pega Julio cuando esté publicada la función.)*
