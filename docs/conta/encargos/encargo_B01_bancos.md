# Encargo B01 — Bancos y conciliación (frente B)

> Copia de trabajo del encargo de Julio (13/10/2026), íntegra. La maqueta
> N17 (`maqueta_B01.zip`) está en `docs/conta/maquetas/b01/`. Comprobaciones
> previas en `docs/conta/B01_comprobaciones_previas.md`.

Sesión de Code: «B · Bancos y conciliación». Rama: `conta/b01-bancos`, sacada de `main`. Maqueta: `maqueta_B01.zip` (N17 «Bancos › Movimientos», estilo nuevo). Una cosa cada vez: haz la tarea 1 y para a informar.

## Para qué

Que el banco se case solo con la contabilidad y que la persona solo toque lo que de verdad no se puede saber. Sirve para Foodint (Llorente29) y para cualquier empresa que use la contabilidad sin el resto de Folvy (ver «Trabajo en paralelo»).

## Hechos de Julio (13/10/2026)

* La conexión tiene que valer para cualquier banco normal de España.
* Ahora sin pagar a nadie: se empieza con el fichero Norma 43 (todos los bancos españoles lo dan) y con el extracto que llega por correo si el banco lo permite.
* La conexión directa (intermediario autorizado PSD2: Salt Edge, Enable Banking, Tink…) llegará después, como extra de pago. Tiene que poder enchufarse sin rehacer nada, y poder cambiarse de proveedor.
* La conciliación bancaria es muy, muy importante (Julio, 04/10). Objetivo: automática al máximo.
* Foodint tiene dos cuentas BBVA (subcuentas 57200001 y 57200002 en su plan traído de Diez).

## Lo que se construye

1. Entrada de movimientos, con un único modelo para todas las fuentes.
   * Fuente `fichero`:
      * Norma 43 de la AEB (un fichero puede traer varias cuentas);
      * Excel/CSV de los bancos más comunes, como reserva (BBVA, Santander, CaixaBank, Sabadell, Bankinter, Unicaja, Kutxabank, Ibercaja, Abanca, ING, Cajamar), con lectura por banco y prueba con un ejemplo inventado de cada uno.
   * Fuente `correo`: el extracto adjunto que llega a una dirección propia de la empresa. Puede ir en este encargo solo si la bandeja de correo ya existe; si no, se deja preparada y se dice.
   * Fuente `agregador:<proveedor>`: solo la interfaz (un adaptador con contrato y pruebas contra un proveedor simulado). Nada de contratos ni claves reales.
   * Nunca un movimiento dos veces: huella por cuenta, fecha, importe, referencias del banco y número de orden dentro del día. Subir el mismo fichero dos veces no cambia nada y lo dice.
   * Cuadre del extracto: saldo inicial + movimientos = saldo final del fichero (registros 11 y 33 de la Norma 43). Si no cuadra, no se importa y se dice por qué.
   * La cuenta del extracto se reconoce por su IBAN contra `treasury_account` (los bancos del C00). Si no existe, se propone darla de alta.
2. Motor de conciliación con confianza graduada, como el plan contable y la ficha de proveedor:
   * Seguro: se casa solo y queda en «Lo que ha hecho Folvy», con el porqué y «Deshacer». Casos:
      * mismo importe y misma referencia que una factura o un pago ya apuntado;
      * traspaso entre dos cuentas propias;
      * cobro de plataforma que cuadra con su liquidación (`channel_settlement`);
      * cuota repetida de un contrato conocido (préstamo o alquiler) confirmada 3 veces.
   * Probable: propuesta en una línea, con el porqué y «Sí» / «Otra cosa».
   * Dudoso: «Por aclarar», diciendo qué falta («No hay factura de 1.278,17 €: ¿la subes o es un cobro sin factura?»).
   * Cruces:
      * facturas recibidas (pago entero, en partes, varias en un pago);
      * facturas emitidas y cobros;
      * liquidaciones de plataformas (neto = ventas − comisiones; comisión a su 410 y ventas a la 430 de la plataforma, como en Diez);
      * pagos con tarjeta (se pide el ticket por foto);
      * nóminas y seguros sociales (465/476);
      * préstamos (cuota = capital 170/520 + intereses 662);
      * impuestos (303/111/115 por modelo y periodo);
      * comisiones bancarias (626).
   * Aprende por contraparte: lo confirmado 2 o 3 veces pasa a propuesta automática. Las reglas se enseñan en palabras («Cuando el concepto tenga "PLENITUDE" → Luz y agua») y se pueden apagar. Las que propone Folvy salen como «Regla nueva, ¿la guardo?».
   * Lo que se casa genera el asiento de cobro o pago (serie de tesorería, 4 en Diez) como propuesto, salvo lo seguro, que se valida solo si la empresa tiene activado «validar solo lo seguro» (apagado por defecto). Usa el libro diario del C04: numeración al validar, huella encadenada y nada se borra.
   * Si el asiento ya existe (por ejemplo, el pago se apuntó a mano), se enlaza, no se duplica.
3. Cierre del mes del banco: saldo del banco = saldo contable de su 572 al último día, o la diferencia explicada movimiento a movimiento. «Cerrar el mes» no deja avanzar con movimientos sueltos (tarea de la lista de cierre del mes).
4. Agente «Conciliación», cada noche, solo lectura:
   * ningún movimiento casado dos veces;
   * ningún asiento de banco sin movimiento detrás (salvo los marcados «a mano»);
   * saldo del banco = saldo contable en cada cierre de mes, o diferencia explicada;
   * ninguna regla automática sin su registro;
   * ningún extracto importado que no cuadre.

## Norma

Comprueba cada referencia en la fuente oficial y cítala literal en el informe:

