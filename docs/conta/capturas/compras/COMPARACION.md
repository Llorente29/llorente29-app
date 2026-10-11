# Compras · capturas contra las maquetas

Capturas del e2e `tests/e2e/conta/compras/compras.spec.ts` contra staging-conta, en ordenador (1440)
y móvil (390), con la semilla `supabase/seeds/conta/seed_compras_staging.sql` (todo inventado). Las
maquetas: `docs/conta/maquetas/compras/{Main,Liquidacion,FichaProveedor,Recepcion}.dc.html`.

| Pantalla | Maqueta | Captura |
|---|---|---|
| Compras | N18 `Main` | `compras-ordenador.png`, `compras-movil.png` |
| Subir una factura (no dibujada) | — | `subir-factura-ordenador.png`, `subir-factura-movil.png` |
| La liquidación y su contraste | N19 `Liquidacion` | `liquidacion-ordenador.png`, `liquidacion-movil.png` |
| Cómo te factura (su pantalla, sin forma: el aviso) | N20 `FichaProveedor` | `como-te-factura-ordenador.png`, `como-te-factura-movil.png` |
| Cómo te factura (con su forma elegida y albaranes sin IVA) | N20 `FichaProveedor` | `como-te-factura-elegida-ordenador.png`, `como-te-factura-elegida-movil.png` |
| Recibido (la frase al recibir) | N21 `Recepcion` | `recibido-movil.png` (la pieza real con el CSS del build: `tests/unit/modules/supply/capturaRecibido.test.tsx`) |
| Ventas (en el menú; su pantalla, aún no) | menú de N18 | `ventas-ordenador.png`, `ventas-movil.png` |

## Lo que arregló el repaso de Julio (10/10)

Ya no son diferencias; lo comprueba el e2e:

- **Una fila por decisión.** «A nombre de quién»: una fila por nombre («3 papeles van a nombre de «Aurora
  Cocina Centro». ¿De quién son?»), con el total, las fechas y el local; contestar una vez resuelve los
  tres. La ficha: una fila por proveedor con todo lo que le falta («A X le faltan el NIF, el tipo de
  gasto y cómo te factura.») y sus botones. La cabecera y el menú cuentan filas. Cada fila abre sus
  papeles («Ver los 3 papeles»): agrupar no esconde (regla 7).
- **«A nombre de quién» no es una ristra.** Como mucho dos propuestas, con su porqué en pequeño
  («Comparte «aurora» y es quien trae el género»); «Es de otro…» abre una búsqueda; «No es nuestro» se
  queda. Un papel a «Contado», «Varios», «Cliente», «Particular»… no pregunta: es un aviso de IVA con dos
  salidas (base: la 0190).
- **Las frases.** Lo humano primero (proveedor, día, local, importe) y el código pequeño al final; la
  fila de recepciones sin camino dice qué no se sabe y por qué, y su botón dice lo que hace («Mirar sus N
  papeles ahora»); fuera la tercera línea repetida.
- **«Ver el papel»** en cada fila y en cada papel de una fila agrupada: abre la foto o el PDF guardado con
  la recepción sin salir de Compras; si no hay papel guardado, lo dice.
- **«Ver los N albaranes»** en el contraste de compras de la liquidación, cada uno con su papel.
- **«Apuntarla sin descontar el IVA»**, con «Lo que voy a apuntar»: el IVA es más gasto, no va a la 472
  ni al libro de recibidas como deducible (`supplier_invoice.vat_non_deductible`; el asiento lo propone
  el libro, probado con la factura de «Contado» de la semilla: 112,79 € al 600 y nada al 472).
- **Contadores en el menú** en Compras, Clientes y proveedores y Libros, con la misma vara que su
  pantalla. Es un aviso que interrumpe: si no hay nada, no se pinta.
- **La liquidación en el orden de la maqueta**: tres cifras, los cinco documentos leídos (cuáles llegaron
  y qué no se puede comprobar sin cada uno), el contraste, las dos facturas, lo que se va a apuntar.
- **Tres veredictos con umbral escrito y probado** (`UMBRAL_COINCIDE`: 2 € o el 0,1 %, lo que sea
  mayor) para compras, ventas y producto a producto: coincide · se parece (cuánto y dónde) · no lo puedo
  comprobar (por qué y qué hace falta).
- **La cabecera pegada y el menú encima del contenido** era de la captura, no de la app: la captura de
  página entera pintaba las piezas fijas donde estaban en la ventana. Ahora se agranda la ventana al alto
  del documento y se captura la ventana.
- **«Cómo te factura»**: se ve qué opción está elegida (el punto y «La de su ficha»); hay aviso cuando la
  ficha y sus últimos papeles no dicen lo mismo; «Abrir su ficha» desde Compras cae en esa sección.
- **Las ventas por plataforma en el móvil** (lo cazó la captura del e2e 171): dentro del veredicto, la
  tabla salía de su caja y «Diferencia» se cortaba. Ahora ocupa el ancho de la tarjeta y las cifras no se
  parten; el e2e mide que ninguna celda se salga. Y «Reconozco 0 de sus 3 productos» pasa a «Todavía no
  reconozco ninguno de sus 3 productos».
