# C12 · El traspaso completo: qué va por Excel, qué va por la API y por qué

> **Decidido por Julio (24/10, respuesta 3):** de acuerdo con la propuesta.
> Emitidas y recibidas por Excel con su PDF y el número de Sumied, con «Ya lo he
> importado» y la lectura de vuelta; banco, manuales y liquidaciones por la API.
> El PDF, con **el enlace permanente con llave por documento** descrito abajo. La
> prueba de la URL corta **no se hace**. Falta construirlo (siguiente encargo).

## Lo que ya sabemos

| | Medido | Dónde |
|---|---|---|
| Emitidas por Excel con «Url documento» | **Entran con su PDF** las tres: normal, dos tipos de IVA y rectificativa | C0009, Julio, 24/10 |
| Recibidas por Excel con «Url documento» | **Probadas** (tercera prueba): las tres con su PDF, N.I.F., IVA y la retención «Profesionales» a la 47510015, con el asiento cuadrado a 242. La 47510015 no existía en la C0009 y Julio la creó: de ahí la comprobación de subcuentas de abajo | C0009, Julio, 24/10 |
| Asientos por Excel | La configuración de Julio **no trae campo de documento** | Julio, 24/10 |
| PDF por la API (`facturas/upload`, `apuntes/upload`) | 500 «The specified container does not exist»: el almacén de documentos de la base no existe en el servidor de Diez | runs 8, 10 y 40091895961 |
| Asientos por la API (`apuntes/add`) | Funcionan: banco, manual y su contraasiento en la C0009; se busca antes de escribir, no se duplica | C07 |
| Lo que Diez tiene, por la API (`api/apuntes` del mes) | Trae todas las líneas, también las de las facturas importadas | run 40098732223 |

## La propuesta

**1. Emitidas y recibidas, por Excel, con su PDF por URL.**
- Al confirmar el traspaso, Sumied prepara **dos Excel del mes** (emitidas y
  recibidas) con la configuración de Julio y la columna «Url documento».
