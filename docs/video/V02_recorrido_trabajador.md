# V02 · El recorrido como trabajador (04/11)

Respuesta V02 · 1 de Julio (04/11, 07:55): antes de grabar, ver lo que enseña de verdad la app del trabajador. Sin locución, sin grabación y sin arreglar pantallas (T1).

- **Run:** [41788449791](https://github.com/Llorente29/llorente29-app/actions/runs/41788449791), en verde, staging-conta, carril 1, cuenta A.
- **Capturas:** en la rama [`video-salida/claude-v02-albaran-a-oficina`](https://github.com/Llorente29/llorente29-app/tree/video-salida/claude-v02-albaran-a-oficina/recorrer), carpeta `recorrer/`. Cada captura tiene su `.txt` con la URL y el texto de la pantalla. La que acaba en `-entera` es la página de arriba abajo.
- **Cocina:** `a.trabajador` en su app (`TrabajadorApp`), a 390×844 y a 2×.
- **Oficina:** `a.admin` en el ordenador, a 1920×1080.
- **Siembra** (`scripts/video/albaran-sembrar.sql`), con datos inventados (T11):
  - el pedido PED-00001 a «Frutas y Verduras La Huerta», enviado, para hoy, en el local de la ficha del trabajador («Taberna del Mercado»);
  - los formatos «Caja», «Saco» y «Garrafa»;
  - los proveedores de prueba de la plantilla sin «Prueba» en el nombre.
- **La lectura del albarán está simulada** (decisión del 03/11). La unidad «caja» la pone mi simulación en todas las líneas: el «2 caja» del aceite es mío, no de la app.

## Las pantallas

| # | Pantalla | Captura |
|---|---|---|
| 1 | Inicio del trabajador | `01-trabajador-inicio` |
| 2 | Recepciones | `02-trabajador-recepciones` |
| 3 | La cámara (escanear) | `03-trabajador-camara` |
| 4 | Con la foto | `04-trabajador-con-la-foto` |
| 5 | La lectura | `05-trabajador-lectura` |
| 6 | Asistente 1 de 4 · tomate | `06-trabajador-asistente-1` |
| 7 | Asistente 2 de 4 · lechuga, como llega | `07-trabajador-asistente-2` |
| 8 | Asistente 2 de 4 · lechuga, 2 de 3 | `08-trabajador-asistente-3-lechuga-2-de-3` |
| 9 | Asistente 3 de 4 · patata | `09-trabajador-asistente-3` |
| 10 | Asistente 4 de 4 · aceite | `10-trabajador-asistente-4` |
| 11 | Resumen («Todo revisado») | `11-trabajador-asistente-5` |
| 12 | «Recibido» | `12-trabajador-recibido` |
| 13 | Oficina · la lista | `13-oficina-lista` |
| 14 | Oficina · la revisión | `14-oficina-revision` |
| 15 | Oficina · «Verificado — cerrar» | `15-oficina-cerrado` |
| 16 | Oficina · la lista después (confianza) | `16-oficina-confianza` |
| 17 | Oficina · Pedidos | `17-oficina-pedidos` |
| 18 | Oficina · la ficha del pedido | `18-oficina-pedido-ficha` |

## Las preguntas de Julio

- **¿Se enlaza solo el pedido?** Sí. PED-00001 queda enlazado a ALB-00019 sin que nadie lo elija (`18`).
- **¿Sale «Recibido parcial» y lo que falta?** Sí: «Recibido parcial · Falta 1 de 4 · Lechuga romana · Caja · Pedido 3 · Llegó 2 · Falta 1», y en la lista de pedidos, «3 de 4 · faltan 1» (`17`, `18`).
- **¿Sale «Reclamar»?** **No.** La ficha dice: «Este proveedor no comunica por el grupo de CTB: la reclamación hay que hacerla por su vía de siempre.» `OrderShortfallPanel` solo deja reclamar a los proveedores de CTB (`puedeReclamar`). Con La Huerta no se puede enseñar.
- **¿Sale la confianza («x de 30»)?** **No comprobado.** El fallo es de mi guion: no encontró el selector del local en el ordenador («no encuentro el selector del local» en el log), y sin local la lista no pinta la confianza (`16`). No lo he relanzado, porque sería un segundo push a staging (T6).

## Lo que se ve mal

### A · Lo que sale en la app del trabajador

| # | Qué se ve mal | Pantalla | Captura |
|---|---|---|---|
| A1 | **El trabajador no ve el pedido que espera.** «Sin pedidos pendientes a la vista», aunque PED-00001 está enviado, es para hoy y es de su local; la tarjeta de Inicio tampoco lleva globo. La recepción luego sí se enlaza (`18`). Lo que el trabajador ve no coincide con lo que hay. Puede que su rol no lea los pedidos o que el filtro de la pantalla lo deje fuera; no lo he podido confirmar. | Recepciones (`OrderReceiveFlow`) | `01`, `02` |
| A2 | Escanear albarán sin márgenes a los lados: el texto, el recuadro y la tabla van pegados al borde de la pantalla. En la web de gestión sí tenía márgenes. | `ReceiptScanPanel` dentro de `TrabajadorApp` | `03`, `05` |
| A3 | La fecha sale como «2026-11-04»; el tipo, «albaran» sin tilde; el proveedor, cortado («La Hu…»); «Total —» vacío; el código partido en dos líneas («TOM-/10»). | Lectura | `05` |
| A4 | «¿Cuántos cajas han llegado?», «¿Cuántos garrafas…?»: no concuerda el género. | Asistente | `06`, `08`, `10` |
| A5 | «El albarán dice … · 4 caja»: el plural no concuerda. | Asistente | `06`–`10` |
| A6 | El importe se ve como «59,6» o «69», sin dos decimales ni €, justo encima de «el albarán dice 59,60 €». | Asistente | `06`, `10` |
| A7 | Al bajar la lechuga de 3 a 2 cajas sale «1,43 €/ud · +50 % sobre lo habitual»: divide lo cobrado entre lo llegado, y quien lo lee entiende que el precio ha subido (lo dijo Julio). | Asistente, `priceAlertFor` | `08` |
| A8 | El resumen dice «Todo revisado · 4 línea(s) del albarán» y no menciona que falta una caja. «línea(s)» se lee a medias. | Resumen | `11` |
| A9 | «Recibido» no dice qué pasa con el papel («Es un albarán…», `RecepcionHecha`), ni que se ha enlazado a su pedido, ni que falta algo. «· 4 productos» empieza la línea con el punto. | Recibido | `12` |
| A10 | El nombre de la ficha de prueba, «Trabajador» («Buenos días, Trabajador»), viene de la plantilla, no de la app. Lo puedo sembrar con un nombre inventado. | Inicio | `01` |

### B · En la oficina (ordenador)

| # | Qué se ve mal | Pantalla | Captura |
|---|---|---|---|
| B1 | La revisión no dice a qué pedido va ni que falta una caja de lechuga respecto al pedido: eso solo está en la ficha del pedido. | `ReceiptOfficeReview` | `14` |
| B2 | «Total del albarán —» vacío. | Revisión | `14` |
| B3 | «Trabajador de Prueba lo recibió…»: el nombre viene de la plantilla, como en A10. | Revisión | `14` |
| B4 | No se puede reclamar lo que falta a un proveedor que no es de CTB. | Ficha del pedido | `18` |
| B5 | El menú de arriba «Folvy Team / Folvy Safety / Folvy Kitchen…», en dos líneas y en inglés. | Barra de arriba | `13`–`18` |
| B6 | Total estimado «200,30 €» en letra de máquina de escribir, distinta del resto. | Ficha del pedido | `18` |

### C · Lo que solo pasaba como administradora en la web de gestión (no sale en la app del trabajador)

Comparado con el run 41751879005 (03/11):
- la barra de abajo con 13 iconos cortados y en inglés («Saf… Kit… Sales Shop»);
- la cabecera con «Todos los locales» y las pestañas Pedidos / Recepciones / Pendientes;
- tener que elegir el local antes de recibir (al trabajador se lo pone su ficha).

### D · Lo que ha arreglado la siembra (no era de la app)

- «viene en caja 12 uds de 12 unidades» → ahora «viene en cajas de 12 unidades». Con un formato cuyo nombre lleva el número, en una cuenta real, seguiría saliendo mal (es otro encargo).
- Los proveedores «… Prueba …» de la lista de oficina.
