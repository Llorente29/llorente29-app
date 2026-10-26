# V04 · PR 1 · El tique de la bolsa: el número y quién factura (sin QR)

*26/10 · rama `conta/v04-tique`.*
Maqueta aprobada: «Tique de bolsa con Verifactu», tableros 1, 2 y 4.
Los tableros 1 y 2, en `docs/folvy/v04/maqueta-tablero-1.png` y `-2.png`.

## Por qué el tique de hoy sale sin el nombre ni el NIF

Medido en producción el 26/10, solo leyendo.

- **La base sí los tiene.** La cuenta Foodint lleva «Llorente29 Food, S.L.» y
  el NIF B56496938, y sus tres locales tienen esa empresa en `location_company`.
- **La tablet los pide al imprimir.** Las bolsas van por `by_order`: 952 en 7
  días. En las últimas 24 h hubo 48 llamadas a `fiscal_for_print` para 36
  bolsas, y todas contestaron 200.
  - `fiscal_for_print` es la misma en staging y en producción (md5 `6efe86f5…`).
  - El pintado de la tablet pinta el nombre y el NIF si llegan, desde el
    20/07 (paquetes 306, 425 y 480 en las tablets activas).
- **Lo que no los pide nunca es la vista previa de Pedidos («Ver tiques»).**
  `OrderCard` abre `TicketPreviewModal` sin `fiscal`. Su imagen («Como sale en
  la impresora») sale sin el nombre ni el NIF y con el código del pedido
  («m6y3req») como número. Es justo el tique «Hoy» del tablero 1.
  - Si el tique que enseñó Julio era esa vista previa, esta es la causa.
  - Si era el papel, el servidor lo descarta: contesta con los datos. Faltaría
    mirarlo en la tablet que lo imprimió.
  - Arreglado: la vista previa los pide ahora con `fiscal_for_preview`.

## Lo que está hecho

### La base: la 2309

`20261026T2309_v04_tique_serie_y_quien_factura.sql`.

- **Añade tres tablas, que nacen vacías:**
  - `location_invoice_code`: el código de cada local;
  - `ticket_invoice_series`: la serie de cada local y año (F) y la de sus
    rectificativas (R), con su contador;
  - `ticket_invoice`: cada número dado, uno por pedido.
- **El número: `_ticket_invoice_number`.**
  - Un cerrojo por pedido, para que dos impresiones a la vez esperen la una a
    la otra.
  - La fila de la serie bloquea el contador, así que dos pedidos a la vez van
    uno detrás de otro.
  - Contador y factura van en la misma transacción: sin huecos.
  - Reimprimir devuelve el mismo número.
  - El año es el de Madrid.
  - La serie llena (999.999) falla, no se inventa.
- **Quién factura: `_ticket_quien_factura`.**
  - Propia (`brand.ownership_type = 'own'`, o sin marca): la empresa del local
    o, si no tiene, la de la cuenta. Nombre y NIF.
  - Cedida (`licensed`): `raw_tab.bills[0].company` (nombre, NIF, dirección) y
    `bills[0].number`.
  - Una cedida sin factura de Last va con `sinFactura` y sin número.
- **`fiscal_for_print` cambia en caliente**, con la misma firma.
  - Devuelve lo de antes y además `issuerKind`, `sinFactura` y `serie`.
  - Una propia de un local con código lleva su número de la serie; sin código,
    como antes.
  - Una cedida sin factura encola el aviso `tique_cedida_sin_factura`.
  - Si la serie falla, la impresión no: el tique sale como antes y se encola
    `tique_sin_numero` con nivel alto.
- **La impresión no falla nunca por quién factura** (Respuesta 1, 27/10).
  `_ticket_quien_factura` y el aviso de la cedida sin factura van dentro de
  bloques que recogen el error. Si fallan, el tique sale como antes (los datos
  de la cuenta y el número de siempre) y se encola `tique_sin_quien_factura`.
  Un aviso que no se puede encolar no para nada.
- **La de antes, guardada** (Respuesta 1). Antes de cambiar `fiscal_for_print`,
  la migración guarda su definición tal cual (`pg_get_functiondef`) en
  `funcion_respaldo`, con `_respaldar_funcion`. La vuelta atrás la vuelve a
  crear desde ahí con `_restaurar_funcion`, que para si la huella no sale
  idéntica. Las tres piezas se quedan para cualquier tanda que cambie una
  función en caliente.
- **`fiscal_for_preview`:** lo mismo para la vista previa, pero solo lee. Si el
  local numera y el pedido aún no se ha impreso, dice «al imprimir».
- **Ajustes:** `ticket_invoice_ajustes` (lo que pinta el tablero 4) y
  `ticket_invoice_code_set`.
  - Solo un administrador cambia un código.
  - Son 2 o 3 letras, y no puede repetirse en la cuenta.
  - Con números dados ya no se cambia.

Todo filtra por `account_id`. Las tablas no se leen directamente: solo por las
funciones.

### El tique

`src/native/print/fiscalTique.ts` es la pieza común de los tres pintados: la
imagen que imprime la tablet, el texto de la tablet y la vista previa. Debajo de
la fecha va, como en la maqueta:

- «Llorente29 Food, S.L. · NIF B56496938» en una línea. En una cedida, sus datos
  y debajo su dirección.
- «Factura Simplificada» con su número. En una cedida sin la factura de Last,
  sin esa línea.

Lo demás del tique no cambia.

### Ajustes de Folvy › «Facturas de los pedidos»

Es la ruta `/configuracion/facturas-pedidos` (tablero 4).