* Norma 43 (AEB, «Información normalizada de cuenta corriente»): estructura de registros 11, 22, 23, 24, 33 y 88, conceptos comunes y propios. Fuente publicada por los bancos, por ejemplo el cuaderno 43 de Cajamar: https://www.cajamar.es/storage/documents/1733/cuaderno-43.pdf
* Código de Comercio, art. 25 y 29 (contabilidad ordenada; justificantes).
* PGC, grupo 57 (tesorería) y las cuentas de los cruces.
* PSD2 (Directiva (UE) 2015/2366) y RDL 19/2018, solo para dejar escrito por qué la conexión directa necesita un proveedor autorizado. Este encargo no conecta con ningún banco.
* RGPD: los movimientos tienen datos de terceros (nombres, IBAN). Viven solo en producción y nunca en el repositorio, en registros públicos ni en staging.

## Contraste (antes de construir; va en `docs/conta/contraste.md`)

Base escrita en `claude/folvy-contabilidad-benchmark.md`, sección «Conciliación bancaria»:

* Diez: todo en una pantalla, pero la contrapartida se pone a mano, sin propuestas ni aprendizaje.
* Holded: cruce con facturas por importe exacto, sin porqué.
* Pennylane: bandeja «por justificar» y aprendizaje.
* Xero: autoconcilia lo seguro y explica por qué; página para deshacer.
* Puzzle y Digits: confianza graduada y porqué.

Añade ContaSOL (Norma 43) y a3innuva. Para cada pieza di qué tienen, qué cogemos y dónde estamos un escalón por encima. Si no lo estamos, se para.

## Diseño (sección obligatoria)

* Maqueta N17 (en el zip). Navegación en tres niveles:
   * pestañas «Movimientos · Reglas · Cuentas y extractos · Cierre del mes»;
   * barra de acciones agrupadas «TUS BANCOS · TRAER MOVIMIENTOS · AUTOMÁTICO», más favoritos y buscador.
* Arriba:
   * la banda de la IA que rinde cuentas («He casado yo 142 de 158…»);
   * cinco cifras: saldo en el banco, saldo en contabilidad, casado solo, para confirmar y por aclarar.
* Tabla:
   * «Lo que dice el banco» con el concepto limpio, sin asteriscos ni códigos;
   * el importe en Geist Mono y verde si entra;
   * un punto de color (verde casado solo, ámbar probable, gris dudoso);
   * «Lo que Folvy cree que es», con el porqué en una línea;
   * los botones a la derecha.
* Nunca la palabra «subcuenta» ni un código a secas: «Luz y agua · 62800000».
* «Subir extracto»: arrastrar el fichero, ver «He leído 2 cuentas, 158 movimientos, del 01/10 al 13/10; cuadra con el saldo del banco» y confirmar.
* Móvil: solo «Para confirmar» y «Por aclarar», una tarjeta por movimiento, «Sí» con el pulgar y «Subir foto» del ticket.
* Fiel a la maqueta. Si algo no se puede, para y dilo antes de cambiarlo.

## Tareas

1. Comprobaciones previas, solo leyendo, y para:
   * qué hay ya en `treasury_account`, `supplier_invoice_payment_log`, `channel_settlement` y en el libro (asientos de tesorería);
   * si existe bandeja de correo;
   * cómo casa hoy Folvy algo con un banco, si algo lo hace;
   * qué falta en la base para este encargo;
   * en producción, las cuentas bancarias de Foodint y sus subcuentas;
   * cualquier choque con lo que hacen las sesiones A y C (ver abajo).
2. Lector de Norma 43 y de los Excel/CSV, con sus pruebas, el cuadre y la huella. Núcleo puro y probado, como `diezMapeo`.
3. Base: movimientos, extractos, reglas, enlaces movimiento ↔ asiento/factura/liquidación, registro de «Lo que ha hecho Folvy». RLS A/B. Vuelta atrás.
4. Motor de conciliación con los cruces del punto 2, las pruebas por caso y la prueba de que nada se casa dos veces.
5. Pantallas N17 (ordenador y móvil), con e2e.
6. Agente «Conciliación», interfaz del agregador con proveedor simulado y cierre del mes del banco.
7. Informe final con capturas comparadas con la maqueta y el contraste. Tanda para producción con su analizador (paso 8 de antes de subir).

## Trabajo en paralelo (nuevo: hay tres sesiones de Code a la vez)

* A · Ventas y facturas recibidas (rama `conta/c04b-diez`) y C · Contabilidad sola (rama `conta/c06-sola`) trabajan a la vez que tú.
* Tus migraciones van con el prefijo `20261101T` (B), para no chocar con A (`20261021T…`) ni con C (`20261111T…`).
* Staging es compartido. Solo migraciones que añaden. Antes de aplicar, mira el historial de staging y no deshagas nada que no sea tuyo. Tus semillas, con nombres propios del frente B.
* Ficheros compartidos (`antes-de-subir.sh`, el analizador, los workflows, `database.ts`, el menú del módulo): si tienes que tocarlos, haz el cambio pequeño y dilo en tu informe. Yo lo coordino con las otras dos sesiones.
* Producción: nunca lanzas nada. Julio lanza una tanda cada vez; yo le digo el orden.
* Las facturas recibidas que vas a cruzar las está rehaciendo el frente A. Cruza contra las tablas que existen hoy (`supplier_invoice`) a través de una función de lectura. Así, si A cambia el modelo, solo cambia esa función.

## Reglas de siempre

* Nada real (NIF, nombres, importes, IBAN) en el repositorio, que es público, ni en staging.
* En producción solo se lee.
* Un freno de seguridad solo se afloja con autorización explícita de Julio.
* Los hechos del negocio se preguntan, no se suponen.
* Lista de antes de subir entera antes de cada push.
* Fichero entero y como usuario en las pruebas de staging.
