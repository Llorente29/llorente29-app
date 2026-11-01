B01 · PR 3a · **Los núcleos de casar.** Decisión de Julio (01/11): sacar la lógica de casar a núcleos internos, en vez de copiarla o abrir las guardas de Bancos. Con eso, el cargo de un pago por Revolut se casa solo con su factura.

## Qué hace

**La 2030**, en la base:
- **Cada función que casa se parte en dos:**
  - **un núcleo**, sin guarda, que nadie de fuera puede llamar (`revoke` a public, anon y authenticated);
  - **la pública de siempre**, que hace su guarda de siempre y llama a su núcleo, con la misma firma.

  | Pública (guarda de siempre) | Su núcleo |
  |---|---|
  | `mark_supplier_invoice_paid` (`belongs_to_account`) | `_mark_supplier_invoice_paid_nucleo` |
  | `bank_casar` (`_bank_cuenta_de_empresa`) | `_bank_casar_nucleo` |
  | `conta_remesa_casar` (`_pc01e2_empresa`) | `_conta_remesa_casar_nucleo` |
  | `journal_entry_validar` | ya lo tenía: `_journal_entry_validar` (S01 · PR 3). No se toca. |

- **Dentro de un casado, los núcleos se llaman entre ellos**, nunca a una pública: la guarda se hace una vez, a la entrada.
- **El texto de cada núcleo** es el de la función de producción del 01/11 (md5 de `pg_get_functiondef`: `bank_casar` 0f253b11, `conta_remesa_casar` 57bb45e3, `mark_supplier_invoice_paid` 927ffeee). La migración lo genera de ahí con reemplazos exactos, y solo cambia esto:
  - la guarda de la entrada, fuera: la empresa se lee sin mirar quién llama;
  - las llamadas a una pública, a su núcleo;
  - sin sesión (la clave de servicio), quien marca pagada la factura es «Sumied»; con sesión, su nombre, como siempre;
  - el núcleo de `conta_remesa_casar` recibe quién casa: «persona» desde la pública, como siempre, o «folvy».
- **El respaldo:** las tres públicas de antes van a `funcion_respaldo` (`_respaldar_funcion`), y la vuelta atrás las restaura de ahí byte a byte.
- **`conta_pago_casar_banco(p_salida)`**, solo para la clave de servicio:
  - toma un pago que el banco ya ha pagado;
  - busca su cargo: el movimiento de la misma empresa y la misma cuenta que lleva el id del pago en el banco (Revolut: `reference_2` = «transacción:pata»), por el importe exacto y sin casar. La comisión y las devoluciones no cuentan: sus ids llevan «:comision» o «:vuelta»;
  - lo casa con su remesa «banco» por el núcleo, como «folvy»;
  - si el cargo aún no ha llegado, o hay más de uno con ese id, lo dice y no casa nada.

**La lectura de Revolut** (`_shared/revolut/servidor.ts`, `casarPagos`):
- en cada lectura, después de traer los movimientos y de preguntar por los pagos, mira los pagos pagados de los últimos 60 días y llama a `conta_pago_casar_banco` para cada uno;
- también después de «Dejar de pagar»: lo que ya salió se casa igual cuando llega su cargo;
- un fallo se cuenta y la lectura sigue. El parte de la lectura lo dice: `casados: {mirados, casados, fallos}`.

## Antes = después

**La prueba de staging** (`supabase/staging/sql/20261101_b01n_nucleos_prueba.sql`, ROLLBACK, cuenta D, IBAN inventados del banco 9999) corre **el mismo caso a los dos lados de un savepoint**: primero con las funciones de producción y después con la 2030. Compara lo que devuelven y lo que dejan escrito, con los ids tapados.
- **Lo que recorre:**
  - casar un pago a mano con su cargo (`conta_remesa_casar`);
  - casar un cargo con su factura (`bank_casar`);
  - casar una remesa de fichero con el IBAN confirmado, que **se valida sola** (`journal_entry_validar`);
  - marcar pagada a mano una factura sin pago con asiento (`mark_supplier_invoice_paid`, que para);
  - las tres guardas, con una persona de otra cuenta, y los «no existe».
- **Lo que compara (18 claves):**
  - frases y sus recuentos;
  - las facturas (estado, fecha, método, quién) y sus pagos;
  - los casados (tipo, quién, confianza, porqué, partidas) y los movimientos;
  - los asientos y sus líneas, y los validados (serie, número, quién, que tenga huella y encadene);
  - el registro de Bancos, el de pagos y el de las remesas.
