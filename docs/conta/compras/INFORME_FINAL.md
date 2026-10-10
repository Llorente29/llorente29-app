# Contabilidad: las compras · informe final

Rama `conta/compras`, PR #173. Encargo de Julio del 10/10. Este informe cierra las tareas 2 a 7; la 1
está en `T1_comprobaciones.md`. Proveedores por letra o por su papel, sin nombres reales.

## Qué hace ahora Folvy con lo que se compra

1. **Cada papel decide su camino al confirmar la recepción** (0120). Factura a nombre de la empresa →
   se registra la factura (en revisión, aprobada según las reglas de la base). Albarán → espera factura.
   Género del socio de marca → va a su liquidación del mes. Lo que no se sabe (a nombre de quién va, o
   el papel contradice la ficha) se **pregunta** en Compras, no se adivina. Confirmar una recepción no
   puede fallar por esto: el disparador va envuelto y, si algo falla, lo apunta como pregunta.
2. **La forma de facturar es de la ficha** (N20): con cada entrega, albarán y factura después (una al
   mes, una por local), o liquidación mensual. Cambiarla vuelve a mirar las recepciones abiertas.
3. **Lo que espera factura** se ve por proveedor y local; al llegar la factura, se casa con sus albaranes
   y se dice la diferencia. A fin de mes, lo recibido sin factura se propone como asiento de fin de mes
   (y su contrario el día 1), con dos orígenes nuevos en el libro.
4. **La liquidación mensual del socio** se lee de sus cinco PDF en el navegador y se contrasta con lo
   que sabe Folvy: compras (lo recibido en el local), ventas por plataforma y producto a producto (con
   lo casado que se recuerda). Confirmarla registra su factura; los tres asientos los propone el libro.
   **Septiembre cuadra al céntimo** en staging con la lectura real (nombres y NIF cambiados): tú le
   facturas 9.533,65 €, él te factura 3.987,81 €, saldo 5.545,84 € a tu favor.
5. **Fichas**: unir dos fichas del mismo proveedor (con deshacer); lo que le falta a cada ficha se dice
   (NIF, con el que traen sus papeles si pasa la letra de control; tipo de gasto; forma de facturar).
6. **`ocr-albaran` lee el NIF del destinatario** (`bill_to_tax_id`), comparado antes y después; el del
   emisor se ofrece, nunca se aplica solo.

## Lo medido (producción, solo lectura)

- Septiembre en Alcalá: 26 recepciones del socio por 11.394,56 € contra 11.393,44 € de su documento
  (1,12 € de diferencia).
- Ventas de sus marcas en septiembre (sin IVA, fecha de Madrid): Glovo 19.281,93 € (1.016 pedidos),
  Uber 8.274,37 € (397), Just Eat 679,54 € (28). Foodint no tiene acuerdos de cesión: se toman las marcas
  cedidas que no son de nadie, y la pantalla lo dice.
- **Octubre de Foodint (0180)**: 18 recepciones confirmadas del 01/10 al 09/10, las 18 con papel y
  ninguna con factura ya registrada. Lo esperado, con la 0110 y la 0130: 14 del socio (1 a su
  liquidación; 13 preguntan «a nombre de quién» y se resuelven contestando **dos** nombres), 1 pregunta
  de papel contra ficha, y 3 facturas creadas en revisión que preguntan la forma de facturar de sus dos
  proveedores. El aviso del ensayo dirá el número real.

## La tanda de producción

`supabase/produccion/aplicar.txt`: de la 0100 a la 0180, con `vuelta-atras.txt`. Analizador pasado en
local contra el contexto real de producción (leído en solo lectura, guardado en
`tests/conta/produccion/contexto-produccion-compras-20261010.json`):

| Fichero | Analizador | Qué hace |
|---|---|---|
| 0100 fusión de proveedores | sigue | Añade |
| 0110 el socio, una ficha | sigue* | Une las cinco fichas del socio en 8d53a379, por id |
| 0120 forma de facturar | sigue | Añade; declara el disparador sobre `goods_receipt` |
| 0130 forma de facturar · datos | **autorizo** | Tres fichas de Foodint, por id |
| 0140 factura desde el papel | sigue | Añade; declara el disparador sobre `supplier_invoice` |
| 0150 pendiente y fin de mes | sigue | Añade |
| 0160 liquidación mensual | sigue | Añade |
| 0170 lo que leen las pantallas | sigue | Añade |
| 0180 octubre de Foodint | sigue* | Da camino a las 18 de octubre y crea sus 3 facturas |

\* La 0110 y la 0180 **mueven datos llamando a una función**, y el analizador no lee dentro de una
llamada: las da por «sigue». Está dicho en el manifiesto. La 0110 la aprobaste en la T1; la 0180 se
puede deshacer sola (apunta lo que crea).

El analizador paraba la 0120 y la 0140 (disparadores nuevos sobre tablas que ya existen, sin declarar):
ganaron su `-- cambia:` con la prueba de staging que nombra la tabla.

## Lo que te toca

1. **Lanzar la tanda**: ensayo y, en verde, real, con `autorizo` =
   `20261017T0130_compras_forma_de_facturar_datos.sql`. Fusionar a `main` publica también el front
   (Compras en el menú, «Cómo te factura», la frase al recibir).
2. **Después del despliegue**, lanzar `medir-ocr-destinatario.yml` (el antes y después del NIF del
   destinatario con las fotos de octubre). Hasta entonces la T2c está escrita y sin efecto.
3. **En Compras, contestar los dos nombres** de los locales del socio («Es …» la ficha del socio): las 13
   preguntas de octubre se resuelven solas y las próximas no volverán a salir.
4. **Fichas que no puedo rellenar yo**: la forma de facturar de los 6 proveedores de Casa Lola que el T1
   apuntó como «mensuales» (no la toqué: no se sabe si es liquidación o factura al mes); el tipo de gasto
   del socio; y sus acuerdos de cesión (sin ellos el contraste de ventas toma todas las marcas cedidas).

## Diferencias con las maquetas

Una a una en `docs/conta/capturas/compras/COMPARACION.md`. Las que cambian lo que se puede hacer:
«Apuntarla sin descontar el IVA» no está; el número del menú tampoco (va en la cabecera de «Qué tienes
que mirar»); «Ver el papel» no está en las filas; las pestañas de la liquidación son secciones.

## Lo que costó y queda escrito

- Run 123: el libro no admite una cuota que no sea base × tipo; el céntimo de redondeo de su factura va a
  redondeos (769/669), no al IVA. Aprobado.
- Run 125: `goods_receipt_path` no tiene `created_at` y la subconsulta lo buscó en las tablas de fuera
  (regla 40 en mi propio fichero). La condición se quitó: «sin camino» enseña todo, sin recortar.
- Las pruebas de las pantallas, escritas contra lo que devolvió la base y los textos aprobados, cazaron
  «S.L..» y «albaránes» antes de salir.
- El build exacto cazó dos errores de tipos que el lint no veía.