- El número de cada factura es el de Sumied: el de la factura resumen del
  cierre del día (serie del canal, desde el #321) o el de la factura a mano. Así,
  el PDF, Sumied y Diez dicen lo mismo. Hoy la API calcula otro (`UBR-…`): con el
  Excel desaparece esa diferencia.
- Julio los importa en Diez (Importaciones › Importación desde fichero ›
  Facturas, dos veces) y pulsa en Sumied «Ya lo he importado».
- Sumied lee las facturas del mes en Diez (`api/facturas`), las enlaza una a una
  con las suyas por número y fecha, y dice cuáles faltan, si falta alguna.
- Las anulaciones de facturas que ya estaban en Diez van como rectificativa en
  el mismo Excel, como la R4 de la prueba.
- Los dos Excel van **sin fila de títulos**: la fila 1 es la primera factura
  (Diez lee la de títulos como una factura más; C0009, 24/10).
- Cada retención lleva su tipo (W) y **su subcuenta (X)**, la que Sumied tiene
  enlazada a ese tipo de retención (`company_account_link`, la misma que en
  Diez). Si un tipo no la tiene, o si alguna línea del asiento va sin cuenta,
  el Excel no se prepara y la pantalla dice cuál.

*Por qué Excel:* es la única forma de que el PDF llegue a Diez (la API no puede
guardar documentos en esa base). *El coste:* un paso a mano de Julio cada mes,
dos importaciones, y que Diez no confirma lo importado: lo confirma Sumied al
leerlo de vuelta.

**Antes de generar los Excel: las subcuentas existen en Diez** *(Julio, 24/10,
respuesta 6)*. Diez no avisa cuando una subcuenta no existe: deja la línea sin
cuenta y el asiento queda cojo. Pasó en la C0009 con la 47510015.
- Antes de preparar nada, Sumied junta **todas las subcuentas que van a usar
  los dos Excel**: gasto, ingreso, IVA (soportado y repercutido), retención,
  clientes y proveedores.
- Pregunta por la API, una a una, si existen en Diez
  (`GET /api/subcuentas/subcuenta/{código}`, ya en `diezCliente.ts`).
- **Si falta alguna, no se genera ningún Excel.** La pantalla dice cuáles faltan
  (código y nombre) y ofrece «Crearlas en Diez». Se crean por la API
  (`subcuentas/add`, ya en `diezCliente.ts`) con el nombre que tienen en Sumied,
  y solo cuando Julio lo confirma. Queda apuntado quién y cuándo, y después se
  vuelve a comprobar.
- Si Diez no contesta, tampoco se genera: no se puede saber si están (de
  acuerdo, Julio, 24/10).

**Cuentas de retención** *(Julio, 24/10)*: profesionales a la **47510015** y
alquileres a la **47510019**, las que Foodint ya tiene enlazadas a esos tipos en
Sumied. El valor del tipo en la configuración de recibidas: **PRO** para
profesionales y **ALQ** para «Alquiler de local» (Julio, 24/10). El Excel lleva
la subcuenta y el valor de cada tipo. No se genera si un tipo no tiene
subcuenta, o si la configuración no conoce su valor: Diez dejaría fuera la
retención y el asiento descuadraría, como en la primera prueba.

## Antes del primer traspaso real: las configuraciones en la C0008

Julio carga en **Diez real (C0008)** las dos configuraciones definitivas. Diez
las guarda por base, y la C0008 no tiene las de las pruebas de la C0009.

| | Fichero | Qué hay que comprobar en la pantalla |
|---|---|---|
| Emitidas | `docs/conta/c12/prueba-excel/ConfiguracionExpedidas-c12.XML` | Probada en la C0009 (las tres con su PDF). |
| Recibidas | `docs/conta/c12/prueba-excel/ConfiguracionRecibidas-c12.XML` | Probada en la C0009 con **PRO**. En la retención, añadir **ALQ** a «Alquiler de local», guardar y exportar el XML: ése es el definitivo, y entra en el generador (hoy para si falta ALQ). |

Después, el primer traspaso comprueba él solo que la C0008 tiene todas las
subcuentas (la 47510015 y la 47510019 incluidas) antes de preparar los Excel.

**2. Banco, asientos a mano y liquidaciones, por la API (`apuntes/add`), sin PDF.**
- Van solos al pulsar «Traspasar», en tandas, como está hecho en el #322.
- Sin PDF, que es lo normal en estos asientos (la importación de asientos de
  Diez no trae documento, y la API tampoco puede guardarlo).

*Por qué la API y no Excel:*
- ya funciona y está probada en la C0009 (C07);
- cada asiento dice al momento si ha llegado y por qué no;
- antes de escribir se mira si ya está, así que repetir no duplica;
- y no añade otro paso a mano.

Por Excel serían una tercera importación sin confirmación y sin nada que ganar,
porque tampoco llevaría PDF.

**3. Después, el cuadre (como está en el #322).** Los apuntes del mes en Diez
contra lo que Sumied dice que tiene que estar allí. Si cuadra, se cierra el mes
(de acuerdo, Julio, 24/10).

## La pantalla, con esto

1. «Traspasar octubre a Diez» → revisar y confirmar (como hoy).
2. Se mandan banco, asientos a mano y liquidaciones (API) y se preparan los dos
   Excel: «Descargar emitidas» y «Descargar recibidas», con dos líneas de cómo
   importarlos.
3. «Ya lo he importado» → Sumied comprueba que están todas y cuadra el mes.

## La URL del PDF

**Decidido: enlace permanente, con llave por documento.** Cómo se protege:
- **No** una URL firmada de diez años: no se puede retirar una sola, solo
  todas a la vez (cambiando la clave del proyecto).
- **Una dirección propia por documento**, `https://…/functions/v1/conta-pdf/<llave>`:
  - la llave es aleatoria, de 128 bits, una por documento;
  - no lleva ni cuenta, ni empresa, ni número de factura;
  - se guarda en la base junto al documento.
- **Una función** sirve el PDF solo si la llave existe y no está retirada:
  - el PDF va con `Cache-Control: private` y `X-Robots-Tag: noindex`;
  - cada acceso queda apuntado (cuándo y desde dónde);
  - tiene un tope de peticiones por llave.
- **Se puede retirar** una llave (si se anula la factura, o si alguien la filtra),
  o todas las de una empresa. Al retirarla, Diez deja de ver ese PDF: es lo que se
  quiere en esos casos.
- **Solo hay llave** para un documento que ha ido en un traspaso.