- **Resultado:** idénticos.
- **La prueba no es un espejo:** cambiando a propósito «persona» por «folvy» en la pública de `conta_remesa_casar`, sale en rojo y dice qué ha cambiado (el casado y el registro de Bancos).

**El resto de la prueba:**
- 0: las públicas parten de la huella de producción y sin núcleos;
- 2: nadie de fuera llama a un núcleo; `conta_pago_casar_banco`, solo la clave de servicio; las públicas conservan sus permisos;
- 3: un pago por Revolut de punta a punta, por el camino de verdad (activar, aprobar, mandar, el banco dice pagada):
  - sin el cargo, dice «El cargo aún no ha llegado del banco»;
  - con el cargo y su comisión aparte, lo casa solo como «folvy», sin sesión de nadie, y la factura queda pagada por «Sumied»;
  - la segunda vez, nada;
- 4: la vuelta atrás, también con lo casado por los núcleos, devuelve las públicas de producción.

En verde en la base local del W09.

**Lo que no cambia y se apunta:**
- `channel_settlement_collect` (cobrar una liquidación de plataforma, dentro de `bank_casar`) sigue mirando la sesión. Con la clave de servicio, casar una liquidación pararía. No es el camino de una remesa ni de un pago.
- Una remesa «banco» no se valida sola: el núcleo de `conta_remesa_casar` lo deja como estaba, que solo valida solas las de fichero. Su asiento queda en «Por validar» con el motivo «es un pago a mano». Si se quiere que un pago por el banco se valide solo, es un cambio aparte.

## Tanda

`supabase/produccion/tandas/sumied/claude-revolut-business-sumied-9fhlsh/`. Las del PR 1, el 2a, el 2b y el 2c-1 están aplicadas y en el historial con su huella.

- **2030, cambia (declarado):**
  - las tres públicas, con la misma firma, con la prueba de staging y la de antes en `funcion_respaldo`;
  - añade los núcleos y `conta_pago_casar_banco`;
  - `lock_timeout` de 5 s;
  - nada en el camino del pedido;
  - el analizador dice **sigue**, sin `autorizo`.
- **Contexto:** medido en producción en solo lectura el 01/11 a las 20:25Z:
  - las tres públicas existen con las huellas de las que parte la migración;
  - ningún núcleo;
  - nada en el camino del pedido;
  - nada en el historial.
- **Lo que cuenta** (`scripts/conta/produccion/cuentas/b01n-nucleos.sql`):
  - antes, medido: las tres huellas de producción; 0 núcleos; Foodint, 572 casados vivos, 95 facturas pagadas y 15.350 asientos validados hasta el corte;
  - después: las huellas cambian, 4 funciones nuevas, y lo de Foodint igual (la tanda no casa, no marca ni valida nada).
- **El real lo lanza Julio.**

## Pruebas

- **Unitarias** (`servidor.test.ts`):
  - `casarPagos` llama a `conta_pago_casar_banco` por cada pago pagado de la empresa de los últimos 60 días, y cuenta casados y fallos;
  - sin la tabla, no casa nada y no para la lectura;
  - la lectura casa después de traer los movimientos y de preguntar por los pagos.
- **Comprobaciones:**
  - `scripts/conta/antes-de-subir.sh`: los 10 pasos en verde;
  - `deno check` de `conta-revolut-leer`, `conta-revolut-aviso`, `conta-revolut-conectar` y `conta-pagar`: sin errores;
  - **regla 40:** las columnas de `conta_pago_salida` que lee `casarPagos` existen en producción, y `conta_pago_casar_banco` llega con la 2030.
- **e2e:** sin pantallas nuevas. La de la zona corre en cada push.

## Lo que sigue (PR 3)

- La remesa por Revolut desde Pagos: varias facturas, una segunda aprobación.
- La prueba de punta a punta en producción con un pago de 1 € a una cuenta de Julio, guiada por la sesión principal.

## Funciones a desplegar a mano

### Sumied

- conta-pagar
- conta-revolut-aviso
- conta-revolut-conectar
- conta-revolut-leer

### Folvy

ninguna

## Producto

- Sumied
- Común (`supabase/functions/_shared`)