- **La barra «Pregunta o pide algo»** ya no tapa la última fila en el móvil: el contenido deja su sitio
  debajo (y la medida `loQueTapan` del e2e lo exige).

## Lo que arregló la respuesta 1 de Julio (11/10)

Como la maqueta, y lo comprueba el e2e (N21, su prueba de captura):

- **Menú con «Ventas»**, detrás de Compras. Su pantalla todavía no existe (llega con el detalle de las
  plataformas): dice «Aún no.» y lleva a los asientos de ventas del libro diario, que es donde están hoy,
  como las entradas de Ajustes que aún no tienen pantalla.
- **La liquidación**: en la maqueta «Tu factura · Su factura · La cuenta · Ventas · Inventario» no son
  pestañas —lo dije mal en la versión anterior de este fichero— sino cinco píldoras verdes en la cabecera,
  arriba a la derecha, con «Los cinco documentos, leídos» debajo. Así van ahora; si falta uno, su píldora
  va en ámbar y debajo se dice qué no se puede comprobar sin él. «‹ Compras» encima del título y el mes,
  el local y la referencia debajo, y la tarjeta «Te paga» oscura, como la maqueta.
- **«Cómo te factura» en su pantalla**: «Clientes y proveedores › <proveedor>» y el título, una tarjeta
  con el aviso, las tres formas (con «Suele mandar la factura: una vez al mes · una por cada local» dentro
  de la segunda), «Dejarlo como estaba» y «Guardar» a la derecha, y la nota debajo, fuera. Llegan ahí
  «Abrir su ficha» desde Compras y, desde la ficha, la pestaña Pago.
- **«sin IVA»**: lo que dicen sus últimos papeles dice también si traían IVA («Sus 3 últimas entregas
  vinieron con albarán, sin IVA.»). Se mira lo leído de cada papel: la cuota, y si no hay, total contra
  base. Lo que no se sabe se dice («y no sé si traía IVA»), no se adivina. Medido en producción (solo
  lectura) sobre los 182 papeles leídos de Foodint: 167 con IVA, 2 sin IVA, 13 sin saberlo.
- **N21 como la maqueta**: después de recibir, la pantalla «Recibido» —de quién, cuántos productos y por
  cuánto— con la frase en su tarjeta, la primera oración en negrita, y «Recibir otro» y «Volver». Antes la
  frase iba al final del mensaje de confirmación, y en el asistente del móvil (el camino de quien recibe)
  no salía. Si la base no sabe decirla, no hay tarjeta; lo que haya que revisar se dice debajo.
- **El botón exacto**: «Es un albarán: esperar su factura» y «Ver el papel», como la maqueta; fuera el
  «Cambiar su ficha a…» que añadí (la costumbre se cambia en «Cómo te factura», que es lo que pide su
  aviso). Y el apoyo como la maqueta: «Recepción del lunes 5 de octubre · Norte Centro · 191,00 €», y en la
  de «Contado», «Así no puedes descontar su IVA.» debajo de la frase.

## Lo que arregló la respuesta 2 (11/10)

- **N21 · el botón principal en azul**: «Recibir otro» va en el azul del estilo nuevo, `#2F5BFF`, con el
  contorno de foco del mismo azul que pone la maqueta. Estaba negro (el `accent` de Cocina). Captura nueva:
  `recibido-movil.png`. Nota: el fichero de la maqueta pinta ese botón con `#1F45D6`, un azul más oscuro;
  he puesto `#2F5BFF` porque es el que dijo Julio y el botón principal del estilo (`--cx-azul`).

## Lo que sigue distinto de la maqueta

Aceptado por Julio:

1. **N19 · el IVA de su factura**: 400,67 € más 0,01 € de redondeo, no 400,66 €. Es como va en el papel
   por líneas, y el libro no admite una cuota que no sea base × tipo. Aceptado el 10/10.
2. **N19 · los números**: los de la captura son los de la semilla, y en staging las ventas salen «no las
   puedo comprobar». Es de los datos, no del diseño. Aceptado el 11/10 (respuesta 1).
3. **«Ventas» lleva a una pantalla que dice «Aún no.»**, con el enlace a los asientos de ventas del libro
   diario. La pantalla de Ventas queda como trabajo propio. Aceptado el 11/10 (respuesta 2).
4. **La pestaña Pago de la ficha guarda una línea** «Cómo te factura: «Con cada entrega». Cambiarlo», con
   el enlace a su pantalla. Aceptado el 11/10 (respuesta 2).
5. **Las filas de «Qué tienes que mirar» que la maqueta no dibuja**: si el papel es una factura y la ficha
   dice albarán, el botón dice «Es una factura: solo esta vez». Aceptado el 11/10 (respuesta 2).
6. **N20 · «Sus importes»** (si el importe de cada línea lleva el IVA dentro) se queda en la pestaña Pago
   de la ficha. Aceptado el 11/10 (respuesta 2).