- **Verifactu:** el estado de la empresa, con «Ir a Sumied».
- **Cada local:**
  - su código (Folvy propone las dos primeras letras sin el nombre de la
    cuenta: Carabanchel → CA, Alcalá → AL);
  - la serie de este año, el último número y la de las rectificativas;
  - un local sin código dice que sus tiques salen como hoy.
- **Las marcas:** propias por nuestra serie; cedidas, «la emite Cloudtown desde
  Last». Sale el aviso si hubo pedidos de cedidas sin la factura de Last.

## Lo probado

- **Unitaria de la serie, contra un Postgres de verdad**
  (`tests/unit/modules/orders/v04/serieTique.test.ts`). Carga el bloque «serie»
  de la migración tal cual y comprueba:
  - dos impresiones a la vez del mismo pedido: el mismo número y un solo gasto;
  - reimprimir no gasta número;
  - veinte pedidos a la vez: del 3 al 22, sin repetir ni saltarse ninguno;
  - el año nuevo de Madrid empieza otra serie;
  - la serie llena falla;
  - el código propuesto.

  Sin el cerrojo por pedido, la prueba cae: probado quitándolo.
- **Staging, en ROLLBACK** (`supabase/staging/sql/20261026_v04_tique_serie_prueba.sql`),
  por los caminos de la regla 10:
  - imprimir y reimprimir con el token de una tablet de verdad;
  - cerrar (`close_sale`) y cancelar (`cancel_sale`) después de imprimir: el
    número sigue;
  - la cedida con factura de Last y sin ella, con su aviso;
  - el local sin código;
  - la serie llena sin que falle la impresión;
  - el código que no se cambia y la vista previa que no numera;
  - los permisos;
  - la vuelta atrás, que deja `fiscal_for_print` con el md5 de producción.
- **Unitarias de lo fiscal del tique y de Ajustes:** `fiscalTique.test.ts` y
  `facturasPedidos.test.ts`.
- **e2e de la zona:** `tests/e2e/conta/v04/tique.spec.ts`.
  - El tique de una propia, una cedida y una cedida sin factura, en «Ver
    tiques». Cada foto, al lado de su tablero:
    `docs/folvy/capturas/v04/tique-propia-al-lado-del-tablero-1.png` y
    `tique-cedida-al-lado-del-tablero-2.png`.
  - Ajustes, en ordenador y móvil.
  - Lo fiscal de la base va simulado en el navegador: la 2309 solo se ensaya en
    staging hasta que se aplica.
  - Corre también la corta de pedidos.

## La tanda

`folvy/conta-v04-tique`: la 2309, con su cuenta (`cuentas/v04-tique.sql`) y su
vuelta atrás.

- **El analizador dice AUTORIZO.** Desde la Respuesta 1, `fiscal_for_print`
  está en `CAMINO_FUNCIONES` del workflow. Contexto medido de nuevo en
  producción, solo lectura, el 26/10 a las 23:37Z.
  - En el campo `autorizo`: `20261026T2309_v04_tique_serie_y_quien_factura.sql`.
- **Por qué paró el ensayo #256.** `fiscal_for_print` tiene `\r\n` en
  producción y en staging (31 retornos, huella `6efe86f5`). La vuelta atrás la
  copiaba a mano con `\n` y dejaba otra huella (`abd45e61`).
  - Staging lo vio: el run 623 salió en rojo en la sección 0 de la prueba, y
    por eso no llegó al comparador (W06), que va después y mide lo mismo.
- **Que no se repita.** El analizador bloquea una tanda que reemplaza una
  función que ya existe si la migración no la guarda antes con
  `_respaldar_funcion` o su `.down.sql` no la restaura con `_restaurar_funcion`.
  - Vale desde la 2309. Las que ya estaban en `main` van congeladas en
    `scripts/conta/produccion/respaldo-antiguas.txt`.
  - Pruebas: `tests/conta/produccion/v04respaldo.test.ts` y, contra un Postgres
    de verdad con una función con `\r\n`,
    `tests/unit/modules/orders/v04/respaldoFuncion.test.ts`.
- **Se lanza desde la rama, antes de fusionar:** el ensayo y después el real.
- **La cuenta medida antes:** 3968 / 10950 · 9874 · 0 de 3 · 6efe86f5 · y las
  siete funciones del camino con su huella.
- **Tiene que cambiar:** las tablas, de 0 a 3 de 3, y la huella de
  `fiscal_for_print`.

## Funciones a desplegar a mano

Ninguna.

## Las tablets

Reciben el cambio por OTA, con el paquete que dé `build-apk.yml` al fusionar.
El último ha sido el **482** (#341): si esto es lo siguiente que entra en
`main`, el **483**.

Hasta que se aplica la 2309, un paquete nuevo con la base de antes pinta el
nombre y el NIF en una línea y el número de siempre: no rompe nada.

## Lo que queda abierto

- **Julio:** elegir el código de cada local en Ajustes. Hasta entonces, ningún
  local numera y los tiques salen con el número del pedido.
- **El PR 2:**
  - el QR de Verifactu;
  - cada tique, un registro F2;
  - cancelar después de imprimir, anulado con el motor de la E3;
  - la serie R de las rectificativas.

  La maqueta dice además que, al pasar a «real», la serie empieza otra vez.
  Con el mismo prefijo, eso repetiría números. Se decide en el PR 2: por
  ejemplo, otra letra en el prefijo.
- **El nombre y el NIF del fabricante de Sumied** (`SistemaInformatico`):
  Julio. Hace falta en el PR 2.
