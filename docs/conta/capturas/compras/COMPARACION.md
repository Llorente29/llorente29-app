# Compras · capturas contra las maquetas

Capturas del e2e `tests/e2e/conta/compras/compras.spec.ts` contra staging-conta, en ordenador (1440)
y móvil (390), con la semilla `supabase/seeds/conta/seed_compras_staging.sql` (todo inventado). Las
maquetas: `docs/conta/maquetas/compras/{Main,Liquidacion,FichaProveedor,Recepcion}.dc.html`.

| Pantalla | Maqueta | Captura |
|---|---|---|
| Compras | N18 `Main` | `compras-ordenador.png`, `compras-movil.png` |
| Subir una factura (no dibujada) | — | `subir-factura-ordenador.png`, `subir-factura-movil.png` |
| La liquidación y su contraste | N19 `Liquidacion` | `liquidacion-ordenador.png`, `liquidacion-movil.png` |
| Cómo te factura (ficha, sin forma: el aviso) | N20 `FichaProveedor` | `como-te-factura-ordenador.png`, `como-te-factura-movil.png` |
| Cómo te factura (ficha, con su forma elegida) | N20 `FichaProveedor` | `como-te-factura-elegida-ordenador.png`, `como-te-factura-elegida-movil.png` |
| La frase al recibir | N21 `Recepcion` | sin captura: va en el mensaje de «Recepción … confirmada» |

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

## Lo que sigue distinto de la maqueta

Aceptado por Julio:

1. **N19 · el IVA de su factura**: 400,67 € más 0,01 € de redondeo, no 400,66 €. Es como va en el papel
   por líneas, y el libro no admite una cuota que no sea base × tipo. Aceptado el 10/10 («el céntimo
   está bien», y en el repaso: «lo del céntimo a redondeos queda como está»).

Pendiente de que Julio lo acepte (o diga cómo lo quiere):

2. **Menú.** La maqueta pinta «Ventas» y no pinta «Documentos», «Facturas que emites» ni «Cómo va tu
   negocio». Se queda el menú del C00 y se añade solo «Compras», delante de Bancos como en la maqueta.
   «Ventas» no existe todavía (sale cuando tenga pantalla).
3. **N19 · las pestañas** «Tu factura · Su factura · La cuenta · Ventas · Inventario»: no están. Lo leído
   va en el orden de la maqueta y los cinco documentos se ven arriba, cada uno con lo que se comprueba
   con él; el inventario se ve producto a producto en «Decirle cuál es cuál».
4. **N19 · los números**: los de la captura son los de la semilla. Los reales de septiembre, medidos en
   producción en solo lectura, están en el informe de la T5. Las ventas de staging no existen, así que la
   captura enseña el veredicto «Sus ventas no las puedo comprobar», no el «coinciden» de la maqueta.
5. **N20 · «sin IVA»** en «Sus 5 últimas entregas vinieron con albarán, sin IVA»: no se dice. Lo que se
   lee del papel es su tipo (albarán o factura), no si trae IVA.
6. **N20 · dónde va.** En la pestaña «Pago» de la ficha, en lugar de las píldoras «Cada cuánto te
   factura» (la forma de facturar ya decide cada cuánto).
7. **N21 · la frase** va dentro del mensaje que ya sale al confirmar una recepción, no en una pantalla
   aparte. Si la base no sabe decirla, no se dice nada: la confirmación no depende de ella.
8. **«Es un albarán: esperar su factura»** es el texto cuando el papel es un albarán y la ficha dice
   otra cosa; si es una factura, «Solo esta vez». El otro botón cambia la ficha a lo que sugiere el papel.
